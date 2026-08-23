const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync(
  require.resolve('../cloudfunctions/tournament/index.js'),
  'utf8'
);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createMemoryDb(initialTournament, initialUsers) {
  const state = {
    tournaments: new Map([[initialTournament._id, clone(initialTournament)]]),
    users: new Map(initialUsers.map(user => [user._id, clone(user)]))
  };
  let transactionQueue = Promise.resolve();

  const collection = name => ({
    where(query) {
      return {
        async get() {
          const rows = [...(state[name] || new Map()).values()]
            .filter(row => Object.entries(query || {}).every(([key, value]) => row[key] === value));
          return { data: clone(rows) };
        },
        async update(payload) {
          let updated = 0;
          for (const [id, row] of (state[name] || new Map()).entries()) {
            if (!Object.entries(query || {}).every(([key, value]) => row[key] === value)) continue;
            state[name].set(id, { ...row, ...clone(payload.data) });
            updated++;
          }
          return { stats: { updated } };
        }
      };
    },
    doc(id) {
      return {
        async get() {
          const row = state[name] && state[name].get(id);
          if (!row) throw new Error(`${name}/${id} not found`);
          return { data: clone(row) };
        },
        async update(payload) {
          const row = state[name] && state[name].get(id);
          if (!row) throw new Error(`${name}/${id} not found`);
          state[name].set(id, { ...row, ...clone(payload.data) });
          return {};
        },
        async remove() {
          if (state[name]) state[name].delete(id);
          return {};
        }
      };
    }
  });

  const db = {
    command: new Proxy({}, { get: () => value => value }),
    collection,
    runTransaction(callback) {
      const run = () => callback({ collection });
      const current = transactionQueue.then(run, run);
      transactionQueue = current.catch(() => {});
      return current;
    }
  };
  return { db, state };
}

function loadTournamentMain(db, getOpenid) {
  const cloud = {
    DYNAMIC_CURRENT_ENV: 'test',
    init() {},
    getWXContext: () => ({ OPENID: getOpenid() }),
    database: () => db
  };
  const moduleObject = { exports: {} };
  const sandbox = {
    require: name => name === 'wx-server-sdk' ? cloud : require(name),
    module: moduleObject,
    exports: moduleObject.exports,
    console,
    Date,
    Math,
    Promise,
    Set,
    Map,
    Buffer
  };
  vm.runInNewContext(source, sandbox, { filename: 'cloudfunctions/tournament/index.js' });
  return moduleObject.exports.main;
}

function makeUser(openid) {
  return {
    _id: `user_${openid}`,
    openid,
    wecomName: openid,
    role: openid === 'owner' ? 'admin' : 'member',
    eloRating: 1500,
    eloHistory: [{ date: 1, value: 1500, tournamentId: '' }],
    tournamentEarnings: [{ tournamentId: 'other', title: '其他赛事', earned: 5, date: 1 }],
    totalPoints: 5
  };
}

function makeTournament(id = 'team-safe-1', status = 'group') {
  return {
    _id: id,
    title: '数据安全团队赛',
    creator: 'owner',
    creatorName: 'owner',
    status,
    type: 'team',
    bestOf: 6,
    matchDate: 100,
    players: ['a1', 'a2', 'b1', 'b2'].map(openid => ({ openid, wecomName: openid })),
    teams: [
      { openid: 'team_A', members: [{ openid: 'a1' }, { openid: 'a2' }] },
      { openid: 'team_B', members: [{ openid: 'b1' }, { openid: 'b2' }] }
    ],
    captains: { A: 'a1', B: 'b1' },
    groups: [{
      name: '团队赛',
      matches: [{
        id: 'tm_1',
        teamA: 'team_A',
        teamB: 'team_B',
        status: status === 'finished' ? 'finished' : 'pending',
        winner: status === 'finished' ? 'A' : null,
        courts: [
          { id: 'court_1', players: ['a1', 'b1'], encounters: [] },
          { id: 'court_2', players: ['a2', 'b2'], encounters: [] }
        ]
      }]
    }]
  };
}

