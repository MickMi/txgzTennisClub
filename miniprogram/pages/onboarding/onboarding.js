const api = require('../../utils/api.js');
const { setCachedUser } = require('../../utils/user.js');

Page({
  data: {
    wecomName: '',
    gender: '',
    avatarTempUrl: '',
    submitting: false,
    privacyAgreed: false,
    navTop: 0
  },

  onLoad() {
    const app = getApp();
    this.setData({ navTop: app.globalData.nav ? app.globalData.nav.navTopRpx : 0 });
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
    } else {
      wx.switchTab({ url: '/pages/match-list/match-list' });
    }
  },

  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    if (avatarUrl) {
      this.setData({ avatarTempUrl: avatarUrl });
    }
  },

  onInput(e) {
    this.setData({ wecomName: e.detail.value });
  },

  onGenderChange(e) {
    this.setData({ gender: e.detail.value });
  },

  onTogglePrivacy() {
    this.setData({ privacyAgreed: !this.data.privacyAgreed });
  },

  onShowPrivacy() {
    wx.showModal({
      title: '用户隐私保护指引',
      content: '本小程序仅限腾讯广州网球社内部成员使用。\n\n' +
        '一、收集的信息\n' +
        '• 你手动填写的昵称和性别：用于在比赛记录中标识参赛者身份\n' +
        '• 微信 OpenID：用于登录身份识别（自动获取，非敏感信息）\n\n' +
        '二、信息存储\n' +
        '所有数据存储在腾讯云开发数据库中，仅授权成员可访问。\n\n' +
        '三、信息用途\n' +
        '仅用于本小程序内部功能（比赛战绩展示、积分排行）。不用于商业推广，不向第三方共享。\n\n' +
        '四、你的权利\n' +
        '可在"我的"页面随时修改你的昵称；如需删除账号信息，请联系管理员。',
      showCancel: false,
      confirmText: '我知道了'
    });
  },

  onSubmit() {
    if (!this.data.privacyAgreed) {
      wx.showToast({ title: '请先同意隐私保护指引', icon: 'none' });
      return;
    }
    const name = (this.data.wecomName || '').trim();
    if (!name) {
      wx.showToast({ title: '请填写昵称', icon: 'none' });
      return;
    }
    if (name.length > 20) {
      wx.showToast({ title: '昵称过长', icon: 'none' });
      return;
    }
    if (!this.data.gender) {
      wx.showToast({ title: '请选择性别', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });

    const doUpdate = (avatarUrl) => {
      const payload = { wecomName: name, gender: this.data.gender };
      if (avatarUrl) payload.avatarUrl = avatarUrl;
      return api
        .updateUser(payload)
        .then(user => {
          setCachedUser(user);
          wx.showToast({ title: '登记成功', icon: 'success' });
          setTimeout(() => {
            // 如果是从 profile 页 navigateTo 过来的，返回上一页；否则跳首页
            const pages = getCurrentPages();
            if (pages.length > 1) {
              wx.navigateBack();
            } else {
              wx.switchTab({ url: '/pages/match-list/match-list' });
            }
          }, 600);
        })
        .catch(() => {
          this.setData({ submitting: false });
        });
    };

    // 如果选了头像，先上传再更新
    if (this.data.avatarTempUrl) {
      api.uploadAvatar(this.data.avatarTempUrl)
        .then(fileID => doUpdate(fileID))
        .catch(() => {
          // 头像上传失败仍然允许完成注册（头像非必填）
          doUpdate('');
        });
    } else {
      doUpdate('');
    }
  }
});
