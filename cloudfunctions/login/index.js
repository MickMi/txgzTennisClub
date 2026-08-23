// 云函数：login
// 功能：根据 openid 查询/创建用户；支持更新企微名等用户信息；获取个人档案
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const USERS = 'users';

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { code: 1, msg: '无法获取 openid' };
  }

  const action = event.action || 'login';

  // 查询当前用户
  const queryRes = await db.collection(USERS).where({ openid: OPENID }).get();
  let user = queryRes.data[0];

  // 不存在 → 创建空记录（等用户去 onboarding 填企微名）
  if (!user) {
    const role = await shouldBeAdmin(OPENID) ? 'admin' : 'member';
    const now = Date.now();
    const addRes = await db.collection(USERS).add({
      data: {
        openid: OPENID,
        wecomName: '',
        gender: '',
        avatarUrl: '',
        rating: '',
        totalPoints: 0,
        eloRating: 1500,
        eloHistory: [{ date: now, value: 1500, tournamentId: '' }],
        tournamentEarnings: [],
        role,
        createdAt: now,
        updatedAt: now
      }
    });
    user = {
      _id: addRes._id,
      openid: OPENID,
      wecomName: '',
      gender: '',
      avatarUrl: '',
      rating: '',
      totalPoints: 0,
      eloRating: 1500,
      eloHistory: [{ date: now, value: 1500, tournamentId: '' }],
      tournamentEarnings: [],
      role,
      createdAt: now,
      updatedAt: now
    };
  }

  if (action === 'update') {
    const payload = event.payload || {};
    const update = { updatedAt: Date.now() };
    if (typeof payload.wecomName === 'string') {
      const name = payload.wecomName.trim();
      if (!name) return { code: 1, msg: '昵称不能为空' };
      if (name.length > 20) return { code: 1, msg: '昵称过长' };
      update.wecomName = name;
    }
    if (typeof payload.rating === 'string') {
      update.rating = payload.rating.trim().slice(0, 10);
    }
    if (typeof payload.gender === 'string' && (payload.gender === 'male' || payload.gender === 'female')) {
      update.gender = payload.gender;
    }
    if (typeof payload.avatarUrl === 'string') {
      // 允许设置为空（清除头像）或云文件ID
      update.avatarUrl = payload.avatarUrl;
    }
    await db.collection(USERS).doc(user._id).update({ data: update });
    user = { ...user, ...update };

    // 同步更新已报名赛事中的展示名和头像（保证显示一致）
    if (update.wecomName || update.avatarUrl !== undefined) {
      await syncUserDisplay(OPENID, update.wecomName || user.wecomName, update.avatarUrl !== undefined ? update.avatarUrl : (user.avatarUrl || ''));
    }
  }

  // 获取积分排行榜
  if (action === 'getRanking') {
    const res = await db.collection(USERS)
      .where({ wecomName: _.neq('') })
      .orderBy('totalPoints', 'desc')
      .limit(100)
      .field({ openid: true, wecomName: true, gender: true, avatarUrl: true, rating: true, totalPoints: true, eloRating: true })
      .get();
    // 并列排名：同分同名次（dense ranking: 1, 2, 2, 3, ...）
    let rank = 0;
    let prevPoints = null;
    const list = (res.data || []).map((u, idx) => {
      const points = u.totalPoints || 0;
      if (idx === 0 || points !== prevPoints) {
        rank = rank + 1;
      }
      prevPoints = points;
      return {
        rank,
        openid: u.openid,
        wecomName: u.wecomName,
        gender: u.gender || '',
        avatarUrl: u.avatarUrl || '',
        rating: u.rating || '',
        totalPoints: points,
        eloRating: u.eloRating || 1500
      };
    });
    const myEntry = list.find(u => u.openid === OPENID);
    const myRank = myEntry ? myEntry.rank : 0;
    return { code: 0, data: { list, myRank } };
  }

  // 获取个人档案：评级 + 战绩统计
  // 支持查看其他用户：传 event.openid 即可。社团内部，不限隐私。
  if (action === 'getProfile') {
    const targetOpenid = event.openid || OPENID;
    let targetUser = user;
    if (targetOpenid !== OPENID) {
      targetUser = await getUserByOpenid(targetOpenid);
      if (!targetUser) return { code: 1, msg: '用户不存在' };
    }
    const profile = await buildProfile(targetOpenid, targetUser);
    return { code: 0, data: profile };
  }

  // 列出全部成员（admin 限定，用于成员管理页）
  if (action === 'listMembers') {
    if (!user || user.role !== 'admin') return { code: 1, msg: '无权限' };
    const r = await db.collection(USERS)
      .where({ wecomName: _.neq('') })
      .orderBy('role', 'desc')      // admin 排前面
      .orderBy('createdAt', 'asc')   // 同角色按加入时间
      .field({
        openid: true, wecomName: true, gender: true, avatarUrl: true, rating: true,
        role: true, totalPoints: true, eloRating: true, createdAt: true
      })
      .limit(200)
      .get();
    return {
      code: 0,
      data: {
        list: r.data || [],
        myOpenid: OPENID,
        adminCount: (r.data || []).filter(u => u.role === 'admin').length
      }
    };
  }

  // 切换某成员角色（admin 限定）
  if (action === 'setRole') {
    if (!user || user.role !== 'admin') return { code: 1, msg: '无权限' };
    const { targetOpenid, role } = event;
    if (!targetOpenid) return { code: 1, msg: '缺少目标 openid' };
    if (role !== 'admin' && role !== 'member') return { code: 1, msg: '角色无效' };

    // 防止自降级（避免无 admin 死锁）
    if (targetOpenid === OPENID && role !== 'admin') {
      return { code: 1, msg: '不能降级自己（请先把另一位提升为 admin 再降自己）' };
    }

    const target = await getUserByOpenid(targetOpenid);
    if (!target) return { code: 1, msg: '目标用户不存在' };
    if (target.role === role) return { code: 1, msg: '角色未变更' };

    // 防止把"最后一个 admin"降级（即便不是自己，也要保证至少一个 admin）
    if (target.role === 'admin' && role === 'member') {
      const r = await db.collection(USERS).where({ role: 'admin' }).count();
      if ((r.total || 0) <= 1) {
        return { code: 1, msg: '至少要保留一位管理员' };
      }
    }

    await db.collection(USERS).doc(target._id).update({
      data: { role, updatedAt: Date.now() }
    });
    return { code: 0, data: { openid: targetOpenid, role } };
  }

  return { code: 0, data: user };
};

