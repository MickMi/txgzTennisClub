# Plan: 团队赛「拆场地」—— slots → courts

> 🧭 状态：执行中 | 进度 27/28 | 当前归属：Executor | 最近卡点：无

## 当前版本核心目标 · 2026-08-20 · 场地轮转型团队赛

团队赛继续保留 A/B 队际对抗和管理员自由调整能力，同时把「每片场地持续、有效地轮转」作为本版本核心目标。

### 已确认的产品边界

- 赛制只保留四种：四局制、六局制、单盘抢 7、单盘抢 11。
- 抽签和排阵不增加复杂的组织公平性管控；管理员继续承担现场组织和自由调整。
- 场地采用真实约束：默认每 6 人一片；每片必须同时有 A/B 队员；不允许空场；少于 4 人或多于 8 人只提示、不拦截。
- 创建者/系统管理员可管理全部场地；普通队员只能新增或修改自己所在场地的比分；其他场地只读。
- 撤回比分只开放给创建者/系统管理员；普通队员不能撤回或删除；已结束比赛不可重开。
- 下一场推荐嵌入场地卡片，优先照顾出场较少的人并避免立即重复；推荐结果仍允许人工改动。
- 个人报告复用现有「我的战绩卡」，补充团队赛个人出场、胜负与搭档/对手信息，不新建独立复杂页面。

## 步骤

- [x] 1. 统一四种赛制的产品名称与输入提示。
- [x] 2. 收紧分场录分、修改、撤回和结束后的权限边界，并补正反例测试。
- [x] 3. 抽签、加减场地、场地间调人落实混队非空约束和人数提示。
- [x] 4. 在场地卡片加入轻量「推荐下一场」，可一键带入录分弹层并换一组。
- [x] 5. 复用个人战绩卡补团队赛个人报告数据。
- [x] 6. 自动化验证已完成；微信开发者工具真实交互验收由用户接管，本轮不部署云函数。

### 本轮验证记录

- 自动化：全部 `tests/*.test.js` 通过，覆盖分场权限 4 条、撤回权限 5 条、场地约束 4 条、轮换推荐、个人报告 courts/tiebreak 以及 76 个 WXML 事件绑定。
- 静态检查：目标 JS `node -c` 全部通过；目标文件 `git diff --check` 通过。
- 真实交互：微信开发者工具 RC 2.02.2607271 已可正常编译和调试；全局组件改用相对路径、开发态关闭未使用文件裁剪后，清除文件缓存并从工具菜单执行真实编译，赛事首页及 12 条赛事数据正常渲染，连续两次编译均为 0 error。
- 发布边界：未部署云函数，云端真实数据尚未使用本轮权限与场地规则。

## 第一批 · 团队赛数据安全修复

> 来源：2026-08-20 全项目 Reviewer 审查，用户已确认“第一批开始执行”。本阶段只处理数据正确性，不扩展活动、场地预订或其他产品能力。

- [x] 7. 团队赛场地录分与撤回改为事务内重读、定点更新，避免多场地并发提交相互覆盖。
- [x] 8. 团队赛结束采用幂等结算标记，重复请求不得重复发放赛事积分；团队赛不修改 ELO。
- [x] 9. 删除已开始/已结束团队赛时，按结算记录完整回滚 +40/+20；无法证明可回滚时拒绝删除。
- [x] 10. 补并发录分、重复结算、团队赛删除回滚和“不修改 ELO”自动化测试，并跑全量静态检查。

### 完成判定

- 两个不同场地基于同一旧快照录分时，事务重试后两条对局都保留。
- 同一团队赛结束请求执行两次，只存在一份 +40/+20 收益，第二次返回已有结算结果。
- 删除已结算团队赛后，该赛事对应的 `tournamentEarnings` 被移除并重新计算 `totalPoints`，ELO 不发生变化。
- `tests/*.test.js`、目标 JS 语法检查与 `git diff --check` 全部通过；云端部署和真实数据验证仍保持在本轮范围之外。

