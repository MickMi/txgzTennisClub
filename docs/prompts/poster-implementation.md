# Claude Code 实施指令：分享海报模块

> 本文件是给 Claude Code 的一次性指令。执行前请先完整阅读 `docs/DESIGN_SPEC.md §11` 和本文件。

## 阶段 0：自我诊断（先回答，不写代码）

请回答以下 5 点，确认你理解了任务：

1. 海报模块的页面路径是什么？需要几个文件？
2. 海报有几种画风？默认是哪种？
3. "高光时刻"有几个优先级？最高优先级是什么条件？
4. Canvas 尺寸是多少？为什么？
5. tournament-detail 页需要改哪里来增加入口？

---

## 阶段 1：创建页面骨架

### 1.1 注册路由

在 `miniprogram/app.json` 的 `pages` 数组末尾加入：
```json
"pages/poster/poster"
```

### 1.2 创建文件

```
miniprogram/pages/poster/
├── poster.wxml
├── poster.wxss
├── poster.js
└── poster.json
```

`poster.json`：
```json
{
  "navigationStyle": "custom",
  "usingComponents": {}
}
```

### 1.3 创建工具模块

```
miniprogram/utils/highlight.js    ← 高光时刻计算
miniprogram/utils/poster-draw.js  ← Canvas 绘制主逻辑
miniprogram/utils/poster-styles.js ← 6 种风格的色值/字体 token 定义
```

---

## 阶段 2：实现 highlight.js

```js
// utils/highlight.js
// 导出: computeHighlight(tournament, userOpenid) → { type, title, detail }

export function computeHighlight(tournament, userOpenid) {
  // 按 DESIGN_SPEC §11.5 的 8 级优先级逐一检测
  // 返回第一个命中的
}
```

8 个 type key：`upset_win` / `clutch_tiebreak` / `group_sweep` / `streak` / `full_distance` / `elo_positive` / `first_tournament` / `rank_maintained`

注意事项：
- NTRP 从 `tournament.players[].rating` 取（字符串 "3.5"/"4.0"/...），需 parseFloat
- "未评级" 视为 NTRP 2.5
- 比赛记录来自 `tournament.groups[].matches` + `tournament.knockout.rounds[].matches`
- 胜负判断用 `match.winner === 'A'|'B'` 结合 playerA/B.openid === userOpenid

---

## 阶段 3：实现 poster-styles.js

6 种风格的 token 对象，Canvas 绘制时用。**不用 CSS 变量**（Canvas 不支持）。

```js
export const POSTER_STYLES = [
  {
    id: 'emerald',
    name: '经典翠绿',
    heroBg: ['#243a30', '#1a2820'],  // gradient stops
    heroFg: '#f8f4e8',
    accent: '#b8964a',
    bg: '#f2ede0',
    surface: '#f8f5eb',
    fg: '#243a30',
    muted: '#5d6e63',
    border: '#d8d2c0',
    positive: '#3a7a4a',
    fontDisplay: 'Iowan Old Style',
    fontBody: 'PingFang SC',
    fontMono: 'SF Mono',
  },
  {
    id: 'sports',
    name: '运动能量',
    heroBg: ['#000000', '#0d0d0d'],
    heroFg: '#f0f0f0',
    accent: '#b4ff00',
    bg: '#0d0d0d',
    surface: '#1a1a1a',
    fg: '#f0f0f0',
    muted: '#6b6b6b',
    border: '#2a2a2a',
    positive: '#b4ff00',
    fontDisplay: 'PingFang SC',
    fontBody: 'PingFang SC',
    fontMono: 'SF Mono',
  },
  {
    id: 'ao',
    name: '澳大利亚公开赛',
    heroBg: ['#005fa3', '#003b6b'],
    heroFg: '#ffffff',
    accent: '#0091D5',
    bg: '#e8f4fa',
    surface: '#f0f8fc',
    fg: '#0a2e42',
    muted: '#4a7a94',
    border: '#c8e3f0',
    positive: '#00a86b',
    fontDisplay: 'PingFang SC',
    fontBody: 'PingFang SC',
    fontMono: 'SF Mono',
  },
  {
    id: 'rg',
    name: '法国公开赛',
    heroBg: ['#8B3A1F', '#5a2210'],
    heroFg: '#fef6ee',
    accent: '#C84B31',
    bg: '#faf3ec',
    surface: '#fdf8f3',
    fg: '#2d1a08',
    muted: '#7a5c3f',
    border: '#e8d5c0',
    positive: '#3d7a3a',
    fontDisplay: 'Iowan Old Style',
    fontBody: 'PingFang SC',
    fontMono: 'SF Mono',
  },
  {
    id: 'wim',
    name: '温布尔登',
    heroBg: ['#1a3d1a', '#0d2610'],
    heroFg: '#f8faf5',
    accent: '#c9a63c',
    bg: '#f5f8f2',
    surface: '#fafcf8',
    fg: '#1a2e14',
    muted: '#4a6640',
    border: '#c5d8b8',
    positive: '#2d6b2f',
    fontDisplay: 'Iowan Old Style',
    fontBody: 'PingFang SC',
    fontMono: 'SF Mono',
  },
  {
    id: 'uso',
    name: '美国公开赛',
    heroBg: ['#001a4d', '#000d26'],
    heroFg: '#f0f4fa',
    accent: '#FF6B35',
    bg: '#0c1a33',
    surface: '#112240',
    fg: '#f0f4fa',
    muted: '#7a9cc0',
    border: '#2a4470',
    positive: '#FFD23F',
    fontDisplay: 'PingFang SC',
    fontBody: 'PingFang SC',
    fontMono: 'SF Mono',
  },
];
```

