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

  // activity
  listActivities: (opts = {}) => {
    const fn = opts.silent ? callSilent : call;
    const { silent, ...rest } = opts;
    return fn('activity', { action: 'list', ...rest });
  },
  getActivity: id => call('activity', { action: 'get', id }),
  createActivity: payload => call('activity', { action: 'create', payload }),
  updateActivity: (id, payload) => call('activity', { action: 'update', id, payload }),
  deleteActivity: id => call('activity', { action: 'delete', id }),
  joinActivity: id => call('activity', { action: 'join', id }),
  leaveActivity: id => call('activity', { action: 'leave', id }),
  closeActivity: id => call('activity', { action: 'close', id }),

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
  // opts 形如 { groupCount, advanceCount, seedCount, pairs?: [[oid1,oid2],...] }
  // 双打必须传 pairs；单打传不传都行
  scoreGroup: (id, groupIndex, matchId, scoreA, scoreB) =>
    call('tournament', { action: 'scoreGroup', id, groupIndex, matchId, scoreA, scoreB }),
  startKnockout: id => call('tournament', { action: 'startKnockout', id }),
  scoreKnockout: (id, roundIndex, matchId, scoreA, scoreB) =>
    call('tournament', { action: 'scoreKnockout', id, roundIndex, matchId, scoreA, scoreB }),
  // 撤回比分（参赛任一 / creator / admin 可发起）
  revertScore: (id, payload) =>
    call('tournament', { action: 'revertScore', id, ...payload })
};
