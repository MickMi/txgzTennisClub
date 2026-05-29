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
    const role = await isFirstUser() ? 'admin' : 'member';
    const now = Date.now();
    const addRes = await db.collection(USERS).add({
      data: {
        openid: OPENID,
        wecomName: '',
        gender: '',
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
      if (!name) return { code: 1, msg: '企微名不能为空' };
      if (name.length > 20) return { code: 1, msg: '企微名过长' };
      update.wecomName = name;
    }
    if (typeof payload.rating === 'string') {
      update.rating = payload.rating.trim().slice(0, 10);
    }
    if (typeof payload.gender === 'string' && (payload.gender === 'male' || payload.gender === 'female')) {
      update.gender = payload.gender;
    }
    await db.collection(USERS).doc(user._id).update({ data: update });
    user = { ...user, ...update };

    // 同步更新已报名活动 / 比赛中的展示名（保证显示一致）
    if (update.wecomName) {
      await syncWecomName(OPENID, update.wecomName);
    }
  }

  // 获取积分排行榜
  if (action === 'getRanking') {
    const res = await db.collection(USERS)
      .where({ wecomName: _.neq('') })
      .orderBy('totalPoints', 'desc')
      .limit(100)
      .field({ openid: true, wecomName: true, gender: true, rating: true, totalPoints: true, eloRating: true })
      .get();
    const list = (res.data || []).map((u, idx) => ({
      rank: idx + 1,
      openid: u.openid,
      wecomName: u.wecomName,
      gender: u.gender || '',
      rating: u.rating || '',
      totalPoints: u.totalPoints || 0,
      eloRating: u.eloRating || 1500
    }));
    const myRank = list.findIndex(u => u.openid === OPENID) + 1;
    return { code: 0, data: { list, myRank } };
  }

  // 获取个人档案：评级 + 战绩统计 + 参与的活动
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
      knockout: true
    })
    .orderBy('createdAt', 'desc')
    .limit(30)
    .get();
  const tournaments = tournamentRes.data || [];

  let wins = 0;
  let losses = 0;
  let pending = 0;
  const matchHistory = [];

  for (const t of tournaments) {
    // 遍历小组赛
    for (const g of (t.groups || [])) {
      for (const m of (g.matches || [])) {
        const isPlayerA = m.playerA && m.playerA.openid === openid;
        const isPlayerB = m.playerB && m.playerB.openid === openid;
        if (!isPlayerA && !isPlayerB) continue;

        if (m.winner) {
          const iWon = (m.winner === 'A' && isPlayerA) || (m.winner === 'B' && isPlayerB);
          if (iWon) wins++;
          else losses++;
          matchHistory.push({
            _id: t._id + '_' + m.id,
            title: t.title + ' · ' + g.name + '组',
            type: t.type,
            matchDate: t.matchDate,
            scoreSummary: m.scoreSummary || '',
            result: iWon ? 'win' : 'loss',
            opponent: isPlayerA ? (m.playerB && m.playerB.wecomName || '') : (m.playerA && m.playerA.wecomName || '')
          });
        } else {
          pending++;
        }
      }
    }

    // 遍历淘汰赛
    if (t.knockout && t.knockout.rounds) {
      for (const round of t.knockout.rounds) {
        for (const m of (round.matches || [])) {
          const isPlayerA = m.playerA && m.playerA.openid === openid;
          const isPlayerB = m.playerB && m.playerB.openid === openid;
          if (!isPlayerA && !isPlayerB) continue;

          if (m.winner) {
            const iWon = (m.winner === 'A' && isPlayerA) || (m.winner === 'B' && isPlayerB);
            if (iWon) wins++;
            else losses++;
            matchHistory.push({
              _id: t._id + '_' + m.id,
              title: t.title + ' · ' + round.name,
              type: t.type,
              matchDate: t.matchDate,
              scoreSummary: m.scoreSummary || '',
              result: iWon ? 'win' : 'loss',
              opponent: isPlayerA ? (m.playerB && m.playerB.wecomName || '') : (m.playerA && m.playerA.wecomName || '')
            });
          } else if (m.playerA && m.playerB && !m.bye) {
            pending++;
          }
        }
      }
    }
  }

  // 按时间倒序排列战绩
  matchHistory.sort((a, b) => (b.matchDate || 0) - (a.matchDate || 0));

  // 查询参与的活动
  const actRes = await db.collection('activities')
    .where({ 'participants.openid': openid })
    .field({
      title: true,
      startTime: true,
      location: true,
      participants: true,
      status: true
    })
    .orderBy('startTime', 'desc')
    .limit(30)
    .get();
  const activities = (actRes.data || []).map(a => ({
    _id: a._id,
    title: a.title,
    startTime: a.startTime,
    location: a.location,
    participantCount: (a.participants || []).length,
    status: a.status
  }));

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

  return {
    user,
    rating: user.rating || '',
    stats: { wins, losses, pending, total: wins + losses + pending },
    matchHistory: matchHistory.slice(0, 20),
    activities,
    eloHistory,
    pointsHistory
  };
}

// 第一个进入的用户自动成为 admin
async function isFirstUser() {
  const { total } = await db.collection(USERS).count();
  return total === 0;
}

// 用户改名后同步活动/赛事中保存的冗余名称
// 注：match 集合已废弃（独立比赛功能于 2026-05-24 删除），不再同步
async function syncWecomName(openid, newName) {
  // 并行拉取需要更新的活动 + 赛事
  const [actsRes, tourRes] = await Promise.all([
    db.collection('activities').where({ 'participants.openid': openid }).get(),
    db.collection('tournaments').where({ 'players.openid': openid }).get()
  ]);

  // 活动 participants（并行更新）
  const actUpdates = (actsRes.data || []).map(a => {
    const ps = (a.participants || []).map(p =>
      p.openid === openid ? { ...p, wecomName: newName } : p
    );
    return db.collection('activities').doc(a._id).update({ data: { participants: ps } });
  });

  // 赛事 tournaments：players / groups / knockout 中的冗余名称（并行更新）
  const tourUpdates = (tourRes.data || []).map(t => {
    const updateData = {};

    // players 列表
    if (t.players && t.players.length > 0) {
      updateData.players = t.players.map(p =>
        p.openid === openid ? { ...p, wecomName: newName } : p
      );
    }

    // groups 中的 players / matches / standings
    if (t.groups && t.groups.length > 0) {
      updateData.groups = t.groups.map(g => ({
        ...g,
        players: (g.players || []).map(p =>
          p.openid === openid ? { ...p, wecomName: newName } : p
        ),
        matches: (g.matches || []).map(m => ({
          ...m,
          playerA: m.playerA && m.playerA.openid === openid
            ? { ...m.playerA, wecomName: newName } : m.playerA,
          playerB: m.playerB && m.playerB.openid === openid
            ? { ...m.playerB, wecomName: newName } : m.playerB
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
              ? { ...m.playerA, wecomName: newName } : m.playerA,
            playerB: m.playerB && m.playerB.openid === openid
              ? { ...m.playerB, wecomName: newName } : m.playerB
          }))
        }))
      };
    }

    if (Object.keys(updateData).length === 0) return null;
    updateData.updatedAt = Date.now();
    return db.collection('tournaments').doc(t._id).update({ data: updateData });
  }).filter(Boolean);

  await Promise.all([...actUpdates, ...tourUpdates]);
}
