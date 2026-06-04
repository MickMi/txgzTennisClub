// 一键初始化数据库 + 全场景模拟数据
// 用法（在微信开发者工具中调用 init-db 云函数）：
//   {}                       → 仅创建集合
//   { "mock": true }         → 清理旧 mock 并插入完整测试数据（16 用户 / 8 活动 / 12 赛事）
//   { "mock": "reset" }      → 仅清理 mock 数据（保留你的 admin 用户）
//   { "mock": "purge" }      → 【发布前用】删除所有非真实用户（按积分来源自动判断）
//                              + 清理 mock 活动/赛事 + 清理孤儿数据
//   { "mock": "minimal" }    → 极简模式：只保留 mickmi + muskxiang 两人（必须已 onboard），
//                              清掉所有 mock，插 2 活动 + 2 赛事
//
// 数据覆盖（mock=true 模式）：
//   - users:        16 人（含 admin/你 + 15 mock）
//   - activities:   8 个（覆盖未来/今天/过去/closed/满员/不限人数）
//   - tournaments:  12 个（含 4 个双打：T9-T12 覆盖小组中/小组完/淘汰中/已结束）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const COLLECTIONS = ['users', 'activities', 'tournaments'];
const DAY = 86400000;

// ============================================================================
// Helpers
// ============================================================================

// 计算 group standings（与 tournament/index.js 中的 calcStandings 一致）
function computeStandings(playerInfos, matches) {
  const map = {};
  for (const p of playerInfos) {
    map[p.openid] = {
      openid: p.openid, wecomName: p.wecomName,
      played: 0, wins: 0, losses: 0, setsWon: 0, setsLost: 0
    };
  }
  for (const m of matches) {
    if (!m.winner) continue;
    const aId = m.playerA.openid;
    const bId = m.playerB.openid;
    map[aId].played++; map[bId].played++;
    map[aId].setsWon += m.scoreA; map[aId].setsLost += m.scoreB;
    map[bId].setsWon += m.scoreB; map[bId].setsLost += m.scoreA;
    if (m.winner === 'A') { map[aId].wins++; map[bId].losses++; }
    else { map[bId].wins++; map[aId].losses++; }
  }
  return Object.values(map).sort((a, b) =>
    b.wins - a.wins || (b.setsWon - b.setsLost) - (a.setsWon - a.setsLost)
  );
}

// 构建一个 group。results: [{ a:openid, b:openid, scoreA, scoreB }]，未提供则该场未录分
// 双打：playerInfos 里每个对象是 compound player（含 members 数组），buildGroup 会
// 自动保留 members 字段，保证后端 score 流程能对到真实成员。
function buildGroup(name, playerInfos, results = []) {
  const cloneUnit = (p) => {
    const u = { openid: p.openid, wecomName: p.wecomName };
    if (Array.isArray(p.members) && p.members.length > 0) {
      u.members = p.members.map(m => ({ openid: m.openid, wecomName: m.wecomName }));
    }
    return u;
  };
  const players = playerInfos.map(p => ({
    ...cloneUnit(p),
    seed: 0
  }));
  const matches = [];
  for (let i = 0; i < playerInfos.length; i++) {
    for (let j = i + 1; j < playerInfos.length; j++) {
      const a = playerInfos[i];
      const b = playerInfos[j];
      const r = results.find(rs =>
        (rs.a === a.openid && rs.b === b.openid) ||
        (rs.a === b.openid && rs.b === a.openid)
      );
      const m = {
        id: `${a.openid}_${b.openid}`,
        playerA: cloneUnit(a),
        playerB: cloneUnit(b),
        scoreA: null, scoreB: null, winner: null, scoreSummary: ''
      };
      if (r) {
        const sa = r.a === a.openid ? r.scoreA : r.scoreB;
        const sb = r.a === a.openid ? r.scoreB : r.scoreA;
        m.scoreA = sa; m.scoreB = sb;
        m.winner = sa > sb ? 'A' : 'B';
        m.scoreSummary = `${sa}:${sb}`;
        // mock 已录分场次：补 pointsAwarded（双打需要 winnerMembers/loserMembers）
        const winnerUnit = m.winner === 'A' ? m.playerA : m.playerB;
        const loserUnit = m.winner === 'A' ? m.playerB : m.playerA;
        const winnerMembers = (winnerUnit.members || [{ openid: winnerUnit.openid }])
          .map(x => ({ openid: x.openid }));
        const loserMembers = (loserUnit.members || [{ openid: loserUnit.openid }])
          .map(x => ({ openid: x.openid }));
        m.pointsAwarded = {
          winnerOpenid: winnerUnit.openid,
          loserOpenid: loserUnit.openid,
          winnerPts: 5, loserPts: 1,
          winnerEloDelta: 6, loserEloDelta: -6,
          winnerMembers, loserMembers,
          awardedAt: Date.now()
        };
      }
      matches.push(m);
    }
  }
  const standings = computeStandings(playerInfos, matches);
  return { name, players, matches, standings };
}

// 构建 knockout match。score = [a, b] 已录入，null = 未录入
// 双打：a / b 可为 compound player（含 members）
function koMatch(id, a, b, score = null) {
  const cloneUnit = (p) => {
    if (!p) return null;
    const u = { openid: p.openid, wecomName: p.wecomName };
    if (Array.isArray(p.members) && p.members.length > 0) {
      u.members = p.members.map(m => ({ openid: m.openid, wecomName: m.wecomName }));
    }
    return u;
  };
  const m = {
    id,
    playerA: cloneUnit(a),
    playerB: cloneUnit(b),
    scoreA: null, scoreB: null, winner: null, scoreSummary: '',
    bye: !a || !b
  };
  if (m.bye) {
    m.winner = a ? 'A' : 'B';
  } else if (score) {
    m.scoreA = score[0]; m.scoreB = score[1];
    m.winner = score[0] > score[1] ? 'A' : 'B';
    m.scoreSummary = `${score[0]}:${score[1]}`;
    const winnerUnit = m.winner === 'A' ? m.playerA : m.playerB;
    const loserUnit = m.winner === 'A' ? m.playerB : m.playerA;
    const winnerMembers = (winnerUnit.members || [{ openid: winnerUnit.openid }])
      .map(x => ({ openid: x.openid }));
    const loserMembers = (loserUnit.members || [{ openid: loserUnit.openid }])
      .map(x => ({ openid: x.openid }));
    m.pointsAwarded = {
      winnerOpenid: winnerUnit.openid,
      loserOpenid: loserUnit.openid,
      winnerPts: 6, loserPts: 2,
      winnerEloDelta: 8, loserEloDelta: -8,
      winnerMembers, loserMembers,
      awardedAt: Date.now()
    };
  }
  return m;
}

// 双打：把两个真实 player 合成 compound 参赛单位
// 字段格式必须和 cloudfunctions/tournament/index.js makeDoubleTeam 一致
function mkTeam(p1, p2) {
  return {
    openid: `team_${p1.openid}_${p2.openid}`,
    wecomName: `${p1.wecomName} / ${p2.wecomName}`,
    members: [
      { openid: p1.openid, wecomName: p1.wecomName },
      { openid: p2.openid, wecomName: p2.wecomName }
    ],
    totalPoints: 0,
    rating: '',
    seed: 0
  };
}

// 批量删除某集合中匹配条件的记录（云开发限制单次最多 20 条）
async function bulkDelete(coll, where) {
  let total = 0;
  while (true) {
    const r = await db.collection(coll).where(where).limit(20).get();
    if (!r.data || r.data.length === 0) break;
    await Promise.all(r.data.map(d => db.collection(coll).doc(d._id).remove()));
    total += r.data.length;
    if (r.data.length < 20) break;
  }
  return total;
}

