const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync(
  require.resolve('../miniprogram/pages/tournament-detail/tournament-detail.js'),
  'utf8'
);
const moduleObject = { exports: {} };
const sandbox = {
  require(name) {
    if (name.includes('/api.js')) return {};
    if (name.includes('/user.js')) return { getCachedUser: () => null };
    if (name.includes('/format.js')) return { formatDate: value => value };
    return require(name);
  },
  module: moduleObject,
  exports: moduleObject.exports,
  Page() {},
  console,
  Set,
  Map
};
vm.runInNewContext(
  `${source}\nmodule.exports.__test = { buildCourtRecommendations };`,
  sandbox,
  { filename: 'tournament-detail.js' }
);

const { buildCourtRecommendations } = moduleObject.exports.__test;
const aPlayers = ['a1', 'a2', 'a3'].map(openid => ({ openid, wecomName: openid.toUpperCase() }));
const bPlayers = ['b1', 'b2', 'b3'].map(openid => ({ openid, wecomName: openid.toUpperCase() }));

const initial = buildCourtRecommendations(aPlayers, bPlayers, []);
assert.strictEqual(initial.length, 9);
assert.strictEqual(initial[0].lineup.A.length, 2);
assert.strictEqual(initial[0].lineup.B.length, 2);

const afterOneMatch = buildCourtRecommendations(aPlayers, bPlayers, [{
  lineup: { A: ['a1', 'a2'], B: ['b1', 'b2'] },
  winner: 'A'
}]);
assert.ok(afterOneMatch[0].lineup.A.includes('a3'), '低出场 A 队员应进入下一场建议');
assert.ok(afterOneMatch[0].lineup.B.includes('b3'), '低出场 B 队员应进入下一场建议');
assert.notDeepStrictEqual(
  JSON.parse(JSON.stringify(afterOneMatch[0].lineup)),
  { A: ['a1', 'a2'], B: ['b1', 'b2'] },
  '不应立即推荐完全相同的对阵'
);

console.log('team match recommendation: rotation paths passed');
