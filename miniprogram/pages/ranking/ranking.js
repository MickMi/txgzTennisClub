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
    this.setData({ myOpenid: user ? user.openid : '' });
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
  }
});
