const api = require('../../utils/api.js');
const { ensureRegistered } = require('../../utils/user.js');
const { formatDateTime } = require('../../utils/format.js');

Page({
  data: {
    list: [],
    loading: true,
    user: null
  },

  onShow() {
    ensureRegistered().then(user => {
      if (!user) return;
      this.setData({ user });
      this.loadList();
    });
  },

  onPullDownRefresh() {
    this.loadList().then(() => wx.stopPullDownRefresh());
  },

  loadList() {
    return api
      .listActivities()
      .then(list => {
        const formatted = (list || []).map(it => ({
          ...it,
          startTimeText: formatDateTime(it.startTime),
          joinedCount: (it.participants || []).length
        }));
        this.setData({ list: formatted, loading: false });
      })
      .catch(() => {
        this.setData({ loading: false });
      });
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/activity-create/activity-create' });
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/activity-detail/activity-detail?id=${id}` });
  }
});
