// 云函数：match
// action: list | get | create | signup | leave | randomize | saveScore
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const MATCH = 'matches';
const USERS = 'users';

// 积分配置
const POINTS_TABLE = {
  major:     { win: 100, lose: 40 },
  challenge: { win: 60,  lose: 25 },
  friendly:  { win: 30,  lose: 10 }
};
const DOUBLES_FACTOR = 0.8;

async function getUser(openid) {
  const r = await db.collection(USERS).where({ openid }).get();
  return r.data[0];
}

// Fisher-Yates 洗牌
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 为用户添加一条赛事/比赛收益，并按最佳10场重算 totalPoints
// 与 tournament 云函数保持一致的积分计算逻辑
async function addMatchEarning(openid, matchId, pointsToAdd, matchTitle, matchDate) {
  const user = await getUser(openid);
  if (!user) return;

  const earnings = user.tournamentEarnings || [];
  // 查找该比赛是否已有记录（防止重复结算）
  const idx = earnings.findIndex(e => e.tournamentId === matchId);
  if (idx >= 0) {
    earnings[idx].earned += pointsToAdd;
  } else {
    earnings.push({ tournamentId: matchId, title: matchTitle, earned: pointsToAdd, date: matchDate });
  }

  // 取最佳10场计算 totalPoints（与 tournament 逻辑一致）
  const sorted = earnings.slice().sort((a, b) => b.earned - a.earned);
  const best10 = sorted.slice(0, 10);
  const totalPoints = best10.reduce((sum, e) => sum + e.earned, 0);

  await db.collection(USERS).where({ openid }).update({
    data: { tournamentEarnings: earnings, totalPoints, updatedAt: Date.now() }
  });
}

// 结算积分（使用 tournamentEarnings 模式，与赛事系统一致）
async function settlePoints(match, matchId, winner) {
  const level = match.level || 'friendly';
  const pts = POINTS_TABLE[level] || POINTS_TABLE.friendly;
  const factor = match.type === 'doubles' ? DOUBLES_FACTOR : 1;

  const winPoints = Math.round(pts.win * factor);
  const losePoints = Math.round(pts.lose * factor);

  const winners = winner === 'A' ? (match.teamA || []) : (match.teamB || []);
  const losers = winner === 'A' ? (match.teamB || []) : (match.teamA || []);

  const matchTitle = match.title || '快速比赛';
  const matchDate = match.matchDate || Date.now();

  for (const p of winners) {
    await addMatchEarning(p.openid, matchId, winPoints, matchTitle, matchDate);
  }
  for (const p of losers) {
    await addMatchEarning(p.openid, matchId, losePoints, matchTitle, matchDate);
  }

  return { winPoints, losePoints };
}

