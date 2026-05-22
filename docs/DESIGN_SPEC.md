# 腾讯广州网球社 · 设计规范

> 版本：v0.1（2026-05-22）
> 风格方向：emerald-heritage（私享俱乐部 · 米白纸 / 深翠 / 黄铜）
> 目标平台：微信小程序，iPhone 标准 375 × 812
> 适用项目：`/Users/mickmi/CodeBuddy/20260519154628/tennis-club`
>
> **本文档的角色**：
> - 给 **Claude Code / 开发者**：这是从设计端约定下来的「实施契约」，包含 Tokens、组件配方、Page Contract、状态清单。按本文实现就能拿到设计稿同款效果。
> - 给 **后端**：每个页面的「数据契约」节是前端对后端 API 字段的硬要求，包含字段命名、状态枚举、为支持设计需要补的字段。
> - 给 **设计**：是设计稿背后的系统，新加页面前先来这里翻 Tokens / 组件，避免再造轮子。
>
> **修改这份文档的优先级高于修改单个页面**。如果实现时发现文档与设计稿冲突，先回来修文档再写代码。

---

## 目录

1. 概述与读后总结
2. 信息架构（IA）
3. 设计 Tokens
4. 图标系统
5. 组件配方
6. Page Contract（11 个页面，逐页）
7. 数据契约 · 后端字段速查
8. 状态变体清单（empty / loading / 满员 / 我已报名 / …）
9. 迁移指南：从现有 `app.wxss` 切到本规范

---

## 1. 概述与读后总结

### 1.1 我读了什么

- 11 个页面：`index`（活动列表）、`activity-create`、`activity-detail`、`match-list`（赛事列表）、`match-create`（快速比赛）、`match-detail`、`tournament-create`、`tournament-detail`、`ranking`、`profile`、`onboarding`
- 5 个云函数：`activity` / `match` / `tournament` / `login` / `init-db`
- 4 个集合：`users` / `activities` / `matches` / `tournaments`
- 2 个工具模块：`utils/api.js` / `utils/format.js` / `utils/user.js`

### 1.2 主要发现

**好的部分**：
- 三 Tab 结构 `活动 / 赛事 / 我的` 已经在 `app.json` 里到位，**不需要改 IA**。
- 后端字段和 action 设计清晰，全部走云函数 + 统一返回 `{ code, data, msg }`，前端只关心 data 的 shape。
- 用户标识是 `openid + wecomName`，名称在 `users` 改名时会同步刷到所有 `activities.participants` / `matches.teamA/B` / `tournaments.players` —— 已经处理了"重命名后冗余字段不一致"的问题。

**需要在重设计中重点处理的**：

1. **当前 UI 全是 emoji**：⏰📍👥📝🎾🏆🏅🏸📋📅♂♀ ——本文档第 4 节给出 8 枚线性图标的替代方案。
2. **当前 `app.wxss` 的微信绿 `#1aad19` 与本设计语言冲突** —— 第 3 节 Tokens 给出 emerald-heritage 全套替代色。
3. **真实数据对设计的冲击**（来自 `init-db` 的 mock 数据 + 字段长度限制）：
   - `wecomName` 上限 20 字，可能出现 4–5 字中文姓名 → avatar+名字布局必须做截断策略
   - `rating` 是字符串 NTRP（"3.5"、"未评级"），约 60% 用户可能未评级
   - `location` 上限 50 字 → 详情页可能需要两行
   - `note` 上限 200 字 → 详情页需要折叠/展开
   - `participants` / `players` 可能为空（活动刚发）→ 必须有 empty-state 变体
   - `maxPeople = 0` 表示"不限人数" → 容量条要变成"无限"形态
   - 活动 `status` 仅 `open` / `closed`；比赛 `status` 是 `signup` / `ready` / `finished`；赛事 `status` 是 `signup` / `group` / `knockout` / `finished` —— **每个状态对应不同的 CTA 文案与禁用规则**，第 6 节逐页定义。

4. **后端需要补 / 修的字段**（设计端先把口子留好，后端按需要补）：
   - `activities.endTime`（可选）：当前只有 `startTime`，无法判断"活动是否进行中 vs 已结束"，详情页时间戳无法显示"已结束 X 小时前"。**建议补**。
   - `activities.coverImage`（可选）：详情页 hero 现在用纯渐变，如果后端能存一张图（云存储 fileID）会让首屏更有"门面感"。**建议补，可空**。
   - `tournaments.bestOf` 与 `tournament-create` 表单不一致：表单允许 `4/5/6`，云函数只接受 `1/3/5`。**这是一个 bug，需要先决策保留哪一个**。
   - `tournaments.matchDate` 是单个日期，但实际"5月月赛"可能跨多天；如果赛事跨日，建议补 `endDate`。**P1**。
   - `users.avatarUrl`（可选）：当前所有 avatar 都用首字母圆圈替代，能用就用，不能用就回退首字母。**建议补，可空**。

5. **建议新增的页面（不在当前路由里）**：
   - `pages/profile/edit-profile`（独立编辑页）—— 当前 profile 页用 inline 切换 editing 状态，移动端体验欠佳。**P2**。
   - 其他暂时不需要补，3 Tab + 现有子页足够。

### 1.3 后续 milestone 建议

| 顺序 | 内容 | 谁先做 |
|---|---|---|
| ① | 把本规范切到 `app.wxss`（Tokens + 通用组件类） | 前端，半天 |
| ② | 补 `activity-detail.wxml` 把 emoji 全部换成图标 | 前端，半天 |
| ③ | 设计端出 5 张高保真稿（活动列表 / 赛事列表 / 赛事详情 / 我的 / 排行榜） | 设计 |
| ④ | 后端补 `coverImage` / `avatarUrl` / 修 `bestOf` 不一致 | 后端 |
| ⑤ | 全量页面迁移 | 前端 |

---

## 2. 信息架构（IA）

### 2.1 三 Tab 结构（保留现状）

```
┌──────────────────────────────────────────────────────────┐
│  Tab Bar                                                 │
│  ┌──────────┬──────────┬──────────┐                      │
│  │   活动   │   赛事   │   我的   │                      │
│  └──────────┴──────────┴──────────┘                      │
│   index      match-list  profile                         │
└──────────────────────────────────────────────────────────┘
```

### 2.2 完整页面树

```
/pages
├── onboarding          ← 首次进入登记企微名（非 Tab）
│
├── 【活动】Tab
│   ├── index                       ← 活动列表（Tab）
│   ├── activity-create             ← 新建/编辑活动
│   └── activity-detail             ← 活动详情 + 报名
│
├── 【赛事】Tab
│   ├── match-list                  ← 赛事 Tab 入口（含排行榜入口 + 赛事列表）
│   ├── ranking                     ← 积分排行榜
│   ├── tournament-create           ← 新建赛事
│   ├── tournament-detail           ← 赛事详情（小组赛 / 淘汰赛 / 签表）
│   ├── match-create                ← 新建快速比赛（单场）
│   └── match-detail                ← 单场比赛详情 + 报名 + 录分
│
└── 【我的】Tab
    └── profile                     ← 个人中心（含 ELO/积分趋势 + 历史战绩 + 参与活动）
```