---

## 阶段 4：实现 poster-draw.js

核心绘制函数，按区域从上往下绘制。

```js
// utils/poster-draw.js
// 导出: drawPoster(ctx, canvas, { type, tournament, userStats, highlight, style, nextTournament })
// type: 'report' | 'personal'
// style: POSTER_STYLES[i]

export async function drawPoster(ctx, canvas, data) {
  const W = 750, H = 1334;
  canvas.width = W;
  canvas.height = H;

  if (data.type === 'report') {
    drawReportPoster(ctx, W, H, data);
  } else {
    drawPersonalPoster(ctx, W, H, data);
  }
}
```

**绘制分区（Report）**：
1. Hero 背景（gradient + court lines path）+ brand + title + meta
2. Podium（前三名 avatar + name + pts）
3. Stats strip（3 列数字）
4. Best Match（双方名字 + 比分）
5. Roster（4 列网格 avatar + name）
6. Footer（下一场 + QR code）

**绘制分区（Personal）**：
1. Hero 背景 + brand + identity（大头像 + 名字 + 角色）+ tournament ref
2. Big Four（2×2 数字格）
3. Highlight（高光时刻文案）
4. Match History（逐行记录）
5. Footer

**Court Lines 画法**（整数坐标，stroke-width=1 对应 canvas 2px）：
```js
function drawCourtLines(ctx, W, heroH, style) {
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = style.heroFg;
  ctx.lineWidth = 2;
  // 外框
  ctx.strokeRect(84, -80, 582, 520);
  // 中线
  ctx.beginPath(); ctx.moveTo(375, -80); ctx.lineTo(375, 440); ctx.stroke();
  // 发球线
  ctx.beginPath(); ctx.moveTo(84, 280); ctx.lineTo(666, 280); ctx.stroke();
  // 双打边线
  ctx.beginPath(); ctx.moveTo(120, -80); ctx.lineTo(120, 440); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(630, -80); ctx.lineTo(630, 440); ctx.stroke();
  ctx.restore();
}
```

---

## 阶段 5：实现 poster 页面

### poster.wxml

```xml
<view class="page">
  <!-- 预览区 -->
  <view class="preview-area" style="padding-top: {{navTop}}rpx;">
    <view class="topnav">
      <view class="icon-btn" bindtap="goBack">
        <image src="/assets/icons/back.svg" />
      </view>
      <view class="topnav-title">分享海报</view>
      <view class="topnav-spacer"></view>
    </view>
    <canvas type="2d" id="posterCanvas" class="canvas-el"></canvas>
  </view>

  <!-- 风格选择条 -->
  <scroll-view class="style-bar" scroll-x>
    <view
      wx:for="{{styles}}"
      wx:key="id"
      class="style-chip {{currentStyle === index ? 'active' : ''}}"
      bindtap="switchStyle"
      data-index="{{index}}"
    >
      <view class="chip-dot" style="background: {{item.accent}};"></view>
      <text>{{item.name}}</text>
    </view>
  </scroll-view>

  <!-- 底部操作栏 -->
  <view class="action-bar">
    <button class="btn-save" bindtap="saveToAlbum">保存到相册</button>
    <button class="btn-share" open-type="share">发送给朋友</button>
  </view>
</view>
```

### poster.js 关键逻辑

