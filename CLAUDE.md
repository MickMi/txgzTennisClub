# 腾讯广州网球社小程序 — Claude Code 工作规则

本仓库是微信小程序（云开发），底部三个 Tab：**活动 / 赛事 / 我的**。

## 必读优先级（每次新会话都先读）

1. **`docs/DESIGN_SPEC.md`** — 设计契约主文档。所有视觉、组件、字段、迁移分阶段策略都在这里。
2. **高保真视觉参考**（按页面查阅，色板/字体/间距以这些为准）：
   - `docs/references/activity-detail.html` — 活动详情页
   - `docs/references/round-2-tabs-and-charts.html` — 活动 Tab + 赛事 Tab + 图表方案 A/B（已选 A）
   - `docs/references/round-3-profile-ranking-tournament.html` — 我的页 + 排行榜 + 赛事详情（淘汰赛状态）
3. **本文件** — 工作流与硬约束。

## 已锁定的设计决策（v2 决策表）

| 项 | 决策 | 来源 |
|---|---|---|
| 视觉方向 | emerald-heritage（米白 / 深翠 / 黄铜金） | direction-form |
| 图表风格 | **方案 A · 发丝网格**（mono Y 轴 + 1.5px 单色折线 + 黄铜金当前值标注） | round-2 |
| Tabbar | 三个 Tab：活动 / 赛事 / 我的（不新增） | discovery-form |
| 图标策略 | 1.5px stroke 线性 SVG，零 emoji | discovery-form |
| 头像策略 | 首字母圆圈（`avatarUrl` 字段暂不补） | round-3 |
| BUG-1 | 暂保持现状（match `bestOf∈[4,5,6]`，tournament `bestOf∈[1,3,5]`） | round-3 |

## 设计哲学（一句话）

emerald-heritage 风格：米白纸 + 深翠墨绿 + 单色黄铜金。**禁用 emoji**，所有功能符号用 1.5px stroke 的线性 SVG 替代。靠发丝边线 + 留白 + 单一强调色形成层级，不靠卡片阴影或圆角块。

## 硬约束

- **Tabbar 永远是三个**：活动 / 赛事 / 我的。不要新增、不要重排。
- **零 emoji**：项目里所有 emoji 都要替换为 `DESIGN_SPEC.md §4` 的 SVG。
- **Token 优先**：颜色用 OKLCH 变量（`--bg / --surface / --fg / --muted / --border / --accent / --emerald-deep`），不要硬编码 hex。
- **三个实体不要混用同一套模板**：Activity（活动，无胜负）、Match（单场对阵，有比分积分）、Tournament（赛事，含小组+淘汰）。视觉对应见 SPEC §2.3。

## 迁移工作流（按顺序执行，单一阶段单一变更）

参考 `DESIGN_SPEC.md §9`：

1. **9.1 Tokens** — 把 `app.wxss` 全局色 / 字体 / 字号换成 emerald-heritage（**只换变量值，不动布局结构**）。
2. **9.3 图标替换** — 全项目搜 emoji，替换成 SPEC §4 的 SVG。tabBar 图标也在这一步换掉。
3. **9.2 通用组件** — 实现 SPEC §5 的 11 个组件配方。
4. **9.4 Page-by-page** — 按 SPEC §6 一页一页改，先 `activity-detail`（已有视觉稿对照）。
5. **9.5 后端字段对齐** — 修 `§10 BUG-1`（tournament `bestOf` 校验不一致），按需补 GAP-1/2/3。

**禁止**在 tokens 阶段顺手"改善"布局；**禁止**把多个阶段揉在一个 commit 里。每一阶段做单一变更。

## 每次开始改动前的对齐流程

新会话第一件事，请回复以下三点（不要直接写代码）：

1. 用 3-5 句话复述你对 `DESIGN_SPEC.md` 设计哲学和迁移分阶段策略的理解。
2. 当前打算执行哪个阶段（9.1 / 9.2 / 9.3 / 9.4 / 9.5），为什么是它。
3. 这一阶段会触碰哪些文件、预期 diff 大小、有没有需要我先决策的点（特别是 BUG-1）。

复述对了再动手；复述跑偏，请等我打断重启，不要继续。

## 改完后的自检

- 每改完一个页面，用微信开发者工具截图，和 `docs/references/activity-detail.html` 对比，差异点逐条 review。
- token 阶段：`grep -rn '#[0-9a-fA-F]\{3,8\}' miniprogram/` 应该几乎为空（除非是 tabBar 图标 PNG 路径）。
- 图标阶段：`grep -rnE '[😀-🙏🌀-🗿✨🎯🚀⏰📍👥📝♀♂✏🗑]' miniprogram/` 应该为空。

## 项目结构（参考）

```
tennis-club/
├── CLAUDE.md                                       ← 本文件
├── docs/
│   ├── DESIGN_SPEC.md                              ← 设计契约
│   └── references/
│       ├── activity-detail.html                    ← 活动详情页
│       ├── round-2-tabs-and-charts.html            ← 活动 Tab + 赛事 Tab + 图表 A
│       └── round-3-profile-ranking-tournament.html ← 我的 + 排行榜 + 赛事详情
├── miniprogram/                                    ← 小程序前端代码
├── cloudfunctions/                                 ← 5 个云函数
├── project.config.json
└── README.md
```
