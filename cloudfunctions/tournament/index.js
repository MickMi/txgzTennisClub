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

// 判定单场胜方（先赢N盘制）
function judgeMatch(scoreA, scoreB) {
  if (scoreA === scoreB) return { winner: null, scoreSummary: `${scoreA}:${scoreB}` };
  const winner = scoreA > scoreB ? 'A' : 'B';
  const scoreSummary = `${scoreA}:${scoreB}`;
  return { winner, scoreSummary };
}

// 校验比分合法性（先赢N盘制）
// 先赢4盘：合法比分为 4:0, 4:1, 4:2, 4:3(抢7)
// 规则：胜者必须恰好等于 target，负者 0 ~ target-1
function validateScore(scoreA, scoreB, target) {
  if (scoreA === target && scoreB >= 0 && scoreB < target) return true;
  if (scoreB === target && scoreA >= 0 && scoreA < target) return true;
  return false;
}

// 更新用户在某赛事中的积分收益，并重新计算 totalPoints（取最佳10场）
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

// 结算单场 ELO 小分 + 更新隐藏 ELO 等级分
async function settleMatchPoints(tournament, winnerOpenid, loserOpenid) {
  // 查询双方当前 ELO
  const winnerUser = await getUser(winnerOpenid);
  const loserUser = await getUser(loserOpenid);
  const winnerElo = (winnerUser && winnerUser.eloRating) || 1500;
  const loserElo = (loserUser && loserUser.eloRating) || 1500;

  // 计算 ELO 小分（可见积分）
  const { winnerPts, loserPts } = calcMatchPoints(winnerElo, loserElo);
  const factor = tournament.type === 'doubles' ? DOUBLES_FACTOR : 1;
  const finalWinnerPts = Math.round(winnerPts * factor);
  const finalLoserPts = Math.round(loserPts * factor);

  // 计算 ELO 等级分变动（隐藏分）
  const { winnerDelta, loserDelta } = calcEloChange(winnerElo, loserElo);

  const tId = tournament._id;
  const tTitle = tournament.title;
  const tDate = tournament.matchDate || tournament.createdAt;

  // 更新胜者：ELO等级分 + 赛事积分收益 + ELO历史
  const newWinnerElo = winnerElo + winnerDelta;
  const winnerHistory = (winnerUser && winnerUser.eloHistory) || [];
  winnerHistory.push({ date: Date.now(), value: newWinnerElo, tournamentId: tId });
  await db.collection(USERS).where({ openid: winnerOpenid }).update({
    data: {
      eloRating: _.inc(winnerDelta),
      eloHistory: winnerHistory,
      updatedAt: Date.now()
    }
  });
  await addTournamentEarning(winnerOpenid, tId, finalWinnerPts, tTitle, tDate);

  // 更新负者
  const newLoserElo = loserElo + loserDelta;
  const loserHistory = (loserUser && loserUser.eloHistory) || [];
  loserHistory.push({ date: Date.now(), value: newLoserElo, tournamentId: tId });
  await db.collection(USERS).where({ openid: loserOpenid }).update({
    data: {
      eloRating: _.inc(loserDelta),
      eloHistory: loserHistory,
      updatedAt: Date.now()
    }
  });
  await addTournamentEarning(loserOpenid, tId, finalLoserPts, tTitle, tDate);

  return { winnerPts: finalWinnerPts, loserPts: finalLoserPts, winnerEloChange: winnerDelta, loserEloChange: loserDelta };
}

