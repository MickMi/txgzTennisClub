const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const wxml = fs.readFileSync(
  require.resolve('../miniprogram/pages/tournament-detail/tournament-detail.wxml'),
  'utf8'
);
const js = fs.readFileSync(
  require.resolve('../miniprogram/pages/tournament-detail/tournament-detail.js'),
  'utf8'
);

let pageConfig = null;
const sandbox = {
  require(name) {
    if (name.includes('/api.js')) return {};
    if (name.includes('/user.js')) return { getCachedUser: () => null };
    if (name.includes('/format.js')) return { formatDate: value => value };
    return require(name);
  },
  Page(config) { pageConfig = config; },
  console,
  Set,
  Map
};
vm.runInNewContext(js, sandbox, { filename: 'tournament-detail.js' });
assert.ok(pageConfig, 'Page 配置必须可加载');

const eventPattern = /\b(?:bind|catch)(?:tap|change|input|blur|confirm|longpress)="([A-Za-z_$][\w$]*)"/g;
const handlers = new Set();
let match;
while ((match = eventPattern.exec(wxml))) handlers.add(match[1]);
const missing = Array.from(handlers).filter(name => typeof pageConfig[name] !== 'function');
assert.deepStrictEqual(missing, [], `WXML 存在未实现事件：${missing.join(', ')}`);
assert.ok(handlers.has('onCycleCourtRecommendation'));
assert.ok(handlers.has('onOpenEncounterModal'));
assert.ok(handlers.has('onSaveEncounterLineup'));
assert.ok(handlers.has('onRevertEncounterScore'));

const addEncounterIndex = wxml.indexOf('＋ 添加场次');
const recommendationIndex = wxml.indexOf('NEXT · 下一场建议');
assert.ok(addEncounterIndex >= 0, '场地卡片必须保留添加场次主入口');
assert.ok(recommendationIndex > addEncounterIndex, '下一场建议必须排在添加场次主入口之后');
assert.match(wxml, /editingTeamEncounter\.isNew[\s\S]*onSaveEncounterLineup/);
assert.match(wxml, /editingTeamEncounter\.hasScore[\s\S]*onRevertEncounterScore/);

console.log(`tournament detail WXML contract: ${handlers.size} handlers resolved`);