## 第二批 · 发布边界收口

> 来源：2026-08-20 全项目 Reviewer 审查，用户已确认“第二批开始”。活动创建不属于免费小程序的产品范围；本阶段不删除线上云函数、集合或真实数据。

- [x] 11. 活动云函数统一返回“功能已下线”，阻断 create/join/update 等所有活动 action。
- [x] 12. 从小程序 API、个人档案查询和昵称同步中移除活动依赖，正式运行时不再读取或写入 `activities`。
- [x] 13. 从正式路由和个人页移除测试夹具入口；保留本地夹具源码和 admin 权限校验，避免破坏开发资产。
- [x] 14. 增加发布边界自动检查，确保 app routes、API、profile/login 运行链路不再暴露活动能力，并跑全量验证。

### 完成判定

- 任意 `activity` 云函数 action 都被统一拒绝，且普通用户不能创建活动。
- `miniprogram/app.json`、`miniprogram/utils/api.js`、profile/login 生产链路不再引用活动页面、活动 API 或 `activities` 集合。
- 正式页面不再注册或展示测试夹具入口；夹具源码不删除，后续开发可显式恢复。
- 发布边界测试、`tests/*.test.js`、全部 JS 语法检查和 `git diff --check` 通过；线上云函数/集合删除仍需单独授权。

### 第二批自检日志

#### Step 11
- files: `cloudfunctions/activity/index.js`
- verify: `tests/release-boundary.test.js` 逐一调用 list/get/create/update/delete/join/leave/close，全部返回“活动功能已下线，请使用赛事功能”，且未访问任何数据库集合或用户上下文。

#### Step 12
- files: `miniprogram/utils/api.js`, `cloudfunctions/login/index.js`, `miniprogram/pages/profile/profile.js`
- verify: 自动边界检查确认正式 API 无 activity 方法、profile/login 无 `activities` 集合访问或活动字段；全量测试通过。

#### Step 13
- files: `miniprogram/app.json`, `miniprogram/pages/profile/profile.js`, `miniprogram/pages/profile/profile.wxml`, `project.config.json`
- verify: 正式路由和个人页不再含测试夹具入口；夹具源码仍存在，四个云函数夹具 action 均保留 admin 校验；项目描述已收口为“赛事与个人战绩管理工具”。

#### Step 14
- files: `tests/release-boundary.test.js`
- verify: `node --test tests/*.test.js` → 8/8 pass；cloudfunctions/miniprogram/tests 下全部 JS `node --check` → exit 0；`git diff --check` → exit 0。未部署云函数，未删除线上云函数、集合或数据。

**阶段 3 · 工程质量与稳定性门禁**

> 来源：2026-08-20 用户要求直接执行阶段 3，并自行承担真实小程序验收。本阶段只建设验证、CI 和架构真相源，不重构 3943 行赛事云函数，不改变业务行为，不部署云端。

- [x] 15. 新建 `scripts/verify.sh`，作为本地与 CI 共用的验证调度入口。
- [x] 16. 新建 `scripts/verify.d/` 原子检查器，分别覆盖 JavaScript 语法、Node 测试和 JSON 配置解析。
- [x] 17. 新建 `.github/workflows/ci.yml`，在 push/PR 上调用 release 级验证入口。
- [x] 18. 将 `docs/architecture.md` 从模板替换为当前赛事/个人管理架构和已确认 ADR。
- [x] 19. 收口 `TODO.md`，移除与已确认产品边界冲突的需求，标记已完成工程项。
- [x] 20. 跑阶段 3 聚焦验证、全量验证和 `git diff --check`，回写可复现证据。

### 阶段 3 完成判定

