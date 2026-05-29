// 一键初始化数据库 + 全场景模拟数据
// 用法（在微信开发者工具中调用 init-db 云函数）：
//   {}                    → 仅创建集合
//   { "mock": true }      → 清理旧 mock 并插入完整测试数据
//   { "mock": "reset" }   → 仅清理 mock 数据（保留你的 admin 用户）
//
// 数据覆盖：
//   - users:        16 人（含 admin/你 + 15 mock）
//   - activities:   8 个（覆盖未来/今天/过去/closed/满员/不限人数）
//   - tournaments:  8 个（覆盖 signup 各人数、group 部分/全部完成、knockout 中段、finished）
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
function buildGroup(name, playerInfos, results = []) {
  const players = playerInfos.map(p => ({ openid: p.openid, wecomName: p.wecomName, seed: 0 }));
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
        playerA: { openid: a.openid, wecomName: a.wecomName },
        playerB: { openid: b.openid, wecomName: b.wecomName },
        scoreA: null, scoreB: null, winner: null, scoreSummary: ''
      };
      if (r) {
        const sa = r.a === a.openid ? r.scoreA : r.scoreB;
        const sb = r.a === a.openid ? r.scoreB : r.scoreA;
        m.scoreA = sa; m.scoreB = sb;
        m.winner = sa > sb ? 'A' : 'B';
        m.scoreSummary = `${sa}:${sb}`;
      }
      matches.push(m);
    }
  }
  const standings = computeStandings(playerInfos, matches);
  return { name, players, matches, standings };
}

// 构建 knockout match。score = [a, b] 已录入，null = 未录入
function koMatch(id, a, b, score = null) {
  const m = {
    id,
    playerA: a ? { openid: a.openid, wecomName: a.wecomName } : null,
    playerB: b ? { openid: b.openid, wecomName: b.wecomName } : null,
    scoreA: null, scoreB: null, winner: null, scoreSummary: '',
    bye: !a || !b
  };
  if (m.bye) {
    m.winner = a ? 'A' : 'B';
  } else if (score) {
    m.scoreA = score[0]; m.scoreB = score[1];
    m.winner = score[0] > score[1] ? 'A' : 'B';
    m.scoreSummary = `${score[0]}:${score[1]}`;
  }
  return m;
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
        { openid: 'u02', place: '冠军', pts: 200 },
        { openid: 'u01', place: '亚军', pts: 120 },
        { openid: 'u04', place: '四强', pts: 60 },
        { openid: 'u03', place: '四强', pts: 60 },
        { openid: 'u05', place: '参与', pts: 15 },
        { openid: 'u06', place: '参与', pts: 15 },
        { openid: 'u07', place: '参与', pts: 15 },
        { openid: 'u08', place: '参与', pts: 15 }
      ],
      config: { groupCount: 2, advanceCount: 2, seedCount: 2 },
      creator: 'u01', creatorName: '张伟',
      createdAt: now - 35 * DAY, updatedAt: now - 25 * DAY
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
    results.push('  • T3 双打(6人)    T4 半年赛(8人含让分)');
    results.push('  • T5 小组赛(A完B中) T6 小组赛(全完)');
    results.push('  • T7 淘汰赛(半决中) T8 已结束(完整含奖)');
  }

  return { code: 0, data: results };
};
