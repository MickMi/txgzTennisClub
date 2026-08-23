const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');

function verifyProductionSurface() {
  const appConfig = JSON.parse(read('miniprogram/app.json'));
  const apiSource = read('miniprogram/utils/api.js');
  const loginSource = read('cloudfunctions/login/index.js');
  const profileJs = read('miniprogram/pages/profile/profile.js');
  const profileWxml = read('miniprogram/pages/profile/profile.wxml');
  const projectConfig = JSON.parse(read('project.config.json'));

  assert.deepStrictEqual(
    appConfig.tabBar.list.map(item => item.pagePath),
    ['pages/match-list/match-list', 'pages/profile/profile']
  );
  assert.ok(appConfig.pages.every(page => !page.includes('activity')));
  assert.ok(appConfig.pages.every(page => !page.includes('test-fixtures')));
  assert.doesNotMatch(apiSource, /\b(?:list|get|create|update|delete|join|leave|close)Activity\b/);
  assert.doesNotMatch(loginSource, /collection\(['"]activities['"]\)/);
  assert.doesNotMatch(profileJs, /\bactivities\b|goTestFixtures|test-fixtures/);
  assert.doesNotMatch(profileWxml, /goTestFixtures|test-fixtures|测试夹具/);
  assert.doesNotMatch(projectConfig.description, /活动/);

  // 研发夹具仍保留在源码中，且云函数入口继续受管理员校验保护。
  assert.ok(fs.existsSync(path.join(projectRoot, 'miniprogram/pages/test-fixtures/test-fixtures.js')));
  const tournamentSource = read('cloudfunctions/tournament/index.js');
  for (const action of ['seedTeamMatchTest', 'seedTournamentTest', 'seedKnockoutTest', 'cleanupTestData']) {
    const actionStart = tournamentSource.indexOf(`if (action === '${action}')`);
    assert.ok(actionStart >= 0, `${action} 夹具入口应继续存在`);
    const guardedSection = tournamentSource.slice(actionStart, actionStart + 260);
    assert.match(guardedSection, /role !== 'admin'/, `${action} 必须保留管理员校验`);
  }
}

async function verifyActivityCloudIsDisabled() {
  const source = read('cloudfunctions/activity/index.js');
  let collectionCalls = 0;
  const db = {
    command: {},
    collection() {
      collectionCalls++;
      throw new Error('活动停用后不应访问数据库集合');
    }
  };
  const cloud = {
    DYNAMIC_CURRENT_ENV: 'test',
    init() {},
    database: () => db,
    getWXContext() {
      throw new Error('活动停用后不应读取用户上下文');
    }
  };
  const moduleObject = { exports: {} };
  const sandbox = {
    require: name => name === 'wx-server-sdk' ? cloud : require(name),
    module: moduleObject,
    exports: moduleObject.exports,
    console,
    Date,
    Math,
    Promise
  };
  vm.runInNewContext(source, sandbox, { filename: 'cloudfunctions/activity/index.js' });

  const actions = ['list', 'get', 'create', 'update', 'delete', 'join', 'leave', 'close'];
  for (const action of actions) {
    const result = await moduleObject.exports.main({ action });
    assert.strictEqual(result.code, 1);
    assert.strictEqual(result.msg, '活动功能已下线，请使用赛事功能');
  }
  assert.strictEqual(collectionCalls, 0);
}

(async () => {
  verifyProductionSurface();
  await verifyActivityCloudIsDisabled();
  console.log('release boundary: activity disabled and test fixtures hidden from production');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