exports.main = async event => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action;

  if (action === 'list') {
    const res = await db.collection(MATCH)
      .orderBy('matchDate', 'desc')
      .limit(100)
      .get();
    return { code: 0, data: res.data };
  }

  if (action === 'get') {
    const res = await db.collection(MATCH).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '比赛不存在' };
    return { code: 0, data: res.data };
  }

  if (action === 'create') {
    const me = await getUser(OPENID);
    if (!me || !me.wecomName) return { code: 1, msg: '请先完成登记' };
    const p = event.payload || {};
    if (!p.title || !p.matchDate) return { code: 1, msg: '参数不完整' };
    const type = p.type === 'doubles' ? 'doubles' : 'singles';
    const bestOf = [4, 6].includes(p.bestOf) ? p.bestOf : 6;
    const level = ['major', 'challenge', 'friendly'].includes(p.level) ? p.level : 'friendly';

    const now = Date.now();
    const addRes = await db.collection(MATCH).add({
      data: {
        title: String(p.title).slice(0, 40),
        type,
        bestOf,
        level,
        handicapRule: p.handicapRule ? String(p.handicapRule).slice(0, 100) : '',
        matchDate: p.matchDate,
        // 报名者列表（先报名，后随机分配）
        signups: [],
        teamA: [],
        teamB: [],
        // 总比分（简化录分）
        scoreA: null,
        scoreB: null,
        winner: null,
        scoreSummary: '',
        pointsAwarded: null,
        creator: OPENID,
        creatorName: me.wecomName,
        status: 'signup', // signup → ready → finished
        createdAt: now,
        updatedAt: now
      }
    });
    return { code: 0, data: { _id: addRes._id } };
  }

  // 报名（不选边，只加入报名列表）
  if (action === 'signup') {
    const me = await getUser(OPENID);
    if (!me || !me.wecomName) return { code: 1, msg: '请先完成登记' };

    const res = await db.collection(MATCH).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '比赛不存在' };
    const m = res.data;
    if (m.status !== 'signup') return { code: 1, msg: '报名已截止' };

    const signups = m.signups || [];
    if (signups.some(p => p.openid === OPENID)) {
      return { code: 1, msg: '你已报名' };
    }

    const max = m.type === 'doubles' ? 4 : 2;
    if (signups.length >= max) return { code: 1, msg: '人数已满' };

    signups.push({ openid: OPENID, wecomName: me.wecomName, gender: me.gender || '' });
    await db.collection(MATCH).doc(event.id).update({
      data: { signups, updatedAt: Date.now() }
    });
    return { code: 0, data: true };
  }

  // 取消报名
  if (action === 'leave') {
    const res = await db.collection(MATCH).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '比赛不存在' };
    const m = res.data;
    if (m.status === 'finished') return { code: 1, msg: '比赛已结束' };

    if (m.status === 'signup') {
      // 报名阶段：从 signups 中移除
      const signups = (m.signups || []).filter(p => p.openid !== OPENID);
      await db.collection(MATCH).doc(event.id).update({
        data: { signups, updatedAt: Date.now() }
      });
    } else {
      // 已分配阶段：从 teamA/teamB 中移除，回退到 signup 状态
      const teamA = (m.teamA || []).filter(p => p.openid !== OPENID);
      const teamB = (m.teamB || []).filter(p => p.openid !== OPENID);
      const signups = [...teamA, ...teamB];
      await db.collection(MATCH).doc(event.id).update({
        data: { teamA: [], teamB: [], signups, status: 'signup', updatedAt: Date.now() }
      });
    }
    return { code: 0, data: true };
  }

  // 随机分组（管理员/创建者操作）
  if (action === 'randomize') {
    const me = await getUser(OPENID);
    const res = await db.collection(MATCH).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '比赛不存在' };
    const m = res.data;

    if (m.creator !== OPENID && (!me || me.role !== 'admin')) {
      return { code: 1, msg: '无权限操作' };
    }
    if (m.status !== 'signup') return { code: 1, msg: '当前状态不允许分组' };

    const signups = m.signups || [];
    const need = m.type === 'doubles' ? 4 : 2;
    if (signups.length < need) {
      return { code: 1, msg: `需要 ${need} 人才能分组` };
    }

    // 随机打乱并分配
    const shuffled = shuffle(signups);
    const half = need / 2;
    const teamA = shuffled.slice(0, half);
    const teamB = shuffled.slice(half, need);

    await db.collection(MATCH).doc(event.id).update({
      data: { teamA, teamB, signups: [], status: 'ready', updatedAt: Date.now() }
    });
    return { code: 0, data: { teamA, teamB } };
  }

  // 录入总比分
  if (action === 'saveScore') {
    const res = await db.collection(MATCH).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '比赛不存在' };
    const m = res.data;
    const me = await getUser(OPENID);
    const inTeam =
      (m.teamA || []).some(p => p.openid === OPENID) ||
      (m.teamB || []).some(p => p.openid === OPENID);
    const isCreator = m.creator === OPENID;
    const isAdmin = me && me.role === 'admin';
    if (!inTeam && !isCreator && !isAdmin) {
      return { code: 1, msg: '无权限录入比分' };
    }

    const scoreA = parseInt(event.scoreA);
    const scoreB = parseInt(event.scoreB);
    if (isNaN(scoreA) || isNaN(scoreB) || scoreA < 0 || scoreB < 0) {
      return { code: 1, msg: '比分格式错误' };
    }
    // 先赢N盘制：胜者必须恰好等于 bestOf，负者 0 ~ bestOf-1
    const target = m.bestOf;
    const valid = (scoreA === target && scoreB >= 0 && scoreB < target) ||
                  (scoreB === target && scoreA >= 0 && scoreA < target);
    if (!valid) {
      return { code: 1, msg: `比分不合法（先赢${target}盘制）` };
    }

    const winner = scoreA > scoreB ? 'A' : 'B';
    const scoreSummary = `${scoreA}:${scoreB}`;

    // 结算积分（仅在之前未结算时）
    let pointsAwarded = m.pointsAwarded || null;
    if (!pointsAwarded) {
      pointsAwarded = await settlePoints(m, event.id, winner);
    }

    await db.collection(MATCH).doc(event.id).update({
      data: {
        scoreA,
        scoreB,
        winner,
        scoreSummary,
        status: 'finished',
        pointsAwarded,
        updatedAt: Date.now()
      }
    });
    return { code: 0, data: { winner, scoreSummary, pointsAwarded } };
  }

  return { code: 1, msg: '未知 action' };
};
