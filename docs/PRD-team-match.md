# PRD · 团队赛 (team-match)

> PM Agent 产物 · 经 5 轮需求追问后用户确认 · 2026-06-08

## 1. 业务目标

在赛事模块新增"团队赛"类型：两支队伍（A/B）对阵，下挂 N 个**纯比分对阵槽**（不记参赛人），团队总比分由各槽胜方累加决定，胜方队员每人获得固定积分。**为了"几个球友凑一起打"的轻量场景**——队名无所谓（系统自动 A 队/B 队），不影响 ELO，只贡献个人 totalPoints。

## 2. 数据契约

### 2.1 tournament 文档新增字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `type` | enum | 新增枚举值 `'team'`（与现有 `'singles' / 'doubles'` 同级） |
| `teamMatchSlots` | int | 仅 `type='team'` 时使用。任意正整数（典型 1/2/3/4/5）。表示每场团队赛挂多少个对阵槽 |
| `teams` | array | 复用现有字段。team 模式下 `team.name` 由系统生成（`'A 队' / 'B 队' / 'C 队' ...`），不允许用户自定义 |

### 2.2 match 文档（team 模式）

```js
{
  teamA: 'team_xxxx',    // tournament.teams[i].openid
  teamB: 'team_yyyy',
  slots: [
    { index: 1, setsA: 2, setsB: 0, score: '6-4,6-2', winner: 'A' },
    { index: 2, setsA: 0, setsB: 2, score: '4-6,5-7', winner: 'B' },
    // ... 长度 = tournament.teamMatchSlots
  ],
  teamScore: { A: 3, B: 2 },   // 由 slots 聚合：A 赢的 slot 数 vs B 赢的 slot 数
  winner: 'A' | 'B' | null,    // 团队胜方，由 judgeMatch(teamScore.A, teamScore.B) 决出
  scoreA: 3,                    // 兼容现有字段（= teamScore.A）
  scoreB: 2,                    // 兼容现有字段（= teamScore.B）
  status: 'pending' | 'partial' | 'finished',
}
```

**关键约束**：
- `slots[i]` **不存** `playerA / playerB` —— 用户的原始诉求
- slot 内的胜负判断**复用** `cloudfunctions/tournament/index.js` 中的 `judgeMatch(scoreA, scoreB)` 函数（输入 = 该 slot 的盘数 setsA / setsB）
- 团队整体胜负**再次复用** `judgeMatch(teamScore.A, teamScore.B)`（两层都走同一个函数，零新判断逻辑）

## 3. 业务规则

### 3.1 积分

- 团队胜：**胜方 team 内每人 +40 分** 写入 `user.tournamentEarnings`
- 团队负：**负方 team 内每人 +20 分** 写入 `user.tournamentEarnings`
- 积分进入现有 `totalPoints` 的**最佳 10 场**池子（与周赛、赛事名次奖励同池），不单独排榜
- 这两个数字（40 / 20）放到云函数顶部常量 `TEAM_MATCH_POINTS = { win: 40, loss: 20 }`，便于后续调

### 3.2 ELO

- 团队赛**不动** ELO（`user.elo` 字段维持不变）
- 团队赛**不写** 个人战绩里的 win/loss 计数（不影响个人胜率统计）

### 3.3 录入 UI

- 团队赛详情页：每个 slot 显示 `序号 · 比分 · 胜方箭头`，无人名
- 每个 slot 一个"录入比分"入口，弹层只问"A 队这盘 / B 队这盘"的盘比，不问人
- 录满所有 slot 后，团队胜负自动决出 → match.status = `'finished'` → 触发积分发放

### 3.4 队名

- v1 **固定 2 队**：系统自动命名为 `A 队 / B 队`（不开放"队伍数量"配置；用户 2026-06-09 确认锁死，详见 §3.5）
- 不提供"自定义队名"输入框
- 创建赛事时用户只填**队员名单**（报名）和**对阵槽数 SLOTS**；队长在抽签弹层选定（§3.5）

### 3.5 选队长（Plan-2 R2-B / 2026-06-09 追加）