### 2.3 概念分层

> **重要**：原项目的"赛事"概念里有两个互不相同的东西，**设计上必须区分清楚**，否则用户会困惑：

| 概念 | 后端 collection | 含义 | 触发流程 |
|---|---|---|---|
| **活动 Activity** | `activities` | 一次组织出来的打球聚会，无胜负、无积分 | 报名 → 截止 |
| **比赛 Match** | `matches` | 单场对阵（1 vs 1 或 2 vs 2），有比分、有积分 | 报名 → 随机分组 → 录分 |
| **赛事 Tournament** | `tournaments` | 完整赛事（小组赛 + 淘汰赛），多场组成 | 报名 → 抽签 → 小组赛 → 淘汰赛 → 颁奖 |

**Tab 设计映射**：
- 「活动 Tab」= `Activity`（聚会类）
- 「赛事 Tab」= `Tournament`（完整赛事）+ `Match`（快速比赛）+ `Ranking`（排行榜）
- 「我的 Tab」= 用户档案 + 战绩 + 评级

---

## 3. 设计 Tokens

> **直接 copy 到 `miniprogram/app.wxss` 顶部即可**。微信小程序不支持 CSS 自定义属性嵌套于 `:root`，但支持 `page` 选择器作为全局根。

### 3.1 颜色（OKLCH 写法 + 微信小程序兼容的 hex 备份）

```css
/* === 全局色板（emerald-heritage） === */
page {
  /* 中性 - 米白纸张 */
  --color-bg:        #f1ece0;  /* oklch(96% 0.018 90)  - 页面底色 */
  --color-surface:   #f8f4e8;  /* oklch(98% 0.008 90)  - 卡片底色 */
  --color-border:    #ddd6c4;  /* oklch(88% 0.015 90)  - 发丝边线 */

  /* 文字 */
  --color-fg:        #1f2e22;  /* oklch(22% 0.05 155)  - 正文/标题/图标 */
  --color-muted:     #5d6e63;  /* oklch(45% 0.025 145) - 次要文字、metadata */
  --color-disabled:  #b6b29f;  /* 禁用态文字 */

  /* 主品牌 - 深翠墨绿 */
  --color-emerald-deep: #243a30;  /* oklch(26% 0.06 155) - 主按钮底、Hero 顶 */
  --color-emerald:      #2d5443;  /* oklch(36% 0.075 155) */

  /* 强调 - 黄铜金（吝啬使用，每屏 ≤ 3 处）*/
  --color-accent:    #b87a36;  /* oklch(62% 0.13 75)  - 状态、CTA 装饰、kicker */

  /* 状态语义 */
  --color-success:   #2d5443;  /* 用 emerald 表达"进行中/已报名" */
  --color-warning:   #b87a36;  /* 用 accent 表达"即将开始/有空位" */
  --color-danger:    #8b3a3a;  /* 仅用于 删除/取消 这类破坏性操作 */
  --color-info:      #5d6e63;  /* 用 muted 表达"已结束/灰态" */

  /* 设备外壳（仅设计稿用，开发时不需要）*/
  --device-frame: #0c1410;
}
```

**色彩使用原则（必须遵守）**：
- **黄铜金 `--color-accent` 每个页面 ≤ 3 处**：通常给 ① 一个 kicker 或标识、② 一个状态指示、③ 一个 CTA 装饰线。多了就回到 AI-slop。
- **绝不使用** 微信原生绿 `#1aad19`、紫色渐变、彩色阴影。
- **删除/危险操作** 用 `--color-danger`，不要染绿。

### 3.2 字体

```css
page {
  /* 西文/数字 衬线 - 用于大标题、纪念碑式数字 */
  --font-display: 'Iowan Old Style', 'Charter', 'Source Han Serif SC', 'Songti SC', Georgia, serif;

  /* 中文/正文 - 系统字体 */
  --font-body: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Segoe UI', system-ui, sans-serif;

  /* 等宽 - 用于 kicker、状态、metadata、英文标签 */
  --font-mono: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace;

  font-family: var(--font-body);
}
```

**字号阶（rpx，小程序单位）**：

| Token | rpx | px @375 | 用途 |
|---|---|---|---|
| `--text-display-xl` | 160rpx | 80px | 详情页巨幅日期戳 |
| `--text-display-lg` | 68rpx | 34px | 详情页主标题 |
| `--text-display-md` | 48rpx | 24px | 列表卡片大标题、tab 切换页头 |
| `--text-display-sm` | 36rpx | 18px | section 大标题、pull quote |
| `--text-body-lg` | 30rpx | 15px | 段落正文 |
| `--text-body` | 28rpx | 14px | 列表正文（默认）|
| `--text-body-sm` | 24rpx | 12px | metadata、次要描述 |
| `--text-mono-md` | 22rpx | 11px | 标签、状态、kicker |
| `--text-mono-sm` | 20rpx | 10px | eyebrow、最小标签 |

**字重**：
- `font-weight: 500` —— display 字号默认（Iowan 中等粗细已足够）
- `font-weight: 400` —— body 默认
- `font-weight: 600` —— 仅用于"我"高亮（排行榜里 my-row、CTA 按钮）

**字距（letter-spacing）**：
- 中文 body：默认 0
- 西文 mono uppercase（kicker / 状态）：`0.18em ~ 0.22em`
- display 大字号：`-0.01em ~ 0.005em`（轻微紧排）

**数字 OpenType**：所有数字位（积分、ELO、比分、报名人数、日期）都加 `font-feature-settings: 'tnum', 'lnum';` —— 让数字等宽，列表对齐才好看。

### 3.3 间距 / 圆角 / 边线

```css
page {
  /* 间距阶 */
  --space-1:  8rpx;
  --space-2:  16rpx;
  --space-3:  24rpx;   /* container 内边距默认 */
  --space-4:  32rpx;
  --space-5:  48rpx;
  --space-6:  64rpx;
  --space-7:  96rpx;

  /* 圆角（emerald-heritage 偏方） */
  --radius-none: 0;
  --radius-sm:   4rpx;     /* 标签、徽章 */
  --radius-md:   8rpx;     /* 表单输入 */
  --radius-lg:   16rpx;    /* 极少用，仅模态/底部抽屉 */
  --radius-pill: 999rpx;   /* avatar 圆形 */

  /* 边线 */
  --border-hairline: 1rpx solid var(--color-border);   /* 发丝线（默认） */
  --border-strong:   1rpx solid var(--color-fg);       /* 强分隔（section 顶部）*/
  --border-accent:   2rpx solid var(--color-accent);   /* pull-quote 左侧装饰 */

  /* 阴影（emerald-heritage 几乎不用阴影，留给模态） */
  --shadow-modal: 0 8rpx 32rpx rgba(20, 30, 25, 0.18);
}
```

**重要决定**：
- **卡片用边线 + 留白分隔，不再使用 `box-shadow` 和 `border-radius: 16rpx`**。
- 唯一例外：底部弹起的 actionSheet / Modal 用 `--shadow-modal`。