// 按 openid 直查（buildProfile 时复用）
async function getUserByOpenid(openid) {
  const r = await db.collection(USERS).where({ openid }).get();
  return r.data[0];
}

// 构建个人档案
async function buildProfile(openid, user) {
  // 从 tournaments 集合统计战绩（小组赛 + 淘汰赛）
  // 只拉构建战绩需要的字段，避免老用户拉几 MB 的 placementAwards/config/handicapRule 等
  const tournamentRes = await db.collection('tournaments')
    .where({ 'players.openid': openid })
    .field({
      title: true,
      type: true,
      matchDate: true,
      groups: true,
      knockout: true,
      teams: true
    })
    .orderBy('createdAt', 'desc')
    .limit(30)
    .get();
  const tournaments = tournamentRes.data || [];

  let wins = 0;
  let losses = 0;
  let pending = 0;
  let singlesWins = 0, singlesLosses = 0, singlesPending = 0;
  let doublesWins = 0, doublesLosses = 0, doublesPending = 0;
  const matchHistory = [];

  // 判断某个 player unit 是否包含指定 openid（兼容单打和双打 compound player）
  // teams: tournament.teams 数组，作为 members 缺失时的回查来源
  function unitContainsPlayer(unit, oid, teams) {
    if (!unit) return false;
    // 单打：直接匹配
    if (unit.openid === oid) return true;
    // 双打：优先查 members 数组
    if (Array.isArray(unit.members) && unit.members.length > 0) {
      return unit.members.some(m => m.openid === oid);
    }
    // 双打 fallback：openid 是合成 ID（team_oidA_oidB），members 缺失时回查 teams
    if (unit.openid && unit.openid.startsWith('team_')) {
      if (Array.isArray(teams)) {
        const team = teams.find(t => t.openid === unit.openid);
        if (team && Array.isArray(team.members)) {
          return team.members.some(m => m.openid === oid);
        }
      }
      // 最终 fallback：从合成 ID 解析（微信 openid 不含下划线，可安全 split）
      const inner = unit.openid.slice(5); // 去掉 "team_"
      // 找第一个 openid 边界：微信 openid 以 'o' 开头，约 28 字符
      // 但更稳妥的做法：检查 inner 是否包含 oid
      return inner.includes(oid);
    }
    return false;
  }

  for (const t of tournaments) {
    const isDoubles = t.type === 'doubles';
    const teams = t.teams || [];
    // 遍历小组赛
    for (const g of (t.groups || [])) {
      for (const m of (g.matches || [])) {
        const isPlayerA = unitContainsPlayer(m.playerA, openid, teams);
        const isPlayerB = unitContainsPlayer(m.playerB, openid, teams);
        if (!isPlayerA && !isPlayerB) continue;

        if (m.winner) {
          const iWon = (m.winner === 'A' && isPlayerA) || (m.winner === 'B' && isPlayerB);
          if (iWon) { wins++; if (isDoubles) doublesWins++; else singlesWins++; }
          else { losses++; if (isDoubles) doublesLosses++; else singlesLosses++; }
          matchHistory.push({
            _id: t._id + '_' + m.id,
            tournamentId: t._id,
            title: t.title + ' · ' + g.name + '组',
            type: t.type,
            matchDate: t.matchDate,
            scoreSummary: m.scoreSummary || '',
            result: iWon ? 'win' : 'loss',
            opponent: isPlayerA ? (m.playerB && m.playerB.wecomName || '') : (m.playerA && m.playerA.wecomName || '')
          });
        } else {
          pending++;
          if (isDoubles) doublesPending++; else singlesPending++;
        }
      }
    }

    // 遍历淘汰赛
    if (t.knockout && t.knockout.rounds) {
      for (const round of t.knockout.rounds) {
        for (const m of (round.matches || [])) {
          const isPlayerA = unitContainsPlayer(m.playerA, openid, teams);
          const isPlayerB = unitContainsPlayer(m.playerB, openid, teams);
          if (!isPlayerA && !isPlayerB) continue;

          if (m.winner) {
            const iWon = (m.winner === 'A' && isPlayerA) || (m.winner === 'B' && isPlayerB);
            if (iWon) { wins++; if (isDoubles) doublesWins++; else singlesWins++; }
            else { losses++; if (isDoubles) doublesLosses++; else singlesLosses++; }
            matchHistory.push({
              _id: t._id + '_' + m.id,
              tournamentId: t._id,
              title: t.title + ' · ' + round.name,
              type: t.type,
              matchDate: t.matchDate,
              scoreSummary: m.scoreSummary || '',
              result: iWon ? 'win' : 'loss',
              opponent: isPlayerA ? (m.playerB && m.playerB.wecomName || '') : (m.playerA && m.playerA.wecomName || '')
            });
          } else if (m.playerA && m.playerB && !m.bye) {
            pending++;
            if (isDoubles) doublesPending++; else singlesPending++;
          }
        }
      }
    }

    // 遍历团队赛（type='team'）：match 结构不同于个人赛，需要遍历 slots
    if (t.type === 'team') {
      const teams = t.teams || [];
      const group = t.groups && t.groups[0];
      const match = group && group.matches && group.matches[0];
      if (!match) continue;

      // 判断玩家属于哪个队
      let playerTeamSide = null; // 'A' | 'B'
      for (const tu of teams) {
        if ((tu.members || []).some(m => m.openid === openid)) {
          playerTeamSide = tu.openid === match.teamA ? 'A' : 'B';
          break;
        }
      }
      if (!playerTeamSide) continue;

      // 构建 openid → wecomName 查找表（用于对手名）
      const nameMap = {};
      for (const tu of teams) {
        for (const m of (tu.members || [])) {
          if (m.openid && m.wecomName) nameMap[m.openid] = m.wecomName;
        }
      }

      // 遍历每个 slot：只统计玩家明确上场的 slot
      for (const slot of (match.slots || [])) {
        const lineup = slot.lineup;
        if (!lineup) continue;

        const inLineupA = (lineup.A || []).includes(openid);
        const inLineupB = (lineup.B || []).includes(openid);
        if (!inLineupA && !inLineupB) continue;

        const playerSide = inLineupA ? 'A' : 'B';
        const oppSide = inLineupA ? 'B' : 'A';
        const slotIsDoubles = (lineup.A || []).length === 2;

        // 对手名
        const oppOids = (lineup[oppSide] || []);
        const oppNames = oppOids.map(oid => nameMap[oid] || '').filter(Boolean).join('/');

        if (slot.winner) {
          const iWon = slot.winner === playerSide;
          if (iWon) { wins++; if (slotIsDoubles) doublesWins++; else singlesWins++; }
          else { losses++; if (slotIsDoubles) doublesLosses++; else singlesLosses++; }
          matchHistory.push({
            _id: t._id + '_slot_' + slot.index,
            tournamentId: t._id,
            title: t.title + ' · 团队赛 Slot ' + slot.index + (slot.isTiebreak ? ' 一球制胜' : ''),
            type: slotIsDoubles ? 'doubles' : 'singles',
            matchDate: t.matchDate,
            scoreSummary: slot.score || '',
            result: iWon ? 'win' : 'loss',
            opponent: oppNames || 'TBD',
            isTeamSlot: true
          });
        } else {
          // 已排阵但未录分
          pending++;
          if (slotIsDoubles) doublesPending++; else singlesPending++;
        }
      }
    }
  }

  // 按时间倒序排列战绩
  matchHistory.sort((a, b) => (b.matchDate || 0) - (a.matchDate || 0));

  // ELO 历史（用于折线图）
  const eloHistory = user.eloHistory || [];

  // 积分历史（从 tournamentEarnings 推导，每参加一场赛事后的最佳10场总分）
  const earnings = (user.tournamentEarnings || []).slice().sort((a, b) => a.date - b.date);
  const pointsHistory = [];
  for (let i = 0; i < earnings.length; i++) {
    const soFar = earnings.slice(0, i + 1).sort((a, b) => b.earned - a.earned).slice(0, 10);
    const total = soFar.reduce((s, e) => s + e.earned, 0);
    pointsHistory.push({ date: earnings[i].date, value: total, title: earnings[i].title });
  }
  // 前补起点 0，让图表从零开始显示趋势
  if (pointsHistory.length >= 1) {
    pointsHistory.unshift({ date: pointsHistory[0].date - 86400000, value: 0, title: '起点' });
  }

  // Delta 计算（最近一场赛事带来的变化量）
  const eloDelta = eloHistory.length >= 2
    ? eloHistory[eloHistory.length - 1].value - eloHistory[eloHistory.length - 2].value
    : eloHistory.length === 1 ? eloHistory[0].value - 1500 : 0;
  const pointsDelta = earnings.length > 0 ? earnings[earnings.length - 1].earned : 0;

  return {
    user,
    rating: user.rating || '',
    stats: { wins, losses, pending, total: wins + losses + pending },
    singlesStats: { wins: singlesWins, losses: singlesLosses, pending: singlesPending, total: singlesWins + singlesLosses + singlesPending },
    doublesStats: { wins: doublesWins, losses: doublesLosses, pending: doublesPending, total: doublesWins + doublesLosses + doublesPending },
    eloDelta,
    pointsDelta,
    matchHistory: matchHistory.slice(0, 20),
    eloHistory,
    pointsHistory
  };
}

