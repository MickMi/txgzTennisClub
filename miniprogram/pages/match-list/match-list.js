const api = require('../../utils/api.js');
const { ensureRegistered } = require('../../utils/user.js');
const { formatDate } = require('../../utils/format.js');

const LEVEL_LABELS = { major: '半年赛', challenge: '月赛', friendly: '周赛' };
const T_STATUS_MAP = { signup: '报名中', group: '小组赛', knockout: '淘汰赛', finished: '已结束' };

Page({
  data: {
    tournaments: [],
    loading: true
  },

  onShow() {
    ensureRegistered().then(user => {
      if (!user) return;
      this.loadTournaments();
    });
  },

  onPullDownRefresh() {
    this.loadTournaments().then(() => wx.stopPullDownRefresh());
  },

  loadTournaments() {
    this.setData({ loading: true });
    return api
      .listTournaments()
      .then(list => {
        const formatted = (list || []).map(it => ({
          ...it,
          dateText: formatDate(it.matchDate),
          levelText: LEVEL_LABELS[it.level] || '周赛',
          statusText: T_STATUS_MAP[it.status] || it.status,
          playerCount: (it.players || []).length
        }));
        this.setData({ tournaments: formatted, loading: false });
      })
      .catch(() => this.setData({ tournaments: [], loading: false }));
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
