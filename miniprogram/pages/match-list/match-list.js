const api = require('../../utils/api.js');
const { getCachedUser, setCachedUser } = require('../../utils/user.js');
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
    loadingMore: false,
    isAdmin: false,
    showCreate: false, // 隐藏创建入口，连续点击标题 5 次后显示（仅 admin 生效）
    myRank: 0,
    totalMembers: 0
  },

  _titleTapCount: 0,
  _titleTapTimer: null,

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    // 不再强制跳 onboarding，允许未注册用户只读浏览
    api.login().then(user => {
      setCachedUser(user);
      this.setData({ isAdmin: user && user.role === 'admin' });
      this.loadTournaments();
      this.loadMyRank();
    }).catch(() => {
      // 即使 login 失败也加载列表（只读模式）
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

  // 连续点击标题 5 次激活创建入口（仅 admin 有效）
  onTitleTap() {
    if (!this.data.isAdmin) return;
    this._titleTapCount++;
    clearTimeout(this._titleTapTimer);
    this._titleTapTimer = setTimeout(() => { this._titleTapCount = 0; }, 2000);
    if (this._titleTapCount >= 5) {
      this._titleTapCount = 0;
      this.setData({ showCreate: true });
      wx.showToast({ title: '管理模式已激活', icon: 'none', duration: 1500 });
    }
  },

  goCreate() {
    if (!this.data.isAdmin) {
      wx.showToast({ title: '只有管理员可以创建赛事', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/tournament-create/tournament-create' });
  },

  loadMyRank() {
    api.getRanking({ silent: true }).then(res => {
      const list = (res && res.list) || [];
      const myRank = res && res.myRank ? res.myRank : 0;
      this.setData({ myRank, totalMembers: list.length });
    }).catch(() => {});
  },

  goRanking() {
    wx.navigateTo({ url: '/pages/ranking/ranking' });
  },

  goTournamentDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/tournament-detail/tournament-detail?id=${id}` });
  }
});