- `bash scripts/verify.sh --tier release --strict-unknown` 在本地返回 exit 0，并汇总三个独立 checker 的结果。
- GitHub Actions 只复用该入口，不复制另一套测试命令；工作流不包含部署或密钥写入。
- 架构文档不再含占位符，明确免费小程序只保留赛事创建/管理和个人管理，活动能力已下线。
- TODO 与真实状态一致；赛事云函数拆分继续保留为后续工程债，不在发布前大改。

### Preflight

- 本地验证使用当前 Node.js 与 macOS Bash 3.2；CI 明确固定 Node.js 20，并通过同一个 Bash 入口运行。
- CI 权限只读且不包含 deploy；云函数、数据库和微信发布状态不在阶段 3 的写入范围。

## 目标

把团队赛的「预设 N 个 slot」升级为「按报名人数动态拆分的 M 片场地」，场地内自由轮换录分，队际比分跨场地汇总。保留全部人员变化能力，并新增场地间调人。

## 数据模型：`match.slots` → `match.courts`

```js
match = {
  id: 'tm_1',
  teamA: 'team_A', teamB: 'team_B',
  courts: [
    {
      id: 'court_1', name: '1号场',
      players: [oid, ...],                      // 混队 openid；队归属反查 teams
      encounters: [                              // 场地内自由轮换的每场 A vs B 对打
        { id, lineup:{A:[..],B:[..]}, setsA, setsB, winner }
      ]
    }
  ],
  teamScore: { A, B },                           // 跨场地汇总 encounters.winner 数
  winner, scoreA, scoreB, scoreSummary, status
}
```

- `teams`（A/B 队成员）是队归属权威源，不变。
- `courts[].players` 只存 openid，队归属反查 `teams` → `swapTeamMember` 换队时场地数据自动跟随。
- 队际比分 = 所有 `courts[].encounters` 里 `winner==='A'` vs `winner==='B'` 的场次数。
- 一球制胜仍是全局一条（不属于任何场地），平分时两位队长 1v1。

## 拆场地算法（混队蛇形）

```
A 队成员 按 totalPoints 降序 → 蛇形分到 M 个场地
B 队成员 按 totalPoints 降序 → 蛇形分到 M 个场地
court_i.players = A_i + B_i   （每场 A/B 都有人，水平均衡）
```

- 场地数 M 默认 `ceil(总人数 / 6)`，draw 弹层可改。

## 决策（已定默认，用户「开始吧」确认）

1. 场地数默认 `ceil(总人数/6)`，draw 弹层可改。
2. 减场地：若该场地已有录分 encounter → 报错要求先清空（与 swapTeamMember 锁条件一致）。

## 历史执行顺序（非重复步骤）

1. ✅ 云函数：courts 数据模型 + draw 拆场地 + 场地内排阵/录分 + 结束/一球制胜 + 结算改造
2. ✅ 前端：tournament-detail 场地卡片视图 + draw 弹层场地数
3. ✅ 人员变化：新增 `moveCourtMember`（场地间调人）+ 保留 `swapTeamMember` 联调
4. ✅ 验证：测试夹具 + `node -c` + 微信开发者工具截图

## 云函数 action 映射

| 现状 | 新版 |
|---|---|
| `draw`(team 分支) | 分完 A/B 队后按 M 生成 courts（替代 slots） |
| `setSlotLineup` | → 作用在 encounter（场地内排阵，逻辑不变） |
| `enterSlotScore` | → 作用在 encounter（1v1/2v2 校验 + 比分校验不变） |
| `randomizeTeamLineups` | → 随机排阵（作用在场地内） |
| `addTeamSlot` | → `addCourt`（加场地） |
| `removeTeamSlot` | → `removeCourt`（减场地，先清空比分） |
| `finishTeamMatch` | → 队际比分跨场地汇总 + 平分一球制胜 |
| `swapTeamMember` | 保留（队间调队） |
| 新增 | `moveCourtMember`（场地间调人） |
| 团队赛结算 | `teamSettlement` 事务内发固定积分；不修改 ELO |

## 锁条件（统一）