### 3.4 触达区 / 安全区

- 最小可点击区域：**88rpx × 88rpx**（44pt）—— 任何按钮、链接行高都≥这个值。
- 页面底部留 **64rpx** 给 home indicator + iOS 安全区。
- CTA 固定栏高度：**100rpx 内容 + 60rpx 底部安全区 = 160rpx**。

---

## 4. 图标系统

### 4.1 总原则

- **0 emoji**。所有功能性图标用 SVG 线性图标。
- 尺寸：**32rpx × 32rpx**（小）、**40rpx × 40rpx**（中，meta-row 默认）、**56rpx × 56rpx**（大，empty-state）。
- 描边：**1.5px**（在 24×24 viewBox 下）。
- 颜色：默认 `currentColor`，由父级 `color` 控制。
- 不填充（`fill="none"`），描边圆头（`stroke-linecap="round"` `stroke-linejoin="round"`）。

### 4.2 必备图标库（迁移阶段必备 12 枚）

> 全部直接 inline SVG，不依赖图标字体或第三方库。统一存到 `miniprogram/components/icon/icon.wxml` 或者直接 inline 到页面。

| 图标 | viewBox 24×24 path | 替代原 emoji | 用途 |
|---|---|---|---|
| `icon-back` | `<polyline points="15 6 9 12 15 18"/>` | — | 顶部返回 |
| `icon-share` | `<path d="M12 3v13"/><polyline points="7 8 12 3 17 8"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>` | — | 分享 |
| `icon-more` | 三个 r=1.2 圆点 (5,12) (12,12) (19,12) | — | 更多操作 |
| `icon-arrow-right` | `<line x1="4" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/>` | `›` `→` | CTA 箭头、列表项进入 |
| `icon-clock` | `<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>` | ⏰ | 时间 |
| `icon-pin` | `<path d="M12 21s-7-7-7-12a7 7 0 0 1 14 0c0 5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>` | 📍 | 地点 |
| `icon-people` | `<circle cx="9" cy="8" r="3"/><path d="M3 19v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1"/><circle cx="17" cy="9" r="2.5"/><path d="M21 19v-1a4 4 0 0 0-3-3.87"/>` | 👥 | 人数 |
| `icon-note` | `<path d="M9 4h6a2 2 0 0 1 2 2v14a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V6a2 2 0 0 1 2-2z"/><line x1="9.5" y1="9" x2="14.5" y2="9"/><line x1="9.5" y1="13" x2="14.5" y2="13"/><line x1="9.5" y1="17" x2="13" y2="17"/>` | 📝 | 备注 |
| `icon-tennis` | `<circle cx="12" cy="12" r="9"/><path d="M3 12c5-3 13-3 18 0"/><path d="M12 3c3 5 3 13 0 18"/>` | 🎾🏸 | 网球（单/双打） |
| `icon-trophy` | `<path d="M8 4h8v3a4 4 0 0 1-8 0V4z"/><path d="M5 5a2 2 0 0 0 2 2"/><path d="M19 5a2 2 0 0 1-2 2"/><line x1="12" y1="11" x2="12" y2="16"/><path d="M9 20h6"/>` | 🏆🏅 | 排行榜、赛事入口、冠军 |
| `icon-list` | `<line x1="6" y1="6" x2="20" y2="6"/><line x1="6" y1="12" x2="20" y2="12"/><line x1="6" y1="18" x2="20" y2="18"/><circle cx="3" cy="6" r="0.8"/><circle cx="3" cy="12" r="0.8"/><circle cx="3" cy="18" r="0.8"/>` | 📋 | 名单、列表 |
| `icon-pencil` | `<path d="M14 4l6 6L8 22H2v-6L14 4z"/>` | ✏️ | 编辑 |
| `icon-trash` | `<polyline points="4 7 20 7"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/>` | 🗑️ | 删除 |
| `icon-check` | `<polyline points="5 12 10 17 19 7"/>` | ✓ | 选中、成功 |
| `icon-plus` | `<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>` | `+` | FAB、新建 |
| `icon-male` | `<circle cx="10" cy="14" r="5"/><line x1="14" y1="10" x2="20" y2="4"/><polyline points="14 4 20 4 20 10"/>` | ♂ | 性别男 |
| `icon-female` | `<circle cx="12" cy="9" r="5"/><line x1="12" y1="14" x2="12" y2="22"/><line x1="9" y1="18" x2="15" y2="18"/>` | ♀ | 性别女 |

### 4.3 性别表示的替代方案

不用 ♂/♀ 符号也不用图标的话，可以用更克制的方式：
- avatar 的边框颜色：女性 = `--color-accent`（黄铜金），男性 = `--color-border`（默认发丝线）
- 这是设计稿里已经在用的方式，**推荐保留**。

---

## 5. 组件配方（WXML + WXSS 片段）

> 每个组件都给一份 WXML 骨架 + 关键 WXSS。开发可以直接抄进 `app.wxss` 公共类，或者拆成 components/ 复用。

### 5.1 卡片（card）—— 用边线代替阴影

```html
<!-- WXML -->
<view class="card" bindtap="..." data-id="...">
  <view class="card-eyebrow">SPRING DOUBLES · NO. 03</view>
  <view class="card-title">春季双打月赛 第三场</view>
  <view class="card-meta">
    <view class="meta-item">
      <icon name="clock" size="32" />
      <text>05/30 14:00</text>
    </view>
    <view class="meta-item">
      <icon name="pin" size="32" />
      <text>二沙岛 1-3 号场</text>
    </view>
  </view>
  <view class="card-foot">
    <view class="card-status">报名中 · 18 / 24</view>
    <icon name="arrow-right" size="32" class="card-arrow" />
  </view>
</view>
```

```css
/* WXSS */
.card {
  background: var(--color-surface);
  border-top: var(--border-strong);
  padding: 32rpx 0;
  margin: 0 32rpx;
  display: block;
}
.card + .card { border-top: var(--border-hairline); }
.card-eyebrow {
  font-family: var(--font-mono);
  font-size: 20rpx;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--color-accent);
  margin-bottom: 12rpx;
}
.card-title {
  font-family: var(--font-display);
  font-size: 48rpx;
  line-height: 1.2;
  color: var(--color-fg);
  margin-bottom: 16rpx;
}
.card-meta { display: flex; gap: 24rpx; color: var(--color-muted); font-size: 24rpx; }
.meta-item { display: flex; align-items: center; gap: 8rpx; }
.card-foot {
  display: flex; justify-content: space-between; align-items: center;
  margin-top: 24rpx;
  font-family: var(--font-mono);
  font-size: 22rpx;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--color-fg);
}
.card-arrow { color: var(--color-accent); }
```

### 5.2 Meta 行（meta-row）—— 详情页字段陈列

```html
<view class="meta-row" data-field="detail.location">
  <icon name="pin" class="meta-icon" />
  <view class="meta-body">
    <text class="meta-label">场地</text>
    <text class="meta-value">广州 · 二沙岛网球中心 1-3 号场</text>
  </view>
  <view class="meta-badge" wx:if="{{badge}}">{{badge}}</view>
</view>
```

