// utils/nav.js — 自定义导航栏度量
//
// navigationStyle: custom 模式下，需要自己定位返回按钮 + 处理与右上角胶囊的关系。
// 单纯用 env(safe-area-inset-top) 在无刘海设备上不可靠（值为 0），
// 必须通过 wx.getMenuButtonBoundingClientRect() 获取胶囊真实位置。
//
// 输出（单位 rpx）：
//   navTop:        返回按钮的 top 值（与胶囊垂直居中）
//   navHeight:     整个 topnav 区域高度
//   capsuleGapRpx: 屏幕右侧给胶囊预留的禁入区宽度
//                  topnav 上任何右侧元素的 right 边界，必须 ≥ 此值
//                  （等于 screenWidth - cap.left + 8px 安全间距）
//
// 在 app.onLaunch 调用一次，结果缓存到 globalData.nav。

const BTN_HEIGHT_PX = 32; // 按钮 64rpx ≈ 32px（与胶囊同高）
const CAPSULE_SAFE_MARGIN_PX = 8; // 我方按钮与胶囊之间的最小水平间距

let _cache = null;

function computeNav() {
  if (_cache) return _cache;

  const sys = wx.getSystemInfoSync();
  const cap = wx.getMenuButtonBoundingClientRect();

  const statusBarPx = sys.statusBarHeight || 20;
  const windowWidthPx = sys.windowWidth || 375;
  const px2rpx = 750 / windowWidthPx;

  // 胶囊位置兜底（极少数机型 cap 拿不到）
  const capsuleTopPx = cap && cap.top ? cap.top : statusBarPx + 4;
  const capsuleHeightPx = cap && cap.height ? cap.height : 32;
  const capsuleLeftPx = cap && cap.left ? cap.left : windowWidthPx - 95;

  // 返回按钮垂直居中对齐胶囊
  const navTopPx = capsuleTopPx + (capsuleHeightPx - BTN_HEIGHT_PX) / 2;
  // topnav 总高度 = safe-area + 上边距 + 按钮 + 同等下边距
  const navHeightPx = navTopPx + BTN_HEIGHT_PX + (navTopPx - statusBarPx);
  // 给胶囊留的禁入区：从屏幕右算起到（胶囊左 - 安全间距）
  const capsuleGapPx = windowWidthPx - capsuleLeftPx + CAPSULE_SAFE_MARGIN_PX;

  _cache = {
    statusBarRpx: Math.round(statusBarPx * px2rpx),
    capsuleTopRpx: Math.round(capsuleTopPx * px2rpx),
    capsuleHeightRpx: Math.round(capsuleHeightPx * px2rpx),
    capsuleGapRpx: Math.round(capsuleGapPx * px2rpx),
    navTopRpx: Math.round(navTopPx * px2rpx),
    navHeightRpx: Math.round(navHeightPx * px2rpx)
  };
  return _cache;
}

module.exports = { computeNav };
