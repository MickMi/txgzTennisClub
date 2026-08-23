// 云函数调用封装
function call(name, data = {}) {
  wx.showLoading({ title: '加载中', mask: true });
  return wx.cloud
    .callFunction({ name, data })
    .then(res => {
      wx.hideLoading();
      if (res.result && res.result.code !== 0) {
        wx.showToast({ title: res.result.msg || '操作失败', icon: 'none' });
        return Promise.reject(res.result);
      }
      return res.result ? res.result.data : null;
    })
    .catch(err => {
      wx.hideLoading();
      console.error(`[${name}]`, err);
      if (!err || !err.msg) {
        wx.showToast({ title: '网络异常', icon: 'none' });
      }
      return Promise.reject(err);
    });
}

// 静默调用（不显示 loading 和错误 toast，适用于非关键请求）
function callSilent(name, data = {}) {
  return wx.cloud
    .callFunction({ name, data })
    .then(res => {
      if (res.result && res.result.code !== 0) {
        return Promise.reject(res.result);
      }
      return res.result ? res.result.data : null;
    })
    .catch(err => {
      console.error(`[${name}:silent]`, err);
      return Promise.reject(err);
    });
}

module.exports = {
  // login
  login: () => call('login'),

  // avatar upload (returns cloud fileID)
  uploadAvatar: (tempFilePath) => {
    const ext = tempFilePath.split('.').pop() || 'png';
    const cloudPath = `avatars/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    wx.showLoading({ title: '上传中', mask: true });
    return wx.cloud.uploadFile({
      cloudPath,
      filePath: tempFilePath
    }).then(res => {
      wx.hideLoading();
      return res.fileID;
    }).catch(err => {
      wx.hideLoading();
      console.error('[uploadAvatar]', err);
      wx.showToast({ title: '头像上传失败', icon: 'none' });
      return Promise.reject(err);
    });
  },

  // user
  updateUser: payload => call('login', { action: 'update', payload }),
  getProfile: () => call('login', { action: 'getProfile' }),
  getProfileByOpenid: openid => call('login', { action: 'getProfile', openid }),
  getRanking: (opts = {}) => (opts.silent ? callSilent : call)('login', { action: 'getRanking' }),
  // 成员管理（admin 限定）
  listMembers: () => call('login', { action: 'listMembers' }),
  setRole: (targetOpenid, role) => call('login', { action: 'setRole', targetOpenid, role }),

  // tournament（默认静默调用，云函数未部署时不报错）
  listTournaments: (opts = {}) => callSilent('tournament', { action: 'list', ...opts }),
  getTournament: id => call('tournament', { action: 'get', id }),
  createTournament: payload => call('tournament', { action: 'create', payload }),
  signupTournament: id => call('tournament', { action: 'signup', id }),
  cancelSignupTournament: id => call('tournament', { action: 'cancelSignup', id }),
  deleteTournament: id => call('tournament', { action: 'delete', id }),
  drawTournament: (id, opts) => call('tournament', { action: 'draw', id, ...opts }),
  // opts 形如：
  //   单/双打：{ groupCount, advanceCount, seedCount, pairs?: [[oid1,oid2],...] }（双打必须传 pairs，单打可不传）
  //   团队赛：{ captainA, captainB, bestOf, teamMatchCourts }
  scoreGroup: (id, groupIndex, matchId, scoreA, scoreB) =>
    call('tournament', { action: 'scoreGroup', id, groupIndex, matchId, scoreA, scoreB }),
  startKnockout: id => call('tournament', { action: 'startKnockout', id }),
  scoreKnockout: (id, roundIndex, matchId, scoreA, scoreB) =>
    call('tournament', { action: 'scoreKnockout', id, roundIndex, matchId, scoreA, scoreB }),
  // 团队赛：先确认上场人员，生成待录比分场次。
  saveEncounterLineup: (id, matchId, courtId, lineupA, lineupB, encounterId) =>
    call('tournament', {
      action: 'saveEncounterLineup', id, matchId, courtId,
      lineupA: lineupA || [], lineupB: lineupB || [], encounterId: encounterId || ''
    }),
  // 团队赛：场地内自由轮换，打完一场记一条 encounter。
  enterEncounterScore: (id, matchId, courtId, setsA, setsB, lineupA, lineupB, encounterId, isTiebreak) =>
    call('tournament', {
      action: 'enterEncounterScore', id, matchId, courtId, setsA, setsB,
      lineupA: lineupA || [], lineupB: lineupB || [], encounterId: encounterId || '', isTiebreak: !!isTiebreak
    }),
  revertEncounterScore: (id, matchId, courtId, encounterId) =>
    call('tournament', { action: 'revertEncounterScore', id, matchId, courtId, encounterId }),
  randomizeTeamLineups: (id, matchId) =>
    call('tournament', { action: 'randomizeTeamLineups', id, matchId }),
  addCourt: (id, matchId) => call('tournament', { action: 'addCourt', id, matchId }),
  removeCourt: (id, matchId, courtId) => call('tournament', { action: 'removeCourt', id, matchId, courtId }),
  finishTeamMatch: (id, matchId) =>
    call('tournament', { action: 'finishTeamMatch', id, matchId }),
  // 撤回比分（参赛任一 / creator / admin 可发起）
  revertScore: (id, payload) =>
    call('tournament', { action: 'revertScore', id, ...payload }),
  // 移除选手（仅 group 阶段、creator/admin，移除后重建该组对阵）
  removePlayer: (id, openid) => call('tournament', { action: 'removePlayer', id, openid }),
  // 重算小组排名（仅 group 阶段、creator/admin，如 H2H 规则更新后刷新）
  recalcStandings: (id) => call('tournament', { action: 'recalcStandings', id }),
  // 重建淘汰赛对阵（仅 knockout 阶段、creator/admin、所有淘汰赛比分已撤回）
  regenKnockout: (id) => call('tournament', { action: 'regenKnockout', id }),
  // 测试夹具（仅 admin）
  seedTeamMatchTest: scenario => call('tournament', { action: 'seedTeamMatchTest', scenario }),
  seedTournamentTest: scenario => call('tournament', { action: 'seedTournamentTest', scenario }),
  seedKnockoutTest: () => call('tournament', { action: 'seedKnockoutTest' }),
  swapTeamMember: (id, openid) => call('tournament', { action: 'swapTeamMember', id, openid }),
  moveCourtMember: (id, openid, targetCourtId) => call('tournament', { action: 'moveCourtMember', id, openid, targetCourtId }),
  cleanupTestData: () => call('tournament', { action: 'cleanupTestData' }),
  // 中途加人（仅 group 阶段、creator/admin）
  addPlayerToTournament: (id, newPlayerOpenids, targetGroup, targetTeam) =>
    call('tournament', { action: 'addPlayer', id, newPlayerOpenids, targetGroup, targetTeam }),
  // 回滚到报名态（仅 group 阶段、无已录分、creator/admin）
  rollbackToSignup: id => call('tournament', { action: 'rollbackToSignup', id }),
  // 更新赛制配置（仅 group 阶段、creator/admin）
  updateTournamentConfig: (id, opts) => call('tournament', { action: 'updateConfig', id, ...opts }),
  // 三四名决赛
  addThirdPlaceMatch: id => call('tournament', { action: 'addThirdPlaceMatch', id }),
  finalizeFourStrong: id => call('tournament', { action: 'finalizeFourStrong', id }),
  // 手动调组（仅 group 阶段、单打/双打、creator/admin）
  movePlayer: (id, openid, toGroup) => call('tournament', { action: 'movePlayer', id, openid, toGroup })
};