```js
import { POSTER_STYLES } from '../../utils/poster-styles';
import { drawPoster } from '../../utils/poster-draw';
import { computeHighlight } from '../../utils/highlight';

Page({
  data: {
    navTop: 0,
    styles: POSTER_STYLES,
    currentStyle: 0,
    posterType: 'personal', // 'report' | 'personal'
    loading: true,
  },

  onLoad(options) {
    const app = getApp();
    this.setData({ navTop: app.globalData.nav?.navTopRpx || 0 });
    this.tournamentId = options.tournamentId;
    this.posterType = options.type || 'personal';
    this.setData({ posterType: this.posterType });
    this.loadData();
  },

  async loadData() {
    // 拉取 tournament 完整数据 + userStats
    const res = await wx.cloud.callFunction({
      name: 'tournament',
      data: { action: 'get', tournamentId: this.tournamentId }
    });
    this.tournament = res.result.data;

    if (this.posterType === 'personal') {
      // 计算个人数据
      this.userStats = this.computeUserStats(this.tournament);
      this.highlight = computeHighlight(this.tournament, getApp().globalData.openid);
    }

    // 获取下一场赛事
    const next = await wx.cloud.callFunction({
      name: 'tournament',
      data: { action: 'list' }
    });
    this.nextTournament = next.result.data?.find(t => t.status === 'signup') || null;

    this.setData({ loading: false });
    this.renderPoster();
  },

  async renderPoster() {
    const query = wx.createSelectorQuery();
    query.select('#posterCanvas').fields({ node: true, size: true }).exec(async (res) => {
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      this.canvas = canvas;

      await drawPoster(ctx, canvas, {
        type: this.posterType,
        tournament: this.tournament,
        userStats: this.userStats,
        highlight: this.highlight,
        style: POSTER_STYLES[this.data.currentStyle],
        nextTournament: this.nextTournament,
      });
    });
  },

  switchStyle(e) {
    const index = e.currentTarget.dataset.index;
    this.setData({ currentStyle: index });
    this.renderPoster();
  },

  saveToAlbum() {
    wx.canvasToTempFilePath({
      canvas: this.canvas,
      fileType: 'png',
      quality: 1,
      success: (res) => {
        wx.saveImageToPhotosAlbum({
          filePath: res.tempFilePath,
          success: () => wx.showToast({ title: '已保存', icon: 'success' }),
          fail: () => wx.showToast({ title: '请授权相册权限', icon: 'none' }),
        });
      }
    });
  },

  goBack() { wx.navigateBack(); },
});
```

---

## 阶段 6：tournament-detail 增加入口

在 `pages/tournament-detail/tournament-detail.wxml` 的 topnav 区域（`.icon-btn` 旁边），当 `status === 'finished'` 时显示分享按钮：

```xml
<view class="icon-btn" wx:if="{{tournament.status === 'finished'}}" bindtap="goToPoster">
  <image src="/assets/icons/share.svg" />
</view>
```

在 js 中加：
```js
goToPoster() {
  wx.navigateTo({
    url: `/pages/poster/poster?tournamentId=${this.data.tournament._id}&type=personal`
  });
},
```

---

## 阶段 7：验证清单

- [ ] poster 页能正常打开，不白屏
- [ ] 6 种风格切换后画布立即重绘
- [ ] 个人卡的 highlight 文案正确（非"爆冷"/"被淘汰"等负面表述）
- [ ] "保存到相册"正常工作
- [ ] Canvas 输出图片清晰（750×1334 retina）
- [ ] Court lines SVG 坐标全部为整数、stroke-width 为整数
- [ ] 文字无截断、对齐正确（mono 字体 tnum 对齐）
- [ ] tournament-detail 在 status!='finished' 时不显示分享按钮

---

## 注意事项

1. **Canvas 不支持 CSS 变量**：所有颜色值在 `poster-styles.js` 里 hardcode 为 hex。
2. **字体 fallback**：`ctx.font` 设置后如果字体不可用，Canvas 自动降级到系统默认。Iowan Old Style 在 iOS 上系统内置；Android 无此字体，降级为 PingFang SC 或 Noto Serif。
3. **小程序码**：需要后端配合。暂时可用一个静态占位框"小程序码"文字替代，后续补 `wx.cloud.callFunction` 获取真实码。
4. **数据量**：roster 区域最多展示 8 人（前 8 名），超出显示 "+N" 文字。
5. **性能**：Canvas 绘制在 `wx.nextTick` 或 `setTimeout(0)` 后执行，避免阻塞渲染。