// 判断是否为预设管理员（不再用"第一个进入的人"逻辑，避免审核员误获 admin）
// 只有 openid 在白名单中的用户才能成为 admin
const ADMIN_OPENIDS = [
  'oLGNX3Ql53l7XD4RbCwXHorEu5u4'  // mickmi
  // 如需新增管理员，在小程序内使用成员管理功能提升即可
];

async function shouldBeAdmin(openid) {
  // 如果白名单非空，按白名单判断
  if (ADMIN_OPENIDS.length > 0) {
    return ADMIN_OPENIDS.includes(openid);
  }
  // 白名单为空时的兜底：如果数据库已有 admin 则新用户不给 admin
  const { total } = await db.collection(USERS).where({ role: 'admin' }).count();
  return total === 0;
}

// 用户改名/换头像后同步赛事中保存的冗余名称和头像
// 注：match 集合已废弃（独立比赛功能于 2026-05-24 删除），不再同步
async function syncUserDisplay(openid, newName, newAvatarUrl) {
  const tourRes = await db.collection('tournaments')
    .where({ 'players.openid': openid })
    .get();

  const patchPlayer = (p) => {
    if (p.openid !== openid) return p;
    const patched = { ...p, wecomName: newName };
    if (newAvatarUrl !== undefined) patched.avatarUrl = newAvatarUrl;
    return patched;
  };

  // 赛事 tournaments：players / groups / knockout 中的冗余名称（并行更新）
  const tourUpdates = (tourRes.data || []).map(t => {
    const updateData = {};

    // players 列表
    if (t.players && t.players.length > 0) {
      updateData.players = t.players.map(patchPlayer);
    }

    // groups 中的 players / matches / standings
    if (t.groups && t.groups.length > 0) {
      updateData.groups = t.groups.map(g => ({
        ...g,
        players: (g.players || []).map(patchPlayer),
        matches: (g.matches || []).map(m => ({
          ...m,
          playerA: m.playerA && m.playerA.openid === openid
            ? patchPlayer(m.playerA) : m.playerA,
          playerB: m.playerB && m.playerB.openid === openid
            ? patchPlayer(m.playerB) : m.playerB
        })),
        standings: (g.standings || []).map(s =>
          s.openid === openid ? { ...s, wecomName: newName } : s
        )
      }));
    }

    // knockout 中的对阵名称
    if (t.knockout && t.knockout.rounds) {
      updateData.knockout = {
        ...t.knockout,
        rounds: t.knockout.rounds.map(round => ({
          ...round,
          matches: (round.matches || []).map(m => ({
            ...m,
            playerA: m.playerA && m.playerA.openid === openid
              ? patchPlayer(m.playerA) : m.playerA,
            playerB: m.playerB && m.playerB.openid === openid
              ? patchPlayer(m.playerB) : m.playerB
          }))
        }))
      };
    }

    if (Object.keys(updateData).length === 0) return null;
    updateData.updatedAt = Date.now();
    return db.collection('tournaments').doc(t._id).update({ data: updateData });
  }).filter(Boolean);

  await Promise.all(tourUpdates);
}
