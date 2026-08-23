const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync(require.resolve('../cloudfunctions/tournament/index.js'), 'utf8');
const moduleObject = { exports: {} };
const cloud = {
  DYNAMIC_CURRENT_ENV: 'test',
  init() {},
  getWXContext: () => ({ OPENID: 'owner' }),
  database: () => ({ command: {} })
};
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
vm.runInNewContext(
  `${source}\nmodule.exports.__test = { generateTeamMatchBrackets, redistributeTeamCourts };`,
  sandbox,
  { filename: 'cloudfunctions/tournament/index.js' }
);

const { generateTeamMatchBrackets, redistributeTeamCourts } = moduleObject.exports.__test;
const players = Array.from({ length: 7 }, (_, index) => ({
  openid: `p${index + 1}`,
  wecomName: `P${index + 1}`,
  totalPoints: 100 - index
}));
const built = generateTeamMatchBrackets(players, 2, { A: 'p1', B: 'p2' });
const match = built.groups[0].matches[0];
const aOids = new Set(built.teams[0].members.map(member => member.openid));
const bOids = new Set(built.teams[1].members.map(member => member.openid));
assert.strictEqual(match.courts.length, 2);
match.courts.forEach(court => {
  assert.ok(court.players.some(openid => aOids.has(openid)), '每片场地必须有 A 队员');
  assert.ok(court.players.some(openid => bOids.has(openid)), '每片场地必须有 B 队员');
});

const excessive = generateTeamMatchBrackets(players, 4, { A: 'p1', B: 'p2' });
assert.strictEqual(excessive.maxCourtCount, 3);
assert.strictEqual(excessive.requestedCourtCount, 4);
assert.strictEqual(excessive.groups[0].matches[0].courts.length, 3);

const redistributed = redistributeTeamCourts(match, built.teams, 3);
assert.ok(!redistributed.error);
assert.strictEqual(redistributed.courts.length, 3);
redistributed.courts.forEach(court => {
  assert.ok(court.players.some(openid => aOids.has(openid)));
  assert.ok(court.players.some(openid => bOids.has(openid)));
});

const invalid = redistributeTeamCourts(match, built.teams, 4);
assert.strictEqual(invalid.maxCourtCount, 3);
assert.ok(invalid.error);

console.log('team match court constraints: 4 paths passed');
