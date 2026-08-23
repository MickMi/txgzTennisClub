# STATE — 项目流程状态机

> single source of truth for Mick Harness orchestration (v2+)

## 当前 Feature

**v0.2.0-history** — 将 2026-06-04 之后的本地成果按业务批次归档到 Git，并建立版本 Changelog。

## 阶段进度

- [x] **Planner** — 版本边界、批次和非伪造历史约束已写入 `plan.md`
- [x] **Executor** — 产品代码已按团队赛、海报、个人管理和发布边界拆分提交
- [ ] **QA** — release Gate 与远端提交图待最终核验
- [ ] **Reviewer** — 工作分支推送后审查 Changelog 与提交边界

## 调度状态

- 当前激活：**Executor**
- 下一动作：完成工程/文档批次提交，运行 release Gate，并推送 `chore/reconstruct-post-june-history`
- 推送后由 Reviewer 审查，合并 `main` 后再创建 `v0.2.0` tag

## 历史 Feature

**team-match** — A/B 两队按水平拆分到多片物理场地，场内自由轮换，跨场地汇总；固定 +40/+20，不修改 ELO。

Dev 完成时间: 2026-06-08T14:52:11Z
Batch 2 (R2-B 抽签弹层 / R2-C 净胜局) 完成时间: 2026-06-09T15:30:00Z

---

## 测试夹具（team-match test fixtures）

入口：`pages/test-fixtures/test-fixtures`（正式路由和个人页入口已隐藏，仅保留 admin 校验后的开发调用）。

当前共 21 个 scenario：
- 团队赛 15 个：覆盖报名/抽签、四种赛制、平分、一球制胜、阵容回填、场地轮转、加人和个人报告。
- 单打/双打 4 个：覆盖分组、加人、移除、回滚和改赛制。
- 三四名决赛 1 个、onboarding 1 个。

清理：`cleanupTestData` action 一键删除所有 `_isTest:true` 的 tournament + user，并防御性扫描真实用户的 `tournamentEarnings` 残留。

### 已解决的数据安全问题（2026-08-20）

- 场地录分与撤回在事务内重读最新 `courts`，不同场地并发提交不再覆盖整个 `groups` 的旧快照。
- 团队赛结束状态、固定积分和 `teamSettlement` 凭证在同一事务写入；重复结束请求只返回已有结算。
- 团队赛不修改 ELO；删除已结算团队赛时依据 `teamSettlement` 回滚固定积分。

Dev (测试夹具) 完成时间: 2026-06-09

### 2026-07-01/02 更新

**下拉刷新**：6 个页面补齐 `enablePullDownRefresh` + `onPullDownRefresh` handler：
- `ranking`（json 补配置，handler 已有）
- `tournament-detail`、`activity-detail`、`profile`、`user-detail`、`member-management`
- 同步修复了 `profile.js`、`user-detail.js`、`member-management.js` 的 `load*` 方法未 return Promise 的问题

**小组排名 H2H 修正**：`calcStandings` 排序从「胜场 → 净胜盘」改为「胜场 → 胜负关系 → 净胜盘」

**交叉对阵修正**：`startKnockout` / `regenKnockout` 的 runner-up 排序从「按净胜盘」改为「锁定与 winner 相同的组顺序」，消除同组内战

**recalcStandings / regenKnockout**：新增两个管理操作用于修正历史赛事排名和对阵

**海报修正**：
- Roster 展开上限从 8 人改为 12 人
- Podium 三四名并列展示（"四强"标签，两个半决赛负者均显示）
- Podium 顺序改为「冠 → 亚 → 四强」
- 删除「满盘场次」统计

**deleteMatch 已回滚**：该功能存在设计缺陷（从赛程中删除单场 match 留下空洞），已全部回滚。

**removePlayer（2026-07-02）**：
- 小组赛阶段移除选手 → 自动重建该组循环赛对阵（保留已有比分）
- 安全锁：该选手参与的 match 如有已录比分，拒绝移除（需先撤回相关场次）
- 淘汰赛阶段不支持直接移除（提示走 revert → regenKnockout 路径）
- 前端入口：standings 列表行尾 × 按钮（creator/admin 可见）
- 测试夹具：新增 `singles_4_group` 场景

**delete 赛事（2026-07-02 扩展）**：
- 原限制仅 signup 阶段删除，现扩展为**所有阶段均可删除**
- signup：硬删除（零积分变动）
- group/knockout/finished：先逐场回滚所有已录比分的 ELO/积分 → 回滚名次奖 → 删除赛事
- 前端：删除按钮始终可见（非 signup 时副标显示「已录比分将全部回滚」）