// ============================================================================
// Mock data definitions
// ============================================================================

// 16 个用户：你 + 15 mock。openid 用 u01-u15 便于辨识。
function defineUsers(adminOpenid, now) {
  const mkHistory = (eloEnd, days) => {
    // 简单模拟：起点 1500 → 终点 eloEnd，days 天前开始，5-9 个数据点
    const start = now - days * DAY;
    const points = [
      { date: start, value: 1500, tournamentId: '' }
    ];
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      const ratio = i / steps;
      const v = Math.round(1500 + (eloEnd - 1500) * ratio + (Math.sin(i * 1.7) * 8));
      points.push({ date: start + Math.floor(days * DAY * ratio), value: v, tournamentId: 't_mock_' + i });
    }
    return points;
  };

  const mkEarnings = (entries) => entries.map(([id, title, earned, daysAgo]) => ({
    tournamentId: id, title, earned, date: now - daysAgo * DAY
  }));

  const list = [
    // admin = 你（在调用时被替换为真实 openid）
    {
      openid: adminOpenid, wecomName: '管理员', gender: 'male', rating: '3.5',
      role: 'admin',
      eloRating: 1580,
      totalPoints: 195,
      eloHistory: mkHistory(1580, 60),
      tournamentEarnings: mkEarnings([
        ['t_mock_1', '3月友谊赛', 38, 60],
        ['t_mock_2', '3月月赛', 52, 45],
        ['t_mock_3', '4月月赛', 75, 30],
        ['t_mock_4', '4月双打', 30, 22]
      ])
    },
    // 高分老手
    { openid: 'u01', wecomName: '张伟', gender: 'male', rating: '4.5', eloRating: 1685, totalPoints: 320,
      eloHistory: mkHistory(1685, 75),
      tournamentEarnings: mkEarnings([['t_mock_1','3月友谊赛',58,60],['t_mock_2','3月月赛',95,45],['t_mock_3','4月月赛',112,30],['t_mock_5','4月半年赛',55,25]]) },
    { openid: 'u02', wecomName: '陈明', gender: 'male', rating: '4.5', eloRating: 1660, totalPoints: 295,
      eloHistory: mkHistory(1660, 70),
      tournamentEarnings: mkEarnings([['t_mock_1','3月友谊赛',45,60],['t_mock_2','3月月赛',82,45],['t_mock_3','4月月赛',98,30],['t_mock_5','4月半年赛',70,25]]) },
    { openid: 'u03', wecomName: '王强', gender: 'male', rating: '4.0', eloRating: 1610, totalPoints: 215,
      eloHistory: mkHistory(1610, 60),
      tournamentEarnings: mkEarnings([['t_mock_1','3月友谊赛',32,60],['t_mock_2','3月月赛',60,45],['t_mock_3','4月月赛',85,30],['t_mock_4','4月双打',38,22]]) },
    { openid: 'u04', wecomName: '李娜', gender: 'female', rating: '4.0', eloRating: 1595, totalPoints: 188,
      eloHistory: mkHistory(1595, 55),
      tournamentEarnings: mkEarnings([['t_mock_1','3月友谊赛',28,60],['t_mock_2','3月月赛',55,45],['t_mock_3','4月月赛',75,30],['t_mock_4','4月双打',30,22]]) },
    { openid: 'u05', wecomName: '周杰', gender: 'male', rating: '3.5', eloRating: 1555, totalPoints: 152,
      eloHistory: mkHistory(1555, 50),
      tournamentEarnings: mkEarnings([['t_mock_2','3月月赛',45,45],['t_mock_3','4月月赛',62,30],['t_mock_4','4月双打',45,22]]) },
    { openid: 'u06', wecomName: '刘洋', gender: 'male', rating: '3.5', eloRating: 1540, totalPoints: 140,
      eloHistory: mkHistory(1540, 50),
      tournamentEarnings: mkEarnings([['t_mock_2','3月月赛',38,45],['t_mock_3','4月月赛',58,30],['t_mock_4','4月双打',44,22]]) },
    { openid: 'u07', wecomName: '赵敏', gender: 'female', rating: '3.5', eloRating: 1520, totalPoints: 122,
      eloHistory: mkHistory(1520, 45),
      tournamentEarnings: mkEarnings([['t_mock_2','3月月赛',32,45],['t_mock_3','4月月赛',50,30],['t_mock_4','4月双打',40,22]]) },
    { openid: 'u08', wecomName: '林芳', gender: 'female', rating: '3.0', eloRating: 1485, totalPoints: 95,
      eloHistory: mkHistory(1485, 40),
      tournamentEarnings: mkEarnings([['t_mock_2','3月月赛',25,45],['t_mock_3','4月月赛',42,30],['t_mock_4','4月双打',28,22]]) },
    { openid: 'u09', wecomName: '吴勇', gender: 'male', rating: '3.0', eloRating: 1465, totalPoints: 88,
      eloHistory: mkHistory(1465, 40),
      tournamentEarnings: mkEarnings([['t_mock_2','3月月赛',22,45],['t_mock_3','4月月赛',38,30],['t_mock_4','4月双打',28,22]]) },
    { openid: 'u10', wecomName: '黄磊', gender: 'male', rating: '3.0', eloRating: 1450, totalPoints: 75,
      eloHistory: mkHistory(1450, 35),
      tournamentEarnings: mkEarnings([['t_mock_3','4月月赛',35,30],['t_mock_4','4月双打',40,22]]) },
    { openid: 'u11', wecomName: '孙丽', gender: 'female', rating: '2.5', eloRating: 1420, totalPoints: 58,
      eloHistory: mkHistory(1420, 30),
      tournamentEarnings: mkEarnings([['t_mock_3','4月月赛',28,30],['t_mock_4','4月双打',30,22]]) },
    { openid: 'u12', wecomName: '马涛', gender: 'male', rating: '2.5', eloRating: 1400, totalPoints: 45,
      eloHistory: mkHistory(1400, 25),
      tournamentEarnings: mkEarnings([['t_mock_3','4月月赛',25,30],['t_mock_4','4月双打',20,22]]) },
    // 新手 / 低分
    { openid: 'u13', wecomName: '高燕', gender: 'female', rating: '2.0', eloRating: 1370, totalPoints: 22,
      eloHistory: mkHistory(1370, 20),
      tournamentEarnings: mkEarnings([['t_mock_4','4月双打',22,22]]) },
    { openid: 'u14', wecomName: '杨帆', gender: 'male', rating: '2.0', eloRating: 1350, totalPoints: 15,
      eloHistory: mkHistory(1350, 15),
      tournamentEarnings: mkEarnings([['t_mock_4','4月双打',15,22]]) },
    // 完全的新人，没参加过比赛（用于测试空状态）
    { openid: 'u15', wecomName: '何欣', gender: 'female', rating: '', eloRating: 1500, totalPoints: 0,
      eloHistory: [{ date: now, value: 1500, tournamentId: '' }],
      tournamentEarnings: [] }
  ];
  return list.map(u => ({
    openid: u.openid,
    wecomName: u.wecomName,
    gender: u.gender,
    rating: u.rating,
    totalPoints: u.totalPoints,
    eloRating: u.eloRating,
    eloHistory: u.eloHistory,
    tournamentEarnings: u.tournamentEarnings,
    role: u.role || 'member',
    createdAt: now - 80 * DAY,
    updatedAt: now
  }));
}