- 队间调队 / 场地间调人：任何 encounter 已有 winner → 禁止（需先撤回）。
- 减场地：该场地有 encounter.winner → 禁止。
- 结束比赛：所有正赛 encounter 已录分。

## 验证

- `node -c cloudfunctions/tournament/index.js` 通过
- 测试夹具补「拆场地」场景
- 微信开发者工具截图对比场地卡片视图

## 自检日志

### Step 1
- files: `cloudfunctions/tournament/index.js`
- verify: `node -c cloudfunctions/tournament/index.js` → exit 0；固定夹具验证 12 人→6+6、7 人→3+4、跨场比分 2:1 / 小分 15:12 / 净胜局 +3 全部 PASS；项目无 `.harness/verify.sh`。

### Step 2
- files: `miniprogram/pages/tournament-detail/tournament-detail.js`, `miniprogram/pages/tournament-detail/tournament-detail.wxml`, `miniprogram/pages/tournament-detail/tournament-detail.wxss`, `miniprogram/utils/api.js`
- verify: 两个 JS 文件 `node -c` 均 exit 0；WXML 标签栈 PASS；68 个 WXML 事件处理器全部可解析；真实页面截图留待 Step 4。

### Step 3
- files: `cloudfunctions/tournament/index.js`, `miniprogram/pages/tournament-detail/tournament-detail.js`, `miniprogram/pages/tournament-detail/tournament-detail.wxml`, `miniprogram/pages/tournament-detail/tournament-detail.wxss`, `miniprogram/utils/api.js`
- verify: 三个 JS 文件 `node -c` 均 exit 0；WXML 标签栈 PASS；71 个事件处理器全部可解析；`moveCourtMember` 前后端调用链和中途加人自动入最少人场地已完成静态核对。

### Step 4
- files: `cloudfunctions/tournament/index.js`, `miniprogram/pages/tournament-detail/tournament-detail.js`, `miniprogram/pages/tournament-detail/tournament-detail.wxml`, `miniprogram/pages/tournament-detail/tournament-detail.wxss`, `miniprogram/utils/api.js`, `miniprogram/pages/test-fixtures/test-fixtures.js`
- verify: 三个 JS 文件 `node -c` + 目标文件 `git diff --check` 均 exit 0；实际源码 VM 验证 12 人→6+6、7 人→3+4、跨场汇总 2:1 / 小分 15:12 / 净胜局 +3、只读 slots 投影含全局 tiebreak 全部 PASS；WXML 919 个标签栈 PASS，91 个事件绑定对应 71 个处理器且无缺失；微信开发者工具 `Cmd+B` 后显示 0 个问题，并在真实旧团队赛数据上打开新版“历史对局”兼容场地卡片。未部署云函数，因此新版 courts 云端真实写入链路留待上线前环境验证。

### Step 7
- files: `cloudfunctions/tournament/index.js`, `tests/team-match-court-permissions.test.js`, `tests/tournament-revert-encounter.test.js`
- verify: 场地新增/修改/撤回均在 `db.runTransaction` 内重读最新 tournament；权限与撤回聚焦测试 2 文件、9 条路径通过。

### Step 8
- files: `cloudfunctions/tournament/index.js`, `docs/SCORING_RULES.md`, `docs/STATE.md`
- verify: 普通结束与一球制胜均在同一事务写 `finished`、固定积分和 `teamSettlement`；全仓搜索无 `settleTeamElo` / `teamEloAwarded` / 整队 ELO 残留。

### Step 9
- files: `cloudfunctions/tournament/index.js`
- verify: 有 `teamSettlement.awards` 时事务内按 tournamentId 移除收益并重算 `totalPoints`；无凭证的历史完赛团队赛返回明确错误且不删除。

### Step 10
- files: `tests/team-match-data-safety.test.js`
- verify: `node --test tests/*.test.js` → 7/7 pass；全部 JS `node --check` → exit 0；`git diff --check` → exit 0；新增用例覆盖双场并发、普通/一球制胜重复结算、删除回滚与 ELO 不变。

