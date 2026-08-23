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
// 双打：队伍胜负 → 队员各得满分（不再缩水），所以 factor=1
// 旧字段保留为常量是为了 future tweak；调用处都直接写 1，不再分支判断
const DOUBLES_FACTOR = 1;

// ====== 团队赛（type='team'）常量 ======
// 团队赛胜/负方每人加的分（进入 totalPoints 个人池，不进 placementAwards、不动 ELO）
// 数字与 PRD §3.1 对齐
const TEAM_MATCH_POINTS = { win: 40, loss: 20 };

// ====== 测试夹具（test-fixtures）常量 ======
const TEST_OPENID_PREFIX = 'test_u_';
const TEST_TITLE_PREFIX = '[TEST]';
// 测试用户花名册（固定 7 人，scenario 按需取前 N 个）
const TEST_USER_ROSTER = [
  { openid: 'test_u_001', wecomName: '测试-甲', gender: 'M', rating: 4.0, totalPoints: 100 },
  { openid: 'test_u_002', wecomName: '测试-乙', gender: 'M', rating: 4.0, totalPoints: 90 },
  { openid: 'test_u_003', wecomName: '测试-丙', gender: 'F', rating: 3.5, totalPoints: 80 },
  { openid: 'test_u_004', wecomName: '测试-丁', gender: 'M', rating: 3.5, totalPoints: 70 },
  { openid: 'test_u_005', wecomName: '测试-戊', gender: 'F', rating: 4.5, totalPoints: 60 },
  { openid: 'test_u_006', wecomName: '测试-己', gender: 'M', rating: 3.0, totalPoints: 50 },
  { openid: 'test_u_007', wecomName: '测试-庚', gender: 'M', rating: 3.0, totalPoints: 40 },
  { openid: 'test_u_008', wecomName: '测试-辛', gender: 'F', rating: 2.5, totalPoints: 30 },
  { openid: 'test_u_009', wecomName: '测试-壬', gender: 'M', rating: 2.5, totalPoints: 25 },
  { openid: 'test_u_010', wecomName: '测试-癸', gender: 'F', rating: 2.0, totalPoints: 20 },
  { openid: 'test_u_011', wecomName: '测试-子', gender: 'M', rating: 2.0, totalPoints: 15 },
  { openid: 'test_u_012', wecomName: '测试-丑', gender: 'F', rating: 1.5, totalPoints: 10 }
];
const SCENARIO_CONFIG = {
  basic_signup_drawn: {
    label: '基础完整流程', userCount: 6, slotCount: 5, preRecorded: [], finish: false
  },
  mid_recording: {
    label: '录入中', userCount: 6, slotCount: 5,
    preRecorded: [{ slotIndex: 1, setsA: 6, setsB: 4 }, { slotIndex: 2, setsA: 4, setsB: 6 }],
    finish: false
  },
  tied_partial: {
    label: '平局未决', userCount: 6, slotCount: 4,
    preRecorded: [
      { slotIndex: 1, setsA: 6, setsB: 4 },
      { slotIndex: 2, setsA: 4, setsB: 6 },
      { slotIndex: 3, setsA: 6, setsB: 4 },
      { slotIndex: 4, setsA: 4, setsB: 6 }
    ],
    finish: false
  },
  a_landslide_finished: {
    label: 'A 队完胜', userCount: 6, slotCount: 5,
    preRecorded: [
      { slotIndex: 1, setsA: 6, setsB: 0 },
      { slotIndex: 2, setsA: 6, setsB: 2 },
      { slotIndex: 3, setsA: 6, setsB: 3 },
      { slotIndex: 4, setsA: 6, setsB: 1 },
      { slotIndex: 5, setsA: 6, setsB: 4 }
    ],
    finish: true
  },
  b_narrow_finished: {
    label: 'B 队险胜', userCount: 6, slotCount: 5,
    preRecorded: [
      { slotIndex: 1, setsA: 6, setsB: 4 },
      { slotIndex: 2, setsA: 4, setsB: 6 },
      { slotIndex: 3, setsA: 3, setsB: 6 },
      { slotIndex: 4, setsA: 6, setsB: 2 },
      { slotIndex: 5, setsA: 2, setsB: 6 }
    ],
    finish: true
  },
      odd_signup_drawn: {
        label: '奇数人蛇形', userCount: 7, slotCount: 5, preRecorded: [], finish: false
      },
      tied_then_net_games: {
        // Team Score 2:2 平分 → 进入一球制胜（不再靠净胜局判胜）
        // 4 个 slot：A/B 各赢 2 场，净胜局 A+5 仅作展示
        label: '平分 · 待一球制胜', userCount: 6, slotCount: 4, preRecorded: [
          { slotIndex: 1, setsA: 6, setsB: 4 },  // A 胜 +2
          { slotIndex: 2, setsA: 7, setsB: 6 },  // A 胜 +1
          { slotIndex: 3, setsA: 6, setsB: 7 },  // B 胜 -1
          { slotIndex: 4, setsA: 11, setsB: 8 }   // A 胜 +3 → teamScore 2:2 / netGames A+5
        ], finish: false
      },
      signup_pending_draw: {
        // Plan-4 R4-A.1：真正停在 status='signup' 的场景
        // 7 人报名好、未选队长、未抽签 → 用来手动测"选队长 / 抽签"弹层全流程
        label: '待抽签 (signup)', userCount: 7, slotCount: 5,
        preRecorded: [], finish: false, stopAtSignup: true
      },
      // —— 抢 7 待录入：用来手动测单盘抢分校验（7-0…7-5 / 8-6 应通过，7-6 / 8-7 应拒绝）
      short_t7_pending: {
        label: '抢 7 待录入', userCount: 6, slotCount: 5, bestOf: 7,
        preRecorded: [], finish: false
      },
      // —— 抢 11 已完赛 A 胜：验证抢 11 校验 + 固定积分结算（A 队 4:1 胜 B 队）
      short_t11_a_wins: {
        label: '抢 11 · A 队完赛胜', userCount: 6, slotCount: 5, bestOf: 11,
        preRecorded: [
          { slotIndex: 1, setsA: 11, setsB: 3 },   // A 胜（正常）
          { slotIndex: 2, setsA: 11, setsB: 5 },   // A 胜（正常）
          { slotIndex: 3, setsA: 7,  setsB: 11 },  // B 胜（正常）
          { slotIndex: 4, setsA: 12, setsB: 10 },  // A 胜（延长）
          { slotIndex: 5, setsA: 13, setsB: 11 }   // A 胜（延长）
        ],
        finish: true
      },
      // —— 多种 lineup 完赛：海报 + 详情页都该正确展示混合 lineup（1v1 / 2v2 / 无）
      // lineupAIdx / lineupBIdx 是各队 members 数组的 0-based 索引；idx=0 = 队长
      team_lineup_mixed_finished: {
        label: 'Lineup · 混合姿态完赛', userCount: 6, slotCount: 5, bestOf: 6,
        preRecorded: [
          { slotIndex: 1, setsA: 6, setsB: 4, lineupAIdx: [0],    lineupBIdx: [0] },     // 队长 1v1
          { slotIndex: 2, setsA: 4, setsB: 6, lineupAIdx: [0, 1], lineupBIdx: [0, 1] },  // 2v2
          { slotIndex: 3, setsA: 6, setsB: 2 },                                          // 无 lineup（fallback 到 SLOT 3）
          { slotIndex: 4, setsA: 7, setsB: 5, lineupAIdx: [1],    lineupBIdx: [1] },     // 非队长 1v1
          { slotIndex: 5, setsA: 6, setsB: 1, lineupAIdx: [0, 2], lineupBIdx: [0, 2] }   // 队长+替补 2v2
        ],
        finish: true
      },
      // —— Lineup 录入中：前两个 slot 已带 lineup，后三个待录（验证改录时回填 + 剩余 slot 可录）
      team_lineup_recording: {
        label: 'Lineup · 录入中', userCount: 6, slotCount: 5, bestOf: 6,
        preRecorded: [
          { slotIndex: 1, setsA: 6, setsB: 4, lineupAIdx: [0],    lineupBIdx: [0] },
          { slotIndex: 2, setsA: 4, setsB: 6, lineupAIdx: [0, 1], lineupBIdx: [0, 1] }
        ],
        finish: false
      },
      // —— 排阵/录分解耦 & 中途加人 测试场景 ——
      team_lineup_ready: {
        label: '排阵测试 · 已抽签无比分', userCount: 6, slotCount: 5,
        preRecorded: [], finish: false
      },
      team_partial_scored: {
        label: '加人测试 · 2 slot 已录 3 slot 空', userCount: 6, slotCount: 5,
        preRecorded: [
          { slotIndex: 1, setsA: 6, setsB: 4 },
          { slotIndex: 2, setsA: 4, setsB: 6 }
        ],
        finish: false
      },
      multi_court_recording: {
        label: '拆场地 · 12人2场录入中', userCount: 12, slotCount: 4, bestOf: 6,
        preRecorded: [
          { slotIndex: 1, setsA: 6, setsB: 3 },
          { slotIndex: 2, setsA: 4, setsB: 6 },
          { slotIndex: 3, setsA: 6, setsB: 2 },
          { slotIndex: 4, setsA: 3, setsB: 6 }
        ],
        finish: false
      },
      // —— 个人页团队赛战绩验证：以 test_u_003（A 队 idx1）为观察对象 ——
      //     team_A indices: [0]=test_u_001, [1]=test_u_003, [2]=test_u_005
      //     team_B indices: [0]=test_u_002, [1]=test_u_004, [2]=test_u_006
      //     test_u_003 预期 matchHistory：
      //       Slot 1 WIN singles  vs 测试-丁
      //       Slot 2 LOSS doubles vs 测试-乙/测试-丁
      //       Slot 3 SKIP（未上场）
      //       Slot 4 WIN singles  vs 测试-乙
      //       Slot 5 WIN doubles  vs 测试-丁/测试-己
      team_personal_profile: {
        label: '个人页 · 团队赛战绩验证', userCount: 6, slotCount: 5, bestOf: 6,
        preRecorded: [
          { slotIndex: 1, setsA: 6, setsB: 3, lineupAIdx: [1],    lineupBIdx: [1] },
          { slotIndex: 2, setsA: 4, setsB: 6, lineupAIdx: [0, 1], lineupBIdx: [0, 1] },
          { slotIndex: 3, setsA: 6, setsB: 2, lineupAIdx: [2],    lineupBIdx: [2] },
          { slotIndex: 4, setsA: 7, setsB: 5, lineupAIdx: [1],    lineupBIdx: [0] },
          { slotIndex: 5, setsA: 6, setsB: 1, lineupAIdx: [1, 2], lineupBIdx: [1, 2] }
        ],
        finish: true
      }
    };

// ====== 单打/双打测试夹具场景（用于加人/移除测试） ======
const TOURNAMENT_TEST_SCENARIOS = {
  singles_5_group: {
    type: 'singles', label: '单打 · 5人2组(加人/移除测试)',
    userCount: 5, bestOf: 6, level: 'friendly',
    config: { groupCount: 2, advanceCount: 2, seedCount: 0 }
  },
  singles_4_group: {
    // 4 人 1 组 = 6 场循环赛，适合测 removePlayer：移除 1 人 → 3 人 3 场
    type: 'singles', label: '单打 · 4人1组(移除选手测试)',
    userCount: 4, bestOf: 6, level: 'friendly',
    config: { groupCount: 1, advanceCount: 2, seedCount: 0 }
  },
  doubles_6_group: {
    type: 'doubles', label: '双打 · 6人3对2组(加人/移除测试)',
    userCount: 6, bestOf: 6, level: 'friendly',
    config: { groupCount: 2, advanceCount: 2, seedCount: 0 }
  },
  singles_6_clean_group: {
    // 6 人 2 组、无任何比分，专测 rollbackToSignup 回滚后重新抽签
    type: 'singles', label: '单打 · 6人2组(回滚测试)',
    userCount: 6, bestOf: 6, level: 'friendly',
    config: { groupCount: 2, advanceCount: 2, seedCount: 0 }
  }
};

// ====== 双打"参赛单位"(compound player) helpers ======
// 单打：每个 group/knockout match 的 playerA/playerB 是单人
//   { openid, wecomName, ... }
// 双打：playerA/playerB 是 compound player（一队两人）
//   { openid: 'team_oidA_oidB',  // 合成 ID，仅用于在 group/match 里识别"参赛单位"
//     wecomName: '张三 / 李四',
//     members: [
//       { openid: oidA, wecomName: '张三' },
//       { openid: oidB, wecomName: '李四' }
//     ],
//     totalPoints: ...  // 两人之和，用于种子排序
//   }
//
// 关键：所有 seedDraw / generateRoundRobin / generateKnockout / calcStandings
// 这套抽签 + 对阵 + 排名逻辑用 player.openid + player.wecomName 作为参赛单位 ID
// 和显示名。compound player 也有这两个字段，所以**这套核心算法对单/双打通用**。
// 真正区分双打的只在两处：
//   1. draw 入口：双打时把 pairs 转成 compound players
//   2. 写回 user 数据：双打时一个参赛单位 = 两人，要循环 members 各发各算

// 提取参赛单位的真实成员
// teams: 可选，tournament.teams 数组，用于兼容历史数据（bracket 中 members 丢失时回查）
function extractMembers(player, teams) {
  if (!player) return [];
  if (Array.isArray(player.members) && player.members.length > 0) {
    return player.members.map(m => ({ openid: m.openid, wecomName: m.wecomName }));
  }
  // 兼容：bracket 中 members 丢失但 openid 是合成 ID（team_oidA_oidB）的双打场景
  // 优先从 tournament.teams 查找完整 members
  if (player.openid && player.openid.startsWith('team_') && Array.isArray(teams)) {
    const team = teams.find(t => t.openid === player.openid);
    if (team && Array.isArray(team.members) && team.members.length > 0) {
      return team.members.map(m => ({ openid: m.openid, wecomName: m.wecomName }));
    }
    // 最终 fallback：从合成 ID 解析出两个真实 openid
    const parts = player.openid.replace(/^team_/, '').split('_');
    if (parts.length >= 2) {
      // openid 可能本身含下划线，用 teams 失败后才走这条路
      // 格式: team_{oid1}_{oid2}，oid 由微信生成通常不含下划线，但保险起见取前后各一段
      return parts.map(oid => ({ openid: oid, wecomName: '' }));
    }
  }
  return [{ openid: player.openid, wecomName: player.wecomName }];
}

// 由两个 player（report 报名记录）构造一个 compound 参赛单位
function makeDoubleTeam(p1, p2) {
  return {
    openid: `team_${p1.openid}_${p2.openid}`,
    wecomName: `${p1.wecomName} / ${p2.wecomName}`,
    members: [
      { openid: p1.openid, wecomName: p1.wecomName },
      { openid: p2.openid, wecomName: p2.wecomName }
    ],
    totalPoints: (p1.totalPoints || 0) + (p2.totalPoints || 0),
    rating: '',
    seed: 0
  };
}

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

// ELO 等级分变动。K 值按赛制分流（整体在历史 K=32 基础上砍半，避免反馈过大）：
//   - 多盘正赛（先赢 4/6 盘）：K=16
//   - 单盘抢 7：K=8   （单盘偶然性最高，权重最小）
//   - 单盘抢 11：K=12 （介于两者之间）
function kFactorFor(bestOf) {
  if (bestOf === 7) return 8;
  if (bestOf === 11) return 12;
  return 16;
}

function calcEloChange(winnerElo, loserElo, bestOf) {
  const K = kFactorFor(bestOf);
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

// 反向冲销 user 文档（撤回比分时使用）：
// - eloRating 减去 eloDelta
// - tournamentEarnings 中该赛事的 earned 减去 pts，归零则移除条目
// - totalPoints 重算最佳10场
// - eloHistory 末尾删除一条匹配 tournamentId 的记录（曲线干净）
function buildUserRevertPayload(user, tournamentId, eloDelta, ptsToRevert) {
  const oldElo = user.eloRating || 1500;
  const newElo = oldElo - eloDelta;

  let earnings = (user.tournamentEarnings || []).slice();
  const idx = earnings.findIndex(e => e.tournamentId === tournamentId);
  if (idx >= 0) {
    const newEarned = (earnings[idx].earned || 0) - ptsToRevert;
    if (newEarned <= 0) {
      earnings.splice(idx, 1); // 该赛事所有得分都撤光了
    } else {
      earnings[idx] = { ...earnings[idx], earned: newEarned };
    }
  }
  const totalPoints = earnings.slice()
    .sort((a, b) => b.earned - a.earned)
    .slice(0, 10)
    .reduce((s, e) => s + e.earned, 0);

  // eloHistory 末尾删除一条该赛事记录（最近的那条；曲线还原）
  const history = (user.eloHistory || []).slice();
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].tournamentId === tournamentId) {
      history.splice(i, 1);
      break;
    }
  }

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

// 团队赛 bracket 生成（PRD §2.2）：
// - 所有报名者按 totalPoints 分入 A 队 / B 队
// - 只生成 1 场 match（teamA vs teamB），match 下挂多个物理场地 court
// - court 内不预设对阵；现场自由轮换，打完一场追加一条 encounter
// - 第三参数 captains = { A: openid, B: openid }（可选）：
//   1) 优先把 captainA / captainB 放进对应队并标记 isCaptain: true，放第 0 位
//   2) 剩余选手按 totalPoints 蛇形分（考虑两队已各有 1 人，从人数较少队开始 fill）
//   3) captains 为 null/缺字段时退化为原"纯蛇形"逻辑（向后兼容 seedTeamMatchTest 等）
// 返回 { groups: [...], teams: [...] }
function generateTeamMatchBrackets(players, courtCount, captains) {
  const sorted = players.slice().sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0));
  const aMembers = [];
  const bMembers = [];
  const strip = (p, isCaptain) => ({
    openid: p.openid,
    wecomName: p.wecomName,
    gender: p.gender || '',
    rating: p.rating || '',
    isCaptain: !!isCaptain
  });

  const hasCaptains = captains && captains.A && captains.B && captains.A !== captains.B;

  if (hasCaptains) {
    // 1) 队长入队（按 openid 定位）
    const findP = (oid) => sorted.find(p => p.openid === oid);
    const capA = findP(captains.A);
    const capB = findP(captains.B);
    if (!capA || !capB) {
      throw new Error('generateTeamMatchBrackets: captainA/captainB 不在报名名单里');
    }
    aMembers.push(strip(capA, true));
    bMembers.push(strip(capB, true));
    // 2) 剩余选手（按 totalPoints 蛇形，从人数较少队开始 fill）
    const rest = sorted.filter(p => p.openid !== captains.A && p.openid !== captains.B);
    rest.forEach((p) => {
      // 从人数较少队开始
      const toA = aMembers.length <= bMembers.length;
      (toA ? aMembers : bMembers).push(strip(p, false));
    });
  } else {
    // 退化：原"纯蛇形"逻辑（向后兼容）
    sorted.forEach((p, i) => {
      const toA = (Math.floor(i / 2) % 2 === 0) ? (i % 2 === 0) : (i % 2 === 1);
      (toA ? aMembers : bMembers).push(strip(p, false));
    });
  }

  const teams = [
    { openid: 'team_A', name: 'A 队', members: aMembers },
    { openid: 'team_B', name: 'B 队', members: bMembers }
  ];

  // 混队蛇形分场地：每片场地必须同时有 A/B 队员，不创建空场或单边场。
  const requestedCourtCount = Math.max(1, parseInt(courtCount) || 1);
  const maxCourtCount = Math.max(1, Math.min(aMembers.length, bMembers.length));
  const courtCountSafe = Math.min(requestedCourtCount, maxCourtCount);
  const courts = [];
  for (let i = 0; i < courtCountSafe; i++) {
    courts.push({ id: `court_${i + 1}`, name: `${i + 1}号场`, players: [], encounters: [] });
  }
  const snakeAssign = (members) => {
    members.forEach((m, idx) => {
      const round = Math.floor(idx / courtCountSafe);
      const pos = idx % courtCountSafe;
      const courtIdx = round % 2 === 0 ? pos : courtCountSafe - 1 - pos;
      courts[courtIdx].players.push(m.openid);
    });
  };
  snakeAssign(aMembers);
  snakeAssign(bMembers);

  const match = {
    id: 'tm_1',
    teamA: 'team_A',
    teamB: 'team_B',
    courts,
    tiebreak: null,
    teamScore: { A: 0, B: 0 },
    winner: null,
    scoreA: 0,
    scoreB: 0,
    scoreSummary: '',
    status: 'pending'
  };
  const groups = [{ name: '团队赛', matches: [match] }];
  return { groups, teams, courtCount: courtCountSafe, maxCourtCount, requestedCourtCount };
}