```css
.meta-row {
  display: grid;
  grid-template-columns: 44rpx 1fr auto;
  column-gap: 28rpx;
  align-items: center;
  padding: 26rpx 0;
  border-bottom: var(--border-hairline);
}
.meta-icon { width: 36rpx; height: 36rpx; color: var(--color-muted); }
.meta-label {
  display: block;
  font-family: var(--font-mono);
  font-size: 19rpx;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin-bottom: 6rpx;
}
.meta-value {
  font-size: 29rpx;
  line-height: 1.35;
  color: var(--color-fg);
  font-feature-settings: 'tnum';
}
.meta-badge {
  font-family: var(--font-mono);
  font-size: 20rpx;
  color: var(--color-accent);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  border: 1rpx solid var(--color-accent);
  padding: 8rpx 16rpx;
}
```

### 5.3 巨幅日期戳（datestamp）

```html
<view class="datestamp">
  <view class="datestamp-day">
    {{day}}
    <text class="datestamp-month">{{month}} · {{weekday}}</text>
  </view>
  <view class="datestamp-right">
    <view class="datestamp-when">{{startTime}} — {{endTime}}<br/>{{rule}}</view>
    <view class="datestamp-session">{{session}}</view>
  </view>
</view>
```

详细 WXSS 见原型 `tennis-club-activity-detail-2.html`。**核心**：上下两道 `--border-strong` 包夹 + 80px 衬线日期 + tnum/lnum。

### 5.4 容量进度（capacity）

```html
<view class="capacity" aria-label="报名进度 {{joined}} of {{max}}">
  <view class="capacity-num">
    {{joined}} <em>/ {{max}}</em>
  </view>
  <view class="capacity-meta">FILLED {{percent}}%</view>
  <view class="capacity-bar" style="--fill: {{percent}}%"></view>
</view>
```

```css
.capacity { display: grid; grid-template-columns: 1fr auto; align-items: end; gap: 8rpx; }
.capacity-num { font-family: var(--font-display); font-size: 56rpx; line-height: 1; color: var(--color-fg); font-feature-settings: 'tnum','lnum'; }
.capacity-num em { font-style: normal; color: var(--color-muted); font-size: 36rpx; }
.capacity-meta { font-family: var(--font-mono); font-size: 19rpx; letter-spacing: 0.2em; color: var(--color-muted); text-transform: uppercase; }
.capacity-bar { grid-column: 1 / -1; margin-top: 20rpx; height: 4rpx; background: var(--color-border); position: relative; }
.capacity-bar::after { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: var(--fill); background: var(--color-accent); }
```

**注意 `maxPeople = 0`**（不限人数）：把 `.capacity-bar` 隐藏，`.capacity-num em` 显示 `/ ∞`。

### 5.5 玩家小卡（player）

```html
<view class="player" data-gender="{{gender}}">
  <view class="avatar">{{firstChar}}</view>
  <view class="player-info">
    <text class="player-name">{{wecomName}}</text>
    <text class="player-rating {{rating ? '' : 'unrated'}}">
      {{rating ? 'NTRP ' + rating : '未评级'}}
    </text>
  </view>
</view>
```

```css
.player {
  display: grid; grid-template-columns: 60rpx 1fr; gap: 20rpx;
  align-items: center; padding: 24rpx 0;
  border-bottom: var(--border-hairline);
  min-width: 0;
}
.avatar {
  width: 60rpx; height: 60rpx; border-radius: 50%;
  background: var(--color-surface);
  border: 1rpx solid var(--color-border);
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-display); font-size: 26rpx; color: var(--color-fg);
  flex-shrink: 0;
}
.player[data-gender='female'] .avatar {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.player-name {
  font-size: 27rpx; color: var(--color-fg);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  display: block;
}
.player-rating {
  font-family: var(--font-mono); font-size: 19rpx;
  letter-spacing: 0.05em; color: var(--color-muted);
  margin-top: 4rpx; display: block; font-feature-settings: 'tnum';
}
.player-rating.unrated { color: var(--color-disabled); }
```

**长名字策略**：超 4 个字 → ellipsis 截断；avatar 取 `wecomName[0]`（中文首字）。

### 5.6 主 CTA 按钮（cta-primary）

```html
<button class="cta-primary" bindtap="onJoin" disabled="{{full || closed}}">
  <text>{{ctaText}}</text>
  <icon name="arrow-right" size="32" />
</button>
```

```css
.cta-primary {
  background: var(--color-emerald-deep);
  color: var(--color-bg);
  border: 1rpx solid var(--color-emerald-deep);
  padding: 28rpx 36rpx;
  font-family: var(--font-body);
  font-weight: 500;
  font-size: 30rpx;
  letter-spacing: 0.06em;
  border-radius: 0;
  display: flex; align-items: center; justify-content: center; gap: 24rpx;
  height: 100rpx;
  position: relative;
}
.cta-primary::after {
  content: '';
  position: absolute; left: 28rpx; right: 28rpx; bottom: 14rpx;
  height: 1rpx;
  background: var(--color-accent);
  opacity: 0.85;
}
.cta-primary[disabled] {
  background: var(--color-border);
  border-color: var(--color-border);
  color: var(--color-muted);
}
.cta-primary[disabled]::after { display: none; }
```

### 5.7 标签 / 徽章（tag）

替换原 `.tag` `.tag-gray`：

```html
<text class="tag tag--open">报名中</text>
<text class="tag tag--closed">已结束</text>
<text class="tag tag--accent">DOUBLES</text>
```

```css
.tag {
  display: inline-block;
  font-family: var(--font-mono);
  font-size: 20rpx;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  padding: 6rpx 14rpx;
  border: 1rpx solid currentColor;
  border-radius: 0;
}
.tag--open    { color: var(--color-emerald-deep); }
.tag--closed  { color: var(--color-muted); }
.tag--accent  { color: var(--color-accent); }
.tag--danger  { color: var(--color-danger); }
```

### 5.8 Section eyebrow（带顶线分隔）

```html
<view class="section-eyebrow">
  <text>赛制规则</text>
  <text class="meta">RULES</text>
</view>
```

```css
.section-eyebrow {
  border-top: var(--border-strong);
  padding-top: 22rpx;
  margin-bottom: 32rpx;
  display: flex; justify-content: space-between; align-items: baseline;
  font-family: var(--font-mono); font-size: 20rpx;
  text-transform: uppercase; letter-spacing: 0.22em;
  color: var(--color-fg);
}
.section-eyebrow .meta { color: var(--color-muted); font-size: 18rpx; letter-spacing: 0.2em; }
```

### 5.9 数字编号列表（rules / steps）

```html
<view class="rules">
  <view class="rule-item">
    <text class="rule-num">01</text>
    <text class="rule-text">抽签分入两个小组，组内单循环后取小组前二交叉淘汰。</text>
  </view>
  ...
</view>
```