### Step 6 — 2026-08-20 02:58
- files: 无代码文件改动；仅更新 `plan.md` 验收记录
- verify: Computer Use 读取微信开发者工具 RC 2.02.2607271 当前真实窗口；模拟器和构建面板均复现 `[summer-compiler] Couldn't found the '/components/icon/icon.json' file relative to 'pages/match-list/match-list'`，编辑器问题面板仍为 0。
- notes: `miniprogram/components/icon/icon.json/js/wxml/wxss` 均存在；同一错误指纹重复，按 Anti-Wall 停止路径/设置试改，Step 6 保持未完成。

### Step 6 — 2026-08-22 22:12
- files: `miniprogram/app.json`, `project.private.config.json`, `plan.md`
- verify: 微信开发者工具 RC 2.02.2607271 清除文件缓存后，从“工具 → 编译”连续执行两次真实编译；赛事首页、排行榜入口、底部导航及 12 条赛事数据均正常渲染，`summer-compiler`、`ReactiveCache` 与 Console error 均为 0。
- notes: 根因是全局组件根路径、开发态未使用文件裁剪和 RC 文件缓存的组合；仅按快捷键 `Cmd+B` 会被内嵌编辑器接收，不能作为微信编译完成证据。

### 历史阻塞 #1（步骤 6）
发现：微信开发者工具 RC 的 summer compiler 无法解析实际存在的全局 icon 组件，模拟器无法启动，因此不能把静态测试当作真实 UI 验收。
证据：
- 开发者工具版本：RC 2.02.2607271；模拟器与构建面板显示同一 `Couldn't found '/components/icon/icon.json'` 错误。
- 文件核对：`miniprogram/components/icon/` 下四个组件文件均存在；`node --test tests/*.test.js` 已 8/8 通过，全部 JS 语法检查与 `git diff --check` 均为 exit 0。
建议方案（请 Planner/用户裁决）：
A. 改用微信开发者工具稳定版重新验收（推荐，不改业务代码）。
B. 保留当前 RC，仅以自动化结果交付，并明确真实模拟器验收未完成。
C. 允许另开环境兼容专项，针对 summer compiler 建最小复现；不与当前发布边界代码混改。

### Step 15 — 2026-08-20 03:05
- files: `scripts/verify.sh`
- verify: `bash -n scripts/verify.sh` → exit 0；`bash scripts/verify.sh --tier fast` → exit 0，并在 checker 尚未创建时明确输出 UNKNOWN。
- notes: 调度器只负责参数、顺序、退出码和汇总；最终审计发现 `.harness` 是用户级符号链接，因此交付路径迁移到可提交的 `scripts/`。

### Step 16 — 2026-08-20 03:07
- files: `scripts/verify.d/10-compile-javascript.sh`, `scripts/verify.d/20-test-node.sh`, `scripts/verify.d/30-compile-json.sh`, `scripts/verify.sh`
- verify: `bash -n scripts/verify.sh scripts/verify.d/*.sh` → exit 0；`bash scripts/verify.sh --tier subsystem --strict-unknown` → 3 PASS / 0 FAIL / 0 UNKNOWN，36 个 JS、8 个测试、27 个 JSON 全部通过。
- notes: 首次运行暴露 macOS Bash 3.2 空数组兼容错误，读取完整错误后改为兼容展开，第二次验证通过。

### Step 17 — 2026-08-20 03:09
- files: `.github/workflows/ci.yml`
- verify: Ruby Psych 解析 workflow → exit 0；`bash scripts/verify.sh --tier fast --changed --strict-unknown` → 3 PASS / 0 FAIL / 0 UNKNOWN；目标文件 `git diff --check` → exit 0。
- notes: workflow 仅授予 contents:read，在 PR 和 main push 上复用 release Gate，不含 deploy、secret 或云环境写入步骤。