function createTeamCourt(index) {
  return { id: `court_${index}`, name: `${index}号场`, players: [], encounters: [] };
}

// 在未录分时重排场地。A/B 分别蛇形进入每片场地，保证非空且混队。
function redistributeTeamCourts(match, teams, courtCount) {
  const teamA = (teams || []).find(team => team.openid === match.teamA);
  const teamB = (teams || []).find(team => team.openid === match.teamB);
  const aMembers = (teamA && teamA.members) || [];
  const bMembers = (teamB && teamB.members) || [];
  const count = Math.max(1, parseInt(courtCount) || 1);
  const maxCourtCount = Math.min(aMembers.length, bMembers.length);
  if (maxCourtCount < 1) return { error: '两队都至少需要 1 人才能分场地' };
  if (count > maxCourtCount) {
    return { error: `当前两队人数最多支持 ${maxCourtCount} 片混队场地`, maxCourtCount };
  }

  const courts = Array.from({ length: count }, (_, index) => createTeamCourt(index + 1));
  const snakeAssign = members => {
    members.forEach((member, index) => {
      const round = Math.floor(index / count);
      const position = index % count;
      const courtIndex = round % 2 === 0 ? position : count - 1 - position;
      courts[courtIndex].players.push(member.openid);
    });
  };
  snakeAssign(aMembers);
  snakeAssign(bMembers);
  return { courts, maxCourtCount };
}

// 新数据读 courts[].encounters；旧赛事仍可读 slots，避免历史团队赛突然无比分。
function getTeamRegularEncounters(match) {
  if (Array.isArray(match.courts)) {
    return match.courts.reduce((all, court) => all.concat((court && court.encounters) || []), []);
  }
  return (match.slots || []).filter(slot => !slot.isTiebreak);
}

function getTeamTiebreak(match) {
  if (match.tiebreak) return match.tiebreak;
  return (match.slots || []).find(slot => slot.isTiebreak) || null;
}

function summarizeTeamMatch(match) {
  const encounters = getTeamRegularEncounters(match).filter(encounter => encounter && encounter.winner);
  const teamScoreA = encounters.filter(encounter => encounter.winner === 'A').length;
  const teamScoreB = encounters.filter(encounter => encounter.winner === 'B').length;
  const gamesA = encounters.reduce((sum, encounter) => sum + (parseInt(encounter.setsA) || 0), 0);
  const gamesB = encounters.reduce((sum, encounter) => sum + (parseInt(encounter.setsB) || 0), 0);
  return {
    encounters,
    teamScoreA,
    teamScoreB,
    gamesA,
    gamesB,
    netGames: gamesA - gamesB
  };
}

// 海报和个人战绩仍使用 slots 作为只读展示契约。
// 新版团队赛以 courts 为真实数据源，详情读取时动态投影，不在 DB 里维护两份可变数据。
function buildLegacyTeamSlots(match) {
  const slots = getTeamRegularEncounters(match).filter(encounter => encounter && encounter.winner).map((encounter, index) => ({
    ...encounter,
    index: index + 1,
    isTiebreak: false
  }));
  const tiebreak = getTeamTiebreak(match);
  if (tiebreak) {
    slots.push({ ...tiebreak, index: slots.length + 1, isTiebreak: true });
  }
  return slots;
}

function projectTeamTournamentForRead(tournament) {
  if (!tournament || tournament.type !== 'team') return tournament;
  const groups = (tournament.groups || []).map(group => ({
    ...group,
    matches: (group.matches || []).map(match => ({ ...match, slots: buildLegacyTeamSlots(match) }))
  }));
  return { ...tournament, groups };
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
    g.standings = g.players.map(p => {
      const s = { openid: p.openid, wecomName: p.wecomName, played: 0, wins: 0, losses: 0, setsWon: 0, setsLost: 0 };
      // 双打：保留 members，确保淘汰赛生成时能找到真实成员
      if (Array.isArray(p.members) && p.members.length > 0) {
        s.members = p.members.map(m => ({ openid: m.openid, wecomName: m.wecomName }));
      }
      return s;
    });
  }

  return groups;
}

