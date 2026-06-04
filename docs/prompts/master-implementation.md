# 小程序 emerald-heritage 全量实现 — Master Prompt

> **用途**：将此文件的全部内容复制给 Claude Code，作为实现指令。
> **前提**：项目根目录 = `/Users/mickmi/tennis-club`，已完成 token 迁移（`app.wxss` 变量已就位）。

---

## 0. 总体指令

你将把 `docs/references/` 下的 HTML 高保真稿**像素级还原**为微信小程序页面。所有视觉、间距、字体、图标都必须严格匹配设计稿，**不得简化、省略、或"稍后补全"任何元素**。

**工作模式**：
1. 每次只改一个页面（或一个明确的功能模块）
2. 改完后立即用 `grep` 自检（见 §8）
3. 自检通过才报告完成

---

## 1. 你必须遵守的硬红线（违反 = 返工）

| # | 红线 | 错误示例 | 正确做法 |
|---|------|---------|---------|
| 1 | **SVG 图标必须有完整路径** | `<image src="/assets/icons/clock.svg" />` 但 SVG 文件内容为空或只有 `<svg></svg>` | 打开 `docs/DESIGN_SPEC.md §4` 或 reference HTML，**逐字复制 `<path d="...">`** 到对应 SVG 文件 |
| 2 | **禁止使用任何非 token 颜色** | `color: #1976d2` / `background: orange` | 只用 `var(--color-*)` 变量。硬编码色 = BUG |
| 3 | **字体三选一不能乱** | 标题用了 sans-serif / 标签用了 serif | Display（标题/大数字）= `var(--font-display)` ；Body（正文）= `var(--font-body)` ；Mono（标签/badge/元数据）= `var(--font-mono)` |
| 4 | **Hero 是结构不是装饰** | 把 `.hero` 区域省略或替换成纯色 header | Hero 必须包含：渐变背景 + court-lines SVG + kicker + title + organiser |
| 5 | **Custom navbar 不能退回默认** | 没有 `.topnav` / `.page-back`，依赖系统导航栏 | `app.json` 已设 `navigationStyle: custom`。每个子页面都必须自绘返回按钮 |
| 6 | **零 emoji** | 用 📍🕐👥 | 全部替换为 `/assets/icons/` 下对应 SVG |
| 7 | **边线而非阴影** | `box-shadow: 0 2px 8px rgba(...)` | 卡片用 `border-top: var(--border-strong)` 分隔 |
| 8 | **按钮高度分档** | 把 `.cta-primary`(100rpx) 和 `.btn-default`(88rpx) 放同一行 | CTA 独占一行 100rpx；次级按钮可并排 88rpx |

---

## 2. 参考文件映射（实现时必须打开对照）

| 目标页面 | 参考 HTML | 在参考文件中的位置 |
|---------|----------|-------------------|
| 活动列表 (index) | `round-2-tabs-and-charts.html` | 第一个 `.device`（"活动 Tab"） |
| 赛事列表 (match-list) | `round-2-tabs-and-charts.html` | 第二个 `.device`（"赛事 Tab"） |
| 活动详情 (activity-detail) | `activity-detail.html` | 整个文件（唯一设备） |
| 我的 (profile) | `round-3-profile-ranking-tournament.html` | 第一组 `.phone-stack`（"我的"） |
| 排行榜 (ranking) | `round-3-profile-ranking-tournament.html` | 第二组 `.phone-stack`（"积分排行榜"） |
| 赛事详情 (tournament-detail) | `round-3-profile-ranking-tournament.html` | 第三组 `.phone-stack`（"赛事详情 · 淘汰赛阶段"） |
| 海报 (poster) | `share-posters-emerald.html` + `share-posters-sports.html` + `share-posters-grand-slam.html` | 各文件全量 |
| 创建表单 | `round-4-create-forms.html` | 三个 device 分别对应 activity/tournament/match |

---

## 3. SVG 图标实现（⚠️ 最易出错的环节）

### 3.1 文件结构

每个图标是独立 `.svg` 文件，路径 `/miniprogram/assets/icons/{name}.svg`。

### 3.2 标准模板

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <!-- path 来自 DESIGN_SPEC.md §4 或 reference HTML -->
  <path d="..."/>