### Step 18 — 2026-08-20 03:12
- files: `docs/architecture.md`
- verify: 模板占位符扫描 0 命中；与源码交叉核对 `.limit(30)`、四种 bestOf、`runTransaction` 和 `teamSettlement` 均有真实实现；`bash scripts/verify.sh --tier fast --only 20-test-node --strict-unknown` → 1 PASS / 0 FAIL / 0 UNKNOWN；`git diff --check` → exit 0。
- notes: 未填写无证据的 SLA/P99/QPS；明确活动下线、团队赛 fixed points/no ELO、权限、部署边界和后续单体拆分债务。

### Step 19 — 2026-08-20 03:14
- files: `TODO.md`
- verify: TODO 关键状态扫描确认用户验收、个人报告、3943 行单体债务、Out of Scope 和远端 CI 待确认均已落位；`bash scripts/verify.sh --tier fast --only 20-test-node --strict-unknown` → 1 PASS / 0 FAIL / 0 UNKNOWN；`git diff --check` → exit 0。
- notes: 删除与已确认边界冲突的伪待办，将签到审批、推送、多维排名、活动和复杂组织规则明确移入当前版本不做。

### Step 20 — 2026-08-20 03:15
- files: `scripts/verify.sh`, `scripts/verify.d/10-compile-javascript.sh`, `scripts/verify.d/20-test-node.sh`, `scripts/verify.d/30-compile-json.sh`, `.github/workflows/ci.yml`, `docs/architecture.md`, `TODO.md`, `plan.md`
- verify: `bash scripts/verify.sh --tier release --strict-unknown` → 3 PASS / 0 FAIL / 0 UNKNOWN（36 JS、8 tests、27 JSON）；CI YAML 解析、架构占位符反查、产品边界扫描、`git diff --check` 均 exit 0。
- notes: 未运行云函数部署、GitHub push 或微信开发者工具验收；远端 CI 首次结果和真实小程序交互由用户后续确认。

### Step 5 — 2026-08-20 03:16
- files: `cloudfunctions/login/index.js`, `tests/team-match-personal-report.test.js`
- verify: 阶段 3 release Gate 再次运行 `tests/team-match-personal-report.test.js`，courts 与 tiebreak 两条个人报告路径通过；全量测试 8/8 通过。
- notes: 这是对旧步骤缺失结构化标题的追溯补录，不代表本阶段重新实现个人报告。

### Step 11 — 2026-08-20 03:16
- files: `cloudfunctions/activity/index.js`
- verify: 阶段 3 release Gate 运行 `tests/release-boundary.test.js`，八种 activity action 全部拒绝且数据库访问为 0。
- notes: 追溯补录第二批已有验证证据。

### Step 12 — 2026-08-20 03:16
- files: `miniprogram/utils/api.js`, `cloudfunctions/login/index.js`, `miniprogram/pages/profile/profile.js`
- verify: 阶段 3 release Gate 的边界测试确认正式 API 与 profile/login 链路无 activity 方法或 `activities` 集合访问。
- notes: 追溯补录第二批已有验证证据。

### Step 13 — 2026-08-20 03:16
- files: `miniprogram/app.json`, `miniprogram/pages/profile/profile.js`, `miniprogram/pages/profile/profile.wxml`, `project.config.json`
- verify: 阶段 3 release Gate 的边界测试确认正式路由与个人页无测试夹具入口，夹具源码及四个 admin 校验仍存在。
- notes: 追溯补录第二批已有验证证据。

### Step 14 — 2026-08-20 03:16
- files: `tests/release-boundary.test.js`
- verify: 阶段 3 release Gate → 3 PASS / 0 FAIL / 0 UNKNOWN，其中 Node 全量测试 8/8 通过。
- notes: 追溯补录第二批已有验证证据。

