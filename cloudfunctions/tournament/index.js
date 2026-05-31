// 云函数：tournament
// 赛事管理：小组赛 + 淘汰赛，种子制抽签
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const TOURNAMENTS = 'tournaments';
const USERS = 'users';

// 积分配置
// 赛事奖励积分（按最终名次发放）
const PLACEMENT_BONUS = {
  friendly:  { champion: 50, runnerUp: 30, semiFinal: 15, quarterFinal: 8, participant: 3 },
  challenge: { champion: 100, runnerUp: 60, semiFinal: 30, quarterFinal: 15, participant: 8 },
  major:     { champion: 200, runnerUp: 120, semiFinal: 60, quarterFinal: 30, participant: 15 }
};
const DOUBLES_FACTOR = 0.8;

// ELO 计算：期望胜率
function expectedWinRate(myElo, opponentElo) {
  return 1 / (1 + Math.pow(10, (opponentElo - myElo) / 400));
}

// ELO 小分（每场比赛积分奖励）
function calcMatchPoints(winnerElo, loserElo) {
  const expected = expectedWinRate(winnerElo, loserElo);
  // 胜者：3~8分，爆冷越大加越多
  const winnerPts = Math.max(3, Math.min(8, Math.round(5 + 3 * (1 - expected))));
  // 负者：1~3分，越意外输安慰越多
  const loserPts = Math.max(1, Math.min(3, Math.round(1 + 2 * expected)));
  return { winnerPts, loserPts };
}

// ELO 等级分变动（K=32）
function calcEloChange(winnerElo, loserElo) {
  const K = 32;
  const expected = expectedWinRate(winnerElo, loserElo);
  const winnerDelta = Math.round(K * (1 - expected));
  const loserDelta = -Math.round(K * expected);
  return { winnerDelta, loserDelta };
}

async function getUser(openid) {
  const r = await db.collection(USERS).where({ openid }).get();
  return r.data[0];
}

// 给定 user 当前数据 + 比赛信息，构造 user 文档的更新 payload。
// 用于事务内"一次写入"合并 ELO 变动 + 赛事积分收益 + 最佳10场总分 + ELO 历史。
// ELO history 限长 200 条，避免老用户数组无限膨胀。
function buildUserSettlePayload(user, tournamentId, tournamentTitle, tournamentDate, eloDelta, pointsToAdd) {
  const oldElo = user.eloRating || 1500;
  const newElo = oldElo + eloDelta;

  const earnings = (user.tournamentEarnings || []).slice();
  const idx = earnings.findIndex(e => e.tournamentId === tournamentId);
  if (idx >= 0) {
    earnings[idx] = { ...earnings[idx], earned: earnings[idx].earned + pointsToAdd };
  } else {
    earnings.push({ tournamentId, title: tournamentTitle, earned: pointsToAdd, date: tournamentDate });
  }
  const totalPoints = earnings.slice()
    .sort((a, b) => b.earned - a.earned)
    .slice(0, 10)
    .reduce((s, e) => s + e.earned, 0);

  const history = (user.eloHistory || []).slice(-199);
  history.push({ date: Date.now(), value: newElo, tournamentId });

  return {
    eloRating: newElo,
    eloHistory: history,
    tournamentEarnings: earnings,
    totalPoints,
    updatedAt: Date.now()
  };
}

// Fisher-Yates 随机洗牌
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 种子制分组：种子选手按蛇形分散到各组，非种子随机填充
function seedDraw(players, groupCount, seedCount) {
  // 按积分降序排列
  const sorted = players.slice().sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0));
  const seeds = sorted.slice(0, seedCount);
  const nonSeeds = shuffle(sorted.slice(seedCount));

  // 初始化分组
  const groups = [];
  for (let i = 0; i < groupCount; i++) {
    groups.push({ name: String.fromCharCode(65 + i), players: [], matches: [], standings: [] });
  }

  // 种子蛇形分配：第1种子→A组，第2→B组，...第N→N组，第N+1→N组，第N+2→N-1组...
  seeds.forEach((p, idx) => {
    const round = Math.floor(idx / groupCount);
    const pos = idx % groupCount;
    const groupIdx = round % 2 === 0 ? pos : groupCount - 1 - pos;
    groups[groupIdx].players.push({ ...p, seed: idx + 1 });
  });

  // 非种子随机均匀分配
  let gi = 0;
  for (const p of nonSeeds) {
    // 找当前人数最少的组
    let minLen = Infinity;
    let minIdx = 0;
    for (let i = 0; i < groups.length; i++) {
      if (groups[i].players.length < minLen) {
        minLen = groups[i].players.length;
        minIdx = i;
      }
    }
    groups[minIdx].players.push({ ...p, seed: 0 });
  }

  // 为每组生成循环赛对阵（round-robin）
  for (const g of groups) {
    g.matches = generateRoundRobin(g.players);
    g.standings = g.players.map(p => ({
      openid: p.openid,
      wecomName: p.wecomName,
      played: 0,
      wins: 0,
      losses: 0,
      setsWon: 0,
      setsLost: 0
    }));
  }

  return groups;
}