```css
.rule-item {
  display: grid; grid-template-columns: 60rpx 1fr; column-gap: 28rpx;
  padding: 24rpx 0; border-bottom: var(--border-hairline);
  align-items: baseline;
}
.rule-num {
  font-family: var(--font-mono); font-size: 20rpx;
  letter-spacing: 0.2em; color: var(--color-accent);
  font-feature-settings: 'tnum';
}
.rule-text { font-size: 29rpx; line-height: 1.55; color: var(--color-fg); }
```

### 5.10 空状态（empty-state）

```html
<view class="empty-state">
  <icon name="trophy" size="80" class="empty-icon"/>
  <text class="empty-title">还没有赛事</text>
  <text class="empty-desc">组织一场赛事，抽签分组自动化管理</text>
  <button class="cta-primary" bindtap="goCreate">创建赛事</button>
</view>
```

```css
.empty-state {
  display: flex; flex-direction: column; align-items: center;
  padding: 200rpx 60rpx 120rpx;
  text-align: center;
}
.empty-icon { color: var(--color-muted); margin-bottom: 32rpx; }
.empty-title { font-family: var(--font-display); font-size: 40rpx; color: var(--color-fg); margin-bottom: 16rpx; }
.empty-desc { font-size: 26rpx; color: var(--color-muted); margin-bottom: 64rpx; line-height: 1.5; }
.empty-state .cta-primary { width: 320rpx; }
```

### 5.11 顶部 Hero（详情页用，深底）

```html
<view class="hero">
  <view class="hero-court-lines"><!-- SVG 半场地线条做底纹 --></view>
  <view class="hero-nav">
    <view class="hero-nav-back"><icon name="back"/></view>
    <view class="hero-nav-actions">
      <view class="hero-nav-btn"><icon name="share"/></view>
      <view class="hero-nav-btn"><icon name="more"/></view>
    </view>
  </view>
  <view class="hero-crest">T<text>GZ · TC</text></view>
  <view class="hero-masthead">
    <text class="hero-kicker">{{kicker}}</text>
    <text class="hero-title">{{title}}</text>
    <view class="hero-organiser">
      <text>{{organiser}}</text>
      <text class="sep"></text>
      <text>{{statusText}}</text>
    </view>
  </view>
</view>
```

参考原型实现，关键参数：高度 760rpx、底色径向 + 线性渐变、半场地 SVG 透明度 0.32、kicker 黄铜色横线 + 字、title 衬线 68rpx。

---

## 6. Page Contract（11 个页面，逐页）

> **Page Contract** = 这一页需要的所有数据字段 + 状态变体 + 视觉决定 + 行为映射。前后端共同遵守。

### 6.1 `pages/onboarding`（首次登记）

| 项 | 内容 |
|---|---|
| **路由** | `/pages/onboarding/onboarding`（非 Tab，被 `ensureRegistered` 重定向） |
| **数据契约** | 写入 `users.wecomName`（≤20 字）、`users.gender`（'male' / 'female'）|
| **API** | `api.updateUser({ wecomName, gender })` |
| **状态变体** | 1 种：未登记。提交成功后跳转回 `/pages/index/index`。|
| **视觉决定** | 顶部 hero 占 1/3 屏（深翠 + 球场线纹路），下半部分米白卡片放表单。一句衬线欢迎词 + 两个输入。|
| **CTA** | `提交` 主按钮。表单未填齐 → 禁用态。|

### 6.2 `pages/index`（活动 Tab · 列表）

| 项 | 内容 |
|---|---|
| **路由** | `/pages/index/index` |
| **数据契约** | `api.listActivities()` → `[Activity]`（最多 100 条，按 `startTime` desc）|
| **必备字段** | `_id, title, startTime, location, maxPeople, participants[], status('open'\|'closed'), creator, creatorName` |
| **派生字段** | `joinedCount = participants.length`、`startTimeText = formatDateTime(startTime)`、`isFull = maxPeople > 0 && joinedCount >= maxPeople` |
| **状态变体** | ① 加载中（骨架）② 空（empty-state，见 5.10）③ 有列表 ④ 我已报名（卡片右上加 `tag--accent` "已报名"）⑤ 满员（`tag--closed` "满员"）⑥ 已结束（卡片整体 muted，标题不再 fg 而是 muted）|
| **顶栏** | 不固定。页面进入即活动列表，不需要 logo / 搜索（社团内部小工具，加搜索是过度设计）。|
| **FAB** | 右下角 `+` 按钮（管理员/任意用户均可创建，云函数 `activity.create` 只验登记）→ `/pages/activity-create/activity-create`|
| **下拉刷新** | 启用，拉新一次 `loadList`|
| **卡片元素** | eyebrow（"WED · 05/27" mono kicker）+ display 标题 + meta 行（场地/人数）+ 右下小箭头|
| **不要做** | 不要把每张卡片做成"圆角阴影绿色卡片"。用上下边线分隔，第 5.1 节配方。|

### 6.3 `pages/activity-create`（新建/编辑活动）

| 项 | 内容 |
|---|---|
| **路由** | `/pages/activity-create/activity-create?id={editId?}` |
| **数据契约** | 创建：`api.createActivity({ title, startTime, location, maxPeople, note })`；编辑：`api.updateActivity(id, payload)`；编辑模式下加载 `api.getActivity(id)` 预填|
| **字段限制** | `title ≤ 40` / `location ≤ 50` / `note ≤ 200` / `maxPeople`：整数，0 = 不限|
| **状态变体** | ① 创建（标题 "新建活动"）② 编辑（标题 "编辑活动"）|
| **表单结构** | label + input/textarea，每行 `meta-row` 风格，发丝边线分隔。`maxPeople` 输入下方 hint：`留空或 0 = 不限人数`|
| **CTA** | 底部固定 `cta-primary` "保存"。|

### 6.4 `pages/activity-detail`（活动详情）⭐

> 已经有高保真稿 `tennis-club-activity-detail-2.html`，本节仅说明状态变体与权限。

| 项 | 内容 |
|---|---|
| **路由** | `/pages/activity-detail/activity-detail?id=...` |
| **数据契约** | `api.getActivity(id)` → `Activity` + `participants[].rating, participants[].gender`（云函数已附加）|
| **状态变体** | ① 加载中 ② 我未报名 + 未满员 → CTA "立即报名" ③ 我已报名 → CTA "取消报名"（用 `--color-danger` 描边按钮）④ 满员 + 我未报名 → CTA disabled "已满员" ⑤ 已结束（status='closed'）→ 整页 muted，CTA disabled "活动已结束" ⑥ 我是创建者/管理员 → 顶部 more 菜单展开 [编辑 / 删除 / 导出名单] |
| **关键交互** | `onJoin` / `onLeave` / `onEdit` / `onDelete` / `onExport`（导出名单到剪贴板，文本格式见现有 wxml）|
| **导出名单** | 文本格式不再含 emoji。改为：<br>`[活动] {title}` <br>`{startTimeText}` <br>`{location}` <br>`{joinedCount} 人报名` <br>`---`<br>`01. {wecomName}` ... |
| **后端依赖** | participants 列表的 `rating` / `gender` 由 `activity.get` 云函数附加（已实现）|

### 6.5 `pages/match-list`（赛事 Tab · 列表）

