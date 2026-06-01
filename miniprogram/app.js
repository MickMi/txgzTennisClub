// app.js
const { computeNav } = require('./utils/nav.js');

App({
  globalData: {
    // ⚠️ 部署前请替换为你自己的云开发环境 ID
    // 在微信开发者工具左上角"云开发"中查看，形如 cloud1-xxxxxxxx
    cloudEnv: 'cloud1-d7gpl79fte0c52c74',
    userInfo: null,
    nav: null // 自定义导航栏度量，onLaunch 时计算
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('当前微信版本过低，请升级到最新版以使用云开发能力');
      return;
    }
    wx.cloud.init({
      env: this.globalData.cloudEnv,
      traceUser: true
    });
    // 自定义导航栏度量（返回按钮与胶囊垂直居中对齐）
    this.globalData.nav = computeNav();
  }
});