// 循环赛对阵生成
function generateRoundRobin(players) {
  const matches = [];
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      matches.push({
        id: `${players[i].openid}_${players[j].openid}`,
        playerA: { openid: players[i].openid, wecomName: players[i].wecomName },
        playerB: { openid: players[j].openid, wecomName: players[j].wecomName },
        scores: [],
        winner: null,
        scoreSummary: ''
      });
    }
  }
  return matches;
}

// 生成淘汰赛 bracket
function generateKnockout(advancedPlayers) {
  // advancedPlayers 按排名排好序
  const n = advancedPlayers.length;
  // 找到 >= n 的最小 2 的幂
  let size = 1;
  while (size < n) size *= 2;

  // 种子排位（1 vs size, 2 vs size-1, ...）
  const bracket = [];
  for (let i = 0; i < size / 2; i++) {
    const a = advancedPlayers[i] || null;
    const b = advancedPlayers[size - 1 - i] || null;
    bracket.push({
      id: `ko_r1_${i}`,
      playerA: a ? { openid: a.openid, wecomName: a.wecomName } : null,
      playerB: b ? { openid: b.openid, wecomName: b.wecomName } : null,
      scores: [],
      winner: null,
      scoreSummary: '',
      // 轮空自动胜出
      bye: !a || !b
    });
  }

  // 处理轮空
  for (const m of bracket) {
    if (m.bye) {
      if (m.playerA && !m.playerB) m.winner = 'A';
      else if (m.playerB && !m.playerA) m.winner = 'B';
    }
  }

  // 确定轮次名称
  const roundNames = [];
  let remaining = size;
  while (remaining >= 2) {
    if (remaining === 2) roundNames.push('决赛');
    else if (remaining === 4) roundNames.push('半决赛');
    else if (remaining === 8) roundNames.push('四分之一决赛');
    else roundNames.push(`${remaining}强`);
    remaining /= 2;
  }

  const rounds = [{
    name: roundNames[0] || '第一轮',
    matches: bracket
  }];

  // 生成后续空轮次
  let prevCount = bracket.length;
  for (let r = 1; r < roundNames.length; r++) {
    const matchCount = prevCount / 2;
    const roundMatches = [];
    for (let i = 0; i < matchCount; i++) {
      roundMatches.push({
        id: `ko_r${r + 1}_${i}`,
        playerA: null,
        playerB: null,
        scores: [],
        winner: null,
        scoreSummary: '',
        bye: false
      });
    }
    rounds.push({ name: roundNames[r], matches: roundMatches });
    prevCount = matchCount;
  }

  return { rounds };
}

// 计算小组赛排名
function calcStandings(group) {
  const map = {};
  for (const p of group.players) {
    map[p.openid] = { openid: p.openid, wecomName: p.wecomName, played: 0, wins: 0, losses: 0, setsWon: 0, setsLost: 0 };
  }
  for (const m of group.matches) {
    if (!m.winner) continue;

    const winnerOpenid = m.winner === 'A' ? m.playerA.openid : m.playerB.openid;
    const loserOpenid = m.winner === 'A' ? m.playerB.openid : m.playerA.openid;

    // 轮空判定：对手为空
    const isBye = !m.playerA || !m.playerB;

    if (map[winnerOpenid]) {
      map[winnerOpenid].played++;
      map[winnerOpenid].wins++;
    }
    if (map[loserOpenid]) {
      map[loserOpenid].played++;
      map[loserOpenid].losses++;
    }

    // 盘数统计（轮空不计入净胜盘）
    if (!isBye) {
      const sa = m.scoreA || 0;
      const sb = m.scoreB || 0;
      if (map[m.playerA.openid]) {
        map[m.playerA.openid].setsWon += sa;
        map[m.playerA.openid].setsLost += sb;
      }
      if (map[m.playerB.openid]) {
        map[m.playerB.openid].setsWon += sb;
        map[m.playerB.openid].setsLost += sa;
      }
    }
  }
  // 排序：胜场 > 净胜盘
  const standings = Object.values(map).sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    return (b.setsWon - b.setsLost) - (a.setsWon - a.setsLost);
  });
  return standings;
}