</svg>
```

### 3.3 必须存在且有完整路径的图标清单

从 `docs/DESIGN_SPEC.md §4` 提取，**每个都必须有真实 `<path d="...">`**：

| 文件名 | 用途 | path 来源 |
|--------|------|-----------|
| `back.svg` | 浅底返回 | `M15 18l-6-6 6-6` |
| `back-light.svg` | 深底返回（白色） | 同上路径，stroke 色由 CSS 控制 |
| `share.svg` | 分享 | 参考 reference HTML 中 `.icon-btn` 内的 share SVG |
| `share-light.svg` | 深底分享 | 同上 |
| `more.svg` | 更多 | 三个垂直圆点 |
| `more-light.svg` | 深底更多 | 同上 |
| `arrow-right.svg` | 卡片箭头 | `M9 5l7 7-7 7` |
| `clock.svg` | 时间 | 圆 + 时针分针 |
| `pin.svg` | 地点 | 气泡 + 圆心 |
| `people.svg` | 人数 | 双人 |
| `note.svg` | 备注 | 文档 + 横线 |
| `tennis.svg` | 网球 | 圆 + 弧线 |
| `trophy.svg` | 赛事 | 奖杯 |
| `trophy-accent.svg` | 金色奖杯 | stroke 设为金色 |
| `list.svg` | 列表 | 三横线 + 三圆点 |
| `pencil.svg` | 编辑 | 铅笔 |
| `trash.svg` | 删除 | 垃圾桶 |
| `check.svg` | 确认 | `M20 6L9 17l-5-5` |
| `plus.svg` | 创建/新增 | `M12 5v14M5 12h14` |
| `male.svg` | 男性 | ♂ 抽象 |
| `female.svg` | 女性 | ♀ 抽象 |
| `court-lines.svg` | Hero 背景球场线 | 矩形+中线+发球线（参考 activity-detail.html 中的 `<svg class="court-lines">` 完整路径） |

### 3.4 court-lines.svg 完整实现

从 `activity-detail.html` 中提取。这是 Hero 背景中的半透明球场线：

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 375 380" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <g stroke="rgba(241, 236, 224, 0.12)" stroke-width="1" fill="none">
    <rect x="42" y="-100" width="291" height="430" rx="0"/>
    <line x1="188" y1="-100" x2="188" y2="225"/>
    <rect x="80" y="-100" width="215" height="298" rx="0"/>
    <line x1="42" y1="120" x2="333" y2="120"/>
    <ellipse cx="188" cy="120" rx="38" ry="38"/>
  </g>
</svg>
```

### 3.5 验证步骤（改完后必须执行）

```bash
# 检查所有 SVG 文件是否有真实路径内容
for f in miniprogram/assets/icons/*.svg; do
  if ! grep -q '<path\|<line\|<circle\|<rect\|<ellipse\|<polyline\|<polygon' "$f"; then
    echo "❌ EMPTY SVG: $f"
  fi
done
```

---

## 4. 页面级实现规范

### 4.1 activity-detail（活动详情）— 对照 `activity-detail.html`

**结构（从上到下）**：

```
┌─ .topnav (absolute, top: {{navTop}}rpx)
│   └─ .icon-btn > back-light.svg
├─ .hero (min-height: 600rpx, 渐变背景)
│   ├─ court-lines.svg (absolute, opacity 0.12)
│   ├─ .hero-crest (右上角圆形徽章 "TC")
│   ├─ .hero-kicker (:: before 金线 + "ACTIVITY · PUBLIC")
│   ├─ .hero-title (活动名称，display font)
│   └─ .hero-organiser (发起人 · 日期)
├─ .datestamp (巨幅日期：左大数字 + 右时间/场次)
├─ .card > .meta-row × N (地点/人数/说明 等)
├─ .section-eyebrow "RULES"
│   └─ .rules > .rule-item × N
├─ .section-eyebrow "ROSTER"
│   └─ .roster (2列 grid) > .player × N
└─ .cta-bar (fixed bottom)
    └─ .cta-primary "立即报名"
```