// ============================================================================
// Activities — 8 个，覆盖各种场景
// ============================================================================
function defineActivities(adminOpenid, now) {
  const mkParticipant = (openid, wecomName, daysAgo = 1) => ({
    openid, wecomName, joinedAt: now - daysAgo * DAY
  });
  return [
    {
      title: '【报名中-未满】周日午后约球',
      startTime: now + 3 * DAY,
      location: '广州天河体育中心 3 号场',
      maxPeople: 8,
      note: '欢迎中级以上水平。带球带水。',
      creator: adminOpenid, creatorName: '管理员',
      participants: [
        mkParticipant(adminOpenid, '管理员', 2),
        mkParticipant('u01', '张伟', 2),
        mkParticipant('u03', '王强', 1),
        mkParticipant('u05', '周杰', 1),
        mkParticipant('u07', '赵敏', 0),
        mkParticipant('u08', '林芳', 0)
      ],
      status: 'open'
    },
    {
      title: '【报名中-我未加入】周三晚约球',
      startTime: now + 1 * DAY + 19 * 3600 * 1000,
      location: '广州大学城网球场',
      maxPeople: 8,
      note: '工作日晚场，3.0 以上',
      creator: 'u02', creatorName: '陈明',
      participants: [
        mkParticipant('u02', '陈明', 1),
        mkParticipant('u04', '李娜', 0),
        mkParticipant('u06', '刘洋', 0)
      ],
      status: 'open'
    },
    {
      title: '【差1人满员】周末男女混双',
      startTime: now + 5 * DAY,
      location: '越秀公园网球俱乐部',
      maxPeople: 8,
      note: '需要 2.5+ 双打基础',
      creator: 'u01', creatorName: '张伟',
      participants: [
        mkParticipant('u01', '张伟', 3),
        mkParticipant('u02', '陈明', 3),
        mkParticipant('u04', '李娜', 2),
        mkParticipant('u07', '赵敏', 2),
        mkParticipant('u08', '林芳', 1),
        mkParticipant('u11', '孙丽', 1),
        mkParticipant('u13', '高燕', 0)
      ],
      status: 'open'
    },
    {
      title: '【不限人数】工作日清晨刷球',
      startTime: now + 2 * DAY + 7 * 3600 * 1000,
      location: '珠江公园网球场',
      maxPeople: 0,
      note: '不限人数，自由组队对打',
      creator: 'u03', creatorName: '王强',
      participants: [
        mkParticipant('u03', '王强', 1),
        mkParticipant('u05', '周杰', 1),
        mkParticipant('u06', '刘洋', 0),
        mkParticipant('u09', '吴勇', 0),
        mkParticipant('u10', '黄磊', 0)
      ],
      status: 'open'
    },
    {
      title: '【已满员】周六训练课（教练班）',
      startTime: now + 4 * DAY,
      location: '广州体院网球馆',
      maxPeople: 6,
      note: 'NTRP 3.0+，提供教练。报名截止前 1 天可退',
      creator: adminOpenid, creatorName: '管理员',
      participants: [
        mkParticipant(adminOpenid, '管理员', 4),
        mkParticipant('u01', '张伟', 3),
        mkParticipant('u02', '陈明', 3),
        mkParticipant('u05', '周杰', 2),
        mkParticipant('u07', '赵敏', 2),
        mkParticipant('u08', '林芳', 1)
      ],
      status: 'open'
    },
    {
      title: '【今天】今晚 7 点临时约球',
      startTime: now + 6 * 3600 * 1000,
      location: '天河体育中心 5 号场',
      maxPeople: 4,
      note: '临时局，先到先得',
      creator: 'u04', creatorName: '李娜',
      participants: [
        mkParticipant('u04', '李娜', 0),
        mkParticipant('u07', '赵敏', 0)
      ],
      status: 'open'
    },
    {
      title: '【已结束】上周日活动',
      startTime: now - 5 * DAY,
      location: '海珠湖网球场',
      maxPeople: 8,
      note: '已结束的历史活动',
      creator: adminOpenid, creatorName: '管理员',
      participants: [
        mkParticipant(adminOpenid, '管理员', 7),
        mkParticipant('u01', '张伟', 7),
        mkParticipant('u03', '王强', 7),
        mkParticipant('u05', '周杰', 7),
        mkParticipant('u07', '赵敏', 7),
        mkParticipant('u09', '吴勇', 7)
      ],
      status: 'closed'
    },
    {
      title: '【过期未关闭】上周二（边界用例）',
      startTime: now - 9 * DAY,
      location: '黄埔体育中心',
      maxPeople: 6,
      note: '时间已过但状态仍是 open，前端应识别',
      creator: 'u02', creatorName: '陈明',
      participants: [
        mkParticipant('u02', '陈明', 11),
        mkParticipant('u04', '李娜', 11)
      ],
      status: 'open'
    }
  ].map(a => ({
    ...a,
    createdAt: a.startTime - 7 * DAY,
    updatedAt: now
  }));
}

