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
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
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
    const WEEKDAYS = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
    return api
      .listActivities()
      .then(list => {
        const formatted = (list || []).map(it => {
          const d = new Date(it.startTime);
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          return {
            ...it,
            startTimeText: formatDateTime(it.startTime),
            joinedCount: (it.participants || []).length,
            weekdayText: WEEKDAYS[d.getDay()],
            dateShort: `${mm}/${dd}`
          };
        });
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