// 判定单场胜方
function judgeMatch(scoreA, scoreB) {
  if (scoreA === scoreB) return { winner: null, scoreSummary: `${scoreA}:${scoreB}` };
  const winner = scoreA > scoreB ? 'A' : 'B';
  const scoreSummary = `${scoreA}:${scoreB}`;
  return { winner, scoreSummary };
}

// 校验比分合法性（网球规则）
// target=4（短盘）: 合法比分 4:0, 4:1, 4:2, 5:3, 5:4(抢七)
// target=6（标准盘）: 合法比分 6:0, 6:1, 6:2, 6:3, 6:4, 7:5, 7:6(抢七)
// 规则：正常胜(winner=target, loser≤target-2) 或 延长胜(winner=target+1, loser=target-1) 或 抢七胜(winner=target+1, loser=target)
function validateScore(scoreA, scoreB, target) {
  const high = Math.max(scoreA, scoreB);
  const low = Math.min(scoreA, scoreB);

  // 平局不合法
  if (high === low) return false;

  // 正常胜：胜者 = target，负者 ≤ target - 2
  if (high === target && low >= 0 && low <= target - 2) return true;

  // 延长胜：胜者 = target + 1，负者 = target - 1（领先2局胜出）
  if (high === target + 1 && low === target - 1) return true;

  // 抢七胜：胜者 = target + 1，负者 = target（抢七决胜）
  if (high === target + 1 && low === target) return true;

  return false;
}

// 更新用户在某赛事中的积分收益，并重新计算 totalPoints（取最佳10场）
// 注：仅 awardPlacementBonus（赛事结束发奖）使用此函数，
// scoreGroup/scoreKnockout 走 runTransaction 路径以避免竞态。
async function addTournamentEarning(openid, tournamentId, pointsToAdd, tournamentTitle, tournamentDate) {
  const user = await getUser(openid);
  if (!user) return;

  let earnings = user.tournamentEarnings || [];
  // 找到该赛事的记录
  const idx = earnings.findIndex(e => e.tournamentId === tournamentId);
  if (idx >= 0) {
    earnings[idx].earned += pointsToAdd;
  } else {
    earnings.push({ tournamentId, title: tournamentTitle, earned: pointsToAdd, date: tournamentDate });
  }

  // 取最佳10场计算 totalPoints
  const sorted = earnings.slice().sort((a, b) => b.earned - a.earned);
  const best10 = sorted.slice(0, 10);
  const totalPoints = best10.reduce((sum, e) => sum + e.earned, 0);

  await db.collection(USERS).where({ openid }).update({
    data: { tournamentEarnings: earnings, totalPoints, updatedAt: Date.now() }
  });
}

// 赛事结束时发放名次奖励（事务外执行：status=finished 后不会再有 score 操作）
async function awardPlacementBonus(tournament) {
  const level = tournament.level || 'friendly';
  const bonus = PLACEMENT_BONUS[level] || PLACEMENT_BONUS.friendly;
  const factor = tournament.type === 'doubles' ? DOUBLES_FACTOR : 1;
  const ko = tournament.knockout;
  if (!ko || !ko.rounds || ko.rounds.length === 0) return [];

  const tId = tournament._id;
  const tTitle = tournament.title;
  const tDate = tournament.matchDate || tournament.createdAt;
  const awards = [];
  const rounds = ko.rounds;
  const finalMatch = rounds[rounds.length - 1].matches[0];

  // 冠军 / 亚军
  if (finalMatch.winner) {
    const championOpenid = finalMatch.winner === 'A' ? finalMatch.playerA.openid : finalMatch.playerB.openid;
    awards.push({ openid: championOpenid, place: '冠军', pts: Math.round(bonus.champion * factor) });
    const runnerUpOpenid = finalMatch.winner === 'A' ? finalMatch.playerB.openid : finalMatch.playerA.openid;
    awards.push({ openid: runnerUpOpenid, place: '亚军', pts: Math.round(bonus.runnerUp * factor) });
  }

  // 四强（半决赛负者）
  if (rounds.length >= 2) {
    const semiFinals = rounds[rounds.length - 2].matches;
    for (const m of semiFinals) {
      if (m.winner) {
        const loserOpenid = m.winner === 'A' ? m.playerB.openid : m.playerA.openid;
        if (loserOpenid && !awards.some(a => a.openid === loserOpenid)) {
          awards.push({ openid: loserOpenid, place: '四强', pts: Math.round(bonus.semiFinal * factor) });
        }
      }
    }
  }

  // 八强（四分之一决赛负者）
  if (rounds.length >= 3) {
    const quarterFinals = rounds[rounds.length - 3].matches;
    for (const m of quarterFinals) {
      if (m.winner) {
        const loserOpenid = m.winner === 'A' ? m.playerB.openid : m.playerA.openid;
        if (loserOpenid && !awards.some(a => a.openid === loserOpenid)) {
          awards.push({ openid: loserOpenid, place: '八强', pts: Math.round(bonus.quarterFinal * factor) });
        }
      }
    }
  }

  // 参与奖（所有未获奖的报名者）
  const awardedOpenids = new Set(awards.map(a => a.openid));
  const players = tournament.players || [];
  for (const p of players) {
    if (!awardedOpenids.has(p.openid)) {
      awards.push({ openid: p.openid, place: '参与', pts: Math.round(bonus.participant * factor) });
    }
  }

  // 并行发放（每个 user 唯一，无相互冲突）
  await Promise.all(
    awards.map(a => addTournamentEarning(a.openid, tId, a.pts, tTitle, tDate))
  );

  return awards;
}

