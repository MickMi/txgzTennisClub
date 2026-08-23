const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const tournamentSource = fs.readFileSync(
  require.resolve('../cloudfunctions/tournament/index.js'),
  'utf8'
);

async function callRevert(tournament, event, openid = 'owner') {
  const updates = [];
  const command = new Proxy({}, { get: () => value => value });
  const db = {
    command,
    runTransaction: async callback => callback({
      collection: name => db.collection(name)
    }),
    collection(name) {
      if (name === 'users') {
        return {
          where() {
            return {
              get: async () => ({ data: [{ _id: `user_${openid}`, openid, role: 'member' }] })
            };
          },
          doc() { return { update: async () => ({}) }; }
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
  vm.runInNewContext(tournamentSource, sandbox, { filename: 'cloudfunctions/tournament/index.js' });
  const result = await moduleObject.exports.main({
    action: 'revertEncounterScore',
    id: tournament._id,
    ...event
  });
  return { result, updates };
}

const baseTournament = {
  _id: 'team-1',
  creator: 'owner',
  status: 'group',
  type: 'team',
  bestOf: 6,
  teams: [
    { openid: 'team_A', members: [{ openid: 'a1' }] },
    { openid: 'team_B', members: [{ openid: 'b1' }] }
  ]
};

function withCourts(encounters) {
  return {
    ...baseTournament,
    groups: [{
      name: '团队赛',
      matches: [{
        id: 'tm_1',
        teamA: 'team_A',
        teamB: 'team_B',
        status: 'partial',
        winner: null,
        tiebreak: { id: 'tb_1', winner: null },
        courts: [{ id: 'court_1', players: ['a1', 'b1'], encounters }]
      }]
    }]
  };
}

(async () => {
  const partial = await callRevert(withCourts([
    { id: 'enc_a', setsA: 6, setsB: 3, winner: 'A', lineup: { A: ['a1'], B: ['b1'] } },
    { id: 'enc_b', setsA: 4, setsB: 6, winner: 'B', lineup: { A: ['a1'], B: ['b1'] } }
  ]), { matchId: 'tm_1', courtId: 'court_1', encounterId: 'enc_a' });
  assert.strictEqual(partial.result.code, 0);
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(partial.result.data.match.teamScore)),
    { A: 0, B: 1 }
  );
  assert.strictEqual(partial.result.data.match.gamesA, 4);
  assert.strictEqual(partial.result.data.match.gamesB, 6);
  assert.strictEqual(partial.result.data.match.tiebreak, null);
  assert.strictEqual(partial.result.data.match.courts[0].encounters.length, 2);
  const reverted = partial.result.data.match.courts[0].encounters.find(item => item.id === 'enc_a');
  assert.strictEqual(reverted.winner, null);
  assert.strictEqual(reverted.setsA, null);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(reverted.lineup)), { A: ['a1'], B: ['b1'] });

  const last = await callRevert(withCourts([
    { id: 'enc_last', setsA: 6, setsB: 3, winner: 'A', lineup: { A: ['a1'], B: ['b1'] } }
  ]), { matchId: 'tm_1', courtId: 'court_1', encounterId: 'enc_last' });
  assert.strictEqual(last.result.data.remainingCount, 0);
  assert.strictEqual(last.result.data.match.status, 'pending');
  assert.strictEqual(last.result.data.match.scoreSummary, '');
  assert.strictEqual(last.result.data.match.courts[0].encounters.length, 1);
  assert.strictEqual(last.result.data.match.courts[0].encounters[0].id, 'enc_last');
  assert.strictEqual(last.result.data.match.courts[0].encounters[0].winner, null);

  const legacy = await callRevert({
    ...baseTournament,
    groups: [{
      name: '团队赛',
      matches: [{
        id: 'tm_1',
        status: 'partial',
        slots: [
          { id: 'legacy_1', setsA: 6, setsB: 2, winner: 'A', isTiebreak: false },
          { id: 'legacy_tb', winner: null, isTiebreak: true }
        ]
      }]
    }]
  }, { matchId: 'tm_1', courtId: 'legacy_court', encounterId: 'legacy_1' });
  assert.strictEqual(legacy.result.code, 0);
  assert.strictEqual(legacy.result.data.match.slots.length, 0);

  const denied = await callRevert(withCourts([
    { id: 'enc_a', setsA: 6, setsB: 3, winner: 'A' }
  ]), { matchId: 'tm_1', courtId: 'court_1', encounterId: 'enc_a' }, 'stranger');
  assert.strictEqual(denied.result.code, 1);
  assert.strictEqual(denied.result.msg, '仅创建者或管理员可撤回比分');
  assert.strictEqual(denied.updates.length, 0);

  const memberDenied = await callRevert(withCourts([
    { id: 'enc_a', setsA: 6, setsB: 3, winner: 'A' }
  ]), { matchId: 'tm_1', courtId: 'court_1', encounterId: 'enc_a' }, 'a1');
  assert.strictEqual(memberDenied.result.code, 1);
  assert.strictEqual(memberDenied.result.msg, '仅创建者或管理员可撤回比分');
  assert.strictEqual(memberDenied.updates.length, 0);

  console.log('tournament revert encounter: 5 paths passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
