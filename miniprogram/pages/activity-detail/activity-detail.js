const api = require('../../utils/api.js');
const { getCachedUser } = require('../../utils/user.js');
const { formatDateTime } = require('../../utils/format.js');

Page({
  data: {
    id: '',
    detail: null,
    user: null,
    joined: false,
    full: false,
    isStarted: false,
    isClosed: false,
    canJoin: false,
    canLeave: false,
    loading: true,
    isOwner: false // 是否为创建者或管理员
  },

  onLoad(opts) {
    const app = getApp();
    this.setData({
      id: opts.id,
      user: getCachedUser(),
      navTop: app.globalData.nav ? app.globalData.nav.navTopRpx : 0
    });
  },

  onShow() {
    if (this.data.id) this.load();
  },

  goBack() {
    wx.navigateBack();
  },

  load() {
    return api.getActivity(this.data.id).then(detail => {
      const me = this.data.user;
      const participants = detail.participants || [];
      const joined = !!(me && participants.some(p => p.openid === me.openid));
      const full =
        detail.maxPeople > 0 && participants.length >= detail.maxPeople;
      const isOwner = !!(me && (detail.creator === me.openid || me.role === 'admin'));

      // 时间相关派生：是否已开始 / 是否已关闭
      const now = Date.now();
      const isStarted = !!(detail.startTime && detail.startTime <= now);
      const isClosed = detail.status === 'closed';
      // 是否禁止加入：关闭 / 已开始 / 已满 / 已报名
      const canJoin = !isClosed && !isStarted && !full && !joined;
      // 是否能退出：已报名 + 未关闭（超时但未关闭仍能退）
      const canLeave = joined && !isClosed;

      // 派生字段：日期戳
      const d = new Date(detail.startTime);
      const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
      const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const dayNum = d.getDate();
      const monthText = MONTHS[d.getMonth()] + ' · ' + WEEKDAYS[d.getDay()];
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const timeText = `${hh}:${mm}`;
      const fillPercent = detail.maxPeople > 0
        ? Math.round(participants.length * 100 / detail.maxPeople)
        : 0;

      this.setData({
        detail: {
          ...detail,
          startTimeText: formatDateTime(detail.startTime),
          dayNum,
          monthText,
          timeText,
          fillPercent
        },
        joined,
        full,
        isStarted,
        isClosed,
        canJoin,
        canLeave,
        isOwner,
        loading: false
      });
    });
  },

  onJoin() {
    api.joinActivity(this.data.id).then(() => {
      wx.showToast({ title: '已报名', icon: 'success' });
      this.load();
    });
  },

  onLeave() {
    wx.showModal({
      title: '取消报名',
      content: '确认取消报名？',
      success: res => {
        if (res.confirm) {
          api.leaveActivity(this.data.id).then(() => {
            wx.showToast({ title: '已取消', icon: 'success' });
            this.load();
          });
        }
      }
    });
  },

  onEdit() {
    wx.navigateTo({
      url: `/pages/activity-create/activity-create?id=${this.data.id}`
    });
  },

  onDelete() {
    wx.showModal({
      title: '删除活动',
      content: '确认删除该活动？删除后不可恢复。',
      confirmColor: '#e53935',
      success: res => {
        if (res.confirm) {
          api.deleteActivity(this.data.id).then(() => {
            wx.showToast({ title: '已删除', icon: 'success' });
            setTimeout(() => wx.navigateBack(), 600);
          });
        }
      }
    });
  },

  // 关闭活动（归档：参与者无法再退出，列表里展示已结束）
  onClose() {
    const count = (this.data.detail && this.data.detail.participants || []).length;
    wx.showModal({
      title: '关闭活动',
      content: `确认关闭活动？关闭后名单（${count} 人）将归档，参与者无法再退出。`,
      confirmColor: '#243a30',
      success: res => {
        if (res.confirm) {
          api.closeActivity(this.data.id).then(() => {
            wx.showToast({ title: '活动已关闭', icon: 'success' });
            this.load();
          });
        }
      }
    });
  },

  onExport() {
    const detail = this.data.detail;
    if (!detail) return;
    const participants = detail.participants || [];
    if (participants.length === 0) {
      return wx.showToast({ title: '暂无报名人员', icon: 'none' });
    }

    // 构建名单文本
    const lines = [];
    lines.push(`📋 ${detail.title} - 报名名单`);
    lines.push(`⏰ ${detail.startTimeText}`);
    lines.push(`📍 ${detail.location}`);
    lines.push(`👥 共 ${participants.length} 人`);
    lines.push('---');
    participants.forEach((p, idx) => {
      lines.push(`${idx + 1}. ${p.wecomName}`);
    });

    const text = lines.join('\n');
    wx.setClipboardData({
      data: text,
      success() {
        wx.showToast({ title: '名单已复制到剪贴板', icon: 'none' });
      }
    });
  }
});
