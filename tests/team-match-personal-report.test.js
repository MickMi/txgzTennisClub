const assert = require('assert');
const { collectUserMatches } = require('../miniprogram/utils/highlight.js');

const tournament = {
  type: 'team',
  teams: [
    { openid: 'team_A', members: [{ openid: 'a1', wecomName: '甲' }, { openid: 'a2', wecomName: '乙' }] },
    { openid: 'team_B', members: [{ openid: 'b1', wecomName: '丙' }, { openid: 'b2', wecomName: '丁' }] }
  ],
  groups: [{
    matches: [{
      id: 'tm_1',
      courts: [{
        id: 'court_1',
        name: '1号场',
        encounters: [{
          id: 'enc_1',
          lineup: { A: ['a1', 'a2'], B: ['b1', 'b2'] },
          setsA: 6,
          setsB: 4,
          score: '6-4',
          winner: 'A'
        }]
      }],
      tiebreak: {
        lineup: { A: ['a1'], B: ['b1'] },
        setsA: 1,
        setsB: 0,
        score: '1-0',
        winner: 'A'
      }
    }]
  }]
};

const matches = collectUserMatches(tournament, 'a1');
assert.strictEqual(matches.length, 2);
assert.strictEqual(matches[0].round, '团队赛 · 1号场');
assert.strictEqual(matches[0].partner.wecomName, '乙');
assert.strictEqual(matches[0].opponent.wecomName, '丙/丁');
assert.strictEqual(matches[0].scoreSummary, '6:4');
assert.strictEqual(matches[0].won, true);
assert.strictEqual(matches[1].match.isTiebreak, true);
assert.strictEqual(matches[1].round, '团队赛 · 一球制胜');

console.log('team match personal report: courts and tiebreak passed');
