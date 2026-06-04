# tennis-club · 项目记忆（Mavis/mavis 会话专用）

> **同时读** `../CLAUDE.md`（项目原有的硬约束文档，给 Claude Code 用的）。本文件是 mavis 自己的项目记忆，专门给 mavis 会话读。
> 两份文档应**作为整体**遵守，有冲突时以 CLAUDE.md 为准（CLAUDE.md 是项目主约束）。

## 项目快照

- 类型：微信小程序（云开发），底部三个 Tab：活动 / 赛事 / 我的
- 当前 commit 数：63+，最近主线：分享海报 6 风格 + 头像模式切换
- 主体：个人（无"社交"类目）
- 基础库：3.7.3
- appid: `wxf896d4d2ff8e3982`
- 云开发 env: `cloud1-d7gpl79fte0c52c74`（待发布前确认是否切生产环境）

## 关键设计系统

- 视觉方向：**emerald-heritage**（米白 + 深翠 + 黄铜金）
- Token：OKLCH CSS 变量（`--bg / --surface / --fg / --muted / --border / --accent / --emerald-deep`）
- 字体：display / body / mono 三档
- 图标：1.5px stroke SVG（**零 emoji**）
- 设计契约：`docs/DESIGN_SPEC.md`（1271 行）
- 组件配方：`docs/DESIGN_SPEC.md §5`（11 个）
- 视觉稿：CLAUDE.md 引用的 `docs/references/*.html` **目录不存在**，引用可忽略

## 硬规则（项目级，mavis 会话必读，**与 CLAUDE.md 同步**）

### 🔒 活动模块当前为隐藏阶段

- 因个人主体无"社交"类目，`custom-tab-bar/index.js` 中活动 tab 已注释
- app.json 的 `pages/index/index`（活动列表首页）目前对用户不可见
- **后续所有更新除非明确作用于活动，否则不得修改活动相关代码**：
  - `pages/index/`、`pages/activity-create/`、`pages/activity-detail/`
  - `cloudfunctions/activity/`
  - `app.json` 中活动 page 引用
  - `utils/api.js` 里的 `listActivities / getActivity / createActivity / updateActivity / deleteActivity / joinActivity / leaveActivity / closeActivity` 等
- 例外：用户明确说"改活动 X"时，按要求改
- 等主体/类目合规后再统一恢复活动模块

### 其他延续 CLAUDE.md 的硬约束

- Tabbar 永远三个：活动 / 赛事 / 我的（活动当前隐藏，但**不要新增**其他 tab）
- 零 emoji
- Token 优先
- 自定义 navTop + capsuleGap 算法（utils/nav.js），返回按钮必须用这套
- 不要混用全局 cta-primary 和 btn-default（同行按钮要么全 btn-*，要么一个独占 cta-primary）

## 模块状态

| 模块 | 状态 | 入口 |
|---|---|---|
| 赛事（tournament） | ✅ 完整 | tabBar |
| 会员管理 | ✅ 完整 | 我的 → 管理员专属 |
| 排行榜 | ✅ 完整 | 我的 |
| 个人中心 | ✅ 完整 | tabBar |
| 分享海报 | ✅ 6 风格 | 赛事详情 → 生成海报 |
| 活动（activity） | ⚠️ 隐藏但代码完整 | （无入口） |
| 比赛（match） | ❌ 已下线 | — |

## 发布前必修（已识别）

1. **admin bootstrap 漏洞**：`cloudfunctions/login/index.js:363` 的 `ADMIN_OPENIDS = []` 白名单空，**第一个注册的用户自动成 admin**。发布前必须填入管理员 openid，或改兜底逻辑。
2. **生产云环境**：`miniprogram/app.js:8` 的 `cloudEnv` 字段是开发环境还是生产待确认。
3. **隐私协议上架**：仓库里的 `PRIVACY.md` 需要在小程序后台"用户隐私保护指引"独立填写并提交审核。
4. **主体/类目**：个人主体发"活动"类功能会审核失败。
5. **README 缺失**：被 `934a518 clear readme` 清空，需要补。
6. **`uploadWithSourceMap: true`**：发布版应该改 false，避免源码泄露。

## 工作区状态

- 当前有未提交改动（来自上轮会话尾巴 + 本轮优化）：
  - `poster.js` — preloadAvatars / switchAvatarMode / 清理 console.log
  - `poster.wxml` — 头像模式 bar（已与 .style-chip 同款）
  - `poster.wxss` — 头像模式 bar 样式复用 .style-bar 黑色半透明
  - `activity-detail.js` — onJoin 拦截未登记跳 onboarding（**待用户决定是否回退**，因活动模块隐藏）
  - `CLAUDE.md` — 活动隐藏阶段硬约束（已加）
  - `AGENTS.md` — 本文件（新增）
- 工作区改动未 commit，建议分三个 commit：
  - `feat(poster): 头像模式与 .style-chip 设计语言统一`
  - `fix(activity-detail): onJoin 拦截未登记用户并引导 onboarding`（**待用户决定**）
  - `docs: 活动模块隐藏阶段硬约束 + 项目 AGENTS.md`

## 工具 / 路径速查

- nav 算法：`miniprogram/utils/nav.js` — `app.globalData.nav.{navTopRpx, capsuleGapRpx}`
- API 封装：`miniprogram/utils/api.js` — 所有 `call` 错误自动 toast
- 用户缓存：`miniprogram/utils/user.js` — `getCachedUser / setCachedUser / ensureRegistered`
- 海报样式：`miniprogram/utils/poster-styles.js` — 6 种风格定义
- 海报绘制：`miniprogram/utils/poster-draw.js` — Canvas 绘制
- 登录：`cloudfunctions/login/` — actions: login / update / getProfile / getRanking / listMembers / setRole
- 活动：`cloudfunctions/activity/` — list / get / create / join / leave / close
- 赛事：`cloudfunctions/tournament/` — list / get / create / signup / cancelSignup / draw / startKnockout / scoreGroup / scoreKnockout / revertScore / delete

## 历次会话踩过的坑（避免重蹈）

### ❌ 头像模式 bar 不要发明独立设计语言

- 上一轮我加了 SVG 图标 + 28rpx 字号 + 12rpx 圆角，**用户反馈"弄太复杂了"**
- **正确做法**：与 .style-chip 完全同款（pill 形 + 24rpx + 0.75 对比度 + 0.05 背景）
- **背景必须用 `rgba(0, 0, 0, 0.5)` 黑色半透明**（浅色风格下也能看清）

### ❌ 浅色风格下用 `rgba(255, 255, 255, ...)` 文字必须配深色背景

- 浅色风格（emerald / AO / RG / Wimbledon）下纯白文字**几乎看不见**
- 解决：黑色半透明背景兜底，或用风格自带的对比色

### ❌ 微信小程序**绝对不能**强制注册

- 微信官方要求：用户必须能不登录就使用基础功能
- 强制 wx.login / 强制授权个人信息 = 必拒审
- **正确模式**："延后注册" — 用户能浏览所有内容，必要时再引导登记
- 当前 match-list（默认页）已合规