// 赛事结束时发放名次奖励
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

  // 冠军
  if (finalMatch.winner) {
    const championOpenid = finalMatch.winner === 'A' ? finalMatch.playerA.openid : finalMatch.playerB.openid;
    const championPts = Math.round(bonus.champion * factor);
    await addTournamentEarning(championOpenid, tId, championPts, tTitle, tDate);
    awards.push({ openid: championOpenid, place: '冠军', pts: championPts });

    // 亚军
    const runnerUpOpenid = finalMatch.winner === 'A' ? finalMatch.playerB.openid : finalMatch.playerA.openid;
    const runnerUpPts = Math.round(bonus.runnerUp * factor);
    await addTournamentEarning(runnerUpOpenid, tId, runnerUpPts, tTitle, tDate);
    awards.push({ openid: runnerUpOpenid, place: '亚军', pts: runnerUpPts });
  }

  // 四强（半决赛负者）
  if (rounds.length >= 2) {
    const semiFinals = rounds[rounds.length - 2].matches;
    for (const m of semiFinals) {
      if (m.winner) {
        const loserOpenid = m.winner === 'A' ? m.playerB.openid : m.playerA.openid;
        const alreadyAwarded = awards.some(a => a.openid === loserOpenid);
        if (!alreadyAwarded && loserOpenid) {
          const pts = Math.round(bonus.semiFinal * factor);
          await addTournamentEarning(loserOpenid, tId, pts, tTitle, tDate);
          awards.push({ openid: loserOpenid, place: '四强', pts });
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
        const alreadyAwarded = awards.some(a => a.openid === loserOpenid);
        if (!alreadyAwarded && loserOpenid) {
          const pts = Math.round(bonus.quarterFinal * factor);
          await addTournamentEarning(loserOpenid, tId, pts, tTitle, tDate);
          awards.push({ openid: loserOpenid, place: '八强', pts });
        }
      }
    }
  }

  // 参与奖（所有未获奖的报名者）
  const awardedOpenids = new Set(awards.map(a => a.openid));
  const players = tournament.players || [];
  for (const p of players) {
    if (!awardedOpenids.has(p.openid)) {
      const pts = Math.round(bonus.participant * factor);
      await addTournamentEarning(p.openid, tId, pts, tTitle, tDate);
      awards.push({ openid: p.openid, place: '参与', pts });
    }
  }

  return awards;
}

