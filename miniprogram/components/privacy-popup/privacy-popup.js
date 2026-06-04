Component({
  data: {
    show: false,
    reason: ''
  },

  lifetimes: {
    attached() {
      const app = getApp();
      app._privacyPopup = this;
    },

    detached() {
      const app = getApp();
      if (app._privacyPopup === this) {
        app._privacyPopup = null;
      }
    }
  },

  pageLifetimes: {
    show() {
      // 页面重新可见时，重新注册为当前活跃的弹窗实例
      const app = getApp();
      app._privacyPopup = this;
    }
  },

  methods: {
    showPopup(reason) {
      this.setData({ show: true, reason });
    },

    onAgree() {
      this.setData({ show: false });
      const app = getApp();
      if (app.globalData.privacyResolve) {
        app.globalData.privacyResolve({ buttonId: 'agree-btn', event: 'agree' });
        app.globalData.privacyResolve = null;
      }
    },

    onDisagree() {
      this.setData({ show: false });
      const app = getApp();
      if (app.globalData.privacyResolve) {
        app.globalData.privacyResolve({ event: 'disagree' });
        app.globalData.privacyResolve = null;
      }
    },

    onMaskTap() {
      this.onDisagree();
    },

    stopPropagation() {}
  }
});