- 团队赛**固定 2 队**（A vs B），**没有"分 x 队"概念**（Plan-3 留口子）
- creator 在抽签弹层**手动从报名列表点 2 人**为 A/B 队长，其余按 `totalPoints` 蛇形分入两队
- 队长在 `team.members` 数组里**放第 0 位**，UI 显示"C"队长 badge
- 抽签时同时选定**盘数**（4 / 6 二选一，默认 6），写入 `tournament.bestOf` + `tournament.captains = { A, B }`
- **抽签后调队（Plan-4 R4-B / 2026-06-09 追加）**：
  - 触发：creator/admin + status='group' + 所有 slot 都没录比分（match.status='pending'）
  - 操作粒度：单人单向移动到对面队（不是 swap）
  - 队长锁定：队长不能被调动，要换队长必须重新抽签
  - 一旦任一 slot 录入比分，调队入口立刻消失（避免历史比分归属错乱）

### 3.6 净胜局 tiebreak（Plan-2 R2-C / 2026-06-09 追加）

- `gamesA = Σ slot.setsA`，`gamesB = Σ slot.setsB`
- `netGames = gamesA - gamesB`（正数 A 领先，负数 B 领先）
- 全部 slot 录完时判定顺序：
  1. `teamScore.A > teamScore.B` → A 胜
  2. `teamScore.B > teamScore.A` → B 胜
  3. `gamesA > gamesB` → A 胜（净胜局 tiebreak）
  4. `gamesB > gamesA` → B 胜
  5. 仍平 → `match.status = 'partial'`，等用户改某个 slot
- `scoreSummary` 在 tiebreak 触发时附 `(净胜局 X)`；仍平显示 `x-y (净胜局相等)`
- 详情页 `team-scoreboard` 下显示净胜局行（`+5 (30:25)` / `-3 (25:28)`）

## 4. 用户场景

### 4.1 主路径
1. 管理员创建赛事 → 选类型"团队赛" → 输入"对阵槽数" 5（任意正整数）→ 隐藏 level / groups / advance / seeds 字段
2. 报名截止后，creator 进详情页点"选队长 / 抽签" → 弹层选 A 队长 + B 队长 + 盘数（4/6）
3. 系统把队长放第 0 位，其余按 totalPoints 蛇形分入两队 → tournament.teams + tournament.captains 写入 db
4. 进入团队赛详情 → 看到 5 个 slot 待录入，队长在"队员名单"显示 C badge
5. 比赛进行，逐个 slot 录入比分（6-4, 6-3 …）
6. 5 个 slot 录满 → 自动判断 `teamScore = 3:2`（或 teamScore 2:2 时净胜局 tiebreak）→ 胜方全员各 +40，负方全员各 +20
7. 用户可生成分享海报（团队赛专用样式，海报内容字段按 Plan-3 重做）

### 4.2 边界
- 录入中途，slot.score 可被覆盖修改（与现有单/双打逻辑一致）
- 团队人数不必等于 slot 数（5 人队打 3 个 slot 也合法）
- 一个队员可以出现在多个 slot（不限制，因为我们不记 slot 参赛人）

## 5. 不在范围（v1 砍掉）

- ❌ 自定义队名 / 队徽
- ❌ MVP 评选 / 单场最佳球员
- ❌ slot 内记参赛人
- ❌ 团队赛专属排行榜
- ❌ 团队赛 ELO 计算

## 6. 验收标准

- [ ] tournament-create 表单"赛事类型"出现"团队赛"选项；选中后出现"对阵槽数"input（任意正整数）
- [ ] 团队赛详情页 UI 与设计稿 `docs/design/team-match-mockup.html` 一致（scoreboard + slot list + roster + points strip）
- [ ] 录满所有 slot 后，云函数自动算出 teamScore 并发积分；胜方 +40、负方 +20
- [ ] 个人 user.totalPoints（最佳 10 场）正确增加；user.elo 不变
- [ ] 团队赛分享海报按新设计绘制，A/B 队名为系统生成
- [ ] 单/双打的现有逻辑不受影响（回归测试）

---

**用户确认轨迹**（5 轮）：
1. slot 不记 playerA/B（用户提出）
2. slot 数量任意正整数（用户拍）
3. 胜负判断复用现有 judgeMatch（用户更正）
4. 不影响 ELO，胜方 +40 / 负方 +20 进入 totalPoints 同一池子（用户拍）
5. 队名系统生成 `A 队 / B 队`（用户拍）
