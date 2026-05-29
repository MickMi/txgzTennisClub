const api = require('../../utils/api.js');
const { ensureRegistered } = require('../../utils/user.js');
const { formatDate } = require('../../utils/format.js');

const LEVEL_LABELS = { major: '半年赛', challenge: '月赛', friendly: '周赛' };
const T_STATUS_MAP = { signup: '报名中', group: '小组赛', knockout: '淘汰赛', finished: '已结束' };

function formatItem(it) {
  return {
    ...it,
    dateText: formatDate(it.matchDate),
    levelText: LEVEL_LABELS[it.level] || '周赛',
    statusText: T_STATUS_MAP[it.status] || it.status,
    // 兼容老返回（直接 it.players）
    playerCount: it.playerCount !== undefined
      ? it.playerCount
      : (it.players || []).length
  };
}

Page({
  data: {
    tournaments: [],
    loading: true,
    hasMore: false,
    nextCursor: null,
    loadingMore: false
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
    ensureRegistered().then(user => {
      if (!user) return;
      this.loadTournaments();
    });
  },

  onPullDownRefresh() {
    this.loadTournaments().then(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    this.loadMore();
  },

  loadTournaments() {
    this.setData({ loading: true });
    return api
      .listTournaments()
      .then(res => {
        const isPaged = res && Array.isArray(res.list);
        const rawList = isPaged ? res.list : (res || []);
        this.setData({
          tournaments: rawList.map(formatItem),
          loading: false,
          hasMore: isPaged ? !!res.hasMore : false,
          nextCursor: isPaged ? res.nextCursor : null
        });
      })
      .catch(() => this.setData({ tournaments: [], loading: false }));
  },

  loadMore() {
    if (!this.data.nextCursor) return Promise.resolve();
    this.setData({ loadingMore: true });
    return api
      .listTournaments({ before: this.data.nextCursor })
      .then(res => {
        const isPaged = res && Array.isArray(res.list);
        const rawList = isPaged ? res.list : (res || []);
        const more = rawList.map(formatItem);
        this.setData({
          tournaments: this.data.tournaments.concat(more),
          hasMore: isPaged ? !!res.hasMore : false,
          nextCursor: isPaged ? res.nextCursor : null,
          loadingMore: false
        });
      })
      .catch(() => this.setData({ loadingMore: false }));
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/tournament-create/tournament-create' });
  },

  goRanking() {
    wx.navigateTo({ url: '/pages/ranking/ranking' });
  },

  goTournamentDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/tournament-detail/tournament-detail?id=${id}` });
  }
});