(async () => {
  const users = ['owner', 'a1', 'a2', 'b1', 'b2'].map(makeUser);
  const { db, state } = createMemoryDb(makeTournament(), users);
  let currentOpenid = 'owner';
  const main = loadTournamentMain(db, () => currentOpenid);

  const score = (courtId, lineupA, lineupB) => main({
    action: 'enterEncounterScore',
    id: 'team-safe-1',
    matchId: 'tm_1',
    courtId,
    setsA: 6,
    setsB: 3,
    lineupA,
    lineupB
  });

  // 两个请求都从同一业务时刻发起；事务内重读保证第二次写入保留第一次的场地结果。
  const [courtOne, courtTwo] = await Promise.all([
    score('court_1', ['a1'], ['b1']),
    score('court_2', ['a2'], ['b2'])
  ]);
  assert.strictEqual(courtOne.code, 0);
  assert.strictEqual(courtTwo.code, 0);
  let stored = state.tournaments.get('team-safe-1');
  let storedMatch = stored.groups[0].matches[0];
  assert.strictEqual(storedMatch.courts[0].encounters.length, 1);
  assert.strictEqual(storedMatch.courts[1].encounters.length, 1);
  assert.strictEqual(storedMatch.teamScore.A, 2);

  // 重复结束只能生成一份固定积分；第二次应返回已有 settlement。
  const [finishOne, finishTwo] = await Promise.all([
    main({ action: 'finishTeamMatch', id: 'team-safe-1', matchId: 'tm_1' }),
    main({ action: 'finishTeamMatch', id: 'team-safe-1', matchId: 'tm_1' })
  ]);
  assert.strictEqual(finishOne.code, 0);
  assert.strictEqual(finishTwo.code, 0);
  assert.ok(finishOne.data.alreadySettled || finishTwo.data.alreadySettled);

  stored = state.tournaments.get('team-safe-1');
  storedMatch = stored.groups[0].matches[0];
  assert.strictEqual(stored.status, 'finished');
  assert.strictEqual(storedMatch.teamSettlement.awards.length, 4);
  for (const openid of ['a1', 'a2', 'b1', 'b2']) {
    const user = state.users.get(`user_${openid}`);
    const teamEarnings = user.tournamentEarnings.filter(item => item.tournamentId === 'team-safe-1');
    assert.strictEqual(teamEarnings.length, 1);
    assert.strictEqual(teamEarnings[0].earned, openid.startsWith('a') ? 40 : 20);
    assert.strictEqual(user.eloRating, 1500);
    assert.deepStrictEqual(user.eloHistory, [{ date: 1, value: 1500, tournamentId: '' }]);
  }

  const deleted = await main({ action: 'delete', id: 'team-safe-1' });
  assert.strictEqual(deleted.code, 0);
  assert.strictEqual(deleted.data.revertedMembers, 4);
  assert.strictEqual(state.tournaments.has('team-safe-1'), false);
  for (const openid of ['a1', 'a2', 'b1', 'b2']) {
    const user = state.users.get(`user_${openid}`);
    assert.strictEqual(user.tournamentEarnings.some(item => item.tournamentId === 'team-safe-1'), false);
    assert.strictEqual(user.totalPoints, 5);
    assert.strictEqual(user.eloRating, 1500);
  }

  // 无 settlement 的历史完赛团队赛不能删除，避免无法证明积分已回滚。
  const legacy = makeTournament('legacy-finished', 'finished');
  state.tournaments.set(legacy._id, clone(legacy));
  const denied = await main({ action: 'delete', id: legacy._id });
  assert.strictEqual(denied.code, 1);
  assert.match(denied.msg, /缺少结算凭证/);
  assert.strictEqual(state.tournaments.has(legacy._id), true);

  // 平分路径同样必须原子结算：先创建一球制胜，再重复提交同一结果。
  const tied = makeTournament('team-tied');
  tied.groups[0].matches[0].status = 'partial';
  tied.groups[0].matches[0].courts[0].encounters.push({
    id: 'tie_a', setsA: 6, setsB: 3, score: '6-3', winner: 'A', lineup: { A: ['a1'], B: ['b1'] }
  });
  tied.groups[0].matches[0].courts[1].encounters.push({
    id: 'tie_b', setsA: 3, setsB: 6, score: '3-6', winner: 'B', lineup: { A: ['a2'], B: ['b2'] }
  });
  state.tournaments.set(tied._id, clone(tied));
  const pendingTiebreak = await main({ action: 'finishTeamMatch', id: tied._id, matchId: 'tm_1' });
  assert.strictEqual(pendingTiebreak.code, 0);
  assert.ok(pendingTiebreak.data.match.tiebreak);
  assert.strictEqual(pendingTiebreak.data.settlement, null);

  const enterTiebreak = () => main({
    action: 'enterEncounterScore',
    id: tied._id,
    matchId: 'tm_1',
    isTiebreak: true,
    setsA: 1,
    setsB: 0,
    lineupA: [],
    lineupB: []
  });
  const [tiebreakOne, tiebreakTwo] = await Promise.all([enterTiebreak(), enterTiebreak()]);
  assert.strictEqual(tiebreakOne.code, 0);
  assert.strictEqual(tiebreakTwo.code, 0);
  assert.ok(tiebreakOne.data.alreadySettled || tiebreakTwo.data.alreadySettled);
  const tiedStored = state.tournaments.get(tied._id);
  assert.strictEqual(tiedStored.groups[0].matches[0].tiebreak.winner, 'A');
  assert.strictEqual(tiedStored.groups[0].matches[0].teamSettlement.awards.length, 4);
  for (const openid of ['a1', 'a2', 'b1', 'b2']) {
    const user = state.users.get(`user_${openid}`);
    const teamEarnings = user.tournamentEarnings.filter(item => item.tournamentId === tied._id);
    assert.strictEqual(teamEarnings.length, 1);
    assert.strictEqual(user.eloRating, 1500);
  }

  console.log('team match data safety: concurrent score, idempotent settlement, rollback and no ELO passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
