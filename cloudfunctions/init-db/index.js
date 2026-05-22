// 一键初始化数据库集合 + 可选模拟数据
// 云端测试传 {"mock": true} 插入赛事模拟数据
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const COLLECTIONS = ['users', 'activities', 'matches', 'tournaments'];

exports.main = async (event) => {
  const results = [];
  for (const name of COLLECTIONS) {
    try {
      await db.createCollection(name);
      results.push(`${name}: 创建成功`);
    } catch (e) {
      if (e.errCode === -501001) {
        results.push(`${name}: 已存在`);
      } else {
        results.push(`${name}: 失败 - ${e.errMsg || e.message}`);
      }
    }
  }

  // 插入模拟赛事数据
  if (event && event.mock) {
    const wxCtx = cloud.getWXContext();
    const OPENID = wxCtx.OPENID || event.openid || 'mock_admin_openid';
    const now = Date.now();

    // 确保当前用户存在
    const userRes = await db.collection('users').where({ openid: OPENID }).get();
    const adminEloHistory = [
      { date: now - 86400000*60, value: 1500, tournamentId: '' },
      { date: now - 86400000*55, value: 1516, tournamentId: 't1' },
      { date: now - 86400000*52, value: 1508, tournamentId: 't1' },
      { date: now - 86400000*50, value: 1530, tournamentId: 't1' },
      { date: now - 86400000*30, value: 1545, tournamentId: 't2' },
      { date: now - 86400000*28, value: 1560, tournamentId: 't2' },
      { date: now - 86400000*25, value: 1548, tournamentId: 't2' },
      { date: now - 86400000*22, value: 1572, tournamentId: 't2' },
      { date: now - 86400000*5, value: 1580, tournamentId: 't3' }
    ];
    const adminEarnings = [
      { tournamentId: 't1', title: '3月月赛', earned: 45, date: now - 86400000*50 },
      { tournamentId: 't2', title: '4月月赛', earned: 75, date: now - 86400000*22 }
    ];
    if (userRes.data.length === 0) {
      await db.collection('users').add({
        data: {
          openid: OPENID, wecomName: '管理员', gender: 'male',
          rating: '3.5', totalPoints: 120, eloRating: 1580,
          eloHistory: adminEloHistory,
          tournamentEarnings: adminEarnings,
          role: 'admin', createdAt: now, updatedAt: now
        }
      });
      results.push('mock: 创建管理员用户');
    } else {
      // 已存在 → 更新字段补全图表数据
      await db.collection('users').where({ openid: OPENID }).update({
        data: {
          totalPoints: 120, eloRating: 1580,
          eloHistory: adminEloHistory,
          tournamentEarnings: adminEarnings,
          updatedAt: now
        }
      });
      results.push('mock: 更新管理员用户(补充图表数据)');
    }

    // 创建模拟用户（用于排行榜展示）
    const mockUsers = [
      { openid: 'p1', wecomName: '张伟', gender: 'male', rating: '4.0', totalPoints: 195, eloRating: 1620,
        tournamentEarnings: [
          { tournamentId: 't1', title: '3月月赛', earned: 85, date: now - 86400000*60 },
          { tournamentId: 't2', title: '4月月赛', earned: 110, date: now - 86400000*30 }
        ]},
      { openid: 'p2', wecomName: '李娜', gender: 'female', rating: '3.0', totalPoints: 80, eloRating: 1450,
        tournamentEarnings: [
          { tournamentId: 't1', title: '3月月赛', earned: 42, date: now - 86400000*60 },
          { tournamentId: 't2', title: '4月月赛', earned: 38, date: now - 86400000*30 }
        ]},
      { openid: 'p3', wecomName: '王强', gender: 'male', rating: '3.5', totalPoints: 145, eloRating: 1550,
        tournamentEarnings: [
          { tournamentId: 't1', title: '3月月赛', earned: 65, date: now - 86400000*60 },
          { tournamentId: 't2', title: '4月月赛', earned: 80, date: now - 86400000*30 }
        ]},
      { openid: 'p4', wecomName: '刘芳', gender: 'female', rating: '2.5', totalPoints: 60, eloRating: 1400,
        tournamentEarnings: [
          { tournamentId: 't2', title: '4月月赛', earned: 60, date: now - 86400000*30 }
        ]},
      { openid: 'p5', wecomName: '陈明', gender: 'male', rating: '4.0', totalPoints: 210, eloRating: 1650,
        tournamentEarnings: [
          { tournamentId: 't1', title: '3月月赛', earned: 98, date: now - 86400000*60 },
          { tournamentId: 't2', title: '4月月赛', earned: 112, date: now - 86400000*30 }
        ]},
      { openid: 'p6', wecomName: '赵丽', gender: 'female', rating: '3.0', totalPoints: 55, eloRating: 1420,
        tournamentEarnings: [
          { tournamentId: 't2', title: '4月月赛', earned: 55, date: now - 86400000*30 }
        ]},
      { openid: 'p7', wecomName: '周杰', gender: 'male', rating: '3.5', totalPoints: 170, eloRating: 1590,
        tournamentEarnings: [
          { tournamentId: 't1', title: '3月月赛', earned: 72, date: now - 86400000*60 },
          { tournamentId: 't2', title: '4月月赛', earned: 98, date: now - 86400000*30 }
        ]}
    ];
    for (const u of mockUsers) {
      const eloH = [{ date: now - 86400000*60, value: 1500, tournamentId: '' }, { date: now - 86400000*30, value: u.eloRating, tournamentId: 't2' }];
      const exists = await db.collection('users').where({ openid: u.openid }).count();
      if (exists.total === 0) {
        await db.collection('users').add({
          data: { ...u, eloHistory: eloH, role: 'member', createdAt: now, updatedAt: now }
        });
      } else {
        await db.collection('users').where({ openid: u.openid }).update({
          data: { ...u, eloHistory: eloH, updatedAt: now }
        });
      }
    }
    results.push('mock: 创建7个模拟用户(含积分)');

    // 先清除旧的 mock 赛事（避免重复）
    const oldTournaments = await db.collection('tournaments').where({ creator: OPENID }).get();
    for (const t of oldTournaments.data) {
      await db.collection('tournaments').doc(t._id).remove();
    }
    results.push(`mock: 清除旧赛事 ${oldTournaments.data.length} 条`);

    // === 赛事1：报名中（8人已报名，等待抽签）===
    await db.collection('tournaments').add({
      data: {
        title: '5月第4周周赛',
        type: 'singles',
        bestOf: 6,
        level: 'friendly',
        handicapRule: '',
        matchDate: now + 86400000 * 3,
        status: 'signup',
        players: [
          { openid: OPENID, wecomName: '管理员', gender: 'male', rating: '3.5', totalPoints: 120, seed: 0, signupAt: now },
          { openid: 'p1', wecomName: '张伟', gender: 'male', rating: '4.0', totalPoints: 95, seed: 0, signupAt: now },
          { openid: 'p2', wecomName: '李娜', gender: 'female', rating: '3.0', totalPoints: 80, seed: 0, signupAt: now },
          { openid: 'p3', wecomName: '王强', gender: 'male', rating: '3.5', totalPoints: 75, seed: 0, signupAt: now },
          { openid: 'p4', wecomName: '刘芳', gender: 'female', rating: '2.5', totalPoints: 60, seed: 0, signupAt: now },
          { openid: 'p5', wecomName: '陈明', gender: 'male', rating: '4.0', totalPoints: 110, seed: 0, signupAt: now },
          { openid: 'p6', wecomName: '赵丽', gender: 'female', rating: '3.0', totalPoints: 55, seed: 0, signupAt: now },
          { openid: 'p7', wecomName: '周杰', gender: 'male', rating: '3.5', totalPoints: 70, seed: 0, signupAt: now }
        ],
        groups: [],
        knockout: null,
        config: { groupCount: 2, advanceCount: 2, seedCount: 0 },
        creator: OPENID,
        creatorName: '管理员',
        createdAt: now,
        updatedAt: now
      }
    });
    results.push('mock: 赛事1 - 报名中(8人)');

    // === 赛事2：小组赛进行中（已抽签，部分比分已录入）===
    await db.collection('tournaments').add({
      data: {
        title: '5月月赛',
        type: 'singles',
        bestOf: 6,
        level: 'challenge',
        handicapRule: '男让女每盘1局',
        matchDate: now - 86400000,
        status: 'group',
        players: [
          { openid: OPENID, wecomName: '管理员', gender: 'male', rating: '3.5', totalPoints: 120, seed: 0, signupAt: now },
          { openid: 'p1', wecomName: '张伟', gender: 'male', rating: '4.0', totalPoints: 95, seed: 0, signupAt: now },
          { openid: 'p2', wecomName: '李娜', gender: 'female', rating: '3.0', totalPoints: 80, seed: 0, signupAt: now },
          { openid: 'p3', wecomName: '王强', gender: 'male', rating: '3.5', totalPoints: 75, seed: 0, signupAt: now },
          { openid: 'p5', wecomName: '陈明', gender: 'male', rating: '4.0', totalPoints: 110, seed: 0, signupAt: now },
          { openid: 'p6', wecomName: '赵丽', gender: 'female', rating: '3.0', totalPoints: 55, seed: 0, signupAt: now }
        ],
        groups: [
          {
            name: 'A',
            players: [
              { openid: OPENID, wecomName: '管理员', seed: 0 },
              { openid: 'p1', wecomName: '张伟', seed: 0 },
              { openid: 'p2', wecomName: '李娜', seed: 0 }
            ],
            matches: [
              {
                id: 'ga_m1',
                playerA: { openid: OPENID, wecomName: '管理员' },
                playerB: { openid: 'p1', wecomName: '张伟' },
                scoreA: 4, scoreB: 2, winner: 'A', scoreSummary: '4:2'
              },
              {
                id: 'ga_m2',
                playerA: { openid: OPENID, wecomName: '管理员' },
                playerB: { openid: 'p2', wecomName: '李娜' },
                scoreA: null, scoreB: null, winner: null, scoreSummary: ''
              },
              {
                id: 'ga_m3',
                playerA: { openid: 'p1', wecomName: '张伟' },
                playerB: { openid: 'p2', wecomName: '李娜' },
                scoreA: 3, scoreB: 4, winner: 'B', scoreSummary: '3:4'
              }
            ],
            standings: [
              { openid: OPENID, wecomName: '管理员', played: 1, wins: 1, losses: 0, setsWon: 4, setsLost: 2 },
              { openid: 'p2', wecomName: '李娜', played: 1, wins: 1, losses: 0, setsWon: 4, setsLost: 3 },
              { openid: 'p1', wecomName: '张伟', played: 2, wins: 0, losses: 2, setsWon: 5, setsLost: 8 }
            ]
          },
          {
            name: 'B',
            players: [
              { openid: 'p3', wecomName: '王强', seed: 0 },
              { openid: 'p5', wecomName: '陈明', seed: 0 },
              { openid: 'p6', wecomName: '赵丽', seed: 0 }
            ],
            matches: [
              {
                id: 'gb_m1',
                playerA: { openid: 'p3', wecomName: '王强' },
                playerB: { openid: 'p5', wecomName: '陈明' },
                scoreA: 2, scoreB: 4, winner: 'B', scoreSummary: '2:4'
              },
              {
                id: 'gb_m2',
                playerA: { openid: 'p3', wecomName: '王强' },
                playerB: { openid: 'p6', wecomName: '赵丽' },
                scoreA: 4, scoreB: 3, winner: 'A', scoreSummary: '4:3'
              },
              {
                id: 'gb_m3',
                playerA: { openid: 'p5', wecomName: '陈明' },
                playerB: { openid: 'p6', wecomName: '赵丽' },
                scoreA: null, scoreB: null, winner: null, scoreSummary: ''
              }
            ],
            standings: [
              { openid: 'p5', wecomName: '陈明', played: 1, wins: 1, losses: 0, setsWon: 4, setsLost: 2 },
              { openid: 'p3', wecomName: '王强', played: 2, wins: 1, losses: 1, setsWon: 6, setsLost: 7 },
              { openid: 'p6', wecomName: '赵丽', played: 1, wins: 0, losses: 1, setsWon: 3, setsLost: 4 }
            ]
          }
        ],
        knockout: null,
        config: { groupCount: 2, advanceCount: 2, seedCount: 0 },
        creator: OPENID,
        creatorName: '管理员',
        createdAt: now - 86400000,
        updatedAt: now
      }
    });
    results.push('mock: 赛事2 - 小组赛进行中(部分比分已录)');

    // === 赛事3：已结束（完整数据，含淘汰赛）===
    await db.collection('tournaments').add({
      data: {
        title: '4月月赛',
        type: 'singles',
        bestOf: 6,
        level: 'challenge',
        handicapRule: '',
        matchDate: now - 86400000 * 30,
        status: 'finished',
        players: [
          { openid: OPENID, wecomName: '管理员', gender: 'male', rating: '3.5', totalPoints: 90, seed: 0, signupAt: now },
          { openid: 'p1', wecomName: '张伟', gender: 'male', rating: '4.0', totalPoints: 85, seed: 0, signupAt: now },
          { openid: 'p5', wecomName: '陈明', gender: 'male', rating: '4.0', totalPoints: 100, seed: 0, signupAt: now },
          { openid: 'p3', wecomName: '王强', gender: 'male', rating: '3.5', totalPoints: 65, seed: 0, signupAt: now }
        ],
        groups: [
          {
            name: 'A',
            players: [
              { openid: OPENID, wecomName: '管理员', seed: 0 },
              { openid: 'p1', wecomName: '张伟', seed: 0 }
            ],
            matches: [
              { id: 'fa_m1', playerA: { openid: OPENID, wecomName: '管理员' }, playerB: { openid: 'p1', wecomName: '张伟' }, scoreA: 4, scoreB: 3, winner: 'A', scoreSummary: '4:3' }
            ],
            standings: [
              { openid: OPENID, wecomName: '管理员', played: 1, wins: 1, losses: 0, setsWon: 4, setsLost: 3 },
              { openid: 'p1', wecomName: '张伟', played: 1, wins: 0, losses: 1, setsWon: 3, setsLost: 4 }
            ]
          },
          {
            name: 'B',
            players: [
              { openid: 'p5', wecomName: '陈明', seed: 0 },
              { openid: 'p3', wecomName: '王强', seed: 0 }
            ],
            matches: [
              { id: 'fb_m1', playerA: { openid: 'p5', wecomName: '陈明' }, playerB: { openid: 'p3', wecomName: '王强' }, scoreA: 5, scoreB: 1, winner: 'A', scoreSummary: '5:1' }
            ],
            standings: [
              { openid: 'p5', wecomName: '陈明', played: 1, wins: 1, losses: 0, setsWon: 5, setsLost: 1 },
              { openid: 'p3', wecomName: '王强', played: 1, wins: 0, losses: 1, setsWon: 1, setsLost: 5 }
            ]
          }
        ],
        knockout: {
          rounds: [
            {
              name: '半决赛',
              matches: [
                { id: 'ko_r1_0', playerA: { openid: OPENID, wecomName: '管理员' }, playerB: { openid: 'p3', wecomName: '王强' }, scoreA: 4, scoreB: 1, winner: 'A', scoreSummary: '4:1', bye: false },
                { id: 'ko_r1_1', playerA: { openid: 'p5', wecomName: '陈明' }, playerB: { openid: 'p1', wecomName: '张伟' }, scoreA: 4, scoreB: 3, winner: 'A', scoreSummary: '4:3', bye: false }
              ]
            },
            {
              name: '决赛',
              matches: [
                { id: 'ko_r2_0', playerA: { openid: OPENID, wecomName: '管理员' }, playerB: { openid: 'p5', wecomName: '陈明' }, scoreA: 2, scoreB: 4, winner: 'B', scoreSummary: '2:4', bye: false }
              ]
            }
          ]
        },
        config: { groupCount: 2, advanceCount: 2, seedCount: 0 },
        creator: OPENID,
        creatorName: '管理员',
        createdAt: now - 86400000 * 30,
        updatedAt: now - 86400000 * 28
      }
    });
    results.push('mock: 赛事3 - 已结束(含淘汰赛bracket)');
  }

  return { code: 0, data: results };
};