### Step 2/4 验收纠正 — 2026-08-22 23:03
- files: `cloudfunctions/tournament/index.js`, `miniprogram/utils/api.js`, `miniprogram/pages/tournament-detail/tournament-detail.js`, `miniprogram/pages/tournament-detail/tournament-detail.wxml`, `miniprogram/pages/tournament-detail/tournament-detail.wxss`, `tests/team-match-court-permissions.test.js`, `tests/tournament-revert-encounter.test.js`, `tests/tournament-detail-wxml-contract.test.js`
- verify: release Gate → 3 PASS / 0 FAIL / 0 UNKNOWN（36 JS、8 tests、27 JSON）；微信开发者工具真实页面确认“＋ 添加场次”位于“下一场建议”之前，新增场次弹窗只确认双方人员、不要求同时填写比分。
- notes: 场次生命周期调整为“先保存人员 → 后录比分 → 管理员撤回只清比分并保留人员”；远端 `tournament` 云函数尚未部署，真实保存接口验收因 Mac 锁屏中断，部署前不得宣称云端 action 已生效。

## v0.2.0 · 2026-08-23 · 6–8 月历史归档与版本追踪

### 目标

把 2026-06-04 之后仍滞留在本地工作区的成果完整纳入 Git，在不伪造历史的前提下按可审查的业务批次提交，并用 `CHANGELOG.md` 记录版本的重要变化。

### 约束

- 旧 Git 基线 `456f50a` 作为 `v0.1.0` 的历史锚点；当前成果规划为 `v0.2.0`。
- 所有新提交使用 2026-08-23 的真实提交时间；6–8 月阶段日期只写入 Changelog，并明确标记为根据文档、计划和对话重建。
- 不直接推送 `main`；推送独立分支 `chore/reconstruct-post-june-history` 供审查。
- 不提交 `.DS_Store`、`.harness-runtime/` 和根目录临时 PNG；不删除这些本地文件。
- 不部署云函数、不修改数据库、不上传微信小程序；本轮只整理 Git 历史。

### 步骤

- [x] 21. [运行] 保存现有暂存区的 6 月局部快照，并创建历史归档工作分支。
- [x] 22. [修改] `.gitignore` — 排除本地元数据、Harness 运行缓存和根目录临时图片。
- [x] 23. [创建] `CHANGELOG.md` — 建立 `v0.1.0` 基线、`v0.2.0` 版本摘要和 6–8 月重建批次。
- [x] 24. [运行] 提交团队赛、赛制、场地轮转、录分权限、测试夹具与核心测试批次。
- [x] 25. [运行] 提交团队赛海报和分享视觉批次。
- [x] 26. [运行] 提交个人管理、成员管理、活动下线与发布边界批次。
- [x] 27. [运行] 提交 Harness、CI、架构文档、Changelog 和版本治理批次。
- [ ] 28. [运行] 执行 release Gate、检查提交图和干净边界，然后推送工作分支到 GitHub。

### Step 21 — 2026-08-23 00:20
- files: Git refs/index（未修改项目文件）
- verify: 本地归档分支 `archive/staged-2026-06-09` 指向 `8ffb627`；当前分支为 `chore/reconstruct-post-june-history`；原暂存区已清空且工作区内容保留。
- notes: 归档提交只保存整理前的局部暂存快照，不代表 2026-06-09 的完整可运行版本，也不会推送为正式发布分支。

### Step 22 — 2026-08-23 00:22
- files: `.gitignore`
- verify: `git check-ignore -v --no-index -- ...` 命中根目录/文档 `.DS_Store`、`.harness-runtime/` 和两个根目录临时 PNG；`git diff --check -- .gitignore` → exit 0。
- notes: 只新增忽略规则，没有删除本地文件；已被 Git 跟踪的根目录 `.DS_Store` 将在版本治理批次中仅从索引移除。

### Step 23 — 2026-08-23 00:26
- files: `CHANGELOG.md`
- verify: Changelog 包含 `Unreleased`、`0.2.0`、`0.1.0` 和五个可追溯重建批次；`git diff --check -- CHANGELOG.md` → exit 0。
- notes: 历史批次明确声明为根据文档、计划、测试和最终差异重建；未伪造旧 commit 日期，也未创建发布 tag。

