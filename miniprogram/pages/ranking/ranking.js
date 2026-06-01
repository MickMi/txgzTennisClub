const api = require('../../utils/api.js');
const { getCachedUser } = require('../../utils/user.js');

Page({
  data: {
    list: [],
    myRank: 0,
    myOpenid: '',
    loading: true
  },

  onLoad() {
    const user = getCachedUser();
    const app = getApp();
    this.setData({
      myOpenid: user ? user.openid : '',
      navTop: app.globalData.nav ? app.globalData.nav.navTopRpx : 0
    });
  },

  goBack() {
    wx.navigateBack();
  },

  onShow() {
    this.loadRanking();
  },

  onPullDownRefresh() {
    this.loadRanking().then(() => wx.stopPullDownRefresh());
  },

  loadRanking() {
    this.setData({ loading: true });
    return api
      .getRanking()
      .then(data => {
        this.setData({
          list: data.list || [],
          myRank: data.myRank || 0,
          loading: false
        });
      })
      .catch(() => this.setData({ loading: false }));
  },

  // 点击榜单项 → 个人详情
  goUserDetail(e) {
    const { openid, name } = e.currentTarget.dataset;
    if (!openid) return;
    wx.navigateTo({
      url: `/pages/user-detail/user-detail?openid=${openid}&name=${encodeURIComponent(name || '')}`
    });
  }
});