| 项 | 内容 |
|---|---|
| **路由** | `/pages/match-list/match-list` |
| **数据契约** | `api.listTournaments()` → `[Tournament]`（云函数未部署时静默返回 null，UI 走 empty）|
| **必备字段** | `_id, title, type, level, status, players[], matchDate, config{groupCount, advanceCount, seedCount}` |
| **派生字段** | `levelText` ('周赛'/'月赛'/'半年赛')、`statusText`、`playerCount`|
| **状态变体** | ① 加载中 ② 空（empty-state）③ 有列表 |
| **顶部固定** | 一行 "排行榜" 入口（带 `icon-trophy` + display 字号 "积分排行榜" + 小箭头），点击 → `/pages/ranking/ranking` |
| **是否要包含 Match（快速比赛）？** | **建议**：在赛事 Tab 顶部加第二个入口 "快速比赛"，进入一个 `match-list-quick`（待新建）或者把 match 列表也放到这里。**P2，先不要做，等用户反馈**。|
| **FAB** | `+` 创建赛事 → `/pages/tournament-create/tournament-create` |

### 6.6 `pages/ranking`（积分排行榜）

| 项 | 内容 |
|---|---|
| **路由** | `/pages/ranking/ranking` |
| **数据契约** | `api.getRanking()` → `{ list: [{rank, openid, wecomName, gender, rating, totalPoints, eloRating}], myRank }` |
| **状态变体** | ① 加载中 ② 空（"还没有人参赛"）③ 有列表（含我）④ 有列表但我未上榜（顶部固定一条 "我 · 暂未上榜 · 去参加比赛"）|
| **行结构** | 排名（mono tnum）+ avatar（首字）+ 名字 + NTRP（mono）+ 总积分（display tnum 大字）|
| **我高亮** | `myOpenid === openid` 的行：底色 `--color-surface`，名字 `font-weight: 600`，左侧 `--border-accent`。|
| **冠亚季军装饰** | 排名 1/2/3 用 mono 大字号 + 黄铜色，从第 4 名起 muted。|

### 6.7 `pages/tournament-create`（新建赛事）

| 项 | 内容 |
|---|---|
| **路由** | `/pages/tournament-create/tournament-create` |
| **数据契约** | `api.createTournament({ title, type, bestOf, level, handicapRule, matchDate, groupCount, advanceCount, seedCount })`|
| **字段决策（重要）** | 当前前端表单 `bestOfOptions: [4, 5, 6]`，但 `tournament/index.js` 第 442 行：`bestOf = [1, 3, 5].includes(p.bestOf) ? p.bestOf : 3`。**矛盾**。<br>**建议**：统一为 `[3, 5]`（先赢 3 盘 / 5 盘）—— 同步改前端表单和云函数。|
| **状态变体** | ① 表单 ② 提交中（按钮 disabled）|
| **表单结构** | 5–7 个 `meta-row` 风格的字段：标题 / 类型（单/双打 segmented）/ 赛制（先赢 N 盘 picker）/ 级别（周/月/半年 segmented）/ 让分规则 / 日期 picker。**不要**把"分组数 / 晋级数 / 种子数" 放在创建时，挪到抽签时管理员决定（云函数已支持 `event.groupCount` 等）。|

### 6.8 `pages/tournament-detail`（赛事详情）⭐ 设计风险最大

| 项 | 内容 |
|---|---|
| **路由** | `/pages/tournament-detail/tournament-detail?id=...` |
| **数据契约** | `api.getTournament(id)` → 大对象，含 `players[], groups[], knockout{rounds[]}, config, status, placementAwards[]` |
| **状态变体（4 大阶段）** | ① `signup`（报名中：玩家列表 + 报名 CTA + 管理员"开始抽签"）② `group`（小组赛：N 个组卡片 + 每组对阵 + 排名表 + 我能录分的高亮 + 管理员"晋级到淘汰赛"按钮）③ `knockout`（淘汰赛：bracket 树状图 + 已确定/未确定的对阵区分）④ `finished`（最终颁奖：前三 + 四强 + 八强 + 我的收益）|
| **签表 vs 赛况 Tab** | 顶部两个 tab：`赛况`（动态视图，按 status 切换内容）+ `签表`（静态全景）|
| **录分模态** | 弹底 actionSheet：A 方分数 input + B 方分数 input，bestOf 提示，提交 → `api.scoreGroup` / `api.scoreKnockout`|
| **抽签设置** | 管理员视角：分组数 picker + 晋级数 picker + 种子数 input + 确认 → `api.drawTournament`|
| **设计承重元素** | ① 顶部 hero（赛事 title + 级别 tag + 状态 tag）② 阶段进度条（signup → group → knockout → finished 4 段）③ 小组赛阶段：每组用一张大 section，组名（A/B/C…）display 衬线 + 排名表 + 对阵列表，已录的对阵显示比分，未录的显示 `vs` 和 hairline |
| **后端依赖** | 现有云函数已经支持全部 action |
| **本页是 P0 设计风险**：信息密度最大、状态最多、bracket 是全新组件 | 建议下一轮专门为这一页出 2 张高保真：`signup` + `group` 两个状态 |

### 6.9 `pages/match-create`（新建快速比赛）

| 项 | 内容 |
|---|---|
| **路由** | `/pages/match-create/match-create` |
| **数据契约** | `api.createMatch({ title, type, bestOf, level, handicapRule, matchDate })` |
| **bestOf** | match 云函数允许 `[4, 5, 6]`（line 108）→ 与 tournament 不一致，但是不同集合，**可以保留**|
| **表单结构** | 同 tournament-create 但更简洁，不含分组配置 |
| **入口** | 当前没有单独入口（只能从 match-detail 或快捷链接进入）。**建议**：在赛事 Tab 顶部 "排行榜" 下面加 "快速比赛 +" 入口。|

### 6.10 `pages/match-detail`（单场比赛详情）

| 项 | 内容 |
|---|---|
| **路由** | `/pages/match-detail/match-detail?id=...` |
| **数据契约** | `api.getMatch(id)` → `Match` 对象 |
| **状态变体（3 大阶段）** | ① `signup`（报名中：报名列表 + 报名/取消 CTA + 创建者"随机分组"按钮 ）② `ready`（已分组：A 方 vs B 方对阵卡 + 录分 CTA）③ `finished`（已结束：A 方 vs B 方 + 比分 + 胜者高亮 + 双方积分变动）|
| **录分** | 创建者 / 双方任一选手 / 管理员 可录分。模态：A 分数 input + B 分数 input。|

### 6.11 `pages/profile`（我的）⭐

