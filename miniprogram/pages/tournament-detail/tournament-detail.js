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
    const app = getApp();
    const nav = app.globalData.nav;
    this.setData({
      id: opts.id,
      user: getCachedUser(),
      navTop: nav ? nav.navTopRpx : 0,
      capsuleGap: nav ? nav.capsuleGapRpx : 190
    });
  },

  onShow() {
    if (this.data.id) this.load();
  },

  goBack() {
    wx.navigateBack();
  },

  // 跳转海报页：A2 决策 — 用 ActionSheet 让用户先选两种海报，再跳
  goPoster() {
    const id = this.data.id;
    if (!id) return;
    wx.showActionSheet({
      itemList: ['我的战绩卡', '赛事战报'],
      success: res => {
        const type = res.tapIndex === 0 ? 'personal' : 'report';
        wx.navigateTo({
          url: `/pages/poster/poster?tournamentId=${id}&type=${type}`
        });
      }
    });
  },

  load() {
    return api.getTournament(this.data.id).then(t => {
      const me = this.data.user;
      const myOpenid = me && me.openid;
      const isOwner = !!(me && (t.creator === me.openid || me.role === 'admin'));
      const signed = !!(me && (t.players || []).some(p => p.openid === me.openid));

      // 给每场 match 加 canRevert 标记（前端展示控制；后端仍会再校验）
      // 规则：match.winner 存在 + (我是参赛方 || 我是 creator || 我是 admin)
      const tagMatch = (m) => {
        if (!m || !m.winner) return m;
        const inMatch = !!(myOpenid && m.playerA && m.playerB && (
          m.playerA.openid === myOpenid || m.playerB.openid === myOpenid
        ));
        return { ...m, canRevert: inMatch || isOwner };
      };
      const groups = (t.groups || []).map(g => ({
        ...g,
        matches: (g.matches || []).map(tagMatch)
      }));
      const knockout = t.knockout
        ? {
            ...t.knockout,
            rounds: (t.knockout.rounds || []).map((r, ri) => ({
              ...r,
              matches: (r.matches || []).map((m, mi) => {
                const tagged = tagMatch(m);
                if (!tagged.canRevert) return tagged;
                // 末梢限制：如果下一轮的对应位置已录分，前端隐藏撤回（提示后端会拦）
                const nextRound = t.knockout.rounds[ri + 1];
                if (nextRound) {
                  const nextMatch = nextRound.matches[Math.floor(mi / 2)];
                  if (nextMatch && nextMatch.winner) {
                    return { ...tagged, canRevert: false, revertBlockedByNext: true };
                  }
                }
                return tagged;
              })
            }))
          }
        : null;

      this.setData({
        t: {
          ...t,
          groups,
          knockout,
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
  },

  // 删除赛事（仅 signup 阶段、creator/admin）
  onDeleteTournament() {
    const t = this.data.t;
    if (!t || t.status !== 'signup') return;
    wx.showModal({
      title: '删除赛事',
      content: `确认删除「${t.title}」？已报名的 ${t.players ? t.players.length : 0} 人将被解除报名。此操作不可撤销。`,
      confirmColor: '#b87a36',
      success: res => {
        if (res.confirm) {
          api.deleteTournament(this.data.id).then(() => {
            wx.showToast({ title: '已删除', icon: 'success' });
            setTimeout(() => wx.navigateBack(), 600);
          });
        }
      }
    });
  },

  // 撤回小组赛比分
  onRevertGroup(e) {
    const { gi, mid, score } = e.currentTarget.dataset;
    wx.showModal({
      title: '撤回比分',
      content: `确认撤回这场比分（${score}）？双方本场获得的 ELO 和积分将被冲销，可重新录入。`,
      confirmColor: '#b87a36',
      success: res => {
        if (res.confirm) {
          api.revertScore(this.data.id, {
            stage: 'group',
            groupIndex: gi,
            matchId: mid
          }).then(() => {
            wx.showToast({ title: '已撤回', icon: 'success' });
            this.load();
          });
        }
      }
    });
  },

  // 撤回淘汰赛比分
  onRevertKO(e) {
    const { ri, mid, score } = e.currentTarget.dataset;
    const t = this.data.t;
    const willResetFinish = t && t.status === 'finished';
    const extraWarn = willResetFinish
      ? '\n注意：本赛事已结束，撤回决赛会同时清空名次奖（冠/亚/四强等），可补录后重发。'
      : '';
    wx.showModal({
      title: '撤回比分',
      content: `确认撤回这场比分（${score}）？双方本场获得的 ELO 和积分将被冲销，下一轮的对位将自动清空。${extraWarn}`,
      confirmColor: '#b87a36',
      success: res => {
        if (res.confirm) {
          api.revertScore(this.data.id, {
            stage: 'knockout',
            roundIndex: ri,
            matchId: mid
          }).then(() => {
            wx.showToast({ title: '已撤回', icon: 'success' });
            this.load();
          });
        }
      }
    });
  }
});