exports.main = async event => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action;

  // 列表
  if (action === 'list') {
    const res = await db.collection(TOURNAMENTS)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    return { code: 0, data: res.data };
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

  // 录入小组赛比分（总比分模式）
  if (action === 'scoreGroup') {
    const me = await getUser(OPENID);
    const res = await db.collection(TOURNAMENTS).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '赛事不存在' };
    const t = res.data;
    if (t.status !== 'group') return { code: 1, msg: '当前不是小组赛阶段' };

    const { groupIndex, matchId, scoreA, scoreB } = event;
    if (groupIndex === undefined || !matchId || scoreA === undefined || scoreB === undefined) {
      return { code: 1, msg: '参数不完整' };
    }

    const sa = parseInt(scoreA);
    const sb = parseInt(scoreB);
    if (isNaN(sa) || isNaN(sb) || sa < 0 || sb < 0) {
      return { code: 1, msg: '比分格式错误' };
    }
    if (!validateScore(sa, sb, t.bestOf)) {
      return { code: 1, msg: `比分不合法（先赢${t.bestOf}盘制，胜者必须恰好${t.bestOf}盘）` };
    }
    if (sa === sb) {
      return { code: 1, msg: '必须决出胜负' };
    }

    // 权限检查
    const group = t.groups[groupIndex];
    if (!group) return { code: 1, msg: '分组不存在' };
    const match = group.matches.find(m => m.id === matchId);
    if (!match) return { code: 1, msg: '比赛不存在' };
    const inMatch = match.playerA.openid === OPENID || match.playerB.openid === OPENID;
    const isCreator = t.creator === OPENID;
    const isAdmin = me && me.role === 'admin';
    if (!inMatch && !isCreator && !isAdmin) {
      return { code: 1, msg: '无权限录入比分' };
    }

    const { winner, scoreSummary } = judgeMatch(sa, sb);
    if (!winner) return { code: 1, msg: '比分未能决出胜负' };

    // 更新比赛结果
    match.scoreA = sa;
    match.scoreB = sb;
    match.winner = winner;
    match.scoreSummary = scoreSummary;

    // 重新计算该组排名
    group.standings = calcStandings(group);

    // 结算积分
    const winnerOpenid = winner === 'A' ? match.playerA.openid : match.playerB.openid;
    const loserOpenid = winner === 'A' ? match.playerB.openid : match.playerA.openid;
    await settleMatchPoints(t, winnerOpenid, loserOpenid);

    // 更新数据库
    const groups = t.groups.slice();
    groups[groupIndex] = group;
    await db.collection(TOURNAMENTS).doc(event.id).update({
      data: { groups, updatedAt: Date.now() }
    });
    return { code: 0, data: { winner, scoreSummary } };
  }

  // 开始淘汰赛（小组赛全部完成后）
  if (action === 'startKnockout') {
    const me = await getUser(OPENID);
    const res = await db.collection(TOURNAMENTS).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '赛事不存在' };
    const t = res.data;
    if (t.creator !== OPENID && (!me || me.role !== 'admin')) {
      return { code: 1, msg: '无权限操作' };
    }
    if (t.status !== 'group') return { code: 1, msg: '当前不是小组赛阶段' };

    // 检查小组赛是否全部完成
    for (const g of t.groups) {
      const unfinished = g.matches.filter(m => !m.winner);
      if (unfinished.length > 0) {
        return { code: 1, msg: `${g.name} 组还有 ${unfinished.length} 场未完成` };
      }
    }

    // 取每组前 advanceCount 名
    const advanced = [];
    for (const g of t.groups) {
      const topN = g.standings.slice(0, t.config.advanceCount);
      topN.forEach((p, rank) => {
        advanced.push({ ...p, groupName: g.name, groupRank: rank + 1 });
      });
    }

    // 按小组排名交叉排列（A组第1, B组第1, ... A组第2, B组第2, ...）
    const sorted = [];
    for (let rank = 0; rank < t.config.advanceCount; rank++) {
      const thisRank = advanced.filter(p => p.groupRank === rank + 1);
      // 组第一名按胜场排序
      thisRank.sort((a, b) => b.wins - a.wins || (b.setsWon - b.setsLost) - (a.setsWon - a.setsLost));
      sorted.push(...thisRank);
    }

    const knockout = generateKnockout(sorted);
    await db.collection(TOURNAMENTS).doc(event.id).update({
      data: { knockout, status: 'knockout', updatedAt: Date.now() }
    });
    return { code: 0, data: { knockout } };
  }

  // 录入淘汰赛比分（总比分模式）
  if (action === 'scoreKnockout') {
    const me = await getUser(OPENID);
    const res = await db.collection(TOURNAMENTS).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '赛事不存在' };
    const t = res.data;
    if (t.status !== 'knockout') return { code: 1, msg: '当前不是淘汰赛阶段' };

    const { roundIndex, matchId, scoreA, scoreB } = event;
    if (roundIndex === undefined || !matchId || scoreA === undefined || scoreB === undefined) {
      return { code: 1, msg: '参数不完整' };
    }

    const sa = parseInt(scoreA);
    const sb = parseInt(scoreB);
    if (isNaN(sa) || isNaN(sb) || sa < 0 || sb < 0) {
      return { code: 1, msg: '比分格式错误' };
    }
    if (!validateScore(sa, sb, t.bestOf)) {
      return { code: 1, msg: `比分不合法（先赢${t.bestOf}盘制，胜者必须恰好${t.bestOf}盘）` };
    }
    if (sa === sb) {
      return { code: 1, msg: '必须决出胜负' };
    }

    const round = t.knockout.rounds[roundIndex];
    if (!round) return { code: 1, msg: '轮次不存在' };
    const match = round.matches.find(m => m.id === matchId);
    if (!match) return { code: 1, msg: '比赛不存在' };
    if (!match.playerA || !match.playerB) return { code: 1, msg: '对手尚未确定' };

    // 权限
    const inMatch = match.playerA.openid === OPENID || match.playerB.openid === OPENID;
    const isCreator = t.creator === OPENID;
    const isAdmin = me && me.role === 'admin';
    if (!inMatch && !isCreator && !isAdmin) {
      return { code: 1, msg: '无权限录入比分' };
    }

    const { winner, scoreSummary } = judgeMatch(sa, sb);
    if (!winner) return { code: 1, msg: '比分未能决出胜负' };

    match.scoreA = sa;
    match.scoreB = sb;
    match.winner = winner;
    match.scoreSummary = scoreSummary;

    // 结算积分
    const winnerOpenid = winner === 'A' ? match.playerA.openid : match.playerB.openid;
    const loserOpenid = winner === 'A' ? match.playerB.openid : match.playerA.openid;
    await settleMatchPoints(t, winnerOpenid, loserOpenid);

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

    // 检查赛事是否全部结束
    const lastRound = t.knockout.rounds[t.knockout.rounds.length - 1];
    const finalMatch = lastRound.matches[0];
    let tournamentStatus = 'knockout';
    let placementAwards = null;
    if (finalMatch.winner) {
      tournamentStatus = 'finished';
      // 发放赛事名次奖励
      placementAwards = await awardPlacementBonus(t);
    }

    await db.collection(TOURNAMENTS).doc(event.id).update({
      data: { knockout: t.knockout, status: tournamentStatus, placementAwards, updatedAt: Date.now() }
    });
    return { code: 0, data: { winner, scoreSummary, status: tournamentStatus, placementAwards } };
  }

  return { code: 1, msg: '未知 action' };
};