### Step 24 — 2026-08-23 00:31
- files: `cloudfunctions/tournament/index.js`, `cloudfunctions/tournament/config.json`, `cloudfunctions/init-db/index.js`, `miniprogram/pages/tournament-create/`, `miniprogram/pages/tournament-detail/`, `miniprogram/pages/test-fixtures/`, `miniprogram/utils/api.js`, `miniprogram/assets/icons/`, 7 个团队赛测试文件
- verify: 5 个核心 JS `node --check` 通过；7/7 聚焦测试通过；`git diff --cached --check` → exit 0；提交 `8e96d9e` 创建成功。
- notes: 本地 pre-commit hook 存在但仓库没有 `.pre-commit-config.yaml`；按 hook 官方提示使用 `PRE_COMMIT_ALLOW_NO_CONFIG=1` 放行，实际质量验证仍由项目 release Gate 承担。

### Step 25 — 2026-08-23 00:34
- files: `miniprogram/pages/poster/poster.js`, `miniprogram/pages/poster/poster.wxss`, `miniprogram/utils/poster-draw.js`, `miniprogram/utils/poster-styles.js`
- verify: 三个 JS `node --check` 通过；`git diff --cached --check` → exit 0；提交 `4f5626e` 创建成功。
- notes: 海报批次只包含绘制、样式和导出页面，未混入团队赛云函数或个人管理代码。

### Step 26 — 2026-08-23 00:39
- files: `cloudfunctions/login/index.js`, `cloudfunctions/activity/index.js`, `miniprogram/app.json`, `miniprogram/app.wxss`, `miniprogram/pages/activity-detail/`, `miniprogram/pages/match-list/`, `miniprogram/pages/member-management/`, `miniprogram/pages/onboarding/`, `miniprogram/pages/profile/`, `miniprogram/pages/ranking/`, `miniprogram/pages/user-detail/`, `miniprogram/utils/highlight.js`, `project.config.json`, `project.private.config.json`, `tests/release-boundary.test.js`
- verify: 个人管理批次 6 个 JS 语法检查通过并提交为 `f378dc4`；发布边界测试 1/1、4 个 JSON 解析与 diff 检查通过并提交为 `daca00d`。
- notes: 按产品边界拆为两个提交：个人/成员体验与活动下线/正式路由收口，避免把不同职责压成一个不可审查提交。

### Step 27 — 2026-08-23 00:44
- files: `.gitignore`, `.harness-config.yaml`, `AGENTS.md`, `CHANGELOG.md`, `MEMORY.md`, `TODO.md`, `.github/workflows/ci.yml`, `docs/`, `plan.md`, `scripts/`, `miniprogram/pages/test-fixtures/test-fixtures.js`, Git 索引中的 `.DS_Store`
- verify: 四个 Bash 脚本 `bash -n` 通过；CI YAML 解析通过；测试夹具 JS 语法通过；版本/规则关键词核对通过；`git diff --cached --check` → exit 0。
- notes: 修正文档中“团队赛仍计算 ELO”“仍按 slot 录入”“等待旧 Reviewer”的过期描述；`.DS_Store` 仅从 Git 索引移除，本地文件保留并被忽略。

### 完成判定

- 当前所有产品代码、测试、文档和工程脚本均被 Git 跟踪；本地缓存与临时图片保持未提交且被忽略。
- `git log` 能按业务批次解释当前版本，`CHANGELOG.md` 能说明 `v0.1.0 → v0.2.0` 的重要变化与重建证据边界。
- `bash scripts/verify.sh --tier release --strict-unknown` 返回 exit 0，`git diff --check` 无错误。
- GitHub 出现 `chore/reconstruct-post-june-history` 分支，远端提交 SHA 与本地一致；`main` 不被直接修改。
