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

  // user
  updateUser: payload => call('login', { action: 'update', payload }),
  getProfile: () => call('login', { action: 'getProfile' }),
  getRanking: () => call('login', { action: 'getRanking' }),

  // tournament（默认静默调用，云函数未部署时不报错）
  listTournaments: (opts = {}) => callSilent('tournament', { action: 'list', ...opts }),
  getTournament: id => call('tournament', { action: 'get', id }),
  createTournament: payload => call('tournament', { action: 'create', payload }),
  signupTournament: id => call('tournament', { action: 'signup', id }),
  cancelSignupTournament: id => call('tournament', { action: 'cancelSignup', id }),
  drawTournament: (id, opts) => call('tournament', { action: 'draw', id, ...opts }),
  scoreGroup: (id, groupIndex, matchId, scoreA, scoreB) =>
    call('tournament', { action: 'scoreGroup', id, groupIndex, matchId, scoreA, scoreB }),
  startKnockout: id => call('tournament', { action: 'startKnockout', id }),
  scoreKnockout: (id, roundIndex, matchId, scoreA, scoreB) =>
    call('tournament', { action: 'scoreKnockout', id, roundIndex, matchId, scoreA, scoreB })
};