| 项 | 内容 |
|---|---|
| **路由** | `/pages/profile/profile`（Tab）|
| **数据契约** | `api.getProfile()` → `{ user, rating, stats{wins, losses, pending, total}, matchHistory[], activities[], eloHistory[], pointsHistory[] }`|
| **状态变体** | ① 未填写企微名（其实 onboarding 已经卡住了，这里不会出现）② 已登记但无任何战绩（empty）③ 全量数据 ④ 编辑信息中（行内编辑切换）|
| **页面结构** | <br>① **Hero 个人卡**：avatar（首字大圆，黄铜描边表示女性）+ 大字 wecomName + 性别小字 + 角色 tag（管理员）+ "修改信息"按钮 <br>② **NTRP 评级 + 总积分 + ELO**：三个 stat 横排，display 大字 tnum<br>③ **战绩**：胜/负/总场次/胜率 四宫格<br>④ **趋势图**：tab 切换 ELO 曲线 / 积分曲线，canvas 绘制（保留现有 `drawChart` 逻辑，只改色板：线 = `--color-emerald-deep`，渐变填充用 `var(--color-accent)` α=0.1）<br>⑤ **历史战绩 / 参与活动 tab 切换**：列表行 |
| **去掉** | 当前 wxml 里的 🎾 avatar、♂♀ 性别小图、🏸 / 📋 空状态 emoji。全部替换为 4.2 的 SVG 图标或纯文字。|
| **关于卡** | 保留底部"关于本小程序 v1.x.x"和"使用说明"两行。|

---

## 7. 数据契约 · 后端字段速查

### 7.1 `users` 集合

```ts
interface User {
  _id: string;
  openid: string;            // 微信 openid
  wecomName: string;         // 企微名（≤20 字），未填写则为 ''
  gender: 'male' | 'female' | '';
  rating: string;            // NTRP，例如 "3.5" | "" | "未评级"（前端把 '' 显示为"未评级"）
  totalPoints: number;       // 最佳 10 场赛事收益之和
  eloRating: number;         // 默认 1500
  eloHistory: { date: number; value: number; tournamentId: string }[];
  tournamentEarnings: { tournamentId: string; title: string; earned: number; date: number }[];
  role: 'admin' | 'member';  // 第一个用户自动 admin
  createdAt: number;
  updatedAt: number;

  // === 设计端建议补的字段 ===
  avatarUrl?: string;        // P2：用户上传头像
}
```

### 7.2 `activities` 集合

```ts
interface Activity {
  _id: string;
  title: string;             // ≤40 字
  startTime: number;         // 时间戳
  location: string;          // ≤50 字
  maxPeople: number;         // 0 = 不限
  note: string;              // ≤200 字，可空
  creator: string;           // openid
  creatorName: string;       // 冗余，重命名时同步
  participants: {
    openid: string;
    wecomName: string;
    joinedAt: number;
    rating?: string;         // 由 activity.get 云函数附加
    gender?: 'male' | 'female' | '';
  }[];
  status: 'open' | 'closed';
  createdAt: number;
  updatedAt: number;

  // === 设计端建议补的字段 ===
  endTime?: number;          // P1：判断"进行中 vs 已结束"
  coverImage?: string;       // P2：详情页 hero 用，云存储 fileID
}
```

### 7.3 `matches` 集合

```ts
interface Match {
  _id: string;
  title: string;
  type: 'singles' | 'doubles';
  bestOf: 4 | 5 | 6;
  level: 'major' | 'challenge' | 'friendly';  // 半年赛 / 月赛 / 周赛
  handicapRule: string;
  matchDate: number;
  signups: { openid: string; wecomName: string; gender: string }[];
  teamA: { openid: string; wecomName: string; gender: string }[];
  teamB: { openid: string; wecomName: string; gender: string }[];
  scoreA: number | null;
  scoreB: number | null;
  winner: 'A' | 'B' | null;
  scoreSummary: string;       // "4:2"
  pointsAwarded: { winPoints: number; losePoints: number } | null;
  creator: string;
  creatorName: string;
  status: 'signup' | 'ready' | 'finished';
  createdAt: number;
  updatedAt: number;
}
```

### 7.4 `tournaments` 集合

```ts
interface Tournament {
  _id: string;
  title: string;
  type: 'singles' | 'doubles';
  bestOf: 1 | 3 | 5;          // ⚠️ 与前端表单 [4,5,6] 不一致，需要统一
  level: 'major' | 'challenge' | 'friendly';
  handicapRule: string;
  matchDate: number;
  status: 'signup' | 'group' | 'knockout' | 'finished';
  players: {
    openid: string; wecomName: string;
    gender: string; rating: string; totalPoints: number;
    seed: number;        // 0 = 非种子
    signupAt: number;
  }[];
  groups: {
    name: string;        // 'A' / 'B' / 'C' ...
    players: { openid: string; wecomName: string; seed: number }[];
    matches: {
      id: string;
      playerA: { openid: string; wecomName: string };
      playerB: { openid: string; wecomName: string };
      scoreA: number | null; scoreB: number | null;
      winner: 'A' | 'B' | null;
      scoreSummary: string;
    }[];
    standings: {
      openid: string; wecomName: string;
      played: number; wins: number; losses: number;
      setsWon: number; setsLost: number;
    }[];
  }[];
  knockout: null | {
    rounds: {
      name: string;      // '半决赛' / '决赛' / '8强'
      matches: {
        id: string;
        playerA: { openid: string; wecomName: string } | null;
        playerB: { openid: string; wecomName: string } | null;
        scoreA?: number; scoreB?: number;
        winner: 'A' | 'B' | null;
        scoreSummary: string;
        bye: boolean;    // 轮空
      }[];
    }[];
  };
  config: { groupCount: number; advanceCount: number; seedCount: number };
  placementAwards?: { openid: string; place: '冠军'|'亚军'|'四强'|'八强'|'参与'; pts: number }[];
  creator: string;
  creatorName: string;
  createdAt: number;
  updatedAt: number;

  // === 设计端建议补的字段 ===
  endDate?: number;       // P1：跨日赛事的结束日
}
```

### 7.5 云函数 action 速查

| 云函数 | actions |
|---|---|
| `login` | （无 action 默认）登录/创建用户、`update`（更新 wecomName/gender/rating）、`getProfile`、`getRanking`|
| `activity` | `list`、`get`、`create`、`update`、`delete`、`join`、`leave`|
| `match` | `list`、`get`、`create`、`signup`、`leave`、`randomize`、`saveScore`|
| `tournament` | `list`、`get`、`create`、`signup`、`cancelSignup`、`draw`、`scoreGroup`、`startKnockout`、`scoreKnockout`|
| `init-db` | （无 action）初始化集合，`event.mock = true` 时插入模拟数据|

### 7.6 已知不一致 / Bug（需要决策）

| 编号 | 描述 | 建议处理 |
|---|---|---|
| BUG-1 | `tournament-create` 表单 `bestOfOptions: [4, 5, 6]`，但 `tournament/index.js:442` 只接受 `[1, 3, 5]`。 | **以云函数为准**改前端，改成 `[3, 5]` 两档；或同时统一为 `[4, 5, 6]`。决策权在产品。|
| GAP-1 | `activities` 没有 `endTime`，无法判断"进行中"。 | 后端补可选字段。|
| GAP-2 | `users` 没有 `avatarUrl`。 | 后端补可选字段，前端有则展示头像，无则首字圆圈。|
| GAP-3 | `tournaments.matchDate` 单日，长赛事跨日不能展示。 | P1，后端补 `endDate` 可选。|
| INC-1 | 列表页 `participants[]` 不附带 `rating/gender`，只在 `get` 才附加。 | 列表页不需要 rating/gender，**保持现状**。|

