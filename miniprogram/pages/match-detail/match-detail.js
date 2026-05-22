const api = require('../../utils/api.js');
const { getCachedUser } = require('../../utils/user.js');
const { formatDate } = require('../../utils/format.js');

const LEVEL_MAP = {
  major: { text: '半年赛', win: 100, lose: 40 },
  challenge: { text: '月赛', win: 60, lose: 25 },
  friendly: { text: '周赛', win: 30, lose: 10 }
};
const DOUBLES_FACTOR = 0.8;

Page({
  data: {
    id: '',
    detail: null,
    user: null,
    signed: false,
    canManage: false,
    canEditScore: false,
    editing: false,
    scoreAInput: '',
    scoreBInput: ''
  },

  onLoad(opts) {
    this.setData({ id: opts.id, user: getCachedUser() });
  },

  onShow() {
    if (this.data.id) this.load();
  },

  load() {
    return api.getMatch(this.data.id).then(detail => {
      const me = this.data.user;
      const signups = detail.signups || [];
      const signed = !!(me && signups.some(p => p.openid === me.openid));
      const inTeam = !!(me && (
        (detail.teamA || []).some(p => p.openid === me.openid) ||
        (detail.teamB || []).some(p => p.openid === me.openid)
      ));
      const canManage = !!(me && (detail.creator === me.openid || me.role === 'admin'));
      const canEditScore = !!(me && (inTeam || canManage));

      // 计算级别展示信息
      const level = detail.level || 'friendly';
      const levelInfo = LEVEL_MAP[level] || LEVEL_MAP.friendly;
      const factor = detail.type === 'doubles' ? DOUBLES_FACTOR : 1;
      const winPts = Math.round(levelInfo.win * factor);
      const losePts = Math.round(levelInfo.lose * factor);

      const need = detail.type === 'doubles' ? 4 : 2;

      this.setData({
        detail: {
          ...detail,
          dateText: formatDate(detail.matchDate),
          levelText: levelInfo.text,
          winPts,
          losePts,
          need
        },
        signed,
        canManage,
        canEditScore
      });
    });
  },

  // 报名
  onSignup() {
    api.signupMatch(this.data.id).then(() => {
      wx.showToast({ title: '已报名', icon: 'success' });
      this.load();
    });
  },

  // 取消报名/退出
  onLeave() {
    wx.showModal({
      title: '退出',
      content: '确认退出比赛？',
      success: res => {
        if (res.confirm) {
          api.leaveMatch(this.data.id).then(() => {
            wx.showToast({ title: '已退出', icon: 'success' });
            this.load();
          });
        }
      }
    });
  },

  // 随机分组
  onRandomize() {
    wx.showModal({
      title: '随机分组',
      content: '将随机打乱报名者分配到 A/B 方，确认？',
      success: res => {
        if (res.confirm) {
          api.randomizeMatch(this.data.id).then(() => {
            wx.showToast({ title: '分组完成', icon: 'success' });
            this.load();
          });
        }
      }
    });
  },

  // 录分
  onEditScore() {
    this.setData({ editing: true, scoreAInput: '', scoreBInput: '' });
  },

  onCancelEdit() {
    this.setData({ editing: false });
  },

  onScoreAInput(e) {
    this.setData({ scoreAInput: e.detail.value });
  },

  onScoreBInput(e) {
    this.setData({ scoreBInput: e.detail.value });
  },

  onSaveScore() {
    const a = parseInt(this.data.scoreAInput);
    const b = parseInt(this.data.scoreBInput);
    if (isNaN(a) || isNaN(b) || a < 0 || b < 0) {
      wx.showToast({ title: '请输入有效比分', icon: 'none' });
      return;
    }
    if (a === b) {
      wx.showToast({ title: '比分不能相同', icon: 'none' });
      return;
    }
    api.saveScore(this.data.id, a, b).then(() => {
      wx.showToast({ title: '已保存', icon: 'success' });
      this.setData({ editing: false });
      this.load();
    });
  }
});