// 循环赛对阵生成
// 对单/双打通用：传入的 player 对象在双打里是 compound player（含 members 数组），
// 单打里是 { openid, wecomName }。下面拷贝 player 时显式带上 members 以保证
// 双打链路完整（之前只拷 openid+wecomName 是 BUG，会让 score 时扣不到真人头上）。
function generateRoundRobin(players) {
  const matches = [];
  const cloneUnit = (p) => {
    const u = { openid: p.openid, wecomName: p.wecomName };
    if (Array.isArray(p.members) && p.members.length > 0) {
      u.members = p.members.map(m => ({ openid: m.openid, wecomName: m.wecomName }));
    }
    return u;
  };
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      matches.push({
        id: `${players[i].openid}_${players[j].openid}`,
        playerA: cloneUnit(players[i]),
        playerB: cloneUnit(players[j]),
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

  const cloneUnit = (p) => {
    if (!p) return null;
    const u = { openid: p.openid, wecomName: p.wecomName };
    if (Array.isArray(p.members) && p.members.length > 0) {
      u.members = p.members.map(m => ({ openid: m.openid, wecomName: m.wecomName }));
    }
    return u;
  };

  // 种子排位（1 vs size, 2 vs size-1, ...）
  const bracket = [];
  for (let i = 0; i < size / 2; i++) {
    const a = advancedPlayers[i] || null;
    const b = advancedPlayers[size - 1 - i] || null;
    bracket.push({
      id: `ko_r1_${i}`,
      playerA: cloneUnit(a),
      playerB: cloneUnit(b),
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
    const entry = { openid: p.openid, wecomName: p.wecomName, played: 0, wins: 0, losses: 0, setsWon: 0, setsLost: 0 };
    // 双打：保留 members 数组，否则淘汰赛阶段无法还原真实成员 openid
    if (Array.isArray(p.members) && p.members.length > 0) {
      entry.members = p.members.map(m => ({ openid: m.openid, wecomName: m.wecomName }));
    }
    map[p.openid] = entry;
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
  // 排序：胜场 > 胜负关系（直接交手） > 净胜盘
  const standings = Object.values(map).sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    // 胜负关系：同胜场时优先看两人直接交手谁赢了
    const h2h = group.matches.find(m => {
      if (!m || !m.winner || !m.playerA || !m.playerB) return false;
      return (m.playerA.openid === a.openid && m.playerB.openid === b.openid) ||
             (m.playerA.openid === b.openid && m.playerB.openid === a.openid);
    });
    if (h2h && h2h.winner) {
      const aIsA = h2h.playerA.openid === a.openid;
      const aWon = (aIsA && h2h.winner === 'A') || (!aIsA && h2h.winner === 'B');
      return aWon ? -1 : 1;
    }
    // 无直接交手（或 3 人循环套） → 净胜盘
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
function isShortFormat(bestOf) {
  return bestOf === 7 || bestOf === 11;
}

function validateScore(scoreA, scoreB, target) {
  const high = Math.max(scoreA, scoreB);
  const low = Math.min(scoreA, scoreB);

  // 平局不合法
  if (high === low) return false;

  // 单盘抢分制（抢 7 / 抢 11）：先到 target、净胜 ≥ 2，可延长
  if (isShortFormat(target)) {
    if (high < target) return false;
    if (high - low < 2) return false;
    // 未延长：胜者 = target，负者 ≤ target - 2
    if (high === target) return low <= target - 2;
    // 延长：胜者 ≥ target + 1，净胜 = 2
    return high - low === 2;
  }

  // 多盘制（先赢 N 盘）
  // 正常胜：胜者 = target，负者 ≤ target - 2
  if (high === target && low >= 0 && low <= target - 2) return true;

  // 延长胜：胜者 = target + 1，负者 = target - 1（领先2局胜出）
  if (high === target + 1 && low === target - 1) return true;

  // 抢七胜：胜者 = target + 1，负者 = target（抢七决胜）
  if (high === target + 1 && low === target) return true;

  return false;
}

// 校验团队赛"一球制胜"slot 比分合法性（只接受 1-0 或 0-1）
function validateGoldenPoint(scoreA, scoreB) {
  return (scoreA === 1 && scoreB === 0) || (scoreA === 0 && scoreB === 1);
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

// 团队赛只写固定赛事积分，不修改 ELO。这里使用“覆盖本赛事固定分”而不是累加，
// 保证同一结算即使因为网络重试再次执行，也只保留一份 +40/+20。
function buildTeamEarningPayload(user, tournamentId, tournamentTitle, tournamentDate, points) {
  const earnings = (user.tournamentEarnings || []).slice();
  const idx = earnings.findIndex(item => item.tournamentId === tournamentId);
  const earning = { tournamentId, title: tournamentTitle, earned: points, date: tournamentDate };
  if (idx >= 0) earnings[idx] = { ...earnings[idx], ...earning };
  else earnings.push(earning);

  const totalPoints = earnings.slice()
    .sort((a, b) => b.earned - a.earned)
    .slice(0, 10)
    .reduce((sum, item) => sum + item.earned, 0);
  return { tournamentEarnings: earnings, totalPoints, updatedAt: Date.now() };
}

// 删除团队赛时按赛事 ID 整条移除固定积分；团队赛不写 ELO，因此无需改 eloRating/eloHistory。
function buildTeamEarningRemovalPayload(user, tournamentId) {
  const earnings = (user.tournamentEarnings || []).filter(item => item.tournamentId !== tournamentId);
  const totalPoints = earnings.slice()
    .sort((a, b) => b.earned - a.earned)
    .slice(0, 10)
    .reduce((sum, item) => sum + item.earned, 0);
  return { tournamentEarnings: earnings, totalPoints, updatedAt: Date.now() };
}

function buildTeamMatchAwards(tournament, match) {
  if (match.status !== 'finished' || !match.winner) {
    throw new Error('团队赛尚未结束或没有胜方');
  }
  const teams = tournament.teams || [];
  const teamAUnit = teams.find(t => t.openid === match.teamA);
  const teamBUnit = teams.find(t => t.openid === match.teamB);
  if (!teamAUnit || !teamBUnit) {
    throw new Error('团队赛队伍数据未正确初始化');
  }
  const winnerMembers = match.winner === 'A' ? (teamAUnit.members || []) : (teamBUnit.members || []);
  const loserMembers = match.winner === 'A' ? (teamBUnit.members || []) : (teamAUnit.members || []);
  return [
    ...winnerMembers.filter(member => member.openid).map(member => ({ openid: member.openid, points: TEAM_MATCH_POINTS.win })),
    ...loserMembers.filter(member => member.openid).map(member => ({ openid: member.openid, points: TEAM_MATCH_POINTS.loss }))
  ];
}

// 事务不支持 where 查询，先在事务外把 team roster 的 openid 映射成 user 文档 ID。
async function loadTeamMemberIdMap(tournament, match) {
  const teams = tournament.teams || [];
  const teamAUnit = teams.find(team => team.openid === match.teamA);
  const teamBUnit = teams.find(team => team.openid === match.teamB);
  if (!teamAUnit || !teamBUnit) throw new Error('团队赛队伍数据未正确初始化');
  const openids = [...new Set(
    [...(teamAUnit.members || []), ...(teamBUnit.members || [])]
      .map(member => member.openid)
      .filter(Boolean)
  )];
  const users = await Promise.all(openids.map(openid => getUser(openid)));
  if (users.some(user => !user)) throw new Error('团队成员用户数据缺失，无法结算');
  const idMap = {};
  openids.forEach((openid, index) => { idMap[openid] = users[index]._id; });
  return idMap;
}

// 必须在与 tournament finished 写入相同的事务中调用。
// 返回带 teamSettlement 凭证的新 match，供删除回滚与重复请求判断。
async function applyTeamMatchSettlement(transaction, tournament, match, userIdMap) {
  if (match.teamSettlement) return { match, settlement: match.teamSettlement, alreadySettled: true };
  const awards = buildTeamMatchAwards(tournament, match);
  for (const award of awards) {
    const userId = userIdMap[award.openid];
    if (!userId) throw new Error('团队成员用户数据缺失，无法结算');
    const userRes = await transaction.collection(USERS).doc(userId).get();
    await transaction.collection(USERS).doc(userId).update({
      data: buildTeamEarningPayload(
        userRes.data,
        tournament._id,
        tournament.title,
        tournament.matchDate,
        award.points
      )
    });
  }
  const settlement = {
    id: `team_${tournament._id}_${match.id}`,
    winner: match.winner,
    awards,
    awardedAt: Date.now()
  };
  return { match: { ...match, teamSettlement: settlement }, settlement, alreadySettled: false };
}

// 测试夹具 helper：确保 TEST_USER_ROSTER 前 count 个用户都存在，返回 players 入库格式
// 幂等：已存在则跳过 add。批量查询替代逐个查库，避免串行 N 次 round trip 导致超时
async function ensureTestUsers(count) {
  const now = Date.now();
  // 花名册不够时自动补位（test_u_009, test_u_010 …）
  const roster = TEST_USER_ROSTER.slice();
  while (roster.length < count) {
    const idx = roster.length + 1;
    roster.push({
      openid: `test_u_${String(idx).padStart(3, '0')}`,
      wecomName: `测试-${idx}`,
      gender: idx % 2 === 0 ? 'F' : 'M',
      rating: 3.0,
      totalPoints: 50 - (idx - 8) * 5
    });
  }
  const subset = roster.slice(0, Math.max(1, count));
  const oids = subset.map(r => r.openid);

  // 批量查出已存在的测试用户
  const existRes = await db.collection(USERS)
    .where({ openid: _.in(oids) })
    .get()
    .catch(() => ({ data: [] }));
  const existingOids = new Set((existRes.data || []).map(u => u.openid));

  // 批量并行创建不存在的用户（同时发起所有 add，1 次 round trip 完成）
  const toCreate = subset.filter(r => !existingOids.has(r.openid));
  if (toCreate.length > 0) {
    await Promise.all(toCreate.map(r =>
      db.collection(USERS).add({
        data: {
          openid: r.openid,
          wecomName: r.wecomName,
          gender: r.gender,
          avatarUrl: '',
          rating: r.rating,
          totalPoints: r.totalPoints,
          eloRating: 1500,
          role: 'member',
          tournamentEarnings: [],
          placementAwards: [],
          _isTest: true,
          createdAt: now,
          updatedAt: now
        }
      })
    ));
  }

  return subset.map(r => ({
    openid: r.openid,
    wecomName: r.wecomName,
    gender: r.gender,
    rating: r.rating,
    totalPoints: r.totalPoints,
    signupAt: now
  }));
}

// 赛事结束时发放名次奖励（事务外执行：status=finished 后不会再有 score 操作）
// 双打：每个 award 对应"参赛单位"，但实际发放时给 team 内每人各发满分（"队员各得满分"）
// 返回的 awards 数组按"真实成员"展开（一人一条），方便前端 placementAwards 展示
async function awardPlacementBonus(tournament) {
  const level = tournament.level || 'friendly';
  const bonus = PLACEMENT_BONUS[level] || PLACEMENT_BONUS.friendly;
  // 双打不再 ×0.8；用户决策"队员各得满分"
  const factor = 1;
  const ko = tournament.knockout;
  if (!ko || !ko.rounds || ko.rounds.length === 0) return [];

  // 名次中文 → 数字（前端海报/highlight 用 placement 字段）
  const PLACEMENT_NUM = { '冠军': 1, '亚军': 2, '四强': 3, '八强': 5, '参与': 99 };

  const tId = tournament._id;
  const tTitle = tournament.title;
  const tDate = tournament.matchDate || tournament.createdAt;
  const awards = [];
  const rounds = ko.rounds;
  const finalMatch = rounds[rounds.length - 1].matches[0];

  // 把 player（compound or 单人）展开成多条 award
  function pushAwardsForUnit(unit, place, pts) {
    if (!unit) return;
    const members = extractMembers(unit, tournament.teams);
    const isTeam = members.length > 1;
    const teamId = isTeam ? unit.openid : null;
    for (const m of members) {
      // 同一个真实 openid 不重复发奖
      if (awards.some(a => a.openid === m.openid)) continue;
      awards.push({
        openid: m.openid,
        wecomName: m.wecomName,
        place,                              // 中文（'冠军' 等）
        placement: PLACEMENT_NUM[place] || 99, // 前端海报/highlight 读取
        pts,
        points: pts,                         // 兼容前端 .points 字段
        teamId
      });
    }
  }

  // 冠军 / 亚军
  if (finalMatch.winner) {
    const championUnit = finalMatch.winner === 'A' ? finalMatch.playerA : finalMatch.playerB;
    const runnerUpUnit = finalMatch.winner === 'A' ? finalMatch.playerB : finalMatch.playerA;
    pushAwardsForUnit(championUnit, '冠军', Math.round(bonus.champion * factor));
    pushAwardsForUnit(runnerUpUnit, '亚军', Math.round(bonus.runnerUp * factor));
  }

  // 三四名 / 四强（半决赛负者）
  if (rounds.length >= 2) {
    const semiFinals = rounds[rounds.length - 2].matches;
    const finalRound = rounds[rounds.length - 1];
    const tpMatch = finalRound.matches.find(m => m.isThirdPlace);

    if (tpMatch && tpMatch.winner) {
      // 有三四名决赛且已出结果
      const thirdUnit = tpMatch.winner === 'A' ? tpMatch.playerA : tpMatch.playerB;
      const fourthUnit = tpMatch.winner === 'A' ? tpMatch.playerB : tpMatch.playerA;
      pushAwardsForUnit(thirdUnit, '季军', Math.round(bonus.semiFinal * factor));
      pushAwardsForUnit(fourthUnit, '殿军', Math.round(bonus.semiFinal * factor));
    } else {
      // 无三四名决赛：两个半决赛负者并列四强
      for (const m of semiFinals) {
        if (m.winner) {
          const loserUnit = m.winner === 'A' ? m.playerB : m.playerA;
          pushAwardsForUnit(loserUnit, '四强', Math.round(bonus.semiFinal * factor));
        }
      }
    }
  }

  // 八强（四分之一决赛负者）
  if (rounds.length >= 3) {
    const quarterFinals = rounds[rounds.length - 3].matches;
    for (const m of quarterFinals) {
      if (m.winner) {
        const loserUnit = m.winner === 'A' ? m.playerB : m.playerA;
        pushAwardsForUnit(loserUnit, '八强', Math.round(bonus.quarterFinal * factor));
      }
    }
  }

  // 小组赛未晋级者：按组内排名给名次（不再统一标"参与/99"）
  // 注意：tournament.players 是个人报名记录，不是 compound players
  // 双打 / 单打都用真实 openid 直接补
  const awardedOpenids = new Set(awards.map(a => a.openid));
  const players = tournament.players || [];
  const groups = tournament.groups || [];

  // 预建 openid → { groupName, groupRank } 的查找表（按 standings 排名）
  function buildGroupRankMap() {
    const map = {};
    for (const g of groups) {
      const standings = Array.isArray(g.standings) && g.standings.length > 0
        ? g.standings
        : calcStandings(g);
      standings.forEach((s, idx) => {
        if (s.openid) {
          map[s.openid] = { groupName: g.name, groupRank: idx + 1 };
        }
      });
    }
    return map;
  }

  const groupRankMap = groups.length > 0 ? buildGroupRankMap() : {};

  for (const p of players) {
    if (!awardedOpenids.has(p.openid)) {
      const gr = groupRankMap[p.openid];
      const place = gr ? `${gr.groupName}组第${gr.groupRank}名` : '参与';
      // placement 编码：淘汰赛 1-8，小组赛用 组序号×100 + 组内排名
      // 例：A 组第 3 → 103，B 组第 1 → 201
      const placement = gr
        ? (gr.groupName.charCodeAt(0) - 64) * 100 + gr.groupRank
        : PLACEMENT_NUM['参与'];
      const pts = Math.round(bonus.participant * factor);
      awards.push({
        openid: p.openid,
        wecomName: p.wecomName,
        place,
        placement,
        pts,
        points: pts,
        teamId: null
      });
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
    return { code: 0, data: projectTeamTournamentForRead(res.data) };
  }

  // 创建赛事
  if (action === 'create') {
    const me = await getUser(OPENID);
    if (!me || !me.wecomName) return { code: 1, msg: '请先完成登记' };
    // 仅管理员可创建赛事（活动 create 不变）
    if (me.role !== 'admin') return { code: 1, msg: '只有管理员可以创建赛事' };
    const p = event.payload || {};
    if (!p.title) return { code: 1, msg: '请填写赛事名称' };

    const type = p.type === 'doubles' ? 'doubles'
      : p.type === 'team' ? 'team'
      : 'singles';
    const bestOf = [4, 6, 7, 11].includes(p.bestOf) ? p.bestOf : 6;
    const level = ['major', 'challenge', 'friendly'].includes(p.level) ? p.level : 'friendly';
    const groupCount = Math.max(1, Math.min(8, p.groupCount || 2));
    const advanceCount = Math.max(1, Math.min(4, p.advanceCount || 2));
    const seedCount = Math.max(0, Math.min(16, p.seedCount || groupCount));
    // 团队赛场地数（仅 type='team' 时有效，可选）：前端可预填；未填则 draw 时按报名人数 ceil/6 自动算
    const teamMatchCourts = parseInt(p.teamMatchCourts) || 0;

    const now = Date.now();
    const addData = {
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
    };
    if (type === 'team') {
      if (teamMatchCourts > 0) addData.teamMatchCourts = teamMatchCourts;
      // 团队赛无级别区分（不论周/月/半年赛都走同一套 TEAM_WIN/LOSS_BONUS），
      // 不写 level 字段，避免后续查询/统计时被误用 PLACEMENT_BONUS
      delete addData.level;
    }
    const addRes = await db.collection(TOURNAMENTS).add({ data: addData });
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
  // 双打：必须额外传 pairs: [[oid1, oid2], ...]，由 admin 在前端配对完成
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
    const groupCount = Math.max(1, Math.min(8, event.groupCount || t.config.groupCount || 2));
    let advanceCount = Math.max(1, Math.min(4, event.advanceCount || t.config.advanceCount || 2));
    const seedCount = event.seedCount !== undefined ? event.seedCount : (t.config.seedCount || 0);

    // 双打：把 pairs 转成 compound players；之后的抽签/分组/对阵全部按 compound 处理
    let drawUnits;
    let teamsForDb = null;
    if (t.type === 'doubles') {
      const pairs = Array.isArray(event.pairs) ? event.pairs : null;
      if (!pairs || pairs.length === 0) {
        return { code: 1, msg: '双打需要先完成两两配对再抽签' };
      }
      // 校验：所有 oid 必须在 players 里、不重复、人数=偶数
      const playerMap = {};
      for (const p of players) playerMap[p.openid] = p;
      const used = new Set();
      const teams = [];
      for (const pair of pairs) {
        if (!Array.isArray(pair) || pair.length !== 2) {
          return { code: 1, msg: '配对格式错误（每对必须 2 人）' };
        }
        const [oidA, oidB] = pair;
        if (oidA === oidB) return { code: 1, msg: '同一人不能与自己配对' };
        if (!playerMap[oidA] || !playerMap[oidB]) {
          return { code: 1, msg: '配对中包含未报名的玩家' };
        }
        if (used.has(oidA) || used.has(oidB)) {
          return { code: 1, msg: '同一玩家被重复配对' };
        }
        used.add(oidA);
        used.add(oidB);
        teams.push(makeDoubleTeam(playerMap[oidA], playerMap[oidB]));
      }
      // 必须全部报名玩家都被配对（要求双打报名为偶数）
      if (used.size !== players.length) {
        return { code: 1, msg: `还有 ${players.length - used.size} 人未配对` };
      }
      drawUnits = teams;
      teamsForDb = teams;
    } else {
      drawUnits = players;
    }

    // 至少需要 groupCount 个参赛单位才能分成 groupCount 组（1 组场景至少 2 单位）
    const minUnits = Math.max(2, groupCount);
    if (drawUnits.length < minUnits) {
      return { code: 1, msg: `至少需要 ${minUnits} ${t.type === 'doubles' ? '对' : '人'}才能分 ${groupCount} 组` };
    }
    // Q2: advance 自动夹紧到组内单位数（避免"组内 4 单位但 advance 5"的非法配置）
    const groupSize = Math.ceil(drawUnits.length / groupCount);
    advanceCount = Math.min(advanceCount, groupSize);

    let groups;
    let config;
    let updateData;
    if (t.type === 'team') {
      // 团队赛：creator 在抽签弹层指定两位队长 + 四种赛制 + 场地数，其余按 totalPoints 蛇形分入两队。
      // 前端可传 teamMatchCourts 覆盖存储值；不传则 fallback 到 t.teamMatchCourts 或默认 ceil(人数/6)
      const courtCount = Math.max(1, parseInt(event.teamMatchCourts) || parseInt(t.teamMatchCourts) || Math.ceil(drawUnits.length / 6));
      if (drawUnits.length < 2) {
        return { code: 1, msg: '团队赛至少需要 2 人才能开赛' };
      }
      const captainA = event.captainA;
      const captainB = event.captainB;
      const bestOf = [4, 6, 7, 11].includes(parseInt(event.bestOf)) ? parseInt(event.bestOf) : 6;
      // 校验：captainA / captainB 都必须在 drawUnits 里，且不能相同
      if (!captainA || !captainB) return { code: 1, msg: '请指定两位队长（A 队 / B 队各一人）' };
      if (captainA === captainB) return { code: 1, msg: 'A 队长和 B 队长不能是同一人' };
      const inRoster = (oid) => drawUnits.some(u => u.openid === oid);
      if (!inRoster(captainA)) return { code: 1, msg: 'A 队长不在报名名单里' };
      if (!inRoster(captainB)) return { code: 1, msg: 'B 队长不在报名名单里' };
      const built = generateTeamMatchBrackets(drawUnits, courtCount, { A: captainA, B: captainB });
      if (built.requestedCourtCount > built.maxCourtCount) {
        return { code: 1, msg: `当前两队人数最多支持 ${built.maxCourtCount} 片混队场地` };
      }
      groups = built.groups;
      teamsForDb = built.teams;
      config = { groupCount: 1, advanceCount: 0, seedCount, courtCount: built.courtCount };
      updateData = { groups, config, status: 'group', bestOf, captains: { A: captainA, B: captainB }, teamMatchCourts: built.courtCount, updatedAt: Date.now() };
    } else {
      groups = seedDraw(drawUnits, groupCount, seedCount);
      config = { groupCount, advanceCount, seedCount };
      updateData = { groups, config, status: 'group', updatedAt: Date.now() };
    }
    if (teamsForDb) updateData.teams = teamsForDb;
    await db.collection(TOURNAMENTS).doc(event.id).update({ data: updateData });
    return { code: 0, data: { groups } };
  }

  // 团队赛：先保存一场的上场人员，不要求同时录入比分。
  // 每片场地只保留一个待录比分场次；比分撤回后也回到这个状态。
  if (action === 'saveEncounterLineup') {
    const me = await getUser(OPENID);
    const { matchId, courtId, lineupA, lineupB, encounterId } = event;
    if (!event.id || !matchId || !courtId) return { code: 1, msg: '参数不完整' };

    const lineA = Array.isArray(lineupA) ? lineupA.filter(Boolean) : [];
    const lineB = Array.isArray(lineupB) ? lineupB.filter(Boolean) : [];
    if (lineA.length === 0 || lineA.length !== lineB.length) {
      return { code: 1, msg: '两队上场人数必须相同且至少各 1 人' };
    }
    if (lineA.length > 2 || lineB.length > 2) return { code: 1, msg: '每队上场最多 2 人' };
    if (new Set(lineA).size !== lineA.length) return { code: 1, msg: 'A 队上场队员重复' };
    if (new Set(lineB).size !== lineB.length) return { code: 1, msg: 'B 队上场队员重复' };

    const isAdmin = me && me.role === 'admin';
    const savedEncounterId = encounterId || `enc_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    try {
      const result = await db.runTransaction(async transaction => {
        const latestRes = await transaction.collection(TOURNAMENTS).doc(event.id).get();
        const latest = latestRes.data;
        if (!latest || latest.type !== 'team') throw new Error('赛事不存在');
        if (latest.status !== 'group') throw new Error('当前不是小组赛阶段');

        const latestGroups = (latest.groups || []).slice();
        const latestGroup = latestGroups[0];
        const latestMatch = latestGroup && (latestGroup.matches || []).find(item => item.id === matchId);
        if (!latestMatch) throw new Error('比赛不存在');
        if (latestMatch.status === 'finished') throw new Error('该场团队赛已结束，不可再改');
        if (latestMatch.tiebreak) throw new Error('已进入一球制胜，不可再添加普通场次');

        const latestCourts = Array.isArray(latestMatch.courts)
          ? latestMatch.courts.map(item => ({
              ...item,
              players: (item.players || []).slice(),
              encounters: (item.encounters || []).slice()
            }))
          : [];
        const latestCourt = latestCourts.find(item => item.id === courtId);
        if (!latestCourt) throw new Error('场地不存在');
        const courtPlayerOids = new Set(latestCourt.players || []);
        if (latest.creator !== OPENID && !isAdmin && !courtPlayerOids.has(OPENID)) {
          throw new Error('你只能录入自己所在场地的场次');
        }

        const latestTeamA = (latest.teams || []).find(team => team.openid === latestMatch.teamA);
        const latestTeamB = (latest.teams || []).find(team => team.openid === latestMatch.teamB);
        const aOids = new Set((latestTeamA && latestTeamA.members || []).map(member => member.openid));
        const bOids = new Set((latestTeamB && latestTeamB.members || []).map(member => member.openid));
        if (lineA.some(openid => !aOids.has(openid))) throw new Error('A 队上场队员不在 A 队名单内');
        if (lineB.some(openid => !bOids.has(openid))) throw new Error('B 队上场队员不在 B 队名单内');
        if (lineA.some(openid => !courtPlayerOids.has(openid)) || lineB.some(openid => !courtPlayerOids.has(openid))) {
          throw new Error('上场队员不在当前场地');
        }

        const encounters = latestCourt.encounters;
        const existingIndex = encounters.findIndex(item => item.id === savedEncounterId);
        let savedEncounter;
        if (encounterId) {
          if (existingIndex < 0) throw new Error('该场次不存在');
          if (encounters[existingIndex].winner) throw new Error('已录入比分的场次请使用修改比分');
          savedEncounter = {
            ...encounters[existingIndex],
            lineup: { A: lineA, B: lineB },
            updatedAt: Date.now(),
            updatedBy: OPENID
          };
          encounters[existingIndex] = savedEncounter;
        } else if (existingIndex >= 0) {
          savedEncounter = encounters[existingIndex];
        } else {
          if (encounters.some(item => !item.winner)) throw new Error('当前场地已有待录比分场次');
          savedEncounter = {
            id: savedEncounterId,
            lineup: { A: lineA, B: lineB },
            setsA: null,
            setsB: null,
            score: '',
            winner: null,
            createdAt: Date.now(),
            createdBy: OPENID
          };
          encounters.push(savedEncounter);
        }

        const updatedMatch = { ...latestMatch, courts: latestCourts };
        latestGroups[0] = {
          ...latestGroup,
          matches: latestGroup.matches.map(item => item.id === matchId ? updatedMatch : item)
        };
        await transaction.collection(TOURNAMENTS).doc(event.id).update({
          data: { groups: latestGroups, updatedAt: Date.now() }
        });
        return { match: updatedMatch, encounter: savedEncounter };
      });
      return { code: 0, data: result };
    } catch (error) {
      console.error('[saveEncounterLineup] failed:', error && error.message, error && error.stack);
      return { code: 1, msg: (error && error.message) || '保存场次失败，请重试' };
    }
  }

  // 团队赛「记一场」：在指定场地内新增/修改一场 A vs B 对打（PRD §2.2 / §4.2）
  // - 自由轮换：不预设对阵，打完一场记一场；lineup 可选（A/B 同空 = 默认整队），1v1 或 2v2
  // - 传 encounterId 则修改已有对打，否则在 court 内追加
  if (action === 'enterEncounterScore') {
    const me = await getUser(OPENID);
    const { matchId, courtId, setsA, setsB, lineupA, lineupB, encounterId, isTiebreak } = event;
    if (!event.id || !matchId || (!courtId && !isTiebreak) || setsA === undefined || setsB === undefined) {
      return { code: 1, msg: '参数不完整' };
    }
    const sa = parseInt(setsA);
    const sb = parseInt(setsB);
    if (isNaN(sa) || isNaN(sb) || sa < 0 || sb < 0) return { code: 1, msg: '比分格式错误' };
    if (sa === sb) return { code: 1, msg: '必须决出胜负' };

    // 上场队员：每条 encounter 必须能回答「谁和谁打」，支持 1v1 / 2v2。
    const lineA = Array.isArray(lineupA) ? lineupA.filter(Boolean) : [];
    const lineB = Array.isArray(lineupB) ? lineupB.filter(Boolean) : [];
    if (lineA.length !== lineB.length) {
      return { code: 1, msg: '两队上场人数必须相同' };
    }
    if (lineA.length > 2 || lineB.length > 2) {
      return { code: 1, msg: '每队上场最多 2 人' };
    }

    const previewRes = await db.collection(TOURNAMENTS).doc(event.id).get().catch(() => null);
    if (!previewRes || !previewRes.data) return { code: 1, msg: '赛事不存在' };
    const tPreview = previewRes.data;
    if (tPreview.type !== 'team') return { code: 1, msg: '该赛事不是团队赛' };
    const groupPreview = tPreview.groups && tPreview.groups[0];
    if (!groupPreview) return { code: 1, msg: '团队赛分组尚未初始化' };
    const matchPreview = groupPreview.matches.find(m => m.id === matchId);
    if (!matchPreview) return { code: 1, msg: '比赛不存在' };
    const isSettledTiebreakRetry = !!(
      isTiebreak &&
      tPreview.status === 'finished' &&
      matchPreview.status === 'finished' &&
      matchPreview.teamSettlement
    );
    if (tPreview.status !== 'group' && !isSettledTiebreakRetry) return { code: 1, msg: '当前不是小组赛阶段' };
    if (matchPreview.status === 'finished' && !isSettledTiebreakRetry) return { code: 1, msg: '该场团队赛已结束，不可再改' };

    // 权限基线：创建者/系统管理员可管理全部场地；普通队员只能管理自己所在场地。
    const teams = tPreview.teams || [];
    const isCreator = tPreview.creator === OPENID;
    const isAdmin = me && me.role === 'admin';

    // 一球制胜是跨场地的全局队长对阵，不进入 courts[].encounters。
    if (isTiebreak) {
      const captainA = tPreview.captains && tPreview.captains.A;
      const captainB = tPreview.captains && tPreview.captains.B;
      const isCaptain = OPENID === captainA || OPENID === captainB;
      if (!isCreator && !isAdmin && !isCaptain) return { code: 1, msg: '仅队长或管理员可录入一球制胜' };
      if (tPreview.status === 'finished' && matchPreview.status === 'finished' && matchPreview.teamSettlement) {
        return {
          code: 0,
          data: {
            match: matchPreview,
            tiebreak: matchPreview.tiebreak,
            settlement: matchPreview.teamSettlement,
            alreadySettled: true
          }
        };
      }
      if (!matchPreview.tiebreak) return { code: 1, msg: '当前比分尚未进入一球制胜' };
      if (matchPreview.tiebreak.winner) return { code: 1, msg: '一球制胜已录入' };
      const validTiebreakScore = (sa === 1 && sb === 0) || (sa === 0 && sb === 1);
      if (!validTiebreakScore) return { code: 1, msg: '一球制胜只能录入 1:0 或 0:1' };
      const winner = sa > sb ? 'A' : 'B';
      let userIdMap;
      try {
        userIdMap = await loadTeamMemberIdMap(tPreview, { ...matchPreview, winner, status: 'finished' });
        const result = await db.runTransaction(async transaction => {
          const latestRes = await transaction.collection(TOURNAMENTS).doc(event.id).get();
          const latest = latestRes.data;
          if (!latest || latest.type !== 'team') throw new Error('赛事不存在');
          const latestGroups = (latest.groups || []).slice();
          const latestGroup = latestGroups[0];
          const latestMatch = latestGroup && (latestGroup.matches || []).find(item => item.id === matchId);
          if (!latestMatch) throw new Error('比赛不存在');
          if (latestMatch.status === 'finished' && latestMatch.teamSettlement) {
            return {
              match: latestMatch,
              tiebreak: latestMatch.tiebreak,
              settlement: latestMatch.teamSettlement,
              alreadySettled: true
            };
          }
          if (latest.status !== 'group') throw new Error('当前不是小组赛阶段');

          const latestCaptainA = latest.captains && latest.captains.A;
          const latestCaptainB = latest.captains && latest.captains.B;
          const latestIsCaptain = OPENID === latestCaptainA || OPENID === latestCaptainB;
          if (latest.creator !== OPENID && !isAdmin && !latestIsCaptain) {
            throw new Error('仅队长或管理员可录入一球制胜');
          }
          if (!latestMatch.tiebreak) throw new Error('当前比分尚未进入一球制胜');
          if (latestMatch.tiebreak.winner) throw new Error('一球制胜已录入');

          const savedTiebreak = {
            ...latestMatch.tiebreak,
            setsA: sa,
            setsB: sb,
            score: `${sa}-${sb}`,
            winner,
            lineup: {
              A: latestCaptainA ? [latestCaptainA] : [],
              B: latestCaptainB ? [latestCaptainB] : []
            },
            recordedAt: Date.now(),
            recordedBy: OPENID
          };
          const regularScore = latestMatch.teamScore || { A: 0, B: 0 };
          const finishedMatch = {
            ...latestMatch,
            tiebreak: savedTiebreak,
            winner,
            status: 'finished',
            scoreA: regularScore.A || 0,
            scoreB: regularScore.B || 0,
            scoreSummary: `${regularScore.A || 0}-${regularScore.B || 0}（一球制胜 ${sa}-${sb}）`
          };
          const settled = await applyTeamMatchSettlement(transaction, latest, finishedMatch, userIdMap);
          latestGroups[0] = {
            ...latestGroup,
            matches: latestGroup.matches.map(item => item.id === matchId ? settled.match : item)
          };
          await transaction.collection(TOURNAMENTS).doc(event.id).update({
            data: { groups: latestGroups, status: 'finished', updatedAt: Date.now() }
          });
          return {
            match: settled.match,
            tiebreak: savedTiebreak,
            settlement: settled.settlement,
            alreadySettled: false
          };
        });
        return { code: 0, data: result };
      } catch (error) {
        console.error('[enterEncounterScore:tiebreak] failed:', error && error.message, error && error.stack);
        return { code: 1, msg: (error && error.message) || '一球制胜结算失败，请重试' };
      }
    }

    if (matchPreview.tiebreak) {
      return { code: 1, msg: '已进入一球制胜，不可再改普通对局' };
    }
    if (lineA.length === 0) {
      return { code: 1, msg: '请选择上场队员' };
    }

    // 定位场地；对局人员必须属于这片场地。
    const courts = Array.isArray(matchPreview.courts) ? matchPreview.courts.slice() : [];
    const court = courts.find(c => c.id === courtId);
    if (!court) return { code: 1, msg: '场地不存在' };
    const courtPlayerOids = new Set(court.players || []);
    if (!isCreator && !isAdmin && !courtPlayerOids.has(OPENID)) {
      return { code: 1, msg: '你只能录入自己所在场地的比分' };
    }

    // lineup 必须是对应队 roster 里的成员（避免脏数据）
    if (lineA.length > 0 || lineB.length > 0) {
      const teamAUnit = teams.find(tu => tu.openid === matchPreview.teamA);
      const teamBUnit = teams.find(tu => tu.openid === matchPreview.teamB);
      const aOids = new Set((teamAUnit && teamAUnit.members || []).map(m => m.openid));
      const bOids = new Set((teamBUnit && teamBUnit.members || []).map(m => m.openid));
      if (lineA.some(oid => !aOids.has(oid))) return { code: 1, msg: 'A 队上场队员不在 A 队名单内' };
      if (lineB.some(oid => !bOids.has(oid))) return { code: 1, msg: 'B 队上场队员不在 B 队名单内' };
      if (new Set(lineA).size !== lineA.length) return { code: 1, msg: 'A 队上场队员重复' };
      if (new Set(lineB).size !== lineB.length) return { code: 1, msg: 'B 队上场队员重复' };
      if (lineA.some(oid => !courtPlayerOids.has(oid)) || lineB.some(oid => !courtPlayerOids.has(oid))) {
        return { code: 1, msg: '上场队员不在当前场地' };
      }
    }

    const { winner } = judgeMatch(sa, sb);
    if (!winner) return { code: 1, msg: '比分未能决出胜负' };
    if (!validateScore(sa, sb, tPreview.bestOf)) {
      return { code: 1, msg: isShortFormat(tPreview.bestOf) ? `比分不合法（单盘抢 ${tPreview.bestOf}，净胜 ≥ 2 分）` : `比分不合法（先赢 ${tPreview.bestOf} 局制，含抢七规则）` };
    }

    // 新增场次的 ID 在事务外生成：云数据库发生冲突重试时复用同一个 ID，避免一次请求追加两条。
    const newEncounterId = encounterId || `enc_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    try {
      const result = await db.runTransaction(async transaction => {
        // 必须在事务内重读最新赛事。多片场地可能同时录分，不能基于事务外快照覆盖整个 groups。
        const latestRes = await transaction.collection(TOURNAMENTS).doc(event.id).get();
        const latest = latestRes.data;
        if (!latest) throw new Error('赛事不存在');
        if (latest.type !== 'team') throw new Error('该赛事不是团队赛');
        if (latest.status !== 'group') throw new Error('当前不是小组赛阶段');

        const latestGroups = (latest.groups || []).slice();
        const latestGroup = latestGroups[0];
        const latestMatch = latestGroup && (latestGroup.matches || []).find(item => item.id === matchId);
        if (!latestMatch) throw new Error('比赛不存在');
        if (latestMatch.status === 'finished') throw new Error('该场团队赛已结束，不可再改');
        if (latestMatch.tiebreak) throw new Error('已进入一球制胜，不可再改普通对局');

        const latestCourts = Array.isArray(latestMatch.courts)
          ? latestMatch.courts.map(item => ({
              ...item,
              players: (item.players || []).slice(),
              encounters: (item.encounters || []).slice()
            }))
          : [];
        const latestCourt = latestCourts.find(item => item.id === courtId);
        if (!latestCourt) throw new Error('场地不存在');
        const latestCourtPlayerOids = new Set(latestCourt.players || []);
        const latestIsCreator = latest.creator === OPENID;
        if (!latestIsCreator && !isAdmin && !latestCourtPlayerOids.has(OPENID)) {
          throw new Error('你只能录入自己所在场地的比分');
        }

        const latestTeamA = (latest.teams || []).find(team => team.openid === latestMatch.teamA);
        const latestTeamB = (latest.teams || []).find(team => team.openid === latestMatch.teamB);
        const latestAOids = new Set((latestTeamA && latestTeamA.members || []).map(member => member.openid));
        const latestBOids = new Set((latestTeamB && latestTeamB.members || []).map(member => member.openid));
        if (lineA.some(oid => !latestAOids.has(oid))) throw new Error('A 队上场队员不在 A 队名单内');
        if (lineB.some(oid => !latestBOids.has(oid))) throw new Error('B 队上场队员不在 B 队名单内');
        if (lineA.some(oid => !latestCourtPlayerOids.has(oid)) || lineB.some(oid => !latestCourtPlayerOids.has(oid))) {
          throw new Error('上场队员不在当前场地');
        }
        if (!validateScore(sa, sb, latest.bestOf)) {
          throw new Error(isShortFormat(latest.bestOf)
            ? `比分不合法（单盘抢 ${latest.bestOf}，净胜 ≥ 2 分）`
            : `比分不合法（先赢 ${latest.bestOf} 局制，含抢七规则）`);
        }

        const latestEncounters = latestCourt.encounters;
        const existingIndex = latestEncounters.findIndex(item => item.id === newEncounterId);
        let savedEncounter;
        if (encounterId) {
          if (existingIndex < 0) throw new Error('该场对打不存在');
          savedEncounter = {
            ...latestEncounters[existingIndex],
            setsA: sa,
            setsB: sb,
            score: `${sa}-${sb}`,
            winner,
            lineup: { A: lineA, B: lineB },
            recordedAt: Date.now(),
            recordedBy: OPENID
          };
          latestEncounters[existingIndex] = savedEncounter;
        } else if (existingIndex >= 0) {
          // 仅用于事务自身冲突重试；同一请求不得重复追加。
          savedEncounter = latestEncounters[existingIndex];
        } else {
          savedEncounter = {
            id: newEncounterId,
            setsA: sa,
            setsB: sb,
            score: `${sa}-${sb}`,
            winner,
            lineup: { A: lineA, B: lineB },
            recordedAt: Date.now(),
            recordedBy: OPENID
          };
          latestEncounters.push(savedEncounter);
        }

        const updatedMatch = { ...latestMatch, courts: latestCourts };
        const summary = summarizeTeamMatch(updatedMatch);
        updatedMatch.teamScore = { A: summary.teamScoreA, B: summary.teamScoreB };
        updatedMatch.gamesA = summary.gamesA;
        updatedMatch.gamesB = summary.gamesB;
        updatedMatch.netGames = summary.netGames;
        updatedMatch.scoreSummary = `${summary.teamScoreA}-${summary.teamScoreB}`;
        updatedMatch.scoreA = summary.teamScoreA;
        updatedMatch.scoreB = summary.teamScoreB;
        updatedMatch.status = 'partial';

        latestGroups[0] = {
          ...latestGroup,
          matches: latestGroup.matches.map(item => item.id === matchId ? updatedMatch : item)
        };
        await transaction.collection(TOURNAMENTS).doc(event.id).update({
          data: { groups: latestGroups, updatedAt: Date.now() }
        });
        return { match: updatedMatch, encounter: savedEncounter };
      });
      return { code: 0, data: result };
    } catch (error) {
      console.error('[enterEncounterScore] failed:', error && error.message, error && error.stack);
      return { code: 1, msg: (error && error.message) || '录入失败，请重试' };
    }
  }

  // 团队赛：撤回一条场地对局比分，并重算跨场地汇总。
  // 只处理尚未结束的 group 阶段；已生成但未录入的一球制胜会随普通比分变化自动取消。
  if (action === 'revertEncounterScore') {
    const me = await getUser(OPENID);
    const { matchId, courtId, encounterId } = event;
    if (!event.id || !matchId || !courtId || !encounterId) {
      return { code: 1, msg: '参数不完整' };
    }

    const res = await db.collection(TOURNAMENTS).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '赛事不存在' };
    const t = res.data;
    if (t.type !== 'team') return { code: 1, msg: '该赛事不是团队赛' };
    if (t.status !== 'group') return { code: 1, msg: '比赛已结束，不能直接撤回场地比分' };

    const groups = (t.groups || []).slice();
    const group = groups[0];
    const match = group && (group.matches || []).find(item => item.id === matchId);
    if (!match) return { code: 1, msg: '比赛不存在' };
    if (match.status === 'finished' || (getTeamTiebreak(match) && getTeamTiebreak(match).winner)) {
      return { code: 1, msg: '比赛已结算，不能直接撤回场地比分' };
    }

    const isCreator = t.creator === OPENID;
    const isAdmin = me && me.role === 'admin';
    if (!isCreator && !isAdmin) return { code: 1, msg: '仅创建者或管理员可撤回比分' };

    try {
      const result = await db.runTransaction(async transaction => {
        const latestRes = await transaction.collection(TOURNAMENTS).doc(event.id).get();
        const latest = latestRes.data;
        if (!latest) throw new Error('赛事不存在');
        if (latest.type !== 'team') throw new Error('该赛事不是团队赛');
        if (latest.status !== 'group') throw new Error('比赛已结束，不能直接撤回场地比分');
        if (latest.creator !== OPENID && !isAdmin) throw new Error('仅创建者或管理员可撤回比分');

        const latestGroups = (latest.groups || []).slice();
        const latestGroup = latestGroups[0];
        const latestMatch = latestGroup && (latestGroup.matches || []).find(item => item.id === matchId);
        if (!latestMatch) throw new Error('比赛不存在');
        if (latestMatch.status === 'finished' || (getTeamTiebreak(latestMatch) && getTeamTiebreak(latestMatch).winner)) {
          throw new Error('比赛已结算，不能直接撤回场地比分');
        }

        let updatedMatch;
        if (Array.isArray(latestMatch.courts)) {
          const latestCourts = latestMatch.courts.map(item => ({
            ...item,
            players: (item.players || []).slice(),
            encounters: (item.encounters || []).slice()
          }));
          const latestCourt = latestCourts.find(item => item.id === courtId);
          if (!latestCourt) throw new Error('场地不存在');
          const encounterIndex = latestCourt.encounters.findIndex(item => item.id === encounterId && item.winner);
          if (encounterIndex < 0) throw new Error('该场对局不存在或已撤回');
          const scoredEncounter = latestCourt.encounters[encounterIndex];
          latestCourt.encounters[encounterIndex] = {
            ...scoredEncounter,
            setsA: null,
            setsB: null,
            score: '',
            winner: null,
            recordedAt: null,
            recordedBy: null,
            revertedAt: Date.now(),
            revertedBy: OPENID
          };
          updatedMatch = { ...latestMatch, courts: latestCourts, tiebreak: null };
        } else {
          // 旧版 slots 兼容：详情页会把它投影成 legacy_court。
          const latestSlots = (latestMatch.slots || []).slice();
          const encounterIndex = latestSlots.findIndex(item => !item.isTiebreak && item.id === encounterId && item.winner);
          if (encounterIndex < 0) throw new Error('该场对局不存在或已撤回');
          latestSlots.splice(encounterIndex, 1);
          updatedMatch = { ...latestMatch, slots: latestSlots.filter(item => !item.isTiebreak), tiebreak: null };
        }

        const summary = summarizeTeamMatch(updatedMatch);
        updatedMatch.teamScore = { A: summary.teamScoreA, B: summary.teamScoreB };
        updatedMatch.gamesA = summary.gamesA;
        updatedMatch.gamesB = summary.gamesB;
        updatedMatch.netGames = summary.netGames;
        updatedMatch.scoreA = summary.teamScoreA;
        updatedMatch.scoreB = summary.teamScoreB;
        updatedMatch.scoreSummary = summary.encounters.length > 0
          ? `${summary.teamScoreA}-${summary.teamScoreB}`
          : '';
        updatedMatch.winner = null;
        updatedMatch.status = summary.encounters.length > 0 ? 'partial' : 'pending';

        latestGroups[0] = {
          ...latestGroup,
          matches: latestGroup.matches.map(item => item.id === matchId ? updatedMatch : item)
        };
        await transaction.collection(TOURNAMENTS).doc(event.id).update({
          data: { groups: latestGroups, updatedAt: Date.now() }
        });
        return { match: updatedMatch, remainingCount: summary.encounters.length };
      });
      return { code: 0, data: result };
    } catch (error) {
      console.error('[revertEncounterScore] failed:', error && error.message, error && error.stack);
      return { code: 1, msg: (error && error.message) || '撤回失败，请重试' };
    }
  }

  // ====== 团队赛旧版随机排阵兼容 ======
  if (action === 'randomizeTeamLineups') {
    const me = await getUser(OPENID);
    const { matchId } = event;
    if (!event.id || !matchId) return { code: 1, msg: '参数不完整' };

    const res = await db.collection(TOURNAMENTS).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '赛事不存在' };
    const t = res.data;
    if (t.type !== 'team') return { code: 1, msg: '该赛事不是团队赛' };
    if (t.status !== 'group') return { code: 1, msg: '当前不是小组赛阶段' };

    const group = t.groups && t.groups[0];
    if (!group) return { code: 1, msg: '团队赛分组尚未初始化' };
    const match = group.matches.find(m => m.id === matchId);
    if (!match) return { code: 1, msg: '比赛不存在' };
    if (match.status === 'finished') return { code: 1, msg: '比赛已结束' };
    if (Array.isArray(match.courts)) {
      return { code: 1, msg: '新版场地模式为自由轮换，请在对应场地直接记一场' };
    }

    // 权限
    const teams = t.teams || [];
    const allMemberOids = new Set();
    teams.forEach(tu => (tu.members || []).forEach(m => m.openid && allMemberOids.add(m.openid)));
    if (!allMemberOids.has(OPENID) && t.creator !== OPENID && (!me || me.role !== 'admin')) {
      return { code: 1, msg: '无权限操作' };
    }

    const teamAUnit = teams.find(tu => tu.openid === match.teamA);
    const teamBUnit = teams.find(tu => tu.openid === match.teamB);
    if (!teamAUnit || !teamBUnit) return { code: 1, msg: '两队数据不完整' };
    const aMembers = (teamAUnit.members || []).map(m => m.openid);
    const bMembers = (teamBUnit.members || []).map(m => m.openid);
    if (aMembers.length === 0 || bMembers.length === 0) return { code: 1, msg: '两队成员为空' };

    // 随机打乱两队成员
    const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const shuffledA = shuffle(aMembers);
    const shuffledB = shuffle(bMembers);

    // 遍历 slot，给空的填上随机 1v1 lineup
    const newSlots = (match.slots || []).map(slot => {
      if (slot.isTiebreak || slot.winner) return slot;
      if (slot.lineup && Array.isArray(slot.lineup.A) && slot.lineup.A.length > 0) return slot;
      const ai = (slot.index - 1) % shuffledA.length;
      const bi = (slot.index - 1) % shuffledB.length;
      return { ...slot, lineup: { A: [shuffledA[ai]], B: [shuffledB[bi]] } };
    });

    const newGroups = t.groups.slice();
    const updatedMatch = { ...match, slots: newSlots };
    newGroups[0] = { ...group, matches: group.matches.map(m => m.id === matchId ? updatedMatch : m) };

    await db.collection(TOURNAMENTS).doc(event.id).update({
      data: { groups: newGroups, updatedAt: Date.now() }
    });
    return { code: 0, data: { slots: newSlots } };
  }

  // ====== 团队赛动态增加场地 ======
  if (action === 'addCourt' || action === 'addTeamSlot') {
    const me = await getUser(OPENID);
    const { matchId } = event;
    if (!event.id || !matchId) return { code: 1, msg: '参数不完整' };

    const res = await db.collection(TOURNAMENTS).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '赛事不存在' };
    const t = res.data;
    if (t.type !== 'team') return { code: 1, msg: '该赛事不是团队赛' };
    if (t.status !== 'group') return { code: 1, msg: '当前不是小组赛阶段' };

    const group = t.groups && t.groups[0];
    if (!group) return { code: 1, msg: '团队赛分组尚未初始化' };
    const match = group.matches.find(m => m.id === matchId);
    if (!match) return { code: 1, msg: '比赛不存在' };
    if (match.status === 'finished') return { code: 1, msg: '比赛已结束，不可调整场地' };
    if (!Array.isArray(match.courts)) return { code: 1, msg: '旧版团队赛不支持动态增加场地' };

    // 场地结构只允许创建者/系统管理员调整。
    const teams = t.teams || [];
    if (t.creator !== OPENID && (!me || me.role !== 'admin')) {
      return { code: 1, msg: '无权限操作' };
    }

    if (match.tiebreak) return { code: 1, msg: '请先解决平分状态再调整场地' };
    if (getTeamRegularEncounters(match).some(encounter => encounter.winner)) {
      return { code: 1, msg: '已开始录分，请先撤回比分再调整场地' };
    }

    const redistributed = redistributeTeamCourts(match, teams, match.courts.length + 1);
    if (redistributed.error) return { code: 1, msg: redistributed.error };
    const courts = redistributed.courts;

    const newGroups = t.groups.slice();
    const updatedMatch = { ...match, courts };
    newGroups[0] = { ...group, matches: group.matches.map(m => m.id === matchId ? updatedMatch : m) };

    await db.collection(TOURNAMENTS).doc(event.id).update({
      data: {
        groups: newGroups,
        teamMatchCourts: courts.length,
        updatedAt: Date.now()
      }
    });
    return { code: 0, data: { courts } };
  }

  // ====== 团队赛动态删除场地 ======
  if (action === 'removeCourt' || action === 'removeTeamSlot') {
    const me = await getUser(OPENID);
    const { matchId, courtId, slotIndex } = event;
    if (!event.id || !matchId || (!courtId && slotIndex === undefined)) return { code: 1, msg: '参数不完整' };

    const res = await db.collection(TOURNAMENTS).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '赛事不存在' };
    const t = res.data;
    if (t.type !== 'team') return { code: 1, msg: '该赛事不是团队赛' };
    if (t.status !== 'group') return { code: 1, msg: '当前不是小组赛阶段' };

    const group = t.groups && t.groups[0];
    if (!group) return { code: 1, msg: '团队赛分组尚未初始化' };
    const match = group.matches.find(m => m.id === matchId);
    if (!match) return { code: 1, msg: '比赛不存在' };
    if (match.status === 'finished') return { code: 1, msg: '比赛已结束，不可调整场地' };
    if (!Array.isArray(match.courts)) return { code: 1, msg: '旧版团队赛不支持动态删除场地' };

    // 场地结构只允许创建者/系统管理员调整。
    const teams = t.teams || [];
    if (t.creator !== OPENID && (!me || me.role !== 'admin')) {
      return { code: 1, msg: '无权限操作' };
    }

    if (match.tiebreak) return { code: 1, msg: '请先解决平分状态再调整场地' };
    if (match.courts.length <= 1) return { code: 1, msg: '至少保留 1 片场地' };
    if (getTeamRegularEncounters(match).some(encounter => encounter.winner)) {
      return { code: 1, msg: '已开始录分，请先撤回比分再调整场地' };
    }

    const resolvedCourtId = courtId || (match.courts[parseInt(slotIndex) - 1] && match.courts[parseInt(slotIndex) - 1].id);
    const targetCourt = match.courts.find(court => court.id === resolvedCourtId);
    if (!targetCourt) return { code: 1, msg: '场地不存在' };
    const redistributed = redistributeTeamCourts(match, teams, match.courts.length - 1);
    if (redistributed.error) return { code: 1, msg: redistributed.error };
    const courts = redistributed.courts;

    const newGroups = t.groups.slice();
    const updatedMatch = { ...match, courts };
    newGroups[0] = { ...group, matches: group.matches.map(m => m.id === matchId ? updatedMatch : m) };

    await db.collection(TOURNAMENTS).doc(event.id).update({
      data: {
        groups: newGroups,
        teamMatchCourts: courts.length,
        updatedAt: Date.now()
      }
    });
    return { code: 0, data: { courts } };
  }

  // ====== 团队赛手动结束 ======
  if (action === 'finishTeamMatch') {
    const me = await getUser(OPENID);
    const { matchId } = event;
    if (!event.id || !matchId) return { code: 1, msg: '参数不完整' };

    const res = await db.collection(TOURNAMENTS).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '赛事不存在' };
    const t = res.data;
    if (t.type !== 'team') return { code: 1, msg: '该赛事不是团队赛' };

    const group = t.groups && t.groups[0];
    if (!group) return { code: 1, msg: '团队赛分组尚未初始化' };
    const match = group.matches.find(m => m.id === matchId);
    if (!match) return { code: 1, msg: '比赛不存在' };

    // 权限：creator / admin
    const isAdmin = me && me.role === 'admin';
    if (t.creator !== OPENID && !isAdmin) {
      return { code: 1, msg: '仅创建者或管理员可结束比赛' };
    }
    if (match.status === 'finished' && match.teamSettlement) {
      return {
        code: 0,
        data: { match, settlement: match.teamSettlement, alreadySettled: true }
      };
    }
    if (t.status !== 'group') return { code: 1, msg: '当前阶段不可结束' };
    if (match.status === 'finished') return { code: 1, msg: '比赛已结束但缺少结算凭证，请联系管理员' };

    // 新版是「打完一场记一场」，没有预设必须打满的 slot 数；但至少要有一场有效对局。
    const summary = summarizeTeamMatch(match);
    if (summary.encounters.length === 0) return { code: 1, msg: '还没有录入任何对局，无法结束' };
    const tiebreakId = `tiebreak_${Date.now()}`;
    try {
      const userIdMap = await loadTeamMemberIdMap(t, match);
      const result = await db.runTransaction(async transaction => {
        const latestRes = await transaction.collection(TOURNAMENTS).doc(event.id).get();
        const latest = latestRes.data;
        if (!latest || latest.type !== 'team') throw new Error('赛事不存在');
        const latestGroups = (latest.groups || []).slice();
        const latestGroup = latestGroups[0];
        const latestMatch = latestGroup && (latestGroup.matches || []).find(item => item.id === matchId);
        if (!latestMatch) throw new Error('比赛不存在');
        if (latest.creator !== OPENID && !isAdmin) throw new Error('仅创建者或管理员可结束比赛');
        if (latestMatch.status === 'finished' && latestMatch.teamSettlement) {
          return { match: latestMatch, settlement: latestMatch.teamSettlement, alreadySettled: true };
        }
        if (latest.status !== 'group') throw new Error('当前阶段不可结束');
        if (latestMatch.status === 'finished') throw new Error('比赛已结束但缺少结算凭证，请联系管理员');

        const latestSummary = summarizeTeamMatch(latestMatch);
        if (latestSummary.encounters.length === 0) throw new Error('还没有录入任何对局，无法结束');
        const { teamScoreA, teamScoreB, gamesA, gamesB, netGames } = latestSummary;
        const teamWinner = teamScoreA > teamScoreB ? 'A' : teamScoreB > teamScoreA ? 'B' : null;
        const existingTiebreak = getTeamTiebreak(latestMatch);

        let updatedMatch;
        let settlement = null;
        let alreadyPendingTiebreak = false;
        if (!teamWinner) {
          if (existingTiebreak && existingTiebreak.winner) {
            throw new Error('一球制胜已完成但缺少结算凭证，请联系管理员');
          }
          if (existingTiebreak) {
            updatedMatch = latestMatch;
            alreadyPendingTiebreak = true;
          } else {
            // 平分 → 创建跨场地的全局一球制胜，固定两位队长上场。
            const tiebreak = {
              id: tiebreakId,
              setsA: 0,
              setsB: 0,
              score: '',
              winner: null,
              lineup: { A: [latest.captains.A], B: [latest.captains.B] }
            };
            updatedMatch = {
              ...latestMatch,
              tiebreak,
              teamScore: { A: teamScoreA, B: teamScoreB },
              gamesA,
              gamesB,
              netGames,
              scoreA: teamScoreA,
              scoreB: teamScoreB,
              scoreSummary: `${teamScoreA}-${teamScoreB}（待一球制胜）`,
              status: 'partial'
            };
          }
        } else {
          const finishedMatch = {
            ...latestMatch,
            winner: teamWinner,
            teamScore: { A: teamScoreA, B: teamScoreB },
            gamesA,
            gamesB,
            netGames,
            scoreA: teamScoreA,
            scoreB: teamScoreB,
            scoreSummary: `${teamScoreA}-${teamScoreB}`,
            status: 'finished'
          };
          const settled = await applyTeamMatchSettlement(transaction, latest, finishedMatch, userIdMap);
          updatedMatch = settled.match;
          settlement = settled.settlement;
        }

        latestGroups[0] = {
          ...latestGroup,
          matches: latestGroup.matches.map(item => item.id === matchId ? updatedMatch : item)
        };
        await transaction.collection(TOURNAMENTS).doc(event.id).update({
          data: {
            groups: latestGroups,
            status: updatedMatch.status === 'finished' ? 'finished' : latest.status,
            updatedAt: Date.now()
          }
        });
        return { match: updatedMatch, settlement, alreadySettled: false, alreadyPendingTiebreak };
      });
      return { code: 0, data: result };
    } catch (error) {
      console.error('[finishTeamMatch] failed:', error && error.message, error && error.stack);
      return { code: 1, msg: (error && error.message) || '结束比赛失败，请重试' };
    }
  }

  // ====== 团队赛手动调队（Plan-4 R4-B） ======
  if (action === 'swapTeamMember') {
    const me = await getUser(OPENID);
    const { id, openid: targetOid } = event;
    if (!id || !targetOid) return { code: 1, msg: '参数不完整' };

    const res = await db.collection(TOURNAMENTS).doc(id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '赛事不存在' };
    const t = res.data;

    // 权限：creator / admin
    if (t.creator !== OPENID && (!me || me.role !== 'admin')) {
      return { code: 1, msg: '无权限调整队员' };
    }
    if (t.type !== 'team') return { code: 1, msg: '该赛事不是团队赛' };
    if (t.status !== 'group') return { code: 1, msg: '当前阶段不可调队' };

    // 找到唯一的 match（团队赛只有一场）
    const group = t.groups && t.groups[0];
    const match = group && group.matches && group.matches[0];
    if (!match) return { code: 1, msg: '比赛尚未生成' };

    // 锁条件：任何场地对局已有 winner 就禁止调队（旧 slots 也兼容）。
    const hasAnyScore = getTeamRegularEncounters(match).some(encounter => encounter.winner) || !!(getTeamTiebreak(match) && getTeamTiebreak(match).winner);
    if (hasAnyScore) return { code: 1, msg: '已开始录比分，不可再调队' };

    // 找当前所属队
    const teams = t.teams || [];
    if (teams.length < 2) return { code: 1, msg: 'teams 数据异常' };
    let fromIdx = -1;
    let memberObj = null;
    for (let i = 0; i < teams.length; i++) {
      const mem = (teams[i].members || []).find(m => m.openid === targetOid);
      if (mem) { fromIdx = i; memberObj = mem; break; }
    }
    if (fromIdx < 0 || !memberObj) return { code: 1, msg: '该队员不在任何队里' };
    if (memberObj.isCaptain) return { code: 1, msg: '队长不能调动，请重新抽签' };

    // 移动：从 fromIdx 删除，加到对面队（toIdx = 1 - fromIdx）
    const toIdx = 1 - fromIdx;
    const newTeams = teams.map(tm => ({ ...tm, members: (tm.members || []).slice() }));
    newTeams[fromIdx].members = newTeams[fromIdx].members.filter(m => m.openid !== targetOid);
    newTeams[toIdx].members.push({ ...memberObj });

    if (Array.isArray(match.courts)) {
      const nextA = new Set((newTeams[0].members || []).map(member => member.openid));
      const nextB = new Set((newTeams[1].members || []).map(member => member.openid));
      const invalidCourt = match.courts.find(court => {
        const players = court.players || [];
        return !players.some(openid => nextA.has(openid)) || !players.some(openid => nextB.has(openid));
      });
      if (invalidCourt) return { code: 1, msg: `调整后${invalidCourt.name || '有场地'}会缺少一方队员，请先调整场地` };
    }

    await db.collection(TOURNAMENTS).doc(id).update({
      data: { teams: newTeams, updatedAt: Date.now() }
    });
    return { code: 0, data: { teams: newTeams } };
  }

  // ====== 团队赛场地间调人 ======
  if (action === 'moveCourtMember') {
    const me = await getUser(OPENID);
    const { id, openid: targetOid, targetCourtId } = event;
    if (!id || !targetOid || !targetCourtId) return { code: 1, msg: '参数不完整' };

    const res = await db.collection(TOURNAMENTS).doc(id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '赛事不存在' };
    const t = res.data;
    if (t.creator !== OPENID && (!me || me.role !== 'admin')) return { code: 1, msg: '无权限调整场地' };
    if (t.type !== 'team') return { code: 1, msg: '该赛事不是团队赛' };
    if (t.status !== 'group') return { code: 1, msg: '当前阶段不可调整场地' };

    const groups = (t.groups || []).slice();
    const group = groups[0];
    const match = group && group.matches && group.matches[0];
    if (!match || !Array.isArray(match.courts)) return { code: 1, msg: '场地数据尚未初始化' };
    if (getTeamRegularEncounters(match).some(encounter => encounter.winner) || getTeamTiebreak(match)) {
      return { code: 1, msg: '已开始录分，不可再调整场地人员' };
    }

    const courts = match.courts.map(court => ({ ...court, players: (court.players || []).slice(), encounters: (court.encounters || []).slice() }));
    const sourceCourt = courts.find(court => court.players.includes(targetOid));
    const targetCourt = courts.find(court => court.id === targetCourtId);
    if (!sourceCourt) return { code: 1, msg: '该队员尚未分配场地' };
    if (!targetCourt) return { code: 1, msg: '目标场地不存在' };
    if (sourceCourt.id === targetCourt.id) return { code: 1, msg: '该队员已在目标场地' };

    const teamA = (t.teams || [])[0];
    const teamB = (t.teams || [])[1];
    const aOids = new Set((teamA && teamA.members || []).map(member => member.openid));
    const bOids = new Set((teamB && teamB.members || []).map(member => member.openid));
    const sameSideSet = aOids.has(targetOid) ? aOids : bOids.has(targetOid) ? bOids : null;
    if (!sameSideSet) return { code: 1, msg: '无法识别该队员的队伍' };
    const sourceSameSideCount = sourceCourt.players.filter(openid => sameSideSet.has(openid)).length;
    if (sourceSameSideCount <= 1) {
      return { code: 1, msg: `${sourceCourt.name || '原场地'}至少要保留 1 名该队队员` };
    }

    sourceCourt.players = sourceCourt.players.filter(openid => openid !== targetOid);
    targetCourt.players.push(targetOid);
    const updatedMatch = { ...match, courts };
    groups[0] = { ...group, matches: group.matches.map(item => item.id === match.id ? updatedMatch : item) };
    await db.collection(TOURNAMENTS).doc(id).update({ data: { groups, updatedAt: Date.now() } });
    return { code: 0, data: { courts } };
  }

  // 测试夹具：创建指定 scenario 的团队赛 tournament（含 pre-recorded encounter）
  // 仅 admin 可调用；测试用户 openid 以 test_u_ 开头，标识 _isTest=true
  if (action === 'seedTeamMatchTest') {
    const me = await getUser(OPENID);
    if (!me || me.role !== 'admin') return { code: 1, msg: '仅管理员可调用' };
    const cfg = SCENARIO_CONFIG[event.scenario];
    if (!cfg) return { code: 1, msg: '未知 scenario: ' + event.scenario };

    // 1. 确保测试用户存在 + 构造 players
    const players = await ensureTestUsers(cfg.userCount);

    // 1.5. stopAtSignup 场景：创建 tournament 但停在 signup 状态（无 captains / groups / teams / bestOf）
    if (cfg.stopAtSignup) {
      const now = Date.now();
      const courtCount = Math.max(1, Math.ceil(cfg.userCount / 6));
      const addRes = await db.collection(TOURNAMENTS).add({
        data: {
          title: `${TEST_TITLE_PREFIX} 场景·${cfg.label}`,
          type: 'team',
          handicapRule: '',
          matchDate: now,
          status: 'signup',
          players,
          groups: [],
          teams: [],
          knockout: null,
          teamMatchCourts: courtCount,
          config: { groupCount: 1, advanceCount: 0, seedCount: 0, courtCount },
          creator: OPENID,
          creatorName: me.wecomName,
          _isTest: true,
          createdAt: now,
          updatedAt: now
        }
      });
      return {
        code: 0,
        data: {
          _id: addRes._id,
          scenario: event.scenario,
          label: cfg.label,
          userCount: cfg.userCount,
          slotCount: cfg.slotCount,
          courtCount
        }
      };
    }

    // 2. 生成 bracket（默认每 6 人一片场地）
    //    测试夹具：固定指定 test_u_001 为 A 队长、test_u_002 为 B 队长，与 R2-B.1c 队长优先模型一致
    const courtCount = Math.max(1, Math.ceil(cfg.userCount / 6));
    const built = generateTeamMatchBrackets(players, courtCount, { A: 'test_u_001', B: 'test_u_002' });
    const match = built.groups[0].matches[0];
    const scenarioBestOf = [4, 6, 7, 11].includes(cfg.bestOf) ? cfg.bestOf : 6;
    const teamAMembersForLineup = (built.teams[0] && built.teams[0].members) || [];
    const teamBMembersForLineup = (built.teams[1] && built.teams[1].members) || [];

    // 3. 预录入 encounter（测试场景放入 1 号场）
    //    lineupAIdx / lineupBIdx 是 0-based 队员索引，会被 resolve 成 openid
    //    比分如非法直接抛错（确保 SCENARIO_CONFIG 数据是配着 bestOf 写的）
    for (const rec of cfg.preRecorded) {
      if (!validateScore(rec.setsA, rec.setsB, scenarioBestOf)) {
        return { code: 1, msg: `SCENARIO_CONFIG 错误：scenario=${event.scenario} slot ${rec.slotIndex} 比分 ${rec.setsA}:${rec.setsB} 不符合 bestOf=${scenarioBestOf}` };
      }
      const lineupA = Array.isArray(rec.lineupAIdx)
        ? rec.lineupAIdx.map(i => teamAMembersForLineup[i] && teamAMembersForLineup[i].openid).filter(Boolean)
        : [teamAMembersForLineup[(rec.slotIndex - 1) % teamAMembersForLineup.length].openid];
      const lineupB = Array.isArray(rec.lineupBIdx)
        ? rec.lineupBIdx.map(i => teamBMembersForLineup[i] && teamBMembersForLineup[i].openid).filter(Boolean)
        : [teamBMembersForLineup[(rec.slotIndex - 1) % teamBMembersForLineup.length].openid];
      if (lineupA.length !== lineupB.length) {
        return { code: 1, msg: `SCENARIO_CONFIG 错误：scenario=${event.scenario} slot ${rec.slotIndex} lineup 两队人数不齐` };
      }
      const targetCourt = match.courts.find(court => [...lineupA, ...lineupB].every(openid => (court.players || []).includes(openid))) || match.courts[0];
      targetCourt.encounters.push({
        id: `fixture_enc_${rec.slotIndex}`,
        setsA: rec.setsA,
        setsB: rec.setsB,
        score: `${rec.setsA}-${rec.setsB}`,
        winner: judgeMatch(rec.setsA, rec.setsB).winner,
        lineup: { A: lineupA, B: lineupB }
      });
    }

    // 4. 算 teamScore + gamesA/gamesB/netGames（净胜局） + 决定 match.status
    const { teamScoreA, teamScoreB, gamesA, gamesB, netGames } = summarizeTeamMatch(match);
    match.teamScore = { A: teamScoreA, B: teamScoreB };
    match.gamesA = gamesA;
    match.gamesB = gamesB;
    match.netGames = netGames;
    match.scoreA = teamScoreA;
    match.scoreB = teamScoreB;
    match.scoreSummary = `${teamScoreA}-${teamScoreB}`;
    if (cfg.finish) {
      // 与 enterEncounterScore 对齐：Team Score 定胜负，平分则走一球制胜
      let teamWinner;
      if (teamScoreA > teamScoreB) teamWinner = 'A';
      else if (teamScoreB > teamScoreA) teamWinner = 'B';
      else teamWinner = null;
      if (!teamWinner) {
        return { code: 1, msg: 'finish 场景必须能决出团队胜方（Team Score 平分，检查 SCENARIO_CONFIG）' };
      }
      match.winner = teamWinner;
      match.status = 'finished';
    } else if (cfg.preRecorded.length > 0) {
      match.status = 'partial';
    } else {
      match.status = 'pending';
    }

    // 5. 一次性写入 tournament 文档（含 groups + teams + status + bestOf + captains）
    const now = Date.now();
    const addRes = await db.collection(TOURNAMENTS).add({
      data: {
        title: `${TEST_TITLE_PREFIX} 场景·${cfg.label}`,
        type: 'team',
        bestOf: scenarioBestOf,
        handicapRule: '',
        matchDate: now,
        status: cfg.finish ? 'finished' : 'group',
        players,
        groups: built.groups,
        teams: built.teams,
        captains: { A: 'test_u_001', B: 'test_u_002' },
        knockout: null,
        teamMatchCourts: courtCount,
        config: { groupCount: 1, advanceCount: 0, seedCount: 0, courtCount },
        creator: OPENID,
        creatorName: me.wecomName,
        _isTest: true,
        createdAt: now,
        updatedAt: now
      }
    });
    const tournamentId = addRes._id;

    // 6. finish 场景：用与真实结束流程相同的事务结算固定积分（团队赛不修改 ELO）
    if (cfg.finish) {
      const reloadRes = await db.collection(TOURNAMENTS).doc(tournamentId).get();
      const storedGroup = reloadRes.data.groups && reloadRes.data.groups[0];
      const storedMatch = storedGroup && storedGroup.matches && storedGroup.matches.find(item => item.id === match.id);
      const userIdMap = await loadTeamMemberIdMap(reloadRes.data, storedMatch);
      await db.runTransaction(async transaction => {
        const latestRes = await transaction.collection(TOURNAMENTS).doc(tournamentId).get();
        const latest = latestRes.data;
        const latestGroups = (latest.groups || []).slice();
        const latestGroup = latestGroups[0];
        const latestMatch = latestGroup.matches.find(item => item.id === match.id);
        const settled = await applyTeamMatchSettlement(transaction, latest, latestMatch, userIdMap);
        latestGroups[0] = {
          ...latestGroup,
          matches: latestGroup.matches.map(item => item.id === match.id ? settled.match : item)
        };
        await transaction.collection(TOURNAMENTS).doc(tournamentId).update({
          data: { groups: latestGroups, updatedAt: Date.now() }
        });
      });
    }

    return {
      code: 0,
      data: {
        _id: tournamentId,
        scenario: event.scenario,
        label: cfg.label,
        userCount: cfg.userCount,
        slotCount: cfg.slotCount,
        courtCount
      }
    };
  }

  // 测试夹具：创建单打/双打赛事（group 阶段，用于中途加人测试）
  if (action === 'seedTournamentTest') {
    const me = await getUser(OPENID);
    if (!me || me.role !== 'admin') return { code: 1, msg: '仅管理员可调用' };
    const cfg = TOURNAMENT_TEST_SCENARIOS[event.scenario];
    if (!cfg) return { code: 1, msg: '未知 scenario: ' + event.scenario };

    const now = Date.now();
    const testUsers = await ensureTestUsers(cfg.userCount);
    const players = testUsers.map(u => ({
      openid: u.openid, wecomName: u.wecomName,
      gender: u.gender || '', rating: u.rating || '',
      totalPoints: u.totalPoints || 0, signupAt: now
    }));

    let groups, config, teams, pairs, bestOf;
    bestOf = cfg.bestOf || 6;
    config = { ...cfg.config, seedCount: cfg.config.seedCount || 0 };

    if (cfg.type === 'doubles') {
      // 双打：自动配对（按列表顺序两两配对）
      if (players.length % 2 !== 0) {
        return { code: 1, msg: `双打测试需偶数人，当前 ${players.length} 人` };
      }
      const drawUnits = [];
      for (let i = 0; i < players.length; i += 2) {
        drawUnits.push(makeDoubleTeam(players[i], players[i + 1]));
      }
      groups = seedDraw(drawUnits, config.groupCount, config.seedCount);
      pairs = [];
      for (let i = 0; i < players.length; i += 2) {
        pairs.push([players[i].openid, players[i + 1].openid]);
      }
    } else {
      // 单打
      const drawUnits = players.map(p => ({
        openid: p.openid, wecomName: p.wecomName, totalPoints: p.totalPoints || 0
      }));
      groups = seedDraw(drawUnits, config.groupCount, config.seedCount);
    }

    const addRes = await db.collection(TOURNAMENTS).add({
      data: {
        title: `${TEST_TITLE_PREFIX} 场景·${cfg.label}`,
        type: cfg.type,
        bestOf,
        level: cfg.level || 'friendly',
        handicapRule: '',
        matchDate: now,
        status: 'group',
        players,
        groups,
        teams: teams || [],
        knockout: null,
        config,
        creator: OPENID,
        creatorName: me.wecomName,
        _isTest: true,
        createdAt: now,
        updatedAt: now
      }
    });
    return {
      code: 0,
      data: {
        _id: addRes._id,
        scenario: event.scenario,
        label: cfg.label,
        type: cfg.type,
        userCount: cfg.userCount
      }
    };
  }

  // 测试夹具：创建已进入淘汰赛的赛事（半决赛已完成，决赛待定，用于测试三四名决赛）
  if (action === 'seedKnockoutTest') {
    const me = await getUser(OPENID);
    if (!me || me.role !== 'admin') return { code: 1, msg: '仅管理员可调用' };

    const now = Date.now();
    const testUsers = await ensureTestUsers(4);
    const players = testUsers.map(u => ({
      openid: u.openid, wecomName: u.wecomName,
      gender: u.gender || '', rating: u.rating || '',
      totalPoints: u.totalPoints || 0, signupAt: now
    }));

    // 1 组 4 人 → 取前 2 晋级
    const drawUnits = players.map(p => ({
      openid: p.openid, wecomName: p.wecomName, totalPoints: p.totalPoints || 0
    }));
    const groups = seedDraw(drawUnits, 1, 0);
    const bestOf = 6;

    // 预录小组赛比分：让前两人全胜晋级
    // standings 排序逻辑：胜场 → 胜负关系(H2H) → 净胜盘
    // 让 test_u_001 3-0, test_u_002 2-1, test_u_003 1-2, test_u_004 0-3
    const preScores = [
      // { playerA openid suffix, playerB openid suffix, scoreA, scoreB }
      ['001', '002', 6, 4],  // 001 胜 002
      ['001', '003', 6, 2],  // 001 胜 003
      ['001', '004', 6, 1],  // 001 胜 004
      ['002', '003', 6, 3],  // 002 胜 003
      ['002', '004', 6, 2],  // 002 胜 004
      ['003', '004', 6, 4],  // 003 胜 004
    ];

    for (const g of groups) {
      for (const ps of preScores) {
        const match = g.matches.find(m => {
          if (!m.playerA || !m.playerB) return false;
          const aEnd = m.playerA.openid.slice(-3);
          const bEnd = m.playerB.openid.slice(-3);
          return (aEnd === ps[0] && bEnd === ps[1]) || (aEnd === ps[1] && bEnd === ps[0]);
        });
        if (!match) continue;
        const aIsFirst = match.playerA.openid.slice(-3) === ps[0];
        const sa = aIsFirst ? ps[2] : ps[3];
        const sb = aIsFirst ? ps[3] : ps[2];
        match.scoreA = sa;
        match.scoreB = sb;
        match.winner = sa > sb ? 'A' : 'B';
        match.scoreSummary = `${sa}:${sb}`;
        // 注意：测试夹具不写 pointsAwarded（跳过 ELO 结算），
        // 因为测试用户没有真实 ELO 历史，直接写入会因事务逻辑失败。
        // 这些比赛仅用于 UI 测试（三四名流程），不影响积分正确性。
      }
      g.standings = calcStandings(g);
    }

    // 取前 2 名生成淘汰赛
    const advanced = [];
    const standings = groups[0].standings;
    const top2 = standings.slice(0, 2);
    top2.forEach((p, rank) => {
      advanced.push({ ...p, groupName: groups[0].name, groupRank: rank + 1 });
    });
    const knockout = generateKnockout(advanced);

    // 预录半决赛比分（让 standings[0] 和 standings[1] 分别胜出）
    const sfRound = knockout.rounds[0];
    if (sfRound && sfRound.matches.length >= 2) {
      const sf1 = sfRound.matches[0];
      if (sf1.playerA && sf1.playerB) {
        sf1.scoreA = 6; sf1.scoreB = 3;
        sf1.winner = 'A'; sf1.scoreSummary = '6:3';
      }
      const sf2 = sfRound.matches[1];
      if (sf2.playerA && sf2.playerB) {
        sf2.scoreA = 4; sf2.scoreB = 6;
        sf2.winner = 'B'; sf2.scoreSummary = '4:6';
      }
      // 手动把胜者填入决赛
      if (knockout.rounds.length >= 2) {
        const finalRound = knockout.rounds[1];
        const finalMatch = finalRound.matches[0];
        if (sf1.winner === 'A') finalMatch.playerA = { ...sf1.playerA };
        else finalMatch.playerA = { ...sf1.playerB };
        if (sf2.winner === 'B') finalMatch.playerB = { ...sf2.playerB };
        else finalMatch.playerB = { ...sf2.playerA };
      }
    }

    const addRes = await db.collection(TOURNAMENTS).add({
      data: {
        title: `${TEST_TITLE_PREFIX} 场景·三四名决赛测试`,
        type: 'singles', bestOf, level: 'friendly',
        handicapRule: '', matchDate: now,
        status: 'knockout',
        players, groups,
        knockout: _.set(knockout),
        teams: [],
        config: { groupCount: 1, advanceCount: 2, seedCount: 0 },
        creator: OPENID, creatorName: me.wecomName,
        _isTest: true, createdAt: now, updatedAt: now
      }
    });
    return {
      code: 0,
      data: { _id: addRes._id, label: '三四名决赛测试', type: 'singles', userCount: 4 }
    };
  }

  // 测试夹具：删除所有 _isTest:true 的 tournament + user，并防御性清掉真实用户身上残留的测试 earnings
  if (action === 'cleanupTestData') {
    const me = await getUser(OPENID);
    if (!me || me.role !== 'admin') return { code: 1, msg: '仅管理员可调用' };

    const tRes = await db.collection(TOURNAMENTS).where({ _isTest: true }).get();
    const testTournamentIds = tRes.data.map(t => t._id);
    for (const id of testTournamentIds) {
      await db.collection(TOURNAMENTS).doc(id).remove();
    }

    const uRes = await db.collection(USERS).where({ _isTest: true }).get();
    for (const u of uRes.data) {
      await db.collection(USERS).doc(u._id).remove();
    }

    // 防御性清理：真实用户身上残留的"测试赛事 earnings"（正常应为 0 条）
    const realUsersRes = await db.collection(USERS).limit(1000).get();
    let defensiveCleaned = 0;
    for (const u of realUsersRes.data) {
      if (u._isTest) continue;
      const earnings = u.tournamentEarnings || [];
      const filtered = earnings.filter(e => !testTournamentIds.includes(e.tournamentId));
      if (filtered.length !== earnings.length) {
        const sorted = filtered.slice().sort((a, b) => b.earned - a.earned);
        const best10 = sorted.slice(0, 10);
        const totalPoints = best10.reduce((sum, e) => sum + e.earned, 0);
        await db.collection(USERS).doc(u._id).update({
          data: { tournamentEarnings: filtered, totalPoints, updatedAt: Date.now() }
        });
        defensiveCleaned += earnings.length - filtered.length;
      }
    }

    return {
      code: 0,
      data: {
        tournamentsDeleted: testTournamentIds.length,
        usersDeleted: uRes.data.length,
        defensiveCleaned
      }
    };
  }

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
      return { code: 1, msg: isShortFormat(tPreview.bestOf) ? `比分不合法（单盘抢 ${tPreview.bestOf}，净胜 ≥ 2 分）` : `比分不合法（先赢 ${tPreview.bestOf} 局制，含抢七规则）` };
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
    const winnerUnit = winner === 'A' ? matchPreview.playerA : matchPreview.playerB;
    const loserUnit = winner === 'A' ? matchPreview.playerB : matchPreview.playerA;
    const winnerMembers = extractMembers(winnerUnit, tPreview.teams);  // 单打 1 人，双打 2 人
    const loserMembers = extractMembers(loserUnit, tPreview.teams);
    const winnerOpenid = winnerUnit.openid;  // 合成 ID（双打）或真 openid（单打）
    const loserOpenid = loserUnit.openid;

    // 预查所有相关 user 的 _id（事务内不支持 .where，必须用 .doc(id)）
    const allMembers = [...winnerMembers, ...loserMembers];
    const memberUsers = await Promise.all(allMembers.map(m => getUser(m.openid)));
    if (memberUsers.some(u => !u)) return { code: 1, msg: '用户数据缺失' };
    const memberIdMap = {};  // openid -> user._id
    allMembers.forEach((m, i) => { memberIdMap[m.openid] = memberUsers[i]._id; });

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

        // ELO/积分按"队内最高 ELO"代表整队计算（双打）；单打就是当事人
        // 写回时给每个 member 都发同样的 ELO 变动 + 积分（"队员各得满分"）
        const eloOfMembers = async (oids) => {
          const ratings = [];
          for (const oid of oids) {
            const r = await transaction.collection(USERS).doc(memberIdMap[oid]).get();
            ratings.push({ user: r.data, elo: r.data.eloRating || 1500 });
          }
          return ratings;
        };
        const winnerSide = await eloOfMembers(winnerMembers.map(m => m.openid));
        const loserSide = await eloOfMembers(loserMembers.map(m => m.openid));

        // 队伍 ELO = 队内最高 ELO（保守评估强度，避免低分队员稀释）
        const wTeamElo = Math.max(...winnerSide.map(x => x.elo));
        const lTeamElo = Math.max(...loserSide.map(x => x.elo));
        const { winnerPts, loserPts } = calcMatchPoints(wTeamElo, lTeamElo);
        const finalWinnerPts = winnerPts;
        const finalLoserPts = loserPts;
        const { winnerDelta, loserDelta } = calcEloChange(wTeamElo, lTeamElo, t.bestOf);

        // 写入本场积分发放明细（用于日后撤回时反向冲销）
        match.pointsAwarded = {
          // 旧字段保留兼容（双打时 winnerOpenid 是合成 ID，没意义但不删）
          winnerOpenid, loserOpenid,
          winnerPts: finalWinnerPts, loserPts: finalLoserPts,
          winnerEloDelta: winnerDelta, loserEloDelta: loserDelta,
          // 新字段：实际成员 openid 列表（单打 1 个，双打 2 个）
          winnerMembers: winnerMembers.map(m => ({ openid: m.openid })),
          loserMembers: loserMembers.map(m => ({ openid: m.openid })),
          awardedAt: Date.now()
        };
        // standings 必须在 match 完整赋值后再算
        group.standings = calcStandings(group);

        const tDate = t.matchDate || t.createdAt;

        // 顺序写入（事务内不能并发）：tournament + 所有 winner/loser members
        await transaction.collection(TOURNAMENTS).doc(event.id).update({
          data: { groups: t.groups, updatedAt: Date.now() }
        });
        // 写所有获胜方 members（每人各一份满分 + ELO+winnerDelta）
        for (const w of winnerSide) {
          await transaction.collection(USERS).doc(w.user._id).update({
            data: buildUserSettlePayload(w.user, event.id, t.title, tDate, winnerDelta, finalWinnerPts)
          });
        }
        // 写所有负方 members（每人各一份）
        for (const l of loserSide) {
          await transaction.collection(USERS).doc(l.user._id).update({
            data: buildUserSettlePayload(l.user, event.id, t.title, tDate, loserDelta, finalLoserPts)
          });
        }

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

      // 交叉对阵排列：
      // 1. 各组第 1 名按「胜场 → 净胜盘」排序（最佳 = 种子 1）
      // 2. 各组第 2+ 名必须与第 1 名保持相同的组顺序，确保 1vN / 2vN-1 公式产生交叉对阵
      //    （反例：runner-up 按净胜盘重排会导致 A1 vs A2 同组内战）
      const sorted = [];
      const rank1 = advanced.filter(p => p.groupRank === 1);
      rank1.sort((a, b) => b.wins - a.wins || (b.setsWon - b.setsLost) - (a.setsWon - a.setsLost));
      const groupOrder = rank1.map(w => w.groupName);
      sorted.push(...rank1);
      for (let rank = 1; rank < advanceCount; rank++) {
        const thisRank = advanced.filter(p => p.groupRank === rank + 1);
        thisRank.sort((a, b) =>
          groupOrder.indexOf(a.groupName) - groupOrder.indexOf(b.groupName)
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

  // 重新计算小组排名（仅 group 阶段、creator/admin）
  // 用于排名逻辑修正后刷新历史数据（如 H2H 胜负关系规则更新）
  if (action === 'recalcStandings') {
    const me = await getUser(OPENID);
    const res = await db.collection(TOURNAMENTS).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '赛事不存在' };
    const t = res.data;
    if (t.creator !== OPENID && (!me || me.role !== 'admin')) {
      return { code: 1, msg: '无权限操作' };
    }
    if (t.status !== 'group') return { code: 1, msg: '仅小组赛阶段可重算排名' };
    if (!Array.isArray(t.groups) || t.groups.length === 0) {
      return { code: 1, msg: '赛事尚未抽签分组' };
    }
    const groups = t.groups.map(g => ({
      ...g,
      standings: calcStandings(g)
    }));
    await db.collection(TOURNAMENTS).doc(event.id).update({
      data: { groups, updatedAt: Date.now() }
    });
    return { code: 0, data: { groups } };
  }

  // 重新生成淘汰赛对阵（仅 knockout 阶段、creator/admin、所有淘汰赛比分已撤回）
  // 用于小组排名修正后，按正确交叉对阵重建 bracket
  if (action === 'regenKnockout') {
    const me = await getUser(OPENID);
    const res = await db.collection(TOURNAMENTS).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '赛事不存在' };
    const t = res.data;
    if (t.creator !== OPENID && (!me || me.role !== 'admin')) {
      return { code: 1, msg: '无权限操作' };
    }
    if (t.status !== 'knockout') return { code: 1, msg: '当前不是淘汰赛阶段（请先撤回全部淘汰赛比分）' };

    // 安全检查：所有淘汰赛 match 必须已撤回（无 winner）
    const rounds = t.knockout && t.knockout.rounds;
    if (!Array.isArray(rounds) || rounds.length === 0) {
      return { code: 1, msg: '淘汰赛数据异常' };
    }
    for (const rd of rounds) {
      const scored = (rd.matches || []).filter(m => m.winner);
      if (scored.length > 0) {
        return { code: 1, msg: `「${rd.name || '?'}」还有 ${scored.length} 场比分未撤回，请先撤回所有淘汰赛比分` };
      }
    }

    // 重算小组排名 + 取晋级名单（使用最新 calcStandings 含 H2H 逻辑）
    const advanceCount = (t.config && t.config.advanceCount) || 2;
    const advanced = [];
    for (const g of t.groups) {
      const standings = calcStandings(g);
      const topN = standings.slice(0, advanceCount);
      topN.forEach((p, rank) => {
        advanced.push({ ...p, groupName: g.name, groupRank: rank + 1 });
      });
    }
    if (advanced.length < 2) return { code: 1, msg: '晋级人数不足' };

    // 交叉对阵排列（与 startKnockout 逻辑一致）：
    // 1. 各组第 1 名按「胜场 → 净胜盘」排序
    // 2. 各组第 2+ 名与第 1 名保持相同组顺序，确保交叉对阵
    const sorted = [];
    const rank1 = advanced.filter(p => p.groupRank === 1);
    rank1.sort((a, b) => b.wins - a.wins || (b.setsWon - b.setsLost) - (a.setsWon - a.setsLost));
    const groupOrder = rank1.map(w => w.groupName);
    sorted.push(...rank1);
    for (let rank = 1; rank < advanceCount; rank++) {
      const thisRank = advanced.filter(p => p.groupRank === rank + 1);
      thisRank.sort((a, b) =>
        groupOrder.indexOf(a.groupName) - groupOrder.indexOf(b.groupName)
      );
      sorted.push(...thisRank);
    }

    const knockout = generateKnockout(sorted);
    // 同时写回重算后的 group standings + 新 knockout
    const groups = t.groups.map(g => ({ ...g, standings: calcStandings(g) }));
    await db.collection(TOURNAMENTS).doc(event.id).update({
      data: {
        groups,
        knockout: _.set(knockout),
        updatedAt: Date.now()
      }
    });
    return { code: 0, data: { knockout, groups } };
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
      return { code: 1, msg: isShortFormat(tPreview.bestOf) ? `比分不合法（单盘抢 ${tPreview.bestOf}，净胜 ≥ 2 分）` : `比分不合法（先赢 ${tPreview.bestOf} 局制，含抢七规则）` };
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
    const winnerUnit = winner === 'A' ? matchPreview.playerA : matchPreview.playerB;
    const loserUnit = winner === 'A' ? matchPreview.playerB : matchPreview.playerA;
    const winnerMembers = extractMembers(winnerUnit, tPreview.teams);
    const loserMembers = extractMembers(loserUnit, tPreview.teams);
    const winnerOpenid = winnerUnit.openid;
    const loserOpenid = loserUnit.openid;

    const allMembers = [...winnerMembers, ...loserMembers];
    const memberUsers = await Promise.all(allMembers.map(m => getUser(m.openid)));
    if (memberUsers.some(u => !u)) {
      const missing = allMembers.filter((m, i) => !memberUsers[i]).map(m => m.openid);
      console.error('[scoreKnockout] 用户数据缺失, missing openids:', missing);
      return { code: 1, msg: `用户数据缺失（${missing.join(', ')}）` };
    }
    const memberIdMap = {};
    allMembers.forEach((m, i) => { memberIdMap[m.openid] = memberUsers[i]._id; });

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

        // 胜者晋级到下一轮（双打时整队 compound player 一起晋级）
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

        // 事务内更新所有 members（串行：事务内不能并发）
        const winnerSide = [];
        const loserSide = [];
        for (const m of winnerMembers) {
          const r = await transaction.collection(USERS).doc(memberIdMap[m.openid]).get();
          winnerSide.push({ user: r.data, elo: r.data.eloRating || 1500 });
        }
        for (const m of loserMembers) {
          const r = await transaction.collection(USERS).doc(memberIdMap[m.openid]).get();
          loserSide.push({ user: r.data, elo: r.data.eloRating || 1500 });
        }

        const wTeamElo = Math.max(...winnerSide.map(x => x.elo));
        const lTeamElo = Math.max(...loserSide.map(x => x.elo));
        const { winnerPts, loserPts } = calcMatchPoints(wTeamElo, lTeamElo);
        const finalWinnerPts = winnerPts;
        const finalLoserPts = loserPts;
        const { winnerDelta, loserDelta } = calcEloChange(wTeamElo, lTeamElo, t.bestOf);

        // 写入本场积分发放明细（撤回时反向冲销凭证）
        match.pointsAwarded = {
          winnerOpenid, loserOpenid,
          winnerPts: finalWinnerPts, loserPts: finalLoserPts,
          winnerEloDelta: winnerDelta, loserEloDelta: loserDelta,
          winnerMembers: winnerMembers.map(m => ({ openid: m.openid })),
          loserMembers: loserMembers.map(m => ({ openid: m.openid })),
          awardedAt: Date.now()
        };

        const tDate = t.matchDate || t.createdAt;
        const newStatus = finished ? 'finished' : 'knockout';

        await transaction.collection(TOURNAMENTS).doc(event.id).update({
          data: { knockout: t.knockout, status: newStatus, updatedAt: Date.now() }
        });
        for (const w of winnerSide) {
          await transaction.collection(USERS).doc(w.user._id).update({
            data: buildUserSettlePayload(w.user, event.id, t.title, tDate, winnerDelta, finalWinnerPts)
          });
        }
        for (const l of loserSide) {
          await transaction.collection(USERS).doc(l.user._id).update({
            data: buildUserSettlePayload(l.user, event.id, t.title, tDate, loserDelta, finalLoserPts)
          });
        }

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

  // 撤回比分（事务化反向冲销 ELO + 积分；可重新录入）
  // 权限：参赛双方任一 / creator / admin（与录分一致）
  // 限制：
  //   - 老数据无 match.pointsAwarded 时拒绝（明细缺失无法精确撤回）
  //   - 淘汰赛末梢限制：下一轮自己出现的格子若已录分，必须先撤下一轮
  //   - 已 finished 赛事撤回决赛/末轮：同时反向 placementAwards + status 回 knockout
  if (action === 'revertScore') {
    const me = await getUser(OPENID);
    const { stage, groupIndex, roundIndex, matchId } = event;
    if (!stage || !matchId) return { code: 1, msg: '参数不完整' };
    if (stage !== 'group' && stage !== 'knockout') return { code: 1, msg: '参数错误（stage）' };

    // 预读：定位比赛 + 校验权限 + 末梢校验
    const previewRes = await db.collection(TOURNAMENTS).doc(event.id).get().catch(() => null);
    if (!previewRes || !previewRes.data) return { code: 1, msg: '赛事不存在' };
    const tPreview = previewRes.data;

    let matchPreview;
    if (stage === 'group') {
      if (tPreview.status !== 'group') {
        return { code: 1, msg: '小组赛已结束（已进入淘汰赛），无法撤回' };
      }
      if (groupIndex === undefined) return { code: 1, msg: '缺少 groupIndex' };
      const gp = tPreview.groups && tPreview.groups[groupIndex];
      if (!gp) return { code: 1, msg: '分组不存在' };
      matchPreview = (gp.matches || []).find(m => m.id === matchId);
    } else {
      if (tPreview.status !== 'knockout' && tPreview.status !== 'finished') {
        return { code: 1, msg: '当前不在淘汰赛阶段' };
      }
      if (roundIndex === undefined) return { code: 1, msg: '缺少 roundIndex' };
      const rd = tPreview.knockout && tPreview.knockout.rounds && tPreview.knockout.rounds[roundIndex];
      if (!rd) return { code: 1, msg: '轮次不存在' };
      matchPreview = (rd.matches || []).find(m => m.id === matchId);

      // 末梢校验：下一轮的对应位置如果已录分，必须先撤下一轮
      if (matchPreview && roundIndex + 1 < tPreview.knockout.rounds.length) {
        const matchIdxInRound = rd.matches.indexOf(matchPreview);
        const nextMatchIdx = Math.floor(matchIdxInRound / 2);
        const nextMatch = tPreview.knockout.rounds[roundIndex + 1].matches[nextMatchIdx];
        if (nextMatch && nextMatch.winner) {
          return { code: 1, msg: '请先撤回下一轮的比分' };
        }
      }
    }

    if (!matchPreview) return { code: 1, msg: '比赛不存在' };
    if (!matchPreview.winner) return { code: 1, msg: '该场尚未录分，无需撤回' };
    if (!matchPreview.pointsAwarded) {
      return { code: 1, msg: '历史数据缺少积分明细，无法自动撤回（请联系管理员）' };
    }

    // 权限：参赛双方 / creator / admin
    const inMatch = matchPreview.playerA && matchPreview.playerB && (
      matchPreview.playerA.openid === OPENID || matchPreview.playerB.openid === OPENID
    );
    const isCreator = tPreview.creator === OPENID;
    const isAdmin = me && me.role === 'admin';
    if (!inMatch && !isCreator && !isAdmin) return { code: 1, msg: '无权限撤回' };

    const pa = matchPreview.pointsAwarded;
    // 双打兼容：优先用 pa.winnerMembers / loserMembers（新数据），
    // 没有则用 pa.winnerOpenid / loserOpenid（旧单打数据）
    const winnerMemberOids = (pa.winnerMembers && pa.winnerMembers.length)
      ? pa.winnerMembers.map(m => m.openid)
      : [pa.winnerOpenid];
    const loserMemberOids = (pa.loserMembers && pa.loserMembers.length)
      ? pa.loserMembers.map(m => m.openid)
      : [pa.loserOpenid];
    // 预查所有相关 user._id（事务内不能 .where）
    const winnerUsers = await Promise.all(winnerMemberOids.map(oid => getUser(oid)));
    const loserUsers = await Promise.all(loserMemberOids.map(oid => getUser(oid)));
    if (winnerUsers.some(u => !u) || loserUsers.some(u => !u)) {
      return { code: 1, msg: '用户数据缺失' };
    }
    const winnerIdMap = {};
    winnerMemberOids.forEach((oid, i) => { winnerIdMap[oid] = winnerUsers[i]._id; });
    const loserIdMap = {};
    loserMemberOids.forEach((oid, i) => { loserIdMap[oid] = loserUsers[i]._id; });

    // 若 finished 状态需要清 placementAwards 时，预读所有名次奖用户
    let placementUsers = null;
    const willResetFinish = stage === 'knockout' && tPreview.status === 'finished';
    if (willResetFinish && Array.isArray(tPreview.placementAwards)) {
      const awardOpenids = [...new Set(tPreview.placementAwards.map(a => a.openid))];
      placementUsers = {};
      for (const oid of awardOpenids) {
        const u = await getUser(oid);
        if (u) placementUsers[oid] = u;
      }
    }

    try {
      const result = await db.runTransaction(async transaction => {
        const tRes = await transaction.collection(TOURNAMENTS).doc(event.id).get();
        const t = tRes.data;

        // 重新定位 match（事务内最新数据）
        let match;
        let group;
        if (stage === 'group') {
          if (t.status !== 'group') throw new Error('小组赛已结束，无法撤回');
          group = t.groups[groupIndex];
          match = group.matches.find(m => m.id === matchId);
        } else {
          if (t.status !== 'knockout' && t.status !== 'finished') {
            throw new Error('当前不在淘汰赛阶段');
          }
          const round = t.knockout.rounds[roundIndex];
          match = round.matches.find(m => m.id === matchId);
          // 二次确认末梢
          if (roundIndex + 1 < t.knockout.rounds.length) {
            const matchIdxInRound = round.matches.indexOf(match);
            const nextMatch = t.knockout.rounds[roundIndex + 1].matches[Math.floor(matchIdxInRound / 2)];
            if (nextMatch && nextMatch.winner) throw new Error('请先撤回下一轮的比分');
          }
        }
        if (!match || !match.winner || !match.pointsAwarded) {
          throw new Error('比赛状态异常，无法撤回');
        }

        const pa2 = match.pointsAwarded;
        const w2Oids = (pa2.winnerMembers && pa2.winnerMembers.length)
          ? pa2.winnerMembers.map(m => m.openid)
          : [pa2.winnerOpenid];
        const l2Oids = (pa2.loserMembers && pa2.loserMembers.length)
          ? pa2.loserMembers.map(m => m.openid)
          : [pa2.loserOpenid];

        // 反向冲销所有 winner / loser members（每人都还原 ELO + 积分）
        for (const oid of w2Oids) {
          const r = await transaction.collection(USERS).doc(winnerIdMap[oid]).get();
          await transaction.collection(USERS).doc(r.data._id).update({
            data: buildUserRevertPayload(r.data, event.id, pa2.winnerEloDelta, pa2.winnerPts)
          });
        }
        for (const oid of l2Oids) {
          const r = await transaction.collection(USERS).doc(loserIdMap[oid]).get();
          await transaction.collection(USERS).doc(r.data._id).update({
            data: buildUserRevertPayload(r.data, event.id, pa2.loserEloDelta, pa2.loserPts)
          });
        }

        // 重置 match 字段
        match.scoreA = null;
        match.scoreB = null;
        match.winner = null;
        match.scoreSummary = '';
        match.pointsAwarded = null;

        // 小组赛：重算 standings
        if (stage === 'group') {
          group.standings = calcStandings(group);
        }

        // 淘汰赛：清掉下一轮自己晋级的位置
        if (stage === 'knockout' && roundIndex + 1 < t.knockout.rounds.length) {
          const round = t.knockout.rounds[roundIndex];
          const matchIdxInRound = round.matches.indexOf(match);
          const nextMatch = t.knockout.rounds[roundIndex + 1].matches[Math.floor(matchIdxInRound / 2)];
          if (nextMatch) {
            if (matchIdxInRound % 2 === 0) nextMatch.playerA = null;
            else nextMatch.playerB = null;
          }
        }

        // 决赛/已完赛场景：反向 placementAwards + status 回 knockout
        // 三四名决赛撤回不影响 finished 状态和已发名次奖
        let newStatus = t.status;
        let newPlacementAwards = t.placementAwards;
        const isTP = !!(match.isThirdPlace);
        if (stage === 'knockout' && t.status === 'finished' && !isTP) {
          // 反向所有名次奖到对应 user
          if (Array.isArray(t.placementAwards) && placementUsers) {
            // 按 openid 聚合：同一 user 多笔奖（如冠军 + 不可能存在）这里防御性
            const aggregated = {}; // openid -> totalPts
            for (const a of t.placementAwards) {
              aggregated[a.openid] = (aggregated[a.openid] || 0) + (a.pts || 0);
            }
            for (const [oid, totalPts] of Object.entries(aggregated)) {
              const u = placementUsers[oid];
              if (!u) continue;
              const uRes = await transaction.collection(USERS).doc(u._id).get();
              const uu = uRes.data;
              await transaction.collection(USERS).doc(uu._id).update({
                // ELO 不变，只反向 earnings + 重算 totalPoints
                data: buildUserRevertPayload(uu, event.id, 0, totalPts)
              });
            }
          }
          newStatus = 'knockout';
          newPlacementAwards = null;
        }

        // 写回 tournament
        const updateData = {
          updatedAt: Date.now(),
          status: newStatus
        };
        if (stage === 'group') {
          updateData.groups = t.groups;
        } else {
          updateData.knockout = _.set(t.knockout);
          if (willResetFinish) updateData.placementAwards = newPlacementAwards;
        }
        await transaction.collection(TOURNAMENTS).doc(event.id).update({ data: updateData });

        return {
          revertedWinner: pa2.winnerOpenid,
          revertedLoser: pa2.loserOpenid,
          revertedWinnerPts: pa2.winnerPts,
          revertedLoserPts: pa2.loserPts,
          newStatus
        };
      });
      return { code: 0, data: result };
    } catch (e) {
      console.error('[revertScore] failed:', e && e.message, e && e.stack);
      return { code: 1, msg: (e && e.message) || '撤回失败，请重试' };
    }
  }

  // 删除赛事
  // signup 阶段：硬删除（零积分变动）
  // group/knockout/finished：先回滚所有已录比分的 ELO/积分 + 名次奖，再删除
  if (action === 'delete') {
    const me = await getUser(OPENID);
    const res = await db.collection(TOURNAMENTS).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '赛事不存在' };
    const t = res.data;
    if (t.creator !== OPENID && (!me || me.role !== 'admin')) {
      return { code: 1, msg: '无权限删除' };
    }

    // signup：直接删
    if (t.status === 'signup') {
      await db.collection(TOURNAMENTS).doc(event.id).remove();
      return { code: 0, data: { stage: 'signup' } };
    }

    // 团队赛没有逐场积分/ELO，只在整场结束时写一份 teamSettlement。
    // 删除必须和固定积分回滚处于同一事务；历史完赛数据没有凭证时宁可拒绝，也不能留下孤儿积分。
    if (t.type === 'team') {
      const group = t.groups && t.groups[0];
      const match = group && group.matches && group.matches[0];
      if (!match) return { code: 1, msg: '团队赛数据不完整，无法安全删除' };
      if (t.status === 'finished' && !match.teamSettlement) {
        return { code: 1, msg: '历史团队赛缺少结算凭证，无法自动回滚积分，请联系管理员处理' };
      }

      let userIdMap;
      try {
        userIdMap = await loadTeamMemberIdMap(t, {
          ...match,
          status: 'finished',
          winner: match.winner || 'A'
        });
        const result = await db.runTransaction(async transaction => {
          const latestRes = await transaction.collection(TOURNAMENTS).doc(event.id).get();
          const latest = latestRes.data;
          if (!latest) return { stage: t.status, revertedMembers: 0, alreadyDeleted: true };
          const latestGroup = latest.groups && latest.groups[0];
          const latestMatch = latestGroup && latestGroup.matches && latestGroup.matches[0];
          if (!latestMatch) throw new Error('团队赛数据不完整，无法安全删除');
          const settlement = latestMatch.teamSettlement;
          if (latest.status === 'finished' && !settlement) {
            throw new Error('历史团队赛缺少结算凭证，无法自动回滚积分，请联系管理员处理');
          }

          let revertedMembers = 0;
          if (settlement) {
            if (!Array.isArray(settlement.awards) || settlement.awards.length === 0) {
              throw new Error('团队赛结算凭证不完整，无法自动回滚积分');
            }
            for (const award of settlement.awards) {
              const userId = userIdMap[award.openid];
              if (!userId) throw new Error('团队成员用户数据缺失，无法回滚积分');
              const userRes = await transaction.collection(USERS).doc(userId).get();
              await transaction.collection(USERS).doc(userId).update({
                data: buildTeamEarningRemovalPayload(userRes.data, event.id)
              });
              revertedMembers++;
            }
          }

          await transaction.collection(TOURNAMENTS).doc(event.id).remove();
          return { stage: latest.status, revertedMembers, settlementId: settlement && settlement.id };
        });
        return { code: 0, data: result };
      } catch (error) {
        console.error('[delete:team] failed:', error && error.message, error && error.stack);
        return { code: 1, msg: (error && error.message) || '删除团队赛失败，请重试' };
      }
    }

    // 收集所有已录分 match（小组赛 + 淘汰赛）
    const scoredMatches = [];
    for (const g of (t.groups || [])) {
      for (const m of (g.matches || [])) {
        if (m.winner && m.pointsAwarded) scoredMatches.push(m);
      }
    }
    const rounds = t.knockout && t.knockout.rounds ? t.knockout.rounds : [];
    for (const rd of rounds) {
      for (const m of (rd.matches || [])) {
        if (m.winner && m.pointsAwarded) scoredMatches.push(m);
      }
    }

    // 逐场回滚积分（非事务，admin 操作可接受；若中途失败，重试即可）
    let revertedCount = 0;
    for (const m of scoredMatches) {
      const pa = m.pointsAwarded;
      const wOids = (pa.winnerMembers && pa.winnerMembers.length)
        ? pa.winnerMembers.map(x => x.openid) : [pa.winnerOpenid];
      const lOids = (pa.loserMembers && pa.loserMembers.length)
        ? pa.loserMembers.map(x => x.openid) : [pa.loserOpenid];
      for (const oid of wOids) {
        const u = await getUser(oid);
        if (u) {
          await db.collection(USERS).doc(u._id).update({
            data: buildUserRevertPayload(u, event.id, pa.winnerEloDelta, pa.winnerPts)
          });
        }
      }
      for (const oid of lOids) {
        const u = await getUser(oid);
        if (u) {
          await db.collection(USERS).doc(u._id).update({
            data: buildUserRevertPayload(u, event.id, pa.loserEloDelta, pa.loserPts)
          });
        }
      }
      revertedCount++;
    }

    // 回滚名次奖（finished 赛事）
    if (Array.isArray(t.placementAwards)) {
      for (const a of t.placementAwards) {
        const u = await getUser(a.openid);
        if (u) {
          await db.collection(USERS).doc(u._id).update({
            data: buildUserRevertPayload(u, event.id, 0, a.points || a.pts || 0)
          });
        }
      }
    }

    // 删除赛事文档
    await db.collection(TOURNAMENTS).doc(event.id).remove();
    return { code: 0, data: { stage: t.status, revertedMatches: revertedCount } };
  }

  // 中途加人（仅 group 阶段、creator/admin 可操作）
  if (action === 'addPlayer') {
    const me = await getUser(OPENID);
    const res = await db.collection(TOURNAMENTS).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '赛事不存在' };
    const t = res.data;
    if (t.creator !== OPENID && (!me || me.role !== 'admin')) {
      return { code: 1, msg: '无权限操作' };
    }
    if (t.status !== 'group') {
      return { code: 1, msg: '仅小组赛阶段支持加人' };
    }

    const newOids = [...new Set((event.newPlayerOpenids || []).filter(Boolean))];
    if (newOids.length === 0) return { code: 1, msg: '请选择要添加的选手' };

    // ====== 团队赛 ======
    if (t.type === 'team') {
      const targetTeam = event.targetTeam;
      if (targetTeam !== 'A' && targetTeam !== 'B') return { code: 1, msg: '请选择目标队伍' };

      const players = (t.players || []).slice();
      const existingOids = new Set(players.map(player => player.openid));
      if (newOids.some(openid => existingOids.has(openid))) {
        return { code: 1, msg: '选择的选手中有人已在参赛名单中' };
      }

      // 先一次性验证所有成员，再修改数组，避免中途发现无效成员导致半批数据。
      const users = await Promise.all(newOids.map(openid => getUser(openid)));
      if (users.some(user => !user)) return { code: 1, msg: '选择的选手中有人不存在' };
      if (users.some(user => !user.wecomName)) {
        return { code: 1, msg: '选择的选手中有人未完成登记，请先到"我的"页登记' };
      }
      const playerEntries = users.map(user => ({
        openid: user.openid, wecomName: user.wecomName,
        gender: user.gender || '', rating: user.rating || '',
        totalPoints: user.totalPoints || 0, signupAt: Date.now()
      }));
      players.push(...playerEntries);

      const teams = (t.teams || []).map(team => ({ ...team, members: (team.members || []).slice() }));
      const teamIdx = targetTeam === 'A' ? 0 : 1;
      if (!teams[teamIdx]) return { code: 1, msg: '目标队伍不存在' };
      teams[teamIdx].members.push(...users.map(user => ({
        openid: user.openid, wecomName: user.wecomName,
        gender: user.gender || '', rating: user.rating || '', isCaptain: false
      })));

      // 新人逐个进入当前人数最少的场地，批量添加后仍保持人数均衡；已完成 encounters 不受影响。
      const groups = (t.groups || []).slice();
      const group = groups[0];
      const match = group && group.matches && group.matches[0];
      if (match && Array.isArray(match.courts) && match.courts.length > 0) {
        const courts = match.courts.map(court => ({ ...court, players: (court.players || []).slice(), encounters: (court.encounters || []).slice() }));
        playerEntries.forEach(player => {
          const targetCourt = courts.reduce((least, court) => court.players.length < least.players.length ? court : least, courts[0]);
          targetCourt.players.push(player.openid);
        });
        groups[0] = { ...group, matches: group.matches.map(item => item.id === match.id ? { ...match, courts } : item) };
      }

      await db.collection(TOURNAMENTS).doc(event.id).update({
        data: { players, teams, groups, updatedAt: Date.now() }
      });
      return { code: 0, data: { added: playerEntries.length, players: playerEntries } };
    }

    // ====== 单打 / 双打 ======
    const targetGroup = parseInt(event.targetGroup);
    if (isNaN(targetGroup) || targetGroup < 0) return { code: 1, msg: '请选择目标组' };

    const groups = (t.groups || []).slice();
    if (targetGroup >= groups.length) return { code: 1, msg: '目标组不存在' };

    const players = (t.players || []).slice();
    const existingOids = new Set(players.map(p => p.openid));

    let newUnits; // 要插入该组 players[] 的参赛单位（单打 1 个，双打 1 个 compound pair）

    if (t.type === 'doubles') {
      if (newOids.length !== 2) return { code: 1, msg: '双打需同时添加 2 人组成一对' };
      const [oidA, oidB] = newOids;
      if (oidA === oidB) return { code: 1, msg: '两人不能相同' };
      if (existingOids.has(oidA) || existingOids.has(oidB)) {
        return { code: 1, msg: '添加的选手中有人已在参赛名单中' };
      }
      const uA = await getUser(oidA);
      const uB = await getUser(oidB);
      if (!uA || !uB) return { code: 1, msg: '用户不存在' };
      if (!uA.wecomName || !uB.wecomName) {
        return { code: 1, msg: '添加的选手中有人未完成登记' };
      }

      const pA = { openid: uA.openid, wecomName: uA.wecomName, gender: uA.gender || '', rating: uA.rating || '', totalPoints: uA.totalPoints || 0, signupAt: Date.now() };
      const pB = { openid: uB.openid, wecomName: uB.wecomName, gender: uB.gender || '', rating: uB.rating || '', totalPoints: uB.totalPoints || 0, signupAt: Date.now() };
      players.push(pA, pB);
      newUnits = [makeDoubleTeam(pA, pB)];
    } else {
      // 单打
      if (newOids.some(openid => existingOids.has(openid))) {
        return { code: 1, msg: '选择的选手中有人已在参赛名单中' };
      }
      const users = await Promise.all(newOids.map(openid => getUser(openid)));
      if (users.some(user => !user)) return { code: 1, msg: '选择的选手中有人不存在' };
      if (users.some(user => !user.wecomName)) {
        return { code: 1, msg: '选择的选手中有人未完成登记，请先到"我的"页登记' };
      }

      const newPlayers = users.map(user => ({
        openid: user.openid, wecomName: user.wecomName,
        gender: user.gender || '', rating: user.rating || '',
        totalPoints: user.totalPoints || 0, signupAt: Date.now()
      }));
      players.push(...newPlayers);
      newUnits = newPlayers.map(player => ({
        openid: player.openid, wecomName: player.wecomName, totalPoints: player.totalPoints
      }));
    }

    // 插入目标组 → 重建对阵（保留已有比分）
    const group = groups[targetGroup];
    group.players.push(...newUnits);
    const freshMatches = generateRoundRobin(group.players);
    const oldMatchMap = {};
    (group.matches || []).forEach(m => { oldMatchMap[m.id] = m; });
    group.matches = freshMatches.map(m => oldMatchMap[m.id] || m);
    group.standings = calcStandings(group);

    await db.collection(TOURNAMENTS).doc(event.id).update({
      data: { players, groups, updatedAt: Date.now() }
    });
    return { code: 0, data: { added: newOids.length } };
  }

  // 移除选手（仅 group 阶段、creator/admin、非团队赛）
  // 从参赛名单 + 所在小组移除选手 → 重建该组循环赛对阵（保留已有比分）
  if (action === 'removePlayer') {
    const me = await getUser(OPENID);
    const { openid: targetOid } = event;
    if (!targetOid) return { code: 1, msg: '参数不完整' };

    const res = await db.collection(TOURNAMENTS).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '赛事不存在' };
    const t = res.data;

    if (t.creator !== OPENID && (!me || me.role !== 'admin')) {
      return { code: 1, msg: '无权限操作' };
    }
    if (t.status !== 'group') {
      return { code: 1, msg: '仅小组赛阶段可移除选手' };
    }
    if (t.type === 'team') {
      return { code: 1, msg: '团队赛请使用「调整队员分队」功能' };
    }

    // 检查是否在参赛名单中
    const players = (t.players || []).slice();
    const playerIdx = players.findIndex(p => p.openid === targetOid);
    if (playerIdx < 0) return { code: 1, msg: '该用户不在参赛名单中' };

    // 找到选手所在的小组
    const groups = (t.groups || []).slice();
    let foundGroupIdx = -1;
    let foundUnitIdx = -1;
    for (let gi = 0; gi < groups.length; gi++) {
      const gPlayers = groups[gi].players || [];
      const idx = gPlayers.findIndex(u => {
        // 单打：直接匹配 openid
        if (u.openid === targetOid) return true;
        // 双打：匹配 compound unit 的 members
        if (Array.isArray(u.members)) {
          return u.members.some(m => m.openid === targetOid);
        }
        return false;
      });
      if (idx >= 0) {
        foundGroupIdx = gi;
        foundUnitIdx = idx;
        break;
      }
    }
    if (foundGroupIdx < 0) return { code: 1, msg: '未找到该选手所在的小组' };

    const targetGroup = groups[foundGroupIdx];
    const targetUnit = (targetGroup.players || [])[foundUnitIdx];

    // 安全检查：该选手参与的 match 是否已有比分
    const scoredMatches = (targetGroup.matches || []).filter(m => {
      if (!m.winner || !m.playerA || !m.playerB) return false;
      // 单打：检查 playerA/B.openid
      if (m.playerA.openid === targetOid || m.playerB.openid === targetOid) return true;
      // 双打：检查 compound unit 的 members
      const checkMembers = (player) => {
        if (Array.isArray(player.members)) {
          return player.members.some(mem => mem.openid === targetOid);
        }
        return false;
      };
      return checkMembers(m.playerA) || checkMembers(m.playerB);
    });
    if (scoredMatches.length > 0) {
      return {
        code: 1,
        msg: `该选手已有 ${scoredMatches.length} 场比分记录，请先用「撤回」清除相关场次后再移除`
      };
    }

    // 从参赛名单移除
    players.splice(playerIdx, 1);

    // 从小组移除
    const newGroupPlayers = (targetGroup.players || []).filter((_, i) => i !== foundUnitIdx);

    // 重建该组对阵（保留已有比分）
    const freshMatches = generateRoundRobin(newGroupPlayers);
    const oldMatchMap = {};
    (targetGroup.matches || []).forEach(m => { oldMatchMap[m.id] = m; });
    // 只保留仍然有效的 match（双方都在新 players 里的）
    const newPlayerOids = new Set(newGroupPlayers.map(u => u.openid));
    const rebuiltMatches = freshMatches.map(m => {
      if (!m.playerA || !m.playerB) return m;  // bye match
      const aId = m.playerA.openid;
      const bId = m.playerB.openid;
      if (newPlayerOids.has(aId) && newPlayerOids.has(bId) && oldMatchMap[m.id]) {
        return oldMatchMap[m.id];  // 保留已有比分
      }
      return m;  // 新 match（或一方被移除后的残留 match）
    });

    targetGroup.players = newGroupPlayers;
    targetGroup.matches = rebuiltMatches;
    targetGroup.standings = calcStandings(targetGroup);
    groups[foundGroupIdx] = targetGroup;

    await db.collection(TOURNAMENTS).doc(event.id).update({
      data: { players, groups, updatedAt: Date.now() }
    });
    return { code: 0, data: { removed: targetOid } };
  }

  // 回滚到报名态（仅 group 阶段、creator/admin、无任何已录分比赛）
  // 场景：抽签完成后发现要加人/重新分组，不用删除比赛重建
  if (action === 'rollbackToSignup') {
    const me = await getUser(OPENID);
    const res = await db.collection(TOURNAMENTS).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '赛事不存在' };
    const t = res.data;
    if (t.creator !== OPENID && (!me || me.role !== 'admin')) {
      return { code: 1, msg: '无权限操作' };
    }
    if (t.status !== 'group') {
      return { code: 1, msg: '仅小组赛阶段可回滚到报名态（淘汰赛/已结束请先撤回比分）' };
    }

    // 安全检查：不能有任何已录分的比赛
    const groups = t.groups || [];
    for (const g of groups) {
      const scored = (g.matches || []).filter(m => m.winner);
      if (scored.length > 0) {
        return { code: 1, msg: `「${g.name}组」已有 ${scored.length} 场比分记录，请先撤回所有比分后再回滚` };
      }
    }

    // 清除分组/淘汰赛/战队数据，保留 players 列表，状态回 signup
    await db.collection(TOURNAMENTS).doc(event.id).update({
      data: {
        status: 'signup',
        groups: [],
        knockout: null,
        teams: [],
        updatedAt: Date.now()
      }
    });
    return { code: 0, data: { status: 'signup' } };
  }

  // ====== 更新赛制配置（仅 group 阶段、creator/admin） ======
  // advanceCount：随时可改（不影响已有比分）
  // bestOf：无比分直接改；有比分需 forceClearScores 清空所有比分+回滚ELO/积分
  if (action === 'updateConfig') {
    const me = await getUser(OPENID);
    const res = await db.collection(TOURNAMENTS).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '赛事不存在' };
    const t = res.data;
    if (t.creator !== OPENID && (!me || me.role !== 'admin')) {
      return { code: 1, msg: '无权限操作' };
    }
    if (t.status !== 'group') return { code: 1, msg: '仅小组赛阶段可调整赛制' };

    const updates = {};
    const updated = [];

    // advanceCount
    if (event.advanceCount !== undefined) {
      const ac = parseInt(event.advanceCount);
      if (isNaN(ac) || ac < 1 || ac > 4) return { code: 1, msg: '晋级人数需在 1-4 之间' };
      const groupCount = (t.config && t.config.groupCount) || (t.groups || []).length || 2;
      const playerCount = (t.players || []).length;
      const groupSize = Math.ceil(playerCount / Math.max(1, groupCount));
      if (ac > groupSize) return { code: 1, msg: `晋级人数(${ac})不能大于组内人数(${groupSize})` };
      updates['config.advanceCount'] = ac;
      updated.push('advanceCount');
    }

    // bestOf
    if (event.bestOf !== undefined) {
      const bo = parseInt(event.bestOf);
      if (![4, 6, 7, 11].includes(bo)) return { code: 1, msg: '赛制仅支持 4/6/7/11' };

      const hasScores = t.type === 'team'
        ? (t.groups || []).some(g => (g.matches || []).some(m =>
            getTeamRegularEncounters(m).some(encounter => encounter && encounter.winner) ||
            !!(getTeamTiebreak(m) && getTeamTiebreak(m).winner)
          ))
        : (t.groups || []).some(g => (g.matches || []).some(m => m.winner));

      // 团队赛允许在完全未录分时修改；一旦有任何场地比分就锁定，禁止清空后强改。
      if (t.type === 'team' && hasScores) {
        return { code: 1, msg: '已有比分，不能修改盘数' };
      }

      if (t.type !== 'team' && hasScores && !event.forceClearScores) {
        return {
          code: 1,
          msg: `已有 ${(t.groups || []).reduce((c, g) => c + (g.matches || []).filter(m => m.winner).length, 0)} 场比分记录，修改赛制将清空所有比分并回滚积分/ELO。请确认后重试`,
          needConfirm: true,
          scoredCount: (t.groups || []).reduce((c, g) => c + (g.matches || []).filter(m => m.winner).length, 0)
        };
      }

      if (t.type !== 'team' && hasScores && event.forceClearScores) {
        // 回滚所有已录比分
        for (const g of (t.groups || [])) {
          for (const m of (g.matches || [])) {
            if (!m.winner || !m.pointsAwarded) continue;
            const pa = m.pointsAwarded;
            const wOids = (pa.winnerMembers && pa.winnerMembers.length)
              ? pa.winnerMembers.map(x => x.openid) : [pa.winnerOpenid];
            const lOids = (pa.loserMembers && pa.loserMembers.length)
              ? pa.loserMembers.map(x => x.openid) : [pa.loserOpenid];
            for (const oid of wOids) {
              const u = await getUser(oid);
              if (u) await db.collection(USERS).doc(u._id).update({
                data: buildUserRevertPayload(u, event.id, pa.winnerEloDelta, pa.winnerPts)
              });
            }
            for (const oid of lOids) {
              const u = await getUser(oid);
              if (u) await db.collection(USERS).doc(u._id).update({
                data: buildUserRevertPayload(u, event.id, pa.loserEloDelta, pa.loserPts)
              });
            }
            // 重置 match
            m.scoreA = null; m.scoreB = null; m.winner = null;
            m.scoreSummary = ''; m.pointsAwarded = null;
          }
        }
        // 重算所有组 standings（全变 0-0）
        updates.groups = (t.groups || []).map(g => ({
          ...g, standings: calcStandings(g)
        }));
      }

      updates.bestOf = bo;
      updated.push('bestOf');
    }

    if (updated.length === 0) return { code: 1, msg: '没有需要更新的参数' };

    updates.updatedAt = Date.now();
    await db.collection(TOURNAMENTS).doc(event.id).update({ data: updates });
    return { code: 0, data: { updated } };
  }

  // ====== 添加三四名决赛（knockout 阶段、半决赛已完成、决赛未开始） ======
  if (action === 'addThirdPlaceMatch') {
    const me = await getUser(OPENID);
    const res = await db.collection(TOURNAMENTS).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '赛事不存在' };
    const t = res.data;
    if (t.creator !== OPENID && (!me || me.role !== 'admin')) {
      return { code: 1, msg: '无权限操作' };
    }
    if (t.status !== 'knockout') return { code: 1, msg: '当前不是淘汰赛阶段' };

    const rounds = t.knockout && t.knockout.rounds;
    if (!Array.isArray(rounds) || rounds.length < 2) {
      return { code: 1, msg: '至少需要半决赛和决赛两轮' };
    }
    const lastRound = rounds[rounds.length - 1];
    const sfRound = rounds[rounds.length - 2];

    // 检查是否已有三四名比赛
    if (lastRound.matches.some(m => m.isThirdPlace)) {
      return { code: 1, msg: '三四名决赛已存在' };
    }
    if (t.noThirdPlace) return { code: 1, msg: '已选择只分四强，无法再添加三四名决赛' };

    // 决赛不能已开始（有 winner）
    if (lastRound.matches[0] && lastRound.matches[0].winner) {
      return { code: 1, msg: '决赛已结束，无法添加三四名决赛' };
    }

    // 半决赛必须全部完成
    const sfMatches = sfRound.matches || [];
    if (sfMatches.length < 2) return { code: 1, msg: '半决赛数据异常' };
    for (const m of sfMatches) {
      if (!m.winner) return { code: 1, msg: '半决赛尚未全部完成' };
    }

    // 取半决赛负者
    const loser1 = sfMatches[0].winner === 'A' ? sfMatches[0].playerB : sfMatches[0].playerA;
    const loser2 = sfMatches[1].winner === 'A' ? sfMatches[1].playerB : sfMatches[1].playerA;
    if (!loser1 || !loser2) return { code: 1, msg: '半决赛选手数据异常' };

    const tpMatch = {
      id: 'ko_third',
      playerA: { ...loser1 },
      playerB: { ...loser2 },
      scores: [],
      winner: null,
      scoreSummary: '',
      isThirdPlace: true
    };

    lastRound.matches.push(tpMatch);
    await db.collection(TOURNAMENTS).doc(event.id).update({
      data: { knockout: _.set(t.knockout), updatedAt: Date.now() }
    });
    return { code: 0, data: { match: tpMatch } };
  }

  // ====== 确认只分四强（不设三四名决赛） ======
  if (action === 'finalizeFourStrong') {
    const me = await getUser(OPENID);
    const res = await db.collection(TOURNAMENTS).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '赛事不存在' };
    const t = res.data;
    if (t.creator !== OPENID && (!me || me.role !== 'admin')) {
      return { code: 1, msg: '无权限操作' };
    }
    if (t.status !== 'knockout') return { code: 1, msg: '当前不是淘汰赛阶段' };
    if (t.noThirdPlace) return { code: 1, msg: '已确认只分四强' };

    const rounds = t.knockout && t.knockout.rounds;
    if (!Array.isArray(rounds) || rounds.length < 2) {
      return { code: 1, msg: '至少需要半决赛和决赛两轮' };
    }
    const lastRound = rounds[rounds.length - 1];
    if (lastRound.matches.some(m => m.isThirdPlace)) {
      return { code: 1, msg: '三四名决赛已存在，如需取消请先撤回该场比分' };
    }

    await db.collection(TOURNAMENTS).doc(event.id).update({
      data: { noThirdPlace: true, updatedAt: Date.now() }
    });
    return { code: 0, data: { noThirdPlace: true } };
  }

  // ====== 手动调组（单打/双打，group 阶段、creator/admin） ======
  // 将选手（单打）或参赛对（双打）从一组移到另一组，两组的对阵自动重建并保留已有比分
  if (action === 'movePlayer') {
    const me = await getUser(OPENID);
    const { openid: targetOid, toGroup: toGroupIdx } = event;
    if (!targetOid || toGroupIdx === undefined) return { code: 1, msg: '参数不完整' };

    const res = await db.collection(TOURNAMENTS).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '赛事不存在' };
    const t = res.data;

    if (t.creator !== OPENID && (!me || me.role !== 'admin')) {
      return { code: 1, msg: '无权限操作' };
    }
    if (t.status !== 'group') return { code: 1, msg: '仅小组赛阶段可调组' };
    if (t.type === 'team') return { code: 1, msg: '团队赛请使用「调整队员分队」' };

    const toIdx = parseInt(toGroupIdx);
    if (isNaN(toIdx) || toIdx < 0) return { code: 1, msg: '目标组参数错误' };

    const groups = (t.groups || []).slice();
    if (toIdx >= groups.length) return { code: 1, msg: '目标组不存在' };

    // 找到目标选手/参赛单位所在组
    let fromIdx = -1, unitIdx = -1, targetUnit = null;
    for (let gi = 0; gi < groups.length; gi++) {
      const gPlayers = groups[gi].players || [];
      const idx = gPlayers.findIndex(u => {
        if (u.openid === targetOid) return true;
        if (Array.isArray(u.members)) return u.members.some(m => m.openid === targetOid);
        return false;
      });
      if (idx >= 0) { fromIdx = gi; unitIdx = idx; targetUnit = gPlayers[idx]; break; }
    }
    if (fromIdx < 0) return { code: 1, msg: '未找到该选手' };
    if (fromIdx === toIdx) return { code: 1, msg: '已在目标组中' };

    // 检查该选手在源组是否有比分
    const fromGroup = groups[fromIdx];
    const hasScores = (fromGroup.matches || []).some(m => {
      if (!m.winner || !m.playerA || !m.playerB) return false;
      if (m.playerA.openid === targetOid || m.playerB.openid === targetOid) return true;
      const chk = (p) => Array.isArray(p.members) && p.members.some(mem => mem.openid === targetOid);
      return chk(m.playerA) || chk(m.playerB);
    });
    if (hasScores) return { code: 1, msg: '该选手已有比分记录，请先撤回相关场次' };

    // 执行迁移
    fromGroup.players = (fromGroup.players || []).filter((_, i) => i !== unitIdx);
    groups[toIdx].players = (groups[toIdx].players || []).concat([targetUnit]);

    // 重建两个组的对阵
    const rebuildGroup = (g) => {
      const fresh = generateRoundRobin(g.players || []);
      const oldMap = {};
      (g.matches || []).forEach(m => { oldMap[m.id] = m; });
      const newPlayerOids = new Set((g.players || []).map(u => u.openid));
      g.matches = fresh.map(m => {
        if (!m.playerA || !m.playerB) return m;
        if (newPlayerOids.has(m.playerA.openid) && newPlayerOids.has(m.playerB.openid) && oldMap[m.id]) {
          return oldMap[m.id];
        }
        return m;
      });
      g.standings = calcStandings(g);
    };
    rebuildGroup(fromGroup);
    rebuildGroup(groups[toIdx]);

    await db.collection(TOURNAMENTS).doc(event.id).update({
      data: { groups, updatedAt: Date.now() }
    });
    return { code: 0, data: { fromGroup: fromIdx, toGroup: toIdx } };
  }

  return { code: 1, msg: '未知 action' };
};