---

## 8. 状态变体清单（across pages）

> 这是给开发者的"测试矩阵"，每条都需要在交付前肉眼验证。

| 场景 | 出现页面 | 视觉变体 |
|---|---|---|
| **加载中** | 所有列表/详情 | 骨架屏：用 `--color-border` 矩形条占位，display 字号位置高 60rpx，body 位置高 32rpx，动画微闪。|
| **空列表** | index, match-list, ranking, profile（matchHistory/activities） | empty-state 5.10 |
| **网络异常** | 同上 | 顶部 toast "网络异常"（已由 api.js 统一处理）|
| **未登记** | 任意 Tab 切入 | `ensureRegistered` redirect → onboarding |
| **未填 NTRP** | profile 评级行 | "未设置" muted 色 + "修改" 按钮 |
| **NTRP 已填** | profile / roster / ranking | "NTRP X.X" mono 字体 |
| **wecomName 4+ 字** | roster / ranking / 任何展示 | ellipsis 截断，title 属性留全名 |
| **maxPeople = 0**（不限） | activity-detail | 容量条隐藏；显示 `{joined} / ∞` |
| **maxPeople > 0 + 半满** | activity-detail | 容量条 `var(--color-accent)` 填充百分比，左对齐|
| **满员且我未报** | activity-detail | CTA disabled "已满员"|
| **我已报名** | activity-detail / match-detail / tournament-detail | CTA "取消报名"，描边按钮 + `--color-danger`|
| **我是创建者** | activity-detail / match-detail / tournament-detail | 顶部 more 菜单含编辑/删除/导出 |
| **管理员** | 任何创建者权限地方 | 同 isCreator |
| **赛事报名中** | tournament-detail | 玩家列表 + 报名 CTA + 创建者"开始抽签"|
| **赛事小组赛** | tournament-detail | N 个组卡片，未录分对阵显示 `vs`，已录分显示比分高亮胜者 |
| **赛事淘汰赛** | tournament-detail | bracket 树状图，待定对阵显示 `?`|
| **赛事已结束** | tournament-detail | 颁奖区（冠/亚/四强/八强 + 参与），列表整体 muted 但奖牌行黄铜高亮 |
| **比分等于** | match-create / score modal | 阻止保存，toast "比分不能相同"|

---

## 9. 迁移指南：从现有 `app.wxss` 切到本规范

### 9.1 替换全局变量（一次性）

将本规范第 3 节全部 Tokens 写到 `miniprogram/app.wxss` 顶部，替换原有：
- `page { background: #f5f6f7; ... }` → `page { background: var(--color-bg); ... }`
- `.card` 删除 `box-shadow` 与 `border-radius`，改为边线分隔
- `.tag` `.tag-gray` 改为 `.tag` + 修饰符
- `.btn-primary` `.btn-default` `.btn-danger` 重写：`.btn-primary` 用 emerald-deep 实底，`.btn-default` 用 fg 描边，`.btn-danger` 用 danger 色描边
- `.empty` `.empty-state` 改用 5.10 配方，移除 `.empty-icon`（emoji 字号 120rpx）
- `.fab` 改为：方形按钮 `100rpx × 100rpx`，背景 `var(--color-emerald-deep)`，无 `border-radius`，icon-plus `--color-bg` 描边

### 9.2 替换 `app.json` 配置

- `navigationBarBackgroundColor`: `#1aad19` → `#243a30`（emerald-deep）
- `tabBar.selectedColor`: `#1aad19` → `#243a30`
- `tabBar.color`: `#999` → `#5d6e63`（muted）
- `tabBar.backgroundColor`: `#ffffff` → `#f8f4e8`（surface）
- `tabBar.borderStyle`: `black` → `white`

### 9.3 全量替换 emoji（一次性）

逐页搜 emoji 关键词替换为 SVG icon 引用：

| emoji | 替换为 | 出现位置 |
|---|---|---|
| `⏰` | `<icon name="clock"/>` | index.wxml, activity-detail.wxml |
| `📍` | `<icon name="pin"/>` | 同上 |
| `👥` | `<icon name="people"/>` | 同上 |
| `📝` | `<icon name="note"/>` | activity-detail |
| `🎾` `🏸` | `<icon name="tennis"/>` | profile, match-list empty |
| `🏆` `🏅` | `<icon name="trophy"/>` | match-list, profile |
| `📋` | `<icon name="list"/>` | profile empty |
| `📅` | `<icon name="clock"/>` | match-list |
| `♂` `♀` | 取消，用 avatar 边框颜色区分 | profile |
| `+` (FAB 内) | `<icon name="plus"/>` | index, match-list |

### 9.4 推荐迁移顺序

1. 切 `app.wxss` Tokens（半天，影响所有页面但只是色板换肤，不会破坏功能）
2. 切 `app.json`（10 分钟）
3. 创建 `components/icon/` 通用组件（半天）
4. 迁移 `pages/index`（活动列表）（半天）—— 最先看到改进的页面
5. 迁移 `pages/activity-detail`（半天）—— 已有高保真稿可参考
6. 其余按用户使用频率：profile → match-list → ranking → tournament-detail → 创建类页面

### 9.5 测试矩阵（迁移每页后逐项验证）

- [ ] 浅色模式下所有文字对比度 ≥ AA（深翠 fg 在米白 bg 上 = 12:1，达标）
- [ ] 暗色模式（暂不支持，但要确保 emerald-deep 在白底也够深）
- [ ] 4 字中文姓名不破坏布局
- [ ] 所有数字位 tnum 对齐
- [ ] 所有触达区 ≥ 88rpx
- [ ] 没有遗留 emoji
- [ ] 顶部状态栏 + tabBar 颜色和页面 hero 协调

---

## 10. 附录

### 10.1 文件位置

- 本文档：`{project-root}/DESIGN_SPEC.md`
- 高保真稿（活动详情）：`{project-root}/tennis-club-activity-detail.html` 及 v2
- 索引：`{project-root}/index.html`

### 10.2 风格快速识别（给 Claude Code 做对照）

> 如果一段代码满足以下任一条，就是 **不符合** 本规范，需要重写：
>
> - 出现 `#1aad19` / `#19be6b` / `#07c160` 等微信绿
> - 出现 emoji（除非显式在 emoji 字段如 reaction）
> - `border-radius` 大于 `4rpx`（avatar 50% 除外）
> - `box-shadow` 出现在卡片/按钮（弹窗除外）
> - `.btn-primary` 用纯绿底
> - `.tag` 是 `background-color` + 圆角 → 应该是 `border` + 直角

### 10.3 后续待补章节（v0.2+）

- §11. 动效与过渡（页面切换、loading skeleton 闪烁、CTA 按下反馈）
- §12. 暗色模式（深翠 hero 反向 → 米白文字）
- §13. tournament-detail 的 bracket 视觉（专门一页）
- §14. 国际化与无障碍（小程序 a11y 限制 + 字号缩放适配）

---

**END OF DESIGN_SPEC v0.1**
