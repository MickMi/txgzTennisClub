// utils/nav.js — 自定义导航栏度量
//
// navigationStyle: custom 模式下，需要自己定位返回按钮。
// 单纯用 env(safe-area-inset-top) 在无刘海设备上不可靠（值为 0），
// 必须通过 wx.getMenuButtonBoundingClientRect() 获取胶囊真实位置，
// 让返回按钮与胶囊**垂直居中对齐**。
//
// 输出（单位 rpx）：
//   navTop:    返回按钮的 top 值（与胶囊垂直居中）
//   navHeight: 整个 topnav 区域高度（safe-area + 胶囊 + 同等下边距）
//
// 在 app.onLaunch 调用一次，结果缓存到 globalData.nav。

const BTN_HEIGHT_PX = 32; // 按钮 64rpx ≈ 32px（与胶囊同高）

let _cache = null;

function computeNav() {
  if (_cache) return _cache;

  const sys = wx.getSystemInfoSync();
  const cap = wx.getMenuButtonBoundingClientRect();

  const statusBarPx = sys.statusBarHeight || 20;
  const windowWidthPx = sys.windowWidth || 375;
  const px2rpx = 750 / windowWidthPx;

  // 胶囊的 top（px，从屏幕顶端起算）
  // 兜底：极少数机型 cap 可能拿不到，按 statusBar + 4 估算
  const capsuleTopPx = cap && cap.top ? cap.top : statusBarPx + 4;
  const capsuleHeightPx = cap && cap.height ? cap.height : 32;

  // 让我们的按钮垂直居中对齐胶囊
  const navTopPx = capsuleTopPx + (capsuleHeightPx - BTN_HEIGHT_PX) / 2;
  // topnav 总高度 = safe-area + 上边距 + 按钮 + 同等下边距
  const navHeightPx = navTopPx + BTN_HEIGHT_PX + (navTopPx - statusBarPx);

  _cache = {
    statusBarRpx: Math.round(statusBarPx * px2rpx),
    capsuleTopRpx: Math.round(capsuleTopPx * px2rpx),
    capsuleHeightRpx: Math.round(capsuleHeightPx * px2rpx),
    navTopRpx: Math.round(navTopPx * px2rpx),
    navHeightRpx: Math.round(navHeightPx * px2rpx)
  };
  return _cache;
}

module.exports = { computeNav };