exports.main = async event => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action;

  // 列表（分页 + 字段裁剪：剥离 groups/knockout 等大对象）
  if (action === 'list') {
    const limit = Math.min(Math.max(parseInt(event.limit) || 20, 1), 50);
    let q = db.collection(TOURNAMENTS)
      .field({
        title: true,
        type: true,
        bestOf: true,
        level: true,
        matchDate: true,
        status: true,
        players: true,  // 服务端用于算 count + joined
        creator: true,
        creatorName: true,
        createdAt: true
      })
      .orderBy('createdAt', 'desc');
    if (event.before) {
      q = q.where({ createdAt: _.lt(event.before) });
    }
    const res = await q.limit(limit).get();
    const list = (res.data || []).map(t => {
      const ps = t.players || [];
      return {
        _id: t._id,
        title: t.title,
        type: t.type,
        bestOf: t.bestOf,
        level: t.level,
        matchDate: t.matchDate,
        status: t.status,
        playerCount: ps.length,
        joined: ps.some(p => p.openid === OPENID),
        creator: t.creator,
        creatorName: t.creatorName,
        createdAt: t.createdAt
      };
    });
    const hasMore = list.length === limit;
    const nextCursor = hasMore && list.length > 0 ? list[list.length - 1].createdAt : null;
    return { code: 0, data: { list, hasMore, nextCursor } };
  }

  // 详情
  if (action === 'get') {
    const res = await db.collection(TOURNAMENTS).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '赛事不存在' };
    return { code: 0, data: res.data };
  }

  // 创建赛事
  if (action === 'create') {
    const me = await getUser(OPENID);
    if (!me || !me.wecomName) return { code: 1, msg: '请先完成登记' };
    const p = event.payload || {};
    if (!p.title) return { code: 1, msg: '请填写赛事名称' };

    const type = p.type === 'doubles' ? 'doubles' : 'singles';
    const bestOf = [4, 6].includes(p.bestOf) ? p.bestOf : 6;
    const level = ['major', 'challenge', 'friendly'].includes(p.level) ? p.level : 'friendly';
    const groupCount = Math.max(2, Math.min(8, p.groupCount || 2));
    const advanceCount = Math.max(1, Math.min(4, p.advanceCount || 2));
    const seedCount = Math.max(0, Math.min(16, p.seedCount || groupCount));

    const now = Date.now();
    const addRes = await db.collection(TOURNAMENTS).add({
      data: {
        title: String(p.title).slice(0, 40),
        type,
        bestOf,
        level,
        handicapRule: p.handicapRule ? String(p.handicapRule).slice(0, 100) : '',
        matchDate: p.matchDate || now,
        status: 'signup', // signup → group → knockout → finished
        players: [],
        groups: [],
        knockout: null,
        config: { groupCount, advanceCount, seedCount },
        creator: OPENID,
        creatorName: me.wecomName,
        createdAt: now,
        updatedAt: now
      }
    });
    return { code: 0, data: { _id: addRes._id } };
  }

  // 报名
  if (action === 'signup') {
    const me = await getUser(OPENID);
    if (!me || !me.wecomName) return { code: 1, msg: '请先完成登记' };
    const res = await db.collection(TOURNAMENTS).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '赛事不存在' };
    const t = res.data;
    if (t.status !== 'signup') return { code: 1, msg: '报名已截止' };
    if ((t.players || []).some(p => p.openid === OPENID)) {
      return { code: 1, msg: '你已报名' };
    }
    const players = (t.players || []).slice();
    players.push({
      openid: OPENID,
      wecomName: me.wecomName,
      gender: me.gender || '',
      rating: me.rating || '',
      totalPoints: me.totalPoints || 0,
      signupAt: Date.now()
    });
    await db.collection(TOURNAMENTS).doc(event.id).update({
      data: { players, updatedAt: Date.now() }
    });
    return { code: 0, data: true };
  }

  // 取消报名
  if (action === 'cancelSignup') {
    const res = await db.collection(TOURNAMENTS).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '赛事不存在' };
    const t = res.data;
    if (t.status !== 'signup') return { code: 1, msg: '报名已截止，无法取消' };
    const players = (t.players || []).filter(p => p.openid !== OPENID);
    await db.collection(TOURNAMENTS).doc(event.id).update({
      data: { players, updatedAt: Date.now() }
    });
    return { code: 0, data: true };
  }

  // 抽签（管理员/创建者操作，此时决定分组数）
  if (action === 'draw') {
    const me = await getUser(OPENID);
    const res = await db.collection(TOURNAMENTS).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '赛事不存在' };
    const t = res.data;
    if (t.creator !== OPENID && (!me || me.role !== 'admin')) {
      return { code: 1, msg: '无权限操作' };
    }
    if (t.status !== 'signup') return { code: 1, msg: '当前状态不允许抽签' };
    const players = t.players || [];

    // 抽签时由管理员决定分组参数
    const groupCount = event.groupCount || t.config.groupCount || 2;
    const advanceCount = event.advanceCount || t.config.advanceCount || 2;
    const seedCount = event.seedCount !== undefined ? event.seedCount : (t.config.seedCount || 0);

    if (players.length < groupCount * 2) {
      return { code: 1, msg: `至少需要 ${groupCount * 2} 人才能分 ${groupCount} 组` };
    }

    const groups = seedDraw(players, groupCount, seedCount);
    const config = { groupCount, advanceCount, seedCount };
    await db.collection(TOURNAMENTS).doc(event.id).update({
      data: { groups, config, status: 'group', updatedAt: Date.now() }
    });
    return { code: 0, data: { groups } };
  }

  // 录入小组赛比分（事务化，防止并发录分互相覆盖）
  if (action === 'scoreGroup') {
    const me = await getUser(OPENID);
    const { groupIndex, matchId, scoreA, scoreB } = event;
    if (groupIndex === undefined || !matchId || scoreA === undefined || scoreB === undefined) {
      return { code: 1, msg: '参数不完整' };
    }
    const sa = parseInt(scoreA);
    const sb = parseInt(scoreB);
    if (isNaN(sa) || isNaN(sb) || sa < 0 || sb < 0) return { code: 1, msg: '比分格式错误' };
    if (sa === sb) return { code: 1, msg: '必须决出胜负' };

    // 事前预读：状态/比分校验/权限/取 winner-loser openid
    const previewRes = await db.collection(TOURNAMENTS).doc(event.id).get().catch(() => null);
    if (!previewRes || !previewRes.data) return { code: 1, msg: '赛事不存在' };
    const tPreview = previewRes.data;
    if (tPreview.status !== 'group') return { code: 1, msg: '当前不是小组赛阶段' };
    if (!validateScore(sa, sb, tPreview.bestOf)) {
      return { code: 1, msg: `比分不合法（先赢${tPreview.bestOf}局制，含抢七规则）` };
    }
    const groupPreview = tPreview.groups[groupIndex];
    if (!groupPreview) return { code: 1, msg: '分组不存在' };
    const matchPreview = groupPreview.matches.find(m => m.id === matchId);
    if (!matchPreview) return { code: 1, msg: '比赛不存在' };
    if (matchPreview.winner) return { code: 1, msg: '该场比分已录入' };

    const inMatch = matchPreview.playerA.openid === OPENID || matchPreview.playerB.openid === OPENID;
    const isCreator = tPreview.creator === OPENID;
    const isAdmin = me && me.role === 'admin';
    if (!inMatch && !isCreator && !isAdmin) return { code: 1, msg: '无权限录入比分' };

    const { winner, scoreSummary } = judgeMatch(sa, sb);
    if (!winner) return { code: 1, msg: '比分未能决出胜负' };
    const winnerOpenid = winner === 'A' ? matchPreview.playerA.openid : matchPreview.playerB.openid;
    const loserOpenid = winner === 'A' ? matchPreview.playerB.openid : matchPreview.playerA.openid;

    // 预查双方 user._id（事务内不支持 .where，必须用 .doc(id)）
    const [winnerUserPre, loserUserPre] = await Promise.all([
      getUser(winnerOpenid),
      getUser(loserOpenid)
    ]);
    if (!winnerUserPre || !loserUserPre) return { code: 1, msg: '用户数据缺失' };

    const factor = tPreview.type === 'doubles' ? DOUBLES_FACTOR : 1;

    try {
      const result = await db.runTransaction(async transaction => {
        // 事务内重新读 tournament（保证最新；若被并发更新会自动 retry）
        const tRes = await transaction.collection(TOURNAMENTS).doc(event.id).get();
        const t = tRes.data;
        if (t.status !== 'group') throw new Error('当前不是小组赛阶段');
        const group = t.groups[groupIndex];
        if (!group) throw new Error('分组不存在');
        const match = group.matches.find(m => m.id === matchId);
        if (!match) throw new Error('比赛不存在');
        if (match.winner) throw new Error('该场比分已录入'); // 防重复录入

        // 更新比赛结果 + 重算排名
        match.scoreA = sa;
        match.scoreB = sb;
        match.winner = winner;
        match.scoreSummary = scoreSummary;
        group.standings = calcStandings(group);

        // 事务内重新读双方 user（串行：微信云开发事务对 Promise.all 支持不稳，
        // 必须按顺序 await）
        const wRes = await transaction.collection(USERS).doc(winnerUserPre._id).get();
        const lRes = await transaction.collection(USERS).doc(loserUserPre._id).get();
        const wu = wRes.data;
        const lu = lRes.data;

        const wElo = wu.eloRating || 1500;
        const lElo = lu.eloRating || 1500;
        const { winnerPts, loserPts } = calcMatchPoints(wElo, lElo);
        const finalWinnerPts = Math.round(winnerPts * factor);
        const finalLoserPts = Math.round(loserPts * factor);
        const { winnerDelta, loserDelta } = calcEloChange(wElo, lElo);

        const tDate = t.matchDate || t.createdAt;

        // 顺序写入：tournament + winner + loser（事务内不能并发）
        await transaction.collection(TOURNAMENTS).doc(event.id).update({
          data: { groups: t.groups, updatedAt: Date.now() }
        });
        await transaction.collection(USERS).doc(wu._id).update({
          data: buildUserSettlePayload(wu, event.id, t.title, tDate, winnerDelta, finalWinnerPts)
        });
        await transaction.collection(USERS).doc(lu._id).update({
          data: buildUserSettlePayload(lu, event.id, t.title, tDate, loserDelta, finalLoserPts)
        });

        return {
          winner,
          scoreSummary,
          winnerPts: finalWinnerPts,
          loserPts: finalLoserPts,
          winnerEloChange: winnerDelta,
          loserEloChange: loserDelta
        };
      });
      return { code: 0, data: result };
    } catch (e) {
      console.error('[scoreGroup] transaction failed:', e && e.message, e && e.stack);
      return { code: 1, msg: (e && e.message) || '录分失败，请重试' };
    }
  }

  // 开始淘汰赛（小组赛全部完成后）
  if (action === 'startKnockout') {
    try {
      const me = await getUser(OPENID);
      const res = await db.collection(TOURNAMENTS).doc(event.id).get().catch(() => null);
      if (!res || !res.data) return { code: 1, msg: '赛事不存在' };
      const t = res.data;
      if (t.creator !== OPENID && (!me || me.role !== 'admin')) {
        return { code: 1, msg: '无权限操作' };
      }
      if (t.status !== 'group') return { code: 1, msg: '当前不是小组赛阶段' };

      // 防御：mock 数据或异常状态可能缺字段
      if (!Array.isArray(t.groups) || t.groups.length === 0) {
        return { code: 1, msg: '赛事尚未抽签分组' };
      }
      const advanceCount = (t.config && t.config.advanceCount) || 2;

      // 检查小组赛是否全部完成
      for (const g of t.groups) {
        if (!Array.isArray(g.matches)) {
          return { code: 1, msg: `${g.name || '?'} 组数据异常（缺 matches）` };
        }
        const unfinished = g.matches.filter(m => !m.winner);
        if (unfinished.length > 0) {
          return { code: 1, msg: `${g.name} 组还有 ${unfinished.length} 场未完成` };
        }
      }

      // 取每组前 advanceCount 名（standings 缺失时即时补算）
      const advanced = [];
      for (const g of t.groups) {
        const standings = Array.isArray(g.standings) && g.standings.length > 0
          ? g.standings
          : calcStandings(g);
        const topN = standings.slice(0, advanceCount);
        topN.forEach((p, rank) => {
          advanced.push({ ...p, groupName: g.name, groupRank: rank + 1 });
        });
      }

      if (advanced.length < 2) {
        return { code: 1, msg: '晋级人数不足，无法生成淘汰赛' };
      }

      // 按小组排名交叉排列（A组第1, B组第1, ... A组第2, B组第2, ...）
      const sorted = [];
      for (let rank = 0; rank < advanceCount; rank++) {
        const thisRank = advanced.filter(p => p.groupRank === rank + 1);
        thisRank.sort((a, b) =>
          b.wins - a.wins || (b.setsWon - b.setsLost) - (a.setsWon - a.setsLost)
        );
        sorted.push(...thisRank);
      }

      const knockout = generateKnockout(sorted);
      // 关键：用 _.set() 强制整字段替换，避免云开发把 knockout: { rounds: [...] }
      // 自动拆成 dot path 'knockout.rounds'。原 knockout 字段是 null 时拆 dot path
      // 会报 "Cannot create field 'rounds' in element {knockout: null}"
      await db.collection(TOURNAMENTS).doc(event.id).update({
        data: {
          knockout: _.set(knockout),
          status: 'knockout',
          updatedAt: Date.now()
        }
      });
      return { code: 0, data: { knockout } };
    } catch (e) {
      console.error('[startKnockout] failed:', e && e.message, e && e.stack);
      return { code: 1, msg: (e && e.message) || '开启淘汰赛失败' };
    }
  }

  // 录入淘汰赛比分（事务化，防止并发录分互相覆盖）
  if (action === 'scoreKnockout') {
    const me = await getUser(OPENID);
    const { roundIndex, matchId, scoreA, scoreB } = event;
    if (roundIndex === undefined || !matchId || scoreA === undefined || scoreB === undefined) {
      return { code: 1, msg: '参数不完整' };
    }
    const sa = parseInt(scoreA);
    const sb = parseInt(scoreB);
    if (isNaN(sa) || isNaN(sb) || sa < 0 || sb < 0) return { code: 1, msg: '比分格式错误' };
    if (sa === sb) return { code: 1, msg: '必须决出胜负' };

    // 事前预读
    const previewRes = await db.collection(TOURNAMENTS).doc(event.id).get().catch(() => null);
    if (!previewRes || !previewRes.data) return { code: 1, msg: '赛事不存在' };
    const tPreview = previewRes.data;
    if (tPreview.status !== 'knockout') return { code: 1, msg: '当前不是淘汰赛阶段' };
    if (!validateScore(sa, sb, tPreview.bestOf)) {
      return { code: 1, msg: `比分不合法（先赢${tPreview.bestOf}局制，含抢七规则）` };
    }

    const roundPreview = tPreview.knockout && tPreview.knockout.rounds && tPreview.knockout.rounds[roundIndex];
    if (!roundPreview) return { code: 1, msg: '轮次不存在' };
    const matchPreview = roundPreview.matches.find(m => m.id === matchId);
    if (!matchPreview) return { code: 1, msg: '比赛不存在' };
    if (!matchPreview.playerA || !matchPreview.playerB) return { code: 1, msg: '对手尚未确定' };
    if (matchPreview.winner) return { code: 1, msg: '该场比分已录入' };

    const inMatch = matchPreview.playerA.openid === OPENID || matchPreview.playerB.openid === OPENID;
    const isCreator = tPreview.creator === OPENID;
    const isAdmin = me && me.role === 'admin';
    if (!inMatch && !isCreator && !isAdmin) return { code: 1, msg: '无权限录入比分' };

    const { winner, scoreSummary } = judgeMatch(sa, sb);
    if (!winner) return { code: 1, msg: '比分未能决出胜负' };
    const winnerOpenid = winner === 'A' ? matchPreview.playerA.openid : matchPreview.playerB.openid;
    const loserOpenid = winner === 'A' ? matchPreview.playerB.openid : matchPreview.playerA.openid;

    const [winnerUserPre, loserUserPre] = await Promise.all([
      getUser(winnerOpenid),
      getUser(loserOpenid)
    ]);
    if (!winnerUserPre || !loserUserPre) return { code: 1, msg: '用户数据缺失' };

    const factor = tPreview.type === 'doubles' ? DOUBLES_FACTOR : 1;

    let txResult;
    try {
      txResult = await db.runTransaction(async transaction => {
        const tRes = await transaction.collection(TOURNAMENTS).doc(event.id).get();
        const t = tRes.data;
        if (t.status !== 'knockout') throw new Error('当前不是淘汰赛阶段');
        const round = t.knockout.rounds[roundIndex];
        if (!round) throw new Error('轮次不存在');
        const match = round.matches.find(m => m.id === matchId);
        if (!match) throw new Error('比赛不存在');
        if (!match.playerA || !match.playerB) throw new Error('对手尚未确定');
        if (match.winner) throw new Error('该场比分已录入');

        match.scoreA = sa;
        match.scoreB = sb;
        match.winner = winner;
        match.scoreSummary = scoreSummary;

        // 胜者晋级到下一轮
        const nextRoundIndex = roundIndex + 1;
        if (nextRoundIndex < t.knockout.rounds.length) {
          const matchIdx = round.matches.indexOf(match);
          const nextMatchIdx = Math.floor(matchIdx / 2);
          const nextMatch = t.knockout.rounds[nextRoundIndex].matches[nextMatchIdx];
          const winnerPlayer = winner === 'A' ? match.playerA : match.playerB;
          if (matchIdx % 2 === 0) {
            nextMatch.playerA = winnerPlayer;
          } else {
            nextMatch.playerB = winnerPlayer;
          }
        }

        // 检查是否决赛结束
        const lastRound = t.knockout.rounds[t.knockout.rounds.length - 1];
        const finalMatch = lastRound.matches[0];
        const finished = !!finalMatch.winner;

        // 事务内更新双方 user（串行：微信云开发事务内不可并发）
        const wRes = await transaction.collection(USERS).doc(winnerUserPre._id).get();
        const lRes = await transaction.collection(USERS).doc(loserUserPre._id).get();
        const wu = wRes.data;
        const lu = lRes.data;

        const wElo = wu.eloRating || 1500;
        const lElo = lu.eloRating || 1500;
        const { winnerPts, loserPts } = calcMatchPoints(wElo, lElo);
        const finalWinnerPts = Math.round(winnerPts * factor);
        const finalLoserPts = Math.round(loserPts * factor);
        const { winnerDelta, loserDelta } = calcEloChange(wElo, lElo);

        const tDate = t.matchDate || t.createdAt;
        const newStatus = finished ? 'finished' : 'knockout';

        await transaction.collection(TOURNAMENTS).doc(event.id).update({
          data: { knockout: t.knockout, status: newStatus, updatedAt: Date.now() }
        });
        await transaction.collection(USERS).doc(wu._id).update({
          data: buildUserSettlePayload(wu, event.id, t.title, tDate, winnerDelta, finalWinnerPts)
        });
        await transaction.collection(USERS).doc(lu._id).update({
          data: buildUserSettlePayload(lu, event.id, t.title, tDate, loserDelta, finalLoserPts)
        });

        return {
          winner, scoreSummary,
          winnerPts: finalWinnerPts, loserPts: finalLoserPts,
          winnerEloChange: winnerDelta, loserEloChange: loserDelta,
          status: newStatus,
          finishedNow: finished,
          tournamentSnapshot: finished ? t : null  // 决赛结束时把快照带出，给 awardPlacementBonus
        };
      });
    } catch (e) {
      console.error('[scoreKnockout] transaction failed:', e && e.message, e && e.stack);
      return { code: 1, msg: (e && e.message) || '录分失败，请重试' };
    }

    // 决赛结束后发奖（事务外，因可能涉及很多用户）
    let placementAwards = null;
    if (txResult.finishedNow && txResult.tournamentSnapshot) {
      placementAwards = await awardPlacementBonus(txResult.tournamentSnapshot);
      // 把名次写回 tournament（用 dot path 不影响其他字段）
      await db.collection(TOURNAMENTS).doc(event.id).update({
        data: { placementAwards, updatedAt: Date.now() }
      });
    }

    return {
      code: 0,
      data: {
        winner: txResult.winner,
        scoreSummary: txResult.scoreSummary,
        status: txResult.status,
        placementAwards
      }
    };
  }

  // 删除赛事（仅 signup 阶段允许）
  // 设计：一旦抽签进入 group 阶段就开始结算积分，删除会留下幽灵积分。
  // 因此仅 signup 阶段（未抽签、零积分变动）支持硬删除。
  if (action === 'delete') {
    const me = await getUser(OPENID);
    const res = await db.collection(TOURNAMENTS).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '赛事不存在' };
    const t = res.data;
    if (t.creator !== OPENID && (!me || me.role !== 'admin')) {
      return { code: 1, msg: '无权限删除' };
    }
    if (t.status !== 'signup') {
      return { code: 1, msg: '赛事已开赛，无法删除（如需取消请联系管理员）' };
    }
    await db.collection(TOURNAMENTS).doc(event.id).remove();
    return { code: 0, data: true };
  }

  return { code: 1, msg: '未知 action' };
};
