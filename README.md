# 腾讯广州网球社 · 活动与比赛记录小程序

一个**仅供社团内部使用**的微信小程序，用于记录活动报名和比赛战绩。基于微信云开发，无需服务器、无需备案。

## 功能

- **用户登记**：首次进入填写企微名（手动），后续可在"我的"中修改
- **活动模块**：创建活动、报名、取消报名、查看参与名单
- **比赛模块**：
  - 单打 / 双打
  - 任意盘数（1 / 3 / 5 盘）
  - 选手主动加入 A 方或 B 方
  - 比分录入，自动判定胜方

## 目录结构

```
tennis-club/
├── miniprogram/             # 小程序前端
│   ├── app.js / app.json / app.wxss
│   ├── pages/
│   │   ├── index/                # 活动列表（Tab）
│   │   ├── match-list/           # 比赛列表（Tab）
│   │   ├── profile/              # 我的（Tab）
│   │   ├── onboarding/           # 首次进入登记企微名
│   │   ├── activity-create/      # 创建活动
│   │   ├── activity-detail/      # 活动详情 + 报名
│   │   ├── match-create/         # 创建比赛
│   │   └── match-detail/         # 比赛详情 + 报名 + 比分
│   └── utils/                    # api / 格式化 / 用户态
├── cloudfunctions/         # 云函数（后端）
│   ├── login/                  # 自动建用户 + 更新企微名
│   ├── activity/               # 活动相关
│   ├── match/                  # 比赛相关（含比分判定）
│   └── init-db/                # 一键初始化数据库
├── PRIVACY.md              # 隐私协议模板
└── project.config.json
```

## 快速开始

### 1. 注册小程序账号

1. 打开 <https://mp.weixin.qq.com> → 立即注册 → 选"小程序"
2. 个人主体即可
3. 注册完成后在 **设置 → 开发设置** 获得 **AppID**

### 2. 安装开发者工具

下载并安装：<https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html>

### 3. 导入项目

1. 打开开发者工具 → "导入项目"
2. 目录选择本仓库 `tennis-club/`
3. AppID 填入你的 AppID
4. 确认勾选"小程序云开发"

### 4. 开通云开发

1. 工具顶部点击 **云开发** 按钮 → 开通
2. 创建一个云环境（个人主体免费额度够用）
3. 复制环境 ID（形如 `cloud1-xxxxxxxx`）
4. 把环境 ID 填到 `miniprogram/app.js` 的 `cloudEnv` 字段：

```js
globalData: {
  cloudEnv: 'cloud1-xxxxxxxx',  // ← 替换这里
  ...
}
```

### 5. 部署云函数

依次右键以下 4 个文件夹 → **创建并部署：云端安装依赖（不上传 node_modules）**：

- `cloudfunctions/login/`
- `cloudfunctions/activity/`
- `cloudfunctions/match/`
- `cloudfunctions/init-db/`

### 6. 初始化数据库

1. 工具顶部 **云开发** → **云函数** → 找到 `init-db`
2. 点击 **云端测试**，事件参数留空 `{}`，运行一次
3. 看到返回包含 `users / activities / matches: 创建成功` 即可

> 也可以在 **云开发 → 数据库** 中手动新建这 3 个集合。

### 7. 真机预览

1. 工具右上角点 **预览**，用微信扫码
2. 第一个进入的人会自动成为 **管理员**
3. 完成企微名登记后，开始创建活动 / 比赛

### 8. 加入团队成员（体验版）

1. 登录 <https://mp.weixin.qq.com>
2. 左侧 **管理 → 成员管理 → 体验成员** → 添加（最多 90 人）
3. 工具顶部点 **上传** 上传一版代码
4. 在 mp 后台 **管理 → 版本管理 → 开发版本** → "选为体验版"，生成体验版二维码
5. 把二维码发到群里，团队成员扫码即可使用

> 体验版**完全无需提交审核**，最适合内部使用。

## 数据库说明

### users 集合
| 字段 | 类型 | 说明 |
|---|---|---|
| openid | string | 微信 openid（唯一） |
| wecomName | string | 企微名 |
| role | string | `member` / `admin`，第一个用户自动为 admin |
| createdAt / updatedAt | number | 时间戳 |

### activities 集合
| 字段 | 类型 | 说明 |
|---|---|---|
| title | string | 标题 |
| startTime | number | 开始时间戳 |
| location | string | 地点 |
| maxPeople | number | 0 = 不限 |
| note | string | 备注 |
| participants | array | `[{openid, wecomName, joinedAt}]` |
| creator / creatorName | string | 创建者 |
| status | string | `open` / `closed` |

### matches 集合
| 字段 | 类型 | 说明 |
|---|---|---|
| title | string | 比赛名 |
| type | string | `singles` / `doubles` |
| bestOf | number | 1 / 3 / 5 |
| matchDate | number | 比赛日期 |
| teamA / teamB | array | `[{openid, wecomName}]` |
| scores | array | `[{setNo, a, b}]` |
| winner | string | `A` / `B` / null |
| scoreSummary | string | 例如 `6-4, 7-5` |
| status | string | `pending` / `finished` |

## 权限说明

- **录入比分权限**：参赛双方任一选手、比赛创建者、管理员
- **管理员**：第一个进入小程序的人自动获得，可后续手动在数据库中修改其他人为 admin

## 常见问题

**Q：报错 "云开发 env 未初始化"？**
A：检查 `miniprogram/app.js` 的 `cloudEnv` 是否替换为你自己的环境 ID。

**Q：列表一直空？**
A：先运行 `init-db` 云函数；或在云开发数据库手动建 `users / activities / matches` 3 个集合。

**Q：改了云函数代码不生效？**
A：必须右键云函数文件夹 → "上传并部署" 才会更新。

## License

仅供腾讯广州网球社内部使用。
