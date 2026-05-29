const api = require('../../utils/api.js');
const { ensureRegistered } = require('../../utils/user.js');
const { formatDateTime } = require('../../utils/format.js');

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function formatItem(it) {
  const d = new Date(it.startTime);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return {
    ...it,
    startTimeText: formatDateTime(it.startTime),
    // 兼容老返回：participantCount 是新字段，老接口走 participants.length
    joinedCount: it.participantCount !== undefined
      ? it.participantCount
      : (it.participants || []).length,
    weekdayText: WEEKDAYS[d.getDay()],
    dateShort: `${mm}/${dd}`
  };
}

Page({
  data: {
    list: [],
    loading: true,
    user: null,
    hasMore: false,
    nextCursor: null,
    loadingMore: false
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

  // 触底加载下一页
  onReachBottom() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    this.loadMore();
  },

  loadList() {
    return api
      .listActivities()
      .then(res => {
        // 兼容老接口（直接返回数组）和新接口（{ list, hasMore, nextCursor }）
        const isPaged = res && Array.isArray(res.list);
        const rawList = isPaged ? res.list : (res || []);
        const formatted = rawList.map(formatItem);
        this.setData({
          list: formatted,
          loading: false,
          hasMore: isPaged ? !!res.hasMore : false,
          nextCursor: isPaged ? res.nextCursor : null
        });
      })
      .catch(() => this.setData({ loading: false }));
  },

  loadMore() {
    if (!this.data.nextCursor) return Promise.resolve();
    this.setData({ loadingMore: true });
    return api
      .listActivities({ before: this.data.nextCursor, silent: true })
      .then(res => {
        const isPaged = res && Array.isArray(res.list);
        const rawList = isPaged ? res.list : (res || []);
        const more = rawList.map(formatItem);
        this.setData({
          list: this.data.list.concat(more),
          hasMore: isPaged ? !!res.hasMore : false,
          nextCursor: isPaged ? res.nextCursor : null,
          loadingMore: false
        });
      })
      .catch(() => this.setData({ loadingMore: false }));
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/activity-create/activity-create' });
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/activity-detail/activity-detail?id=${id}` });
  }
});
