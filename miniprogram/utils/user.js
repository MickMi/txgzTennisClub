const api = require('./api.js');

const KEY = 'tennis_user';

function getCachedUser() {
  try {
    return wx.getStorageSync(KEY) || null;
  } catch (e) {
    return null;
  }
}

function setCachedUser(u) {
  try {
    wx.setStorageSync(KEY, u || null);
  } catch (e) {}
}

// 进入需要鉴权的页面前调用：确保已登记企微名，否则跳转 onboarding
function ensureRegistered() {
  return api.login().then(user => {
    setCachedUser(user);
    if (!user || !user.wecomName) {
      wx.redirectTo({ url: '/pages/onboarding/onboarding' });
      return null;
    }
    return user;
  });
}

module.exports = { getCachedUser, setCachedUser, ensureRegistered };