// ============================================================================
// Tournaments — 8 个，覆盖所有 status × 多种 config
// ============================================================================
function defineTournaments(adminOpenid, now, userMap) {
  // 把 userMap 里的关键字段提取为 player 信息
  const u = (openid) => {
    const x = userMap[openid];
    return x ? { openid: x.openid, wecomName: x.wecomName } : null;
  };
  const mkSignupPlayer = (openid, daysAgo = 2) => {
    const x = userMap[openid];
    return {
      openid: x.openid, wecomName: x.wecomName,
      gender: x.gender || '', rating: x.rating || '',
      totalPoints: x.totalPoints || 0,
      signupAt: now - daysAgo * DAY
    };
  };

  const tournaments = [];

  // ==== T1: 报名中（0 人）— 测试空报名 + 你自己加入 ====
  tournaments.push({
    title: 'T1 周赛 · 报名中（0 人）',
    type: 'singles', bestOf: 6, level: 'friendly',
    handicapRule: '',
    matchDate: now + 7 * DAY,
    status: 'signup',
    players: [],
    groups: [], knockout: null,
    config: { groupCount: 2, advanceCount: 2, seedCount: 0 },
    creator: adminOpenid, creatorName: '管理员',
    createdAt: now - 1 * DAY, updatedAt: now - 1 * DAY
  });

  // ==== T2: 报名中（3 人）— 不够分两组的边界 ====
  tournaments.push({
    title: 'T2 周赛 · 报名中（3 人，不够分组）',
    type: 'singles', bestOf: 6, level: 'friendly',
    handicapRule: '',
    matchDate: now + 5 * DAY,
    status: 'signup',
    players: [
      mkSignupPlayer(adminOpenid, 2),
      mkSignupPlayer('u05', 1),
      mkSignupPlayer('u08', 0)
    ],
    groups: [], knockout: null,
    config: { groupCount: 2, advanceCount: 2, seedCount: 0 },
    creator: adminOpenid, creatorName: '管理员',
    createdAt: now - 2 * DAY, updatedAt: now
  });

  // ==== T3: 双打报名中（6 人）====
  tournaments.push({
    title: 'T3 双打周赛 · 报名中（6 人）',
    type: 'doubles', bestOf: 4, level: 'friendly',
    handicapRule: '混双每盘男让 1 局',
    matchDate: now + 6 * DAY,
    status: 'signup',
    players: [
      mkSignupPlayer('u01', 3), mkSignupPlayer('u02', 3),
      mkSignupPlayer('u04', 2), mkSignupPlayer('u07', 2),
      mkSignupPlayer('u08', 1), mkSignupPlayer('u11', 0)
    ],
    groups: [], knockout: null,
    config: { groupCount: 2, advanceCount: 2, seedCount: 2 },
    creator: 'u01', creatorName: '张伟',
    createdAt: now - 3 * DAY, updatedAt: now
  });

  // ==== T4: 半年赛报名中（8 人足够） ====
  tournaments.push({
    title: 'T4 半年赛 · 报名中（8 人，含让分）',
    type: 'singles', bestOf: 6, level: 'major',
    handicapRule: '种子选手让非种子每盘 1 局',
    matchDate: now + 10 * DAY,
    status: 'signup',
    players: [
      mkSignupPlayer(adminOpenid, 4),
      mkSignupPlayer('u01', 4), mkSignupPlayer('u02', 3),
      mkSignupPlayer('u03', 3), mkSignupPlayer('u04', 2),
      mkSignupPlayer('u05', 2), mkSignupPlayer('u06', 1),
      mkSignupPlayer('u07', 0)
    ],
    groups: [], knockout: null,
    config: { groupCount: 2, advanceCount: 2, seedCount: 2 },
    creator: adminOpenid, creatorName: '管理员',
    createdAt: now - 5 * DAY, updatedAt: now
  });

  // ==== T5: 小组赛进行中（A 组完成，B 组进行中）====
  // 4 人分两组，每组 2 人，比赛少
  // 但 2 人分组没意思，改 6 人分两组每组 3 人
  {
    const groupA = buildGroup('A',
      [u(adminOpenid), u('u02'), u('u08')],
      [
        { a: adminOpenid, b: 'u02', scoreA: 6, scoreB: 4 },
        { a: adminOpenid, b: 'u08', scoreA: 6, scoreB: 1 },
        { a: 'u02',       b: 'u08', scoreA: 6, scoreB: 3 }
      ]
    );
    const groupB = buildGroup('B',
      [u('u01'), u('u04'), u('u05')],
      [
        { a: 'u01', b: 'u04', scoreA: 7, scoreB: 5 }
        // u01 vs u05、u04 vs u05 未录入
      ]
    );
    tournaments.push({
      title: 'T5 月赛 · 小组赛进行中（A 完 B 中）',
      type: 'singles', bestOf: 6, level: 'challenge',
      handicapRule: '',
      matchDate: now - 1 * DAY,
      status: 'group',
      players: [
        mkSignupPlayer(adminOpenid, 8),
        mkSignupPlayer('u01', 8), mkSignupPlayer('u02', 7),
        mkSignupPlayer('u04', 7), mkSignupPlayer('u05', 6),
        mkSignupPlayer('u08', 6)
      ],
      groups: [groupA, groupB], knockout: null,
      config: { groupCount: 2, advanceCount: 2, seedCount: 0 },
      creator: adminOpenid, creatorName: '管理员',
      createdAt: now - 8 * DAY, updatedAt: now - 1 * DAY
    });
  }

  // ==== T6: 小组赛全部完成（待开启淘汰赛）====
  {
    const players = [u('u01'), u('u02'), u('u03'), u('u04'), u('u05'), u('u06'), u('u07'), u('u08')];
    const gA = buildGroup('A',
      [players[0], players[3], players[5], players[7]], // u01, u04, u06, u08
      [
        { a: 'u01', b: 'u04', scoreA: 6, scoreB: 3 },
        { a: 'u01', b: 'u06', scoreA: 6, scoreB: 2 },
        { a: 'u01', b: 'u08', scoreA: 6, scoreB: 0 },
        { a: 'u04', b: 'u06', scoreA: 6, scoreB: 4 },
        { a: 'u04', b: 'u08', scoreA: 6, scoreB: 1 },
        { a: 'u06', b: 'u08', scoreA: 7, scoreB: 5 }
      ]
    );
    const gB = buildGroup('B',
      [players[1], players[2], players[4], players[6]], // u02, u03, u05, u07
      [
        { a: 'u02', b: 'u03', scoreA: 6, scoreB: 4 },
        { a: 'u02', b: 'u05', scoreA: 6, scoreB: 2 },
        { a: 'u02', b: 'u07', scoreA: 7, scoreB: 6 },
        { a: 'u03', b: 'u05', scoreA: 7, scoreB: 5 },
        { a: 'u03', b: 'u07', scoreA: 6, scoreB: 4 },
        { a: 'u05', b: 'u07', scoreA: 6, scoreB: 3 }
      ]
    );
    tournaments.push({
      title: 'T6 月赛 · 小组赛全部完成（待开淘汰）',
      type: 'singles', bestOf: 6, level: 'challenge',
      handicapRule: '',
      matchDate: now - 3 * DAY,
      status: 'group',
      players: [
        mkSignupPlayer('u01', 12), mkSignupPlayer('u02', 12),
        mkSignupPlayer('u03', 11), mkSignupPlayer('u04', 11),
        mkSignupPlayer('u05', 10), mkSignupPlayer('u06', 10),
        mkSignupPlayer('u07', 9),  mkSignupPlayer('u08', 9)
      ],
      groups: [gA, gB], knockout: null,
      config: { groupCount: 2, advanceCount: 2, seedCount: 0 },
      creator: 'u01', creatorName: '张伟',
      createdAt: now - 14 * DAY, updatedAt: now - 3 * DAY
    });
  }

  // ==== T7: 淘汰赛进行中（半决赛部分录分，决赛未开始）====
  {
    const players = [u(adminOpenid), u('u01'), u('u02'), u('u03'), u('u04'), u('u05'), u('u06'), u('u07')];
    const gA = buildGroup('A',
      [players[0], players[2], players[4], players[6]], // admin, u02, u04, u06
      [
        { a: adminOpenid, b: 'u02', scoreA: 6, scoreB: 3 },
        { a: adminOpenid, b: 'u04', scoreA: 6, scoreB: 2 },
        { a: adminOpenid, b: 'u06', scoreA: 6, scoreB: 4 },
        { a: 'u02', b: 'u04', scoreA: 6, scoreB: 4 },
        { a: 'u02', b: 'u06', scoreA: 6, scoreB: 3 },
        { a: 'u04', b: 'u06', scoreA: 7, scoreB: 5 }
      ]
    );
    const gB = buildGroup('B',
      [players[1], players[3], players[5], players[7]], // u01, u03, u05, u07
      [
        { a: 'u01', b: 'u03', scoreA: 6, scoreB: 4 },
        { a: 'u01', b: 'u05', scoreA: 6, scoreB: 2 },
        { a: 'u01', b: 'u07', scoreA: 6, scoreB: 1 },
        { a: 'u03', b: 'u05', scoreA: 7, scoreB: 5 },
        { a: 'u03', b: 'u07', scoreA: 6, scoreB: 3 },
        { a: 'u05', b: 'u07', scoreA: 6, scoreB: 4 }
      ]
    );
    // 8 人淘汰赛 = 四分之一决赛 + 半决赛 + 决赛 (3 轮)
    // 4 进 8：A1 vs B2、B1 vs A2（每组前 2 名晋级，A 组前 2 = admin/u02，B 组前 2 = u01/u03）
    // 但 8 人正好是 1 轮淘汰（4 强）= 半决赛 + 决赛 (2 轮)
    // 实际：advanceCount=2 → 每组前 2 名 = 4 人 → 半决赛 + 决赛
    const adminP = u(adminOpenid), u02P = u('u02'), u01P = u('u01'), u03P = u('u03');
    const semi1 = koMatch('ko_r1_0', adminP, u03P, [6, 3]); // admin 已胜
    const semi2 = koMatch('ko_r1_1', u01P, u02P);            // 未录分
    // 决赛 playerA 已是半决1胜者（admin），playerB 待半决2出结果，此时未开始
    const finalMatch = {
      id: 'ko_r2_0',
      playerA: adminP,
      playerB: null,
      scoreA: null, scoreB: null,
      winner: null, scoreSummary: '', bye: false
    };
    tournaments.push({
      title: 'T7 月赛 · 淘汰赛进行中（半决赛中）',
      type: 'singles', bestOf: 6, level: 'challenge',
      handicapRule: '',
      matchDate: now - 5 * DAY,
      status: 'knockout',
      players: [
        mkSignupPlayer(adminOpenid, 18),
        mkSignupPlayer('u01', 18), mkSignupPlayer('u02', 17),
        mkSignupPlayer('u03', 17), mkSignupPlayer('u04', 16),
        mkSignupPlayer('u05', 16), mkSignupPlayer('u06', 15),
        mkSignupPlayer('u07', 15)
      ],
      groups: [gA, gB],
      knockout: {
        rounds: [
          { name: '半决赛', matches: [semi1, semi2] },
          { name: '决赛',   matches: [finalMatch] }
        ]
      },
      config: { groupCount: 2, advanceCount: 2, seedCount: 0 },
      creator: adminOpenid, creatorName: '管理员',
      createdAt: now - 21 * DAY, updatedAt: now - 1 * DAY
    });
  }

  // ==== T8: 已结束（完整赛事 + placementAwards）====
  {
    const players = [u('u01'), u('u02'), u('u03'), u('u04'), u('u05'), u('u06'), u('u07'), u('u08')];
    const gA = buildGroup('A',
      [players[0], players[2], players[4], players[6]],
      [
        { a: 'u01', b: 'u03', scoreA: 6, scoreB: 2 },
        { a: 'u01', b: 'u05', scoreA: 6, scoreB: 4 },
        { a: 'u01', b: 'u07', scoreA: 6, scoreB: 1 },
        { a: 'u03', b: 'u05', scoreA: 7, scoreB: 5 },
        { a: 'u03', b: 'u07', scoreA: 6, scoreB: 3 },
        { a: 'u05', b: 'u07', scoreA: 6, scoreB: 4 }
      ]
    );
    const gB = buildGroup('B',
      [players[1], players[3], players[5], players[7]],
      [
        { a: 'u02', b: 'u04', scoreA: 6, scoreB: 4 },
        { a: 'u02', b: 'u06', scoreA: 6, scoreB: 2 },
        { a: 'u02', b: 'u08', scoreA: 6, scoreB: 1 },
        { a: 'u04', b: 'u06', scoreA: 7, scoreB: 5 },
        { a: 'u04', b: 'u08', scoreA: 6, scoreB: 3 },
        { a: 'u06', b: 'u08', scoreA: 6, scoreB: 4 }
      ]
    );
    const u01P = u('u01'), u02P = u('u02'), u03P = u('u03'), u04P = u('u04');
    const semi1 = koMatch('ko_r1_0', u01P, u04P, [6, 4]);  // u01 胜
    const semi2 = koMatch('ko_r1_1', u02P, u03P, [7, 6]);  // u02 胜（抢七）
    const finalM = koMatch('ko_r2_0', u01P, u02P, [4, 6]); // u02 夺冠
    tournaments.push({
      title: 'T8 半年赛 · 已结束（含 placementAwards）',
      type: 'singles', bestOf: 6, level: 'major',
      handicapRule: '',
      matchDate: now - 25 * DAY,
      status: 'finished',
      players: [
        mkSignupPlayer('u01', 32), mkSignupPlayer('u02', 32),
        mkSignupPlayer('u03', 31), mkSignupPlayer('u04', 31),
        mkSignupPlayer('u05', 30), mkSignupPlayer('u06', 30),
        mkSignupPlayer('u07', 29), mkSignupPlayer('u08', 29)
      ],
      groups: [gA, gB],
      knockout: {
        rounds: [
          { name: '半决赛', matches: [semi1, semi2] },
          { name: '决赛',   matches: [finalM] }
        ]
      },
      placementAwards: [
        { openid: 'u02', place: '冠军', placement: 1, pts: 200, points: 200, teamId: null },
        { openid: 'u01', place: '亚军', placement: 2, pts: 120, points: 120, teamId: null },
        { openid: 'u04', place: '四强', placement: 3, pts: 60,  points: 60,  teamId: null },
        { openid: 'u03', place: '四强', placement: 3, pts: 60,  points: 60,  teamId: null },
        { openid: 'u05', place: '参与', placement: 99, pts: 15, points: 15, teamId: null },
        { openid: 'u06', place: '参与', placement: 99, pts: 15, points: 15, teamId: null },
        { openid: 'u07', place: '参与', placement: 99, pts: 15, points: 15, teamId: null },
        { openid: 'u08', place: '参与', placement: 99, pts: 15, points: 15, teamId: null }
      ],
      config: { groupCount: 2, advanceCount: 2, seedCount: 2 },
      creator: 'u01', creatorName: '张伟',
      createdAt: now - 35 * DAY, updatedAt: now - 25 * DAY
    });
  }

  // ============================================================================
  // 双打专项（T9-T12）覆盖双打四个状态：抽签后小组中 / 小组完 / 淘汰中 / 已结束
  // 全部用 8 人 → 4 队 → 1 组 round-robin（6 场） → advanceCount=2 → 决赛 1 场
  // 这是双打最小可演示规模；想要更复杂的（半决赛）等做成 12 人 6 队 2 组场景
  // ============================================================================

  // 标准 4 队（用 admin + u01-u07，每两人一队）
  const buildDoublesTeams = () => {
    const p = (oid) => userMap[oid];
    return [
      mkTeam(p(adminOpenid), p('u02')),  // T1
      mkTeam(p('u01'),       p('u04')),  // T2
      mkTeam(p('u03'),       p('u05')),  // T3
      mkTeam(p('u06'),       p('u07'))   // T4
    ];
  };
  // 8 人报名记录（顺序与 mkTeam 保持一致）
  const doublesSignupPlayers = (daysOffset = 5) => [
    mkSignupPlayer(adminOpenid, daysOffset),
    mkSignupPlayer('u02', daysOffset),
    mkSignupPlayer('u01', daysOffset),
    mkSignupPlayer('u04', daysOffset),
    mkSignupPlayer('u03', daysOffset - 1),
    mkSignupPlayer('u05', daysOffset - 1),
    mkSignupPlayer('u06', daysOffset - 2),
    mkSignupPlayer('u07', daysOffset - 2)
  ];

  // ==== T9: 双打小组赛进行中（6 场录了 3 场） ====
  {
    const teams = buildDoublesTeams();
    const [t1, t2, t3, t4] = teams;
    const groupA = buildGroup('A', teams, [
      { a: t1.openid, b: t2.openid, scoreA: 4, scoreB: 2 },
      { a: t1.openid, b: t3.openid, scoreA: 4, scoreB: 1 },
      { a: t2.openid, b: t3.openid, scoreA: 4, scoreB: 3 }
      // t1 vs t4、t2 vs t4、t3 vs t4 均未录入
    ]);
    tournaments.push({
      title: 'T9 双打月赛 · 小组赛进行中（6 场录 3 场）',
      type: 'doubles', bestOf: 4, level: 'challenge',
      handicapRule: '',
      matchDate: now - 1 * DAY,
      status: 'group',
      players: doublesSignupPlayers(8),
      teams,
      groups: [groupA], knockout: null,
      config: { groupCount: 1, advanceCount: 2, seedCount: 0 },
      creator: adminOpenid, creatorName: '管理员',
      createdAt: now - 9 * DAY, updatedAt: now - 1 * DAY
    });
  }

  // ==== T10: 双打小组赛全部完成（待开淘汰赛） ====
  {
    const teams = buildDoublesTeams();
    const [t1, t2, t3, t4] = teams;
    const groupA = buildGroup('A', teams, [
      { a: t1.openid, b: t2.openid, scoreA: 4, scoreB: 2 },
      { a: t1.openid, b: t3.openid, scoreA: 4, scoreB: 1 },
      { a: t1.openid, b: t4.openid, scoreA: 4, scoreB: 0 },
      { a: t2.openid, b: t3.openid, scoreA: 4, scoreB: 3 },
      { a: t2.openid, b: t4.openid, scoreA: 4, scoreB: 2 },
      { a: t3.openid, b: t4.openid, scoreA: 4, scoreB: 3 }
    ]);
    // T1 全胜（3-0），T2 (2-1)，T3 (1-2)，T4 (0-3) → 前 2 出线：T1, T2
    tournaments.push({
      title: 'T10 双打月赛 · 小组赛全部完成（待开淘汰）',
      type: 'doubles', bestOf: 4, level: 'challenge',
      handicapRule: '',
      matchDate: now - 3 * DAY,
      status: 'group',
      players: doublesSignupPlayers(12),
      teams,
      groups: [groupA], knockout: null,
      config: { groupCount: 1, advanceCount: 2, seedCount: 0 },
      creator: adminOpenid, creatorName: '管理员',
      createdAt: now - 14 * DAY, updatedAt: now - 3 * DAY
    });
  }

  // ==== T11: 双打淘汰赛进行中（决赛未录入） ====
  {
    const teams = buildDoublesTeams();
    const [t1, t2, t3, t4] = teams;
    const groupA = buildGroup('A', teams, [
      { a: t1.openid, b: t2.openid, scoreA: 4, scoreB: 1 },
      { a: t1.openid, b: t3.openid, scoreA: 4, scoreB: 2 },
      { a: t1.openid, b: t4.openid, scoreA: 4, scoreB: 0 },
      { a: t2.openid, b: t3.openid, scoreA: 5, scoreB: 4 },
      { a: t2.openid, b: t4.openid, scoreA: 4, scoreB: 1 },
      { a: t3.openid, b: t4.openid, scoreA: 4, scoreB: 2 }
    ]);
    // 前 2 = T1, T2 进决赛；决赛未录入
    const finalUnplayed = koMatch('ko_r1_0', t1, t2, null);
    tournaments.push({
      title: 'T11 双打月赛 · 淘汰赛进行中（决赛未录入）',
      type: 'doubles', bestOf: 4, level: 'challenge',
      handicapRule: '',
      matchDate: now - 5 * DAY,
      status: 'knockout',
      players: doublesSignupPlayers(18),
      teams,
      groups: [groupA],
      knockout: {
        rounds: [
          { name: '决赛', matches: [finalUnplayed] }
        ]
      },
      config: { groupCount: 1, advanceCount: 2, seedCount: 0 },
      creator: adminOpenid, creatorName: '管理员',
      createdAt: now - 21 * DAY, updatedAt: now - 2 * DAY
    });
  }

  // ==== T12: 双打已结束（含 placementAwards，按 team 展开成员条目） ====
  {
    const teams = buildDoublesTeams();
    const [t1, t2, t3, t4] = teams;
    const groupA = buildGroup('A', teams, [
      { a: t1.openid, b: t2.openid, scoreA: 4, scoreB: 1 },
      { a: t1.openid, b: t3.openid, scoreA: 4, scoreB: 2 },
      { a: t1.openid, b: t4.openid, scoreA: 4, scoreB: 0 },
      { a: t2.openid, b: t3.openid, scoreA: 4, scoreB: 3 },
      { a: t2.openid, b: t4.openid, scoreA: 4, scoreB: 1 },
      { a: t3.openid, b: t4.openid, scoreA: 5, scoreB: 4 }
    ]);
    // 前 2 = T1, T2 进决赛 → T2 反扑赢 T1 拿冠军
    const finalM = koMatch('ko_r1_0', t1, t2, [3, 5]);  // T2 (u01+u04) 夺冠
    // placementAwards：T2 两人都是冠军、T1 两人都是亚军、T3+T4 两人都是参与
    const championPts = 100; // challenge 级别
    const runnerUpPts = 60;
    const participantPts = 8;
    const teamIdT1 = t1.openid;
    const teamIdT2 = t2.openid;
    tournaments.push({
      title: 'T12 双打月赛 · 已结束（双打 placementAwards）',
      type: 'doubles', bestOf: 4, level: 'challenge',
      handicapRule: '',
      matchDate: now - 28 * DAY,
      status: 'finished',
      players: doublesSignupPlayers(35),
      teams,
      groups: [groupA],
      knockout: {
        rounds: [
          { name: '决赛', matches: [finalM] }
        ]
      },
      placementAwards: [
        // 冠军：team t2 (u01 + u04)
        { openid: 'u01', wecomName: '张伟', place: '冠军', placement: 1, pts: championPts, points: championPts, teamId: teamIdT2 },
        { openid: 'u04', wecomName: '李娜', place: '冠军', placement: 1, pts: championPts, points: championPts, teamId: teamIdT2 },
        // 亚军：team t1 (admin + u02)
        { openid: adminOpenid, wecomName: '管理员', place: '亚军', placement: 2, pts: runnerUpPts, points: runnerUpPts, teamId: teamIdT1 },
        { openid: 'u02', wecomName: '陈明', place: '亚军', placement: 2, pts: runnerUpPts, points: runnerUpPts, teamId: teamIdT1 },
        // 参与：t3 + t4
        { openid: 'u03', wecomName: '王强', place: '参与', placement: 99, pts: participantPts, points: participantPts, teamId: null },
        { openid: 'u05', wecomName: '周杰', place: '参与', placement: 99, pts: participantPts, points: participantPts, teamId: null },
        { openid: 'u06', wecomName: '刘洋', place: '参与', placement: 99, pts: participantPts, points: participantPts, teamId: null },
        { openid: 'u07', wecomName: '赵敏', place: '参与', placement: 99, pts: participantPts, points: participantPts, teamId: null }
      ],
      config: { groupCount: 1, advanceCount: 2, seedCount: 0 },
      creator: 'u01', creatorName: '张伟',
      createdAt: now - 40 * DAY, updatedAt: now - 28 * DAY
    });
  }

  return tournaments;
}

