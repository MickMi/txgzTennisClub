const api = require('../../utils/api.js');
const { getCachedUser } = require('../../utils/user.js');
const { formatDate } = require('../../utils/format.js');

const LEVEL_MAP = { major: '半年赛', challenge: '月赛', friendly: '周赛' };
const STATUS_MAP = { signup: '报名中', group: '小组赛', knockout: '淘汰赛', finished: '已结束' };

Page({
  data: {
    id: '',
    t: null,
    user: null,
    isOwner: false,
    signed: false,
    activeTab: 0, // 0: 赛况, 1: 签表
    // 抽签设置
    drawGroupCount: 2,
    drawAdvanceCount: 2,
    drawSeedCount: 0,
    groupCountOptions: [2, 3, 4, 6, 8],
    advanceOptions: [1, 2, 3, 4],
    // 小组赛录分
    editingGroup: null,
    groupScoreA: '',
    groupScoreB: '',
    // 淘汰赛录分
    editingKO: null,
    koScoreA: '',
    koScoreB: ''
  },

  onLoad(opts) {
    this.setData({ id: opts.id, user: getCachedUser() });
  },

  onShow() {
    if (this.data.id) this.load();
  },

  load() {
    return api.getTournament(this.data.id).then(t => {
      const me = this.data.user;
      const isOwner = !!(me && (t.creator === me.openid || me.role === 'admin'));
      const signed = !!(me && (t.players || []).some(p => p.openid === me.openid));
      this.setData({
        t: {
          ...t,
          dateText: formatDate(t.matchDate),
          levelText: LEVEL_MAP[t.level] || '周赛',
          statusText: STATUS_MAP[t.status] || t.status
        },
        isOwner,
        signed,
        drawGroupCount: t.config.groupCount || 2,
        drawAdvanceCount: t.config.advanceCount || 2,
        drawSeedCount: t.config.seedCount || 0
      });
    });
  },

  onTabChange(e) {
    this.setData({ activeTab: parseInt(e.currentTarget.dataset.tab) });
  },

  // 报名
  onSignup() {
    api.signupTournament(this.data.id).then(() => {
      wx.showToast({ title: '已报名', icon: 'success' });
      this.load();
    });
  },

  // 取消报名
  onCancelSignup() {
    wx.showModal({
      title: '取消报名',
      content: '确认取消？',
      success: res => {
        if (res.confirm) {
          api.cancelSignupTournament(this.data.id).then(() => {
            wx.showToast({ title: '已取消', icon: 'success' });
            this.load();
          });
        }
      }
    });
  },

  // 抽签参数调整
  onDrawGroupCountChange(e) {
    this.setData({ drawGroupCount: this.data.groupCountOptions[+e.detail.value] });
  },

  onDrawAdvanceChange(e) {
    this.setData({ drawAdvanceCount: this.data.advanceOptions[+e.detail.value] });
  },

  onDrawSeedInput(e) {
    this.setData({ drawSeedCount: parseInt(e.detail.value) || 0 });
  },

  // 抽签
  onDraw() {
    const { drawGroupCount, drawAdvanceCount, drawSeedCount } = this.data;
    const playerCount = this.data.t.players.length;
    wx.showModal({
      title: '确认抽签分组',
      content: `${playerCount}人 → 分${drawGroupCount}组 → 每组前${drawAdvanceCount}名晋级${drawSeedCount > 0 ? ' · ' + drawSeedCount + '种子' : ' · 随机'}`,
      success: res => {
        if (res.confirm) {
          api.drawTournament(this.data.id, {
            groupCount: drawGroupCount,
            advanceCount: drawAdvanceCount,
            seedCount: drawSeedCount
          }).then(() => {
            wx.showToast({ title: '抽签完成', icon: 'success' });
            this.load();
          });
        }
      }
    });
  },

  // 开始淘汰赛
  onStartKnockout() {
    wx.showModal({
      title: '进入淘汰赛',
      content: '小组赛已全部完成，确认进入淘汰赛阶段？',
      success: res => {
        if (res.confirm) {
          api.startKnockout(this.data.id).then(() => {
            wx.showToast({ title: '淘汰赛开始', icon: 'success' });
            this.load();
          });
        }
      }
    });
  },

  // 小组赛 - 开始录分
  onEditGroupScore(e) {
    const { gi, mid } = e.currentTarget.dataset;
    this.setData({
      editingGroup: { groupIndex: gi, matchId: mid },
      groupScoreA: '',
      groupScoreB: ''
    });
  },

  onGroupScoreAInput(e) {
    this.setData({ groupScoreA: e.detail.value });
  },

  onGroupScoreBInput(e) {
    this.setData({ groupScoreB: e.detail.value });
  },

  onCancelGroupScore() {
    this.setData({ editingGroup: null });
  },

  onSaveGroupScore() {
    const a = parseInt(this.data.groupScoreA);
    const b = parseInt(this.data.groupScoreB);
    if (isNaN(a) || isNaN(b) || a < 0 || b < 0) {
      wx.showToast({ title: '请输入有效比分', icon: 'none' });
      return;
    }
    if (a === b) {
      wx.showToast({ title: '比分不能相同', icon: 'none' });
      return;
    }
    const { groupIndex, matchId } = this.data.editingGroup;
    api.scoreGroup(this.data.id, groupIndex, matchId, a, b).then(() => {
      wx.showToast({ title: '已保存', icon: 'success' });
      this.setData({ editingGroup: null });
      this.load();
    });
  },

  // 淘汰赛 - 开始录分
  onEditKOScore(e) {
    const { ri, mid } = e.currentTarget.dataset;
    this.setData({
      editingKO: { roundIndex: ri, matchId: mid },
      koScoreA: '',
      koScoreB: ''
    });
  },

  onKOScoreAInput(e) {
    this.setData({ koScoreA: e.detail.value });
  },

  onKOScoreBInput(e) {
    this.setData({ koScoreB: e.detail.value });
  },

  onCancelKOScore() {
    this.setData({ editingKO: null });
  },

  onSaveKOScore() {
    const a = parseInt(this.data.koScoreA);
    const b = parseInt(this.data.koScoreB);
    if (isNaN(a) || isNaN(b) || a < 0 || b < 0) {
      wx.showToast({ title: '请输入有效比分', icon: 'none' });
      return;
    }
    if (a === b) {
      wx.showToast({ title: '比分不能相同', icon: 'none' });
      return;
    }
    const { roundIndex, matchId } = this.data.editingKO;
    api.scoreKnockout(this.data.id, roundIndex, matchId, a, b).then(() => {
      wx.showToast({ title: '已保存', icon: 'success' });
      this.setData({ editingKO: null });
      this.load();
    });
  }
});
