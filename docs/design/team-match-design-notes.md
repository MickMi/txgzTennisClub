# Design Notes · 团队赛海报 (team-match)

> Designer Agent 产物 · 配套 `team-match-mockup.html` · design.mode=html

## 与现有 6 套海报的差异

| 维度 | 现有海报（singles/doubles） | 团队赛海报 |
|---|---|---|
| 主轴 | podium（冠/亚/季）或个人 highlight | **A 队 vs B 队 + 大比分** |
| 比分卡 | matchup（人 vs 人） | scoreboard（队 vs 队） |
| Slot 列 | — | 纯 `序号 · 比分 · 胜方箭头`，无人名 |
| 名单 | 全员名册（4 列网格） | 双栏（左 A 队 / 右 B 队） |
| 积分 | 隐式（ELO + 名次奖励） | **显式**写 `胜方 +40 / 负方 +20` |
| 删除 | — | 没有 ELO 变动、最佳一战、NTRP 升档 |

## 组件清单（Canvas 实现时的对应）

| 区块 | mockup class | Canvas 绘制函数（建议命名） |
|---|---|---|
| Hero（深翠墨绿渐变 + 标题） | `.pt .hero` | `drawHero(ctx, { title, date, slots, bo })` |
| Scoreboard（队徽 + 大比分） | `.pt .board` | `drawScoreboard(ctx, { teamA, teamB, scoreA, scoreB })` |
| Slot 列表 | `.pt .slots` | `drawSlotList(ctx, slots)` |
| Roster 双栏 | `.pt .roster` | `drawRoster(ctx, { teamA, teamB })` |
| 积分条 | `.pt .points` | `drawPointsStrip(ctx, winnerSide)` |
| Footer（next match + QR） | `.pt .foot` | `drawFoot(ctx, { next, qrPath })` |

## 视觉契约（Dev 实现时必须保持）

- **色板**：完全复用 emerald-heritage 的 OKLCH 变量（见 `app.wxss` 的 :root），禁止硬编码 hex
- **字体**：`var(--font-display)` 大标题 / `var(--font-mono)` eyebrow / `var(--font-body)` 内文
- **胜方标记**：用 `var(--accent)`（黄铜金），WINNER tag + 队徽放大 + 箭头染色
- **Slot 数自适应**：行高/字号按 `slots.length` 动态调整。≤ 5 用默认，6-8 缩 row padding 至 8px，> 8 缩字号到 13px
- **Roster 自适应**：队员数 ≤ 8 一列内排满；> 8 时切两列（同侧）

## 设计稿与生产 Canvas 的偏差容忍

- mockup 用 HTML/CSS，Canvas 实现允许：
  - 字号 ±1px（屏幕渲染差异）
  - 边距 ±2px
  - SVG 箭头可替换为 Unicode `◀ / ▶`（已在 mockup 中如此）
- **不可偏差**：色板值、布局结构、信息层级、积分数字（40/20）

## 已确认的取舍

- **没出多套风格**：团队赛只此一稿 emerald-heritage，与现有海报 6 套风格保持一致家族。运动风/满贯主题若用户后续要再补，可作为 v2 扩展
- **slot 不画运动员头像**：与数据模型一致（slots[i] 不存 playerA/B）
- **不显示 NTRP / ELO 变动**：团队赛不动这些数据，海报上展示会误导
