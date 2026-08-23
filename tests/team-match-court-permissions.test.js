const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync(require.resolve('../cloudfunctions/tournament/index.js'), 'utf8');

function makeTournament(status = 'group') {
  return {
    _id: 'team-permission-1',
    creator: 'owner',
    status,
    type: 'team',
    bestOf: 6,
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
        courts: [
          { id: 'court_1', players: ['a1', 'b1'], encounters: [] },
          { id: 'court_2', players: ['a2', 'b2'], encounters: [] }
        ]
      }]
    }]
  };
}

async function callCourtAction(tournament, openid, courtId, lineupA, lineupB, action = 'enterEncounterScore') {
  const updates = [];
  const db = {
    command: new Proxy({}, { get: () => value => value }),
    runTransaction: async callback => callback({
      collection: name => db.collection(name)
    }),
    collection(name) {
      if (name === 'users') {
        return {
          where() {
            return { get: async () => ({ data: [{ openid, role: 'member' }] }) };
          }
        };
      }
      if (name === 'tournaments') {
        return {
          doc() {
            return {
              get: async () => ({ data: tournament }),
              update: async payload => { updates.push(payload.data); return {}; }
            };
          }
        };
      }
      return { where() { return { get: async () => ({ data: [] }) }; } };
    }
  };
  const cloud = {
    DYNAMIC_CURRENT_ENV: 'test',
    init() {},
    getWXContext: () => ({ OPENID: openid }),
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
  const result = await moduleObject.exports.main({
    action,
    id: tournament._id,
    matchId: 'tm_1',
    courtId,
    ...(action === 'enterEncounterScore' ? { setsA: 6, setsB: 3 } : {}),
    lineupA,
    lineupB
  });
  return { result, updates };
}

(async () => {
  const ownCourt = await callCourtAction(makeTournament(), 'a1', 'court_1', ['a1'], ['b1']);
  assert.strictEqual(ownCourt.result.code, 0);
  assert.strictEqual(ownCourt.updates.length, 1);

  const otherCourt = await callCourtAction(makeTournament(), 'a1', 'court_2', ['a2'], ['b2']);
  assert.strictEqual(otherCourt.result.code, 1);
  assert.strictEqual(otherCourt.result.msg, '你只能录入自己所在场地的比分');
  assert.strictEqual(otherCourt.updates.length, 0);

  const ownerAnyCourt = await callCourtAction(makeTournament(), 'owner', 'court_2', ['a2'], ['b2']);
  assert.strictEqual(ownerAnyCourt.result.code, 0);

  const finished = await callCourtAction(makeTournament('finished'), 'owner', 'court_1', ['a1'], ['b1']);
  assert.strictEqual(finished.result.code, 1);
  assert.strictEqual(finished.result.msg, '当前不是小组赛阶段');

  const savedLineup = await callCourtAction(
    makeTournament(), 'a1', 'court_1', ['a1'], ['b1'], 'saveEncounterLineup'
  );
  assert.strictEqual(savedLineup.result.code, 0);
  assert.strictEqual(savedLineup.result.data.encounter.winner, null);
  assert.strictEqual(savedLineup.result.data.encounter.setsA, null);
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(savedLineup.result.data.encounter.lineup)),
    { A: ['a1'], B: ['b1'] }
  );

  const deniedLineup = await callCourtAction(
    makeTournament(), 'a1', 'court_2', ['a2'], ['b2'], 'saveEncounterLineup'
  );
  assert.strictEqual(deniedLineup.result.code, 1);
  assert.strictEqual(deniedLineup.result.msg, '你只能录入自己所在场地的场次');

  console.log('team match court permissions: 6 paths passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