**关键细节**：
- Hero 渐变：`radial-gradient(120% 80% at 100% 0%, var(--color-emerald) 0%, transparent 55%), linear-gradient(170deg, var(--color-emerald-deep) 0%, #14201a 100%)`
- court-lines SVG absolute 定位，覆盖 hero 区域，`opacity: 0.12`
- `.hero-crest` 圆形 112rpx，1rpx accent 描边，内部文字 "TC"（display font 44rpx）
- datestamp 两列 grid：左侧日数字 160rpx，右侧时间 + 场次规则
- meta-row 三列 grid（icon 44rpx | label+value 1fr | badge auto）
- roster 使用 2 列 grid，每个 player 包含 avatar(首字母) + name + rating
- CTA bar fixed 在底部，高度 100rpx

### 4.2 index（活动列表 Tab）— 对照 `round-2-tabs-and-charts.html` 第一个 device

**结构**：

```
┌─ .masthead
│   ├─ .wordmark "广州网球社"
│   ├─ .wordmark-caption "EST. 2024"
│   └─ .masthead-actions > .icon-pill (plus.svg，用于创建)
├─ .card × N（每张活动卡）
│   ├─ .card-eyebrow "ACTIVITY · MAR 2025"
│   ├─ .card-title (活动名称，display font)
│   ├─ .card-meta (时间 + 地点)
│   └─ .card-foot (人数/状态 + arrow-right)
└─ custom-tab-bar
```

**关键细节**：
- Masthead：`padding-top` 必须留出状态栏 + 胶囊高度（用 `navTop` + 额外间距）
- `.icon-pill` = 68rpx 圆形、1rpx border、内部 plus SVG 32rpx
- 卡片无圆角无阴影，用 `border-top` 分隔
- `.card-foot` 右侧箭头用 `→` 字符或 arrow-right SVG，颜色 accent

### 4.3 match-list（赛事列表 Tab）— 对照 `round-2-tabs-and-charts.html` 第二个 device

**结构**：

```
┌─ .masthead (同上，但 caption 改为 "TOURNAMENT")
├─ .ranking-entry（排行榜入口，固定顶部）
│   ├─ 左侧 trophy-accent.svg + "积分排行榜"
│   └─ 右侧 arrow-right + "查看"
├─ .card × N（赛事卡）
│   ├─ .card-eyebrow "TOURNAMENT · GROUP STAGE"
│   ├─ .card-title
│   ├─ .card-meta
│   └─ .card-foot (参赛人数 + 状态 tag + arrow)
└─ custom-tab-bar
```

### 4.4 profile（我的 Tab）— 对照 `round-3-profile-ranking-tournament.html`

**结构**：

```
┌─ .profile-topnav
│   └─ .icon-pill (设置 gear icon)
├─ .profile-hero
│   ├─ .avatar (大号 120rpx，首字母)
│   ├─ .profile-name (display font)
│   └─ .profile-role (mono, "MEMBER")
├─ .identity-grid（3列：NTRP / 总积分 / ELO）
├─ .stats-strip（4列：胜 / 负 / 待录 / 总计）
├─ .chart-block（积分趋势图，Canvas 绘制）
│   ├─ eyebrow "POINTS TREND"
│   └─ <canvas>（方案 A 发丝网格）
└─ .history-section（比赛记录列表）
    └─ .match-row × N
```

**关键细节**：
- `identity-grid`：三列等分 grid，每个格子 = 数字(display) + 标签(mono)
- `stats-strip`：四列，各格 = 数字(display-sm) + 标签(mono-sm)。标签为"胜/负/待录/总计"
- 图表使用 Canvas API 绘制，遵循方案 A（发丝网格 + 单色折线 + 黄铜金当前值标注）
- 不要出现 "入队一个月" 这种文字
- Profile 右上角 icon-pill 是设置入口（gear icon），不是空圈

### 4.5 ranking（积分排行榜）— 对照 `round-3-profile-ranking-tournament.html`

**结构**：

```
┌─ .page-back (style="top: {{navTop}}rpx")
├─ .page-title "积分排行榜"
├─ .ranking-header (列标题：# / 姓名 / 积分)
├─ .ranking-row × N
│   ├─ .rank-num (#1 ~ #3 特殊样式：accent + display font)
│   ├─ .avatar + .player-name
│   └─ .rank-points (mono, 右对齐)
└─ 我的排名高亮行（背景 surface，font-weight 600）
```

### 4.6 tournament-detail（赛事详情）— 对照 `round-3-profile-ranking-tournament.html`

