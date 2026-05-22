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
    loading: true,
    isOwner: false // 是否为创建者或管理员
  },

  onLoad(opts) {
    this.setData({ id: opts.id, user: getCachedUser() });
  },

  onShow() {
    if (this.data.id) this.load();
  },

  load() {
    return api.getActivity(this.data.id).then(detail => {
      const me = this.data.user;
      const participants = detail.participants || [];
      const joined = !!(me && participants.some(p => p.openid === me.openid));
      const full =
        detail.maxPeople > 0 && participants.length >= detail.maxPeople;
      const isOwner = !!(me && (detail.creator === me.openid || me.role === 'admin'));
      this.setData({
        detail: { ...detail, startTimeText: formatDateTime(detail.startTime) },
        joined,
        full,
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