// ============================================================================
// Main
// ============================================================================
exports.main = async (event = {}) => {
  const wxCtx = cloud.getWXContext();
  const adminOpenid = wxCtx.OPENID || event.openid || 'mock_admin_openid';
  const now = Date.now();
  const results = [];

  // 1. 创建集合（已存在不报错）
  for (const name of COLLECTIONS) {
    try {
      await db.createCollection(name);
      results.push(`collection ${name}: 创建成功`);
    } catch (e) {
      if (e.errCode === -501001) results.push(`collection ${name}: 已存在`);
      else results.push(`collection ${name}: 失败 - ${e.errMsg || e.message}`);
    }
  }

  // 2. 仅 reset：清理 mock 数据并退出
  if (event.mock === 'reset') {
    const delU = await bulkDelete('users', { openid: _.in(['u01','u02','u03','u04','u05','u06','u07','u08','u09','u10','u11','u12','u13','u14','u15']) });
    const delA = await bulkDelete('activities', { mockTag: true });
    const delT = await bulkDelete('tournaments', { mockTag: true });
    results.push(`reset: 删除 ${delU} 用户 / ${delA} 活动 / ${delT} 赛事`);
    return { code: 0, data: results };
  }

  // 2.1 purge 模式：删除所有非真实用户（按积分来源自动判断）
  //   逻辑：
  //   - openid 为 u01-u15 → 直接删（mock openid）
  //   - tournamentEarnings 引用的赛事全部不存在于 DB → 积分全是幽灵数据，假用户，删
  //   - 有真实存在的赛事积分 → 保留，清除幽灵积分条目、重算 totalPoints
  //   - 零积分零参赛 → 保留（可能是刚注册的真实成员）
  //   同时清理所有 mockTag 的活动/赛事 + 孤儿数据
  //   用法：cloud.callFunction({ name: 'init-db', data: { mock: 'purge' } })
  if (event.mock === 'purge') {
    // Step 1: 删除 mock openid 用户
    const delMockId = await bulkDelete('users', {
      openid: _.in(['u01','u02','u03','u04','u05','u06','u07','u08','u09','u10','u11','u12','u13','u14','u15'])
    });
    results.push(`删除 mock openid 用户: ${delMockId}`);

    // Step 2: 删除所有 mockTag 的活动/赛事
    const delA = await bulkDelete('activities', { mockTag: true });
    const delT = await bulkDelete('tournaments', { mockTag: true });
    results.push(`删除 mockTag 活动: ${delA} / 赛事: ${delT}`);

    // Step 3: 获取当前数据库中所有真实存在的赛事 ID
    const existingTournamentIds = new Set();
    let tCursor = null;
    while (true) {
      const q = db.collection('tournaments').field({ _id: true }).limit(100);
      const batch = tCursor
        ? await q.where({ _id: _.gt(tCursor) }).orderBy('_id', 'asc').get()
        : await q.orderBy('_id', 'asc').get();
      if (!batch.data || batch.data.length === 0) break;
      for (const t of batch.data) existingTournamentIds.add(t._id);
      tCursor = batch.data[batch.data.length - 1]._id;
      if (batch.data.length < 100) break;
    }
    results.push(`当前存活赛事数: ${existingTournamentIds.size}`);

    // Step 4: 遍历剩余用户，按积分来源是否存在判断真假
    let deletedFake = 0;
    let cleanedReal = 0;
    let keptZero = 0;
    let allUsers = [];
    let uCursor = null;
    while (true) {
      const q = db.collection('users').limit(100);
      const batch = uCursor
        ? await q.where({ _id: _.gt(uCursor) }).orderBy('_id', 'asc').get()
        : await q.orderBy('_id', 'asc').get();
      if (!batch.data || batch.data.length === 0) break;
      allUsers = allUsers.concat(batch.data);
      uCursor = batch.data[batch.data.length - 1]._id;
      if (batch.data.length < 100) break;
    }
    results.push(`扫描剩余用户: ${allUsers.length}`);

    for (const u of allUsers) {
      const earnings = u.tournamentEarnings || [];
      if (earnings.length === 0) {
        // 零积分用户 → 保留
        keptZero++;
        continue;
      }
      // 检查积分引用的赛事是否存在
      const realEarnings = earnings.filter(e =>
        existingTournamentIds.has(e.tournamentId)
      );
      const ghostEarnings = earnings.filter(e =>
        !existingTournamentIds.has(e.tournamentId)
      );

      if (realEarnings.length === 0) {
        // 所有积分引用的赛事都不存在 → 全是幽灵数据 → 假用户，删除
        await db.collection('users').doc(u._id).remove();
        deletedFake++;
      } else if (ghostEarnings.length > 0) {
        // 有部分真实 + 部分幽灵 → 保留用户，清除幽灵积分
        const best10 = realEarnings.slice().sort((a, b) => b.earned - a.earned).slice(0, 10);
        const newTotal = best10.reduce((s, e) => s + e.earned, 0);
        await db.collection('users').doc(u._id).update({
          data: {
            tournamentEarnings: realEarnings,
            totalPoints: newTotal,
            eloRating: 1500,
            eloHistory: [{ date: Date.now(), value: 1500, tournamentId: '' }],
            updatedAt: Date.now()
          }
        });
        cleanedReal++;
      }
      // else: 所有积分都引用存在的赛事 → 真用户，完全不动
    }
    results.push(`删除假用户（幽灵积分）: ${deletedFake}`);
    results.push(`清理真实用户幽灵积分: ${cleanedReal}`);
    results.push(`保留零积分用户: ${keptZero}`);

    // Step 5: 清理孤儿活动/赛事（creator 已不存在的）
    const survivingOpenids = [];
    const surv = await db.collection('users').field({ openid: true }).limit(200).get();
    for (const s of (surv.data || [])) survivingOpenids.push(s.openid);

    const orphanActs = await db.collection('activities').where({
      creator: _.nin(survivingOpenids)
    }).get();
    for (const a of (orphanActs.data || [])) {
      await db.collection('activities').doc(a._id).remove();
    }
    const orphanTours = await db.collection('tournaments').where({
      creator: _.nin(survivingOpenids)
    }).get();
    for (const t of (orphanTours.data || [])) {
      await db.collection('tournaments').doc(t._id).remove();
    }
    results.push(`删除孤儿活动: ${(orphanActs.data || []).length} / 赛事: ${(orphanTours.data || []).length}`);

    results.push('—— purge 完成 ——');
    return { code: 0, data: results };
  }

  // 2.5. minimal 模式：只保留 mickmi + muskxiang 两人，
  //      清掉 mock users 和所有 mockTag 数据，再插入 2 活动 + 2 赛事的最小测试集
  //      用法：cloud.callFunction({ name: 'init-db', data: { mock: 'minimal' } })
  if (event.mock === 'minimal') {
    // 2.5.1 找到 mickmi 和 muskxiang 真实 openid（按 wecomName 反查）
    const realUsersRes = await db.collection('users').where({
      wecomName: _.in(['mickmi', 'muskxiang'])
    }).get();
    const mickUser = (realUsersRes.data || []).find(u => u.wecomName === 'mickmi');
    const muskUser = (realUsersRes.data || []).find(u => u.wecomName === 'muskxiang');
    if (!mickUser) {
      return { code: 1, msg: 'mickmi 用户不存在，请先在小程序里完成 onboarding' };
    }
    if (!muskUser) {
      return { code: 1, msg: 'muskxiang 用户不存在，请先在小程序里完成 onboarding' };
    }
    const mickOid = mickUser.openid;
    const muskOid = muskUser.openid;
    results.push(`找到真实用户: mickmi=${mickOid.slice(0, 8)}... / muskxiang=${muskOid.slice(0, 8)}...`);

    // 2.5.2 把 mickmi 升为 admin（如果还不是）
    if (mickUser.role !== 'admin') {
      await db.collection('users').doc(mickUser._id).update({ data: { role: 'admin' } });
      results.push('mickmi 已设为 admin');
    }

    // 2.5.3 清理 mock 用户（u01-u15）+ 所有 mockTag 的活动/赛事
    const delU = await bulkDelete('users', { openid: _.in(['u01','u02','u03','u04','u05','u06','u07','u08','u09','u10','u11','u12','u13','u14','u15']) });
    const delA = await bulkDelete('activities', { mockTag: true });
    const delT = await bulkDelete('tournaments', { mockTag: true });
    results.push(`清理: ${delU} mock 用户 / ${delA} 活动 / ${delT} 赛事`);
    // 兜底：把没打 mockTag 但属于 mock 时期遗留的孤儿数据也清干净
    // （创建者既不是 mickmi 也不是 muskxiang 的活动/赛事 → 视为旧 mock 残留）
    const orphanA = await db.collection('activities').where({
      creator: _.nin([mickOid, muskOid])
    }).get();
    for (const a of orphanA.data || []) {
      await db.collection('activities').doc(a._id).remove();
    }
    const orphanT = await db.collection('tournaments').where({
      creator: _.nin([mickOid, muskOid])
    }).get();
    for (const t of orphanT.data || []) {
      await db.collection('tournaments').doc(t._id).remove();
    }
    results.push(`清理孤儿: ${(orphanA.data || []).length} 活动 / ${(orphanT.data || []).length} 赛事`);

    // 2.5.4 创建 2 个测试活动
    const minimalActivities = [
      {
        title: '【测试-报名中】周末双打约球',
        startTime: now + 3 * DAY,
        location: '广州天河体育中心 3 号场',
        maxPeople: 8,
        note: '欢迎大家来打球。带球带水。',
        creator: mickOid, creatorName: 'mickmi',
        participants: [
          { openid: mickOid, wecomName: 'mickmi', joinedAt: now - 1 * DAY },
          { openid: muskOid, wecomName: 'muskxiang', joinedAt: now - 12 * 3600 * 1000 }
        ],
        status: 'open',
        createdAt: now - 2 * DAY,
        updatedAt: now,
        mockTag: true
      },
      {
        title: '【测试-已结束】上周双打',
        startTime: now - 5 * DAY,
        location: '海珠湖网球场',
        maxPeople: 4,
        note: '已结束的测试活动，验证 closed 状态显示',
        creator: mickOid, creatorName: 'mickmi',
        participants: [
          { openid: mickOid, wecomName: 'mickmi', joinedAt: now - 8 * DAY },
          { openid: muskOid, wecomName: 'muskxiang', joinedAt: now - 8 * DAY }
        ],
        status: 'closed',
        createdAt: now - 10 * DAY,
        updatedAt: now - 5 * DAY,
        mockTag: true
      }
    ];
    for (const a of minimalActivities) await db.collection('activities').add({ data: a });
    results.push(`插入活动: ${minimalActivities.length} 个`);

    // 2.5.5 创建 2 个测试赛事
    const mickPlayer = {
      openid: mickOid, wecomName: 'mickmi',
      gender: mickUser.gender || 'male', rating: mickUser.rating || '4.0',
      totalPoints: mickUser.totalPoints || 0
    };
    const muskPlayer = {
      openid: muskOid, wecomName: 'muskxiang',
      gender: muskUser.gender || 'male', rating: muskUser.rating || '4.0',
      totalPoints: muskUser.totalPoints || 0
    };

    // 赛事 1：单打报名中（2 人都已报名，可立即抽签测试）
    const t1 = {
      title: '【测试-单打报名中】周赛 · 测试抽签流程',
      type: 'singles', bestOf: 6, level: 'friendly',
      handicapRule: '',
      matchDate: now + 5 * DAY,
      status: 'signup',
      players: [
        { ...mickPlayer, signupAt: now - 2 * DAY },
        { ...muskPlayer, signupAt: now - 1 * DAY }
      ],
      groups: [], knockout: null,
      config: { groupCount: 1, advanceCount: 2, seedCount: 0 },
      creator: mickOid, creatorName: 'mickmi',
      createdAt: now - 3 * DAY, updatedAt: now,
      mockTag: true
    };

    // 赛事 2：单打已结束（mickmi vs muskxiang 决赛，含 placementAwards 测海报）
    const finalMatch = koMatch(
      'ko_r1_0',
      { openid: mickOid, wecomName: 'mickmi' },
      { openid: muskOid, wecomName: 'muskxiang' },
      [6, 4]  // mickmi 6:4 取胜
    );
    const t2 = {
      title: '【测试-单打已结束】月赛 · 测试海报与积分',
      type: 'singles', bestOf: 6, level: 'challenge',
      handicapRule: '',
      matchDate: now - 7 * DAY,
      status: 'finished',
      players: [
        { ...mickPlayer, signupAt: now - 14 * DAY },
        { ...muskPlayer, signupAt: now - 14 * DAY }
      ],
      // 2 人 → 1 组 → advanceCount=2 → 直接决赛（无小组赛）
      // 但是 1 组 2 人 round-robin 也是 1 场，跟决赛同场。
      // 简化：只画出决赛（status=finished 后用户看到的就是决赛结果）
      groups: [
        // 留个空 group 占位，避免前端读 groups[0] 时崩
        { name: 'A', players: [
            { openid: mickOid, wecomName: 'mickmi', seed: 0 },
            { openid: muskOid, wecomName: 'muskxiang', seed: 0 }
          ],
          matches: [], standings: [
            { openid: mickOid, wecomName: 'mickmi', played: 1, wins: 1, losses: 0, setsWon: 6, setsLost: 4 },
            { openid: muskOid, wecomName: 'muskxiang', played: 1, wins: 0, losses: 1, setsWon: 4, setsLost: 6 }
          ]
        }
      ],
      knockout: {
        rounds: [
          { name: '决赛', matches: [finalMatch] }
        ]
      },
      placementAwards: [
        { openid: mickOid, wecomName: 'mickmi', place: '冠军', placement: 1, pts: 100, points: 100, teamId: null },
        { openid: muskOid, wecomName: 'muskxiang', place: '亚军', placement: 2, pts: 60, points: 60, teamId: null }
      ],
      config: { groupCount: 1, advanceCount: 2, seedCount: 0 },
      creator: mickOid, creatorName: 'mickmi',
      createdAt: now - 14 * DAY, updatedAt: now - 7 * DAY,
      mockTag: true
    };

    await db.collection('tournaments').add({ data: t1 });
    await db.collection('tournaments').add({ data: t2 });
    results.push('插入赛事: 2 个（单打报名中 / 单打已结束）');

    results.push('—— minimal 数据集就绪 ——');
    results.push('  • 活动: 1 报名中(双打约球) + 1 已结束');
    results.push('  • 赛事: 1 单打报名中(测抽签) + 1 单打已结束(测海报)');
    results.push('  • 用户: 仅 mickmi(admin) + muskxiang');
    return { code: 0, data: results };
  }

  // 3. mock=true：清理旧 mock + 重新插入完整数据
  if (event.mock === true) {
    // 3.1 清理旧 mock（用 mockTag 标识，不会误删用户手动创建的文档）
    const delMockU = await bulkDelete('users', { openid: _.in(['u01','u02','u03','u04','u05','u06','u07','u08','u09','u10','u11','u12','u13','u14','u15']) });
    const delMockA = await bulkDelete('activities', { mockTag: true });
    const delMockT = await bulkDelete('tournaments', { mockTag: true });
    results.push(`清理旧数据: ${delMockU} 用户 / ${delMockA} 活动 / ${delMockT} 赛事`);

    // 3.2 插入用户（admin 走 update，其他走 add）
    const users = defineUsers(adminOpenid, now);
    for (const u of users) {
      if (u.openid === adminOpenid) {
        const exists = await db.collection('users').where({ openid: adminOpenid }).get();
        if (exists.data.length === 0) {
          await db.collection('users').add({ data: u });
        } else {
          // 保留原 _id，仅更新业务字段
          const { openid, createdAt, ...rest } = u;
          await db.collection('users').doc(exists.data[0]._id).update({ data: rest });
        }
      } else {
        await db.collection('users').add({ data: u });
      }
    }
    results.push(`插入 users: ${users.length} 人（含 admin）`);

    // 3.3 插入活动（统一打 mockTag）
    const activities = defineActivities(adminOpenid, now);
    await Promise.all(activities.map(a =>
      db.collection('activities').add({ data: { ...a, mockTag: true } })
    ));
    results.push(`插入 activities: ${activities.length} 个`);

    // 3.4 插入赛事（统一打 mockTag）
    const userMap = {};
    for (const u of users) userMap[u.openid] = u;
    const tournaments = defineTournaments(adminOpenid, now, userMap);
    await Promise.all(tournaments.map(t =>
      db.collection('tournaments').add({ data: { ...t, mockTag: true } })
    ));
    results.push(`插入 tournaments: ${tournaments.length} 个`);

    results.push('—— 所有 mock 数据就绪 ——');
    results.push('  • T1 报名中(0人)  T2 报名中(3人不够) ');
    results.push('  • T3 双打(6人) 报名中    T4 半年赛(8人含让分)');
    results.push('  • T5 单打小组赛(A完B中) T6 单打小组赛(全完)');
    results.push('  • T7 单打淘汰赛(半决中) T8 单打已结束(完整含奖)');
    results.push('  • T9 双打小组赛(6场录3) T10 双打小组赛(全完待开淘汰)');
    results.push('  • T11 双打淘汰赛(决赛未录) T12 双打已结束(含team奖项)');
  }

  return { code: 0, data: results };
};