**结构（淘汰赛阶段为例）**：

```
┌─ .topnav (absolute, top: {{navTop}}rpx, right: {{capsuleGap}}rpx)
│   ├─ .icon-btn > back-light.svg (左)
│   └─ .icon-btn > share-light.svg (右，须避开胶囊)
├─ .hero (同 activity-detail 结构，但 kicker 改为 "TOURNAMENT · KNOCKOUT")
├─ .section "BRACKET"
│   └─ 淘汰赛对阵图（树形结构）
├─ .section "GROUP STANDINGS" (如有小组赛阶段)
│   └─ 积分表格
└─ .cta-bar（状态相关按钮）
```

---

## 5. custom-tab-bar 实现规范

位置：`/miniprogram/custom-tab-bar/`

### 5.1 视觉要求

- 背景：`var(--color-surface)` (#f8f4e8)
- 上边线：`1rpx solid var(--color-border)` 
- 三个 Tab：赛事 / 活动 / 我的
- 每个 Tab：SVG 图标(48rpx) + 文字标签(20rpx mono)
- 选中态：图标颜色 `var(--color-emerald-deep)`，文字同色
- 未选中：`var(--color-muted)`
- **无下划线指示器**（不是 segmented control，是纯 tabbar）

### 5.2 图标文件

| Tab | 默认图标 | 选中图标 |
|-----|---------|---------|
| 赛事 | `tab-trophy.svg` | `tab-trophy-active.svg` |
| 活动 | `tab-calendar.svg` | `tab-calendar-active.svg` |
| 我的 | `tab-person.svg` | `tab-person-active.svg` |

选中图标 = 默认图标的 stroke-width 从 1.5 变为 2（更粗），或 fill 从 none 变为 currentColor。

---

## 6. 导航系统实现

### 6.1 `utils/nav.js`（已存在，确认内容）

```js
function initNav() {
  const sys = wx.getSystemInfoSync();
  const capsule = wx.getMenuButtonBoundingClientRect();
  const statusBarHeight = sys.statusBarHeight;
  const navBarHeight = capsule.height + (capsule.top - statusBarHeight) * 2;
  const navTopPx = capsule.top + (capsule.height - 32) / 2; // 32px = back button icon size
  const navTopRpx = navTopPx * (750 / sys.windowWidth);
  const capsuleGapPx = sys.windowWidth - capsule.left + 8;
  const capsuleGapRpx = capsuleGapPx * (750 / sys.windowWidth);
  
  return {
    statusBarHeight,
    navBarHeight,
    navTopPx,
    navTopRpx: Math.round(navTopRpx),
    capsuleGapPx,
    capsuleGapRpx: Math.round(capsuleGapRpx),
  };
}

module.exports = { initNav };
```

### 6.2 每个子页面 onLoad 必须包含

```js
onLoad() {
  const nav = getApp().globalData.nav;
  this.setData({
    navTop: nav ? nav.navTopRpx : 0,
    capsuleGap: nav ? nav.capsuleGapRpx : 190
  });
},
goBack() {
  wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
},
```

### 6.3 WXML 返回按钮模板

**A. 浅底页面**（activity-create / tournament-create / ranking 等）：
```wxml
<view class="page-back" style="top: {{navTop}}rpx;" bindtap="goBack">
  <image src="/assets/icons/back.svg" mode="aspectFit" />
</view>
```

**B. 深底 Hero 页面**（activity-detail / tournament-detail）：
```wxml
<view class="topnav" style="top: {{navTop}}rpx;">
  <view class="icon-btn" bindtap="goBack">
    <image src="/assets/icons/back-light.svg" mode="aspectFit" />
  </view>
  <!-- 如果右侧有按钮 -->
  <view class="icon-btn" bindtap="onShare">
    <image src="/assets/icons/share-light.svg" mode="aspectFit" />
  </view>
</view>
```

对应 WXSS（页面级，不是全局）：
```css
.topnav {
  position: absolute;
  left: 0;
  right: 0;
  padding: 0 32rpx;
  display: flex;
  justify-content: space-between;
  z-index: 5;
}
.topnav .icon-btn {
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  border: 1rpx solid rgba(248, 244, 232, 0.4);
  background: rgba(36, 58, 48, 0.4);
  display: grid;
  place-items: center;
}
.topnav .icon-btn image {
  width: 32rpx;
  height: 32rpx;
}
```

---

## 7. 全局 WXSS 类索引（已在 app.wxss 中定义，不要重复定义）

| 类名 | 用途 | 禁止操作 |
|------|------|---------|
| `.card` / `.card-eyebrow` / `.card-title` / `.card-meta` / `.card-foot` | 卡片系统 | 不要在页面 wxss 重写 |
| `.meta-row` / `.meta-icon` / `.meta-label` / `.meta-value` / `.meta-badge` | 元数据行 | 不要在页面 wxss 重写 |
| `.datestamp` / `.datestamp-day` / `.datestamp-month` / `.datestamp-right` | 日期戳 | 不要在页面 wxss 重写 |
| `.capacity` / `.capacity-num` / `.capacity-bar` | 容量进度 | 不要在页面 wxss 重写 |
| `.player` / `.avatar` / `.player-name` / `.player-rating` | 玩家卡 | 不要在页面 wxss 重写 |
| `.cta-primary` | 主按钮 | 不要改高度/颜色 |
| `.tag` / `.tag--open` / `.tag--closed` / `.tag--accent` | 标签 | 不要在页面 wxss 重写 |
| `.section-eyebrow` | 段眉 | 不要在页面 wxss 重写 |
| `.rules` / `.rule-item` / `.rule-num` / `.rule-text` | 规则列表 | 不要在页面 wxss 重写 |
| `.empty-state` | 空状态 | 不要在页面 wxss 重写 |
| `.hero` / `.hero-kicker` / `.hero-title` | Hero 区 | 不要在页面 wxss 重写 |
| `.masthead` / `.wordmark` / `.icon-pill` | 列表页头 | 不要在页面 wxss 重写 |
| `.page-back` | 通用返回按钮 | 不要在页面 wxss 重写 |
| `.cta-bar` | 底部操作栏 | — |

---

## 8. 改完后的自检清单（每个页面改完都必须执行）

```bash
# 1. 检查是否有非 token 硬编码颜色（应该为 0 结果）
grep -rn '#[0-9a-fA-F]\{3,8\}' miniprogram/pages/{PAGE_NAME}/ miniprogram/components/ --include="*.wxss"

# 2. 检查是否有 emoji 残留（应该为 0 结果）
grep -rnP '[\x{1F300}-\x{1F9FF}\x{2600}-\x{26FF}\x{2700}-\x{27BF}]' miniprogram/pages/{PAGE_NAME}/ --include="*.wxml"

# 3. 检查所有 image src 引用的 SVG 是否存在且非空
grep -oh 'src="/assets/icons/[^"]*"' miniprogram/pages/{PAGE_NAME}/*.wxml | sort -u | while read -r line; do
  file=$(echo "$line" | sed 's|src="/|miniprogram/|;s|"||g')
  if [ ! -s "$file" ]; then echo "❌ Missing/empty: $file"; fi
done

# 4. 检查是否有 box-shadow（只允许 modal 用）
grep -rn 'box-shadow' miniprogram/pages/{PAGE_NAME}/*.wxss

# 5. 检查页面 wxss 是否重复定义了全局类
grep -n '\.card\b\|\.meta-row\b\|\.hero\b\|\.cta-primary\b\|\.player\b\|\.tag\b\|\.datestamp\b' miniprogram/pages/{PAGE_NAME}/*.wxss
```

将 `{PAGE_NAME}` 替换为当前页面目录名（如 `activity-detail`）。

---

## 9. 实现顺序（按依赖关系排列）

| 阶段 | 范围 | 预期改动 |
|------|------|---------|
| **P1** | SVG 图标内容补全 | 只改 `assets/icons/*.svg`，确保所有图标有完整路径 |
| **P2** | custom-tab-bar 样式对齐 | 改 `custom-tab-bar/index.wxml` + `.wxss` |
| **P3** | index（活动列表）+ masthead | 改 `pages/index/` |
| **P4** | match-list（赛事列表） | 改 `pages/match-list/` |
| **P5** | activity-detail（活动详情）| 改 `pages/activity-detail/` — **最高优先级验证页** |
| **P6** | profile（我的） | 改 `pages/profile/` |
| **P7** | ranking（排行榜） | 改 `pages/ranking/` |
| **P8** | tournament-detail（赛事详情） | 改 `pages/tournament-detail/` |
| **P9** | 三个 create 表单 | 改 `pages/activity-create/` + `tournament-create/` |
| **P10** | poster（海报） | 改 `pages/poster/` + `utils/poster-draw.js` + `utils/poster-styles.js` |

---

## 10. 图表实现规范（方案 A · 发丝网格）

Profile 页中的积分趋势图使用 Canvas 2D API 绘制：

```
视觉要素：
- 背景：透明（不画）
- Y 轴网格线：水平 4 条，stroke 1rpx，颜色 var(--color-border)
- Y 轴标签：右侧，mono 字体，20rpx，颜色 muted
- 折线：1.5px stroke，颜色 var(--color-emerald-deep)
- 数据点：无圆点（纯折线）
- 当前值标注：最后一个点上方，黄铜金色圆点 + 数值标签
- X 轴标签：底部月份，mono 字体，18rpx
```

Canvas 绘制用 `wx.createSelectorQuery().select('#chartCanvas').fields({ node: true, size: true })` 获取 Canvas 实例。

---

## 11. 表单页共享规范

三个创建表单（activity-create / tournament-create / match-create）共享 `.form-row` 原语：

```css
.form-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 32rpx 0;
  border-bottom: var(--border-hairline);
}
.form-label {
  font-size: var(--text-body);
  color: var(--color-fg);
}
.form-value {
  font-size: var(--text-body);
  color: var(--color-muted);
  text-align: right;
}
.form-input {
  flex: 1;
  text-align: right;
  font-size: var(--text-body);
  color: var(--color-fg);
  border: none;
  background: none;
}
```

---

## 12. roster（花名册）布局规范

```css
.roster {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 32rpx;
}
```

每个 `.player` 在 roster 内为单列布局（avatar + info 纵向叠放或横向 grid）。

---

## 13. 错误恢复指南

如果你发现某个页面和设计稿差异很大，按以下流程修复：

1. **打开对应的 reference HTML 文件**，逐段对比当前 wxml 结构
2. **列出差异点**：缺失元素 / 多余元素 / 错误类名 / 错误层级
3. **从上到下修复**，不要跳着改（容易漏）
4. **SVG 逐个验证**：打开每个引用的 SVG 文件，确认有 `<path d="...">` 内容
5. **运行 §8 自检**
6. **报告**：改了什么 + 自检结果

---

## 14. 禁止行为清单

- ❌ 使用 `wx.showNavigationBarLoading()` 或任何系统导航栏 API
- ❌ 在 wxml 中使用 emoji 字符（📍🕐👥🎯 等）
- ❌ 使用 `box-shadow` 做卡片层级（用 border-top）
- ❌ 把 `.hero` 区域替换为普通 header
- ❌ 创建空的 SVG 文件（`<svg></svg>` 无路径）
- ❌ 在页面级 wxss 重新定义 app.wxss 中已有的全局类
- ❌ 使用 `navigateStyle: default` 或不画返回按钮
- ❌ 把所有文字都用 sans-serif（必须区分 display / body / mono）
- ❌ 把 `.icon-pill`（圆形按钮）做成大矩形或方块
- ❌ 使用 `env(safe-area-inset-top)` 定位返回按钮（必须用 JS 计算的 navTop）
- ❌ 一次改多个页面不自检

---

## 15. 完成标准

当以下全部满足时，一个页面算"完成"：

1. ✅ WXML 结构与 reference HTML 的 DOM 层级一致（类名可映射）
2. ✅ 所有 SVG 图标有完整的 path 内容，渲染为可见图形
3. ✅ 字体三层明确（display / body / mono），可从截图区分
4. ✅ 颜色全部来自 `var(--color-*)` 变量
5. ✅ Hero 区有渐变背景 + court-lines + kicker + title
6. ✅ 返回按钮使用 JS 计算的 navTop 定位
7. ✅ §8 自检全部通过（grep 无违规输出）
8. ✅ 无 emoji、无阴影、无系统导航栏

---

*Prompt 结束。实现时按 §9 顺序逐阶段执行，每阶段完成后报告 + 自检结果。*
