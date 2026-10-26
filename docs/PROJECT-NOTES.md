# 今日作业 · 项目全记录(设计 / 开发 / 思路 / CI / 发布)

> 这份文档记录**为什么这么做**、**踩了哪些坑**、**CI 与发布链路怎么搭起来的**,
> 以及从零到 TestFlight 上架的完整过程与当时的判断依据。
>
> 与 [README.md](../README.md) 的分工:
> - `README.md` = **使用手册**(怎么部署、怎么装、怎么用,面向"我要跑起来")
> - 本文 = **工程全记录**(设计取舍、实现细节、故障根因、CI/签名链路,面向"我以后要改它"或"换个 App 重来一遍")
>
> 记录时间:2026-10-16。文中"现状"截至该日,含尚未提交的工作区改动。

---

## 目录

1. [项目概览](#1-项目概览)
2. [需求与产品设计](#2-需求与产品设计)
3. [技术选型与理由](#3-技术选型与理由)
4. [总体架构](#4-总体架构)
5. [数据模型与协议](#5-数据模型与协议)
6. [关键实现细节与踩坑记录](#6-关键实现细节与踩坑记录)
7. [Git 开发历程(逐 commit)](#7-git-开发历程逐-commit)
8. [CI/CD 全解](#8-cicd-全解)
9. [iOS 签名与发布链路](#9-ios-签名与发布链路)
10. [隐私、安全与合规](#10-隐私安全与合规)
11. [当前状态与未完成事项](#11-当前状态与未完成事项)
12. [运维与故障排查手册](#12-运维与故障排查手册)
13. [换一个新 App 复用这套设施](#13-换一个新-app-复用这套设施)
14. [命令速查与术语表](#14-命令速查与术语表)
15. [后续规划](#15-后续规划)

---

## 1. 项目概览

| 项 | 内容 |
|---|---|
| 产品名 | 今日作业(内部名 `homework-app`) |
| 一句话 | 家长在手机上布置作业,孩子在 iPad 上大字号查看、打勾完成 |
| 仓库 | `goxofy/homework-arrangement`(**仓库根 = 项目根**) |
| 客户端 | Expo SDK 57 / React Native 0.86.3 / React 19.2.3 / TypeScript 6(`strict`) |
| 服务端 | Node ≥ 22.5 + `node:sqlite`(内置),仅 3 个依赖:`express` / `cors` / `ws` |
| 分发 | Android APK + iOS TestFlight(自用内测,不上架 App Store) |
| 作者 | Tink |
| 首次提交 | 2026-09-18 `c644bfa`(create-expo-app 脚手架) |
| 已发 build | iOS `1.0.0(4)`(2026-09-19,已通过 ipa 实测校验) |
| 提交数 | 15 个 commit(`c644bfa` … `4d76f45`),无 tag |

**使用场景(不是"通用 App",是家庭内的一个工具)**:

```
家长手机(Android/iPhone)              孩子 iPad
  ├─ 打字/语音布置今天的作业        →     ├─ 打开就是今天,大字看
  ├─ 配图/录音/视频当资料(7 天暂存) →     ├─ 翻到这一天自动下载到本机
  ├─ 勾选完成                       ↔     ├─ 自己也能勾选完成
  └─ 提前布置未来日期作业             ←→    └─ 同一套周导航,可提前查看
             │                                    │
             └────────── 自建服务端(家里/公网)──────┘
                REST + WebSocket 实时双向同步
```

---

## 2. 需求与产品设计

### 2.1 需求是怎么推导出来的

需求不是一句"做个布置作业的 App",而是从真实使用场景反推出来的约束:

| 场景事实 | 推导出的设计 |
|---|---|
| 家长在**手机**上布置,孩子在**iPad** 上看 | 双端形态、双端布局差异(家长端密集录入、儿童端大字号) |
| 家里不是每个人都有 Apple ID / 账号体系太麻烦 | **无账号系统**:家长定一个 ≥8 位房间号,双方输同一个号即关联 |
| 孩子小,打不了字 | 儿童端**只读 + 勾选完成**,没有编辑/删除入口 |
| 家长输入作业需要稳定、可编辑 | **文字录入为主**;移除系统语音转文字,语音仅作为可选讲解附件 |
| 教科书面每天固定几科 | **分组持续生效**:分组配置一次,后续每天沿用,全 App 只有一个分组入口 |
| 要用很多年 | 数据落在**自己家的服务器**,不依赖任何云服务账号与付费 |
| 家里的服务器很弱(树莓派级) | 服务端零原生依赖、SQLite 单文件、附件串行上传、下载并发上限 2 |
| 需要提前安排周末/下周 | 两端都可浏览未来日期;家长可提前布置,儿童可提前查看 |
| 视力差异大 | 设置页提供**字号 4 档 + 行距 3 档**,只影响本机显示 |

### 2.2 关键设计决策与理由

| 决策 | 为什么这么定 | 被否掉的替代方案 |
|---|---|---|
| **无账号,房间号即凭据** | 家庭成员不需要注册流程;房间号本身就是访问凭证,别人猜不到即可 | 账号体系(对"家里人用"是纯负担)、邀请链接(需要额外的分发通道) |
| **家长端 / 儿童端两个界面,而非一套带权限的界面** | 孩子只需要"看 + 打勾",把编辑入口藏起来比做权限判断更简单也更不会被误触 | 单界面按角色隐藏按钮(仍会露出编辑态、误触风险高) |
| **作业正文只用文字输入** | 输入路径更直接,也不再申请系统语音识别权限;需要口头说明时录成附件即可 | 系统语音转文字(已移除,入口占空间且不是主要使用方式) |
| **任务行压成单行紧凑 + 详情弹层看全文** | 一屏要能看到当天所有作业(真机实测:两行布局一屏只有 5–6 条,不够) | 多行自动换行(一屏装不下)、点进二级页面(打断浏览) |
| **周导航(上/下周 + 周一到周日七按钮)** | 家长布置是"按周"思考的;有作业的日子带小圆点,一眼看清那周情况 | 按天左右翻页(要翻 7 次才能看到下周一) |
| **不用 RN 的 `Modal`,自研树内 `Overlay`** | `Modal` 渲染进独立原生窗口,`SafeAreaView` 拿到的 insets 为 0,二级页面顶到状态栏、左上角按钮点不到(详见 6.1) | 继续用 `Modal` + 硬编码 padding(换设备/横屏就崩) |
| **附件只暂存 7 天,谁看谁下载到本机** | 服务器不替用户永久囤几 GB 视频;孩子打开过这一天 → 资料长期留在他 iPad 上,服务器删了也不影响 | 永久保存(服务器迟早爆)、纯直链播放(家里宽带上传带宽顶不住) |
| **完成状态放服务端、两端都可写** | 孩子自己记录进度是刻意设计,不是漏洞;双端勾选实时同步 | 只有家长能勾(孩子失去了参与感) |
| **显示偏好存在本机** | 家长的手机和孩子 iPad 需要不同的字号,不应互相覆盖 | 存服务端(两端会互相改坏) |

---

## 3. 技术选型与理由

### 3.1 客户端:Expo(而非裸 RN / Flutter)

- **Expo SDK 57 + `expo prebuild`**:CI 上一条 `npx expo prebuild --platform ios` 就能生成可归档的原生工程,不需要在仓库里维护 `ios/`、`android/` 目录(两者都在 `.gitignore` 里)。
- **原生模块与原生配置是刚需**:`expo-audio`(录音)、`expo-image-picker`(相册)、`expo-video`(历史视频播放)、`expo-file-system`(附件上传/缓存),以及 Android 构建配置插件;Expo Go 不能覆盖完整验证。
- **`AGENTS.md` 里钉死了版本化文档**:`Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code` —— Expo 大版本间 API 变化大(`expo-file-system` 新旧两套 API 并存就是例子),避免按记忆写代码。

依赖清单(实际使用的部分):

| 包 | 用途 |
|---|---|
| `expo-audio` | 录音(语音讲解附件) |
| `expo-image-picker` | 相册多选图片(历史视频附件保留展示兼容) |
| `expo-video` | 播放视频附件 |
| `expo-file-system` | 附件原生上传(`File.upload`)、本机缓存(`Directory`/`File`/`Paths`) |
| `@react-native-async-storage/async-storage` | 身份、服务器地址、显示偏好、草稿持久化 |
| `react-native-safe-area-context` | 安全区(`SafeAreaProvider` 必需,见 6.3) |
| `@react-native-community/netinfo`、`datetimepicker` | 依赖中保留(网络状态/日期选择) |

### 3.2 服务端:Node 内置 sqlite + 3 个纯 JS 依赖

- **`node:sqlite`(Node ≥ 22.5 内置)** 是关键决策:SQLite 免安装、单文件、WAL 模式够用;而且**没有原生编译**,`npm install` 秒级完成,树莓派/小主机/Docker 都不会在 `better-sqlite3` 编译上翻车。
- `express` + `cors` + `ws`:全部纯 JS,`server/package.json` 只声明这三个。
- **不用数据库服务(Postgres/MySQL)**:单文件备份(`tar czf backup.tar.gz data/`)对这个规模就是最优解。
- `Dockerfile` 基于 `node:22-slim`,`VOLUME /app/data` 持久化数据。

### 3.3 工具链

| 工具 | 位置 | 理由 |
|---|---|---|
| `bun` | CI:先 `npm i -g bun` 再 `bun install --frozen-lockfile` | 安装快、锁文件确定,CI 时间可控 |
| 本地 Xcode | 16.2(现状) | 早期为 15.4;无论如何,**签名构建仍放在 CI**,理由见 §8.2 |
| GitHub Actions | 三个工作流 | 出 APK / unsigned IPA / 已签名 IPA,零本地环境依赖 |

---

## 4. 总体架构

### 4.1 客户端分层

```
index.ts                   registerRootComponent(App)
App.tsx                    根组件:三层 Provider 包裹 + 页面路由
 ├── SafeAreaProvider       最外层,insets 来源
 ├── DisplayProvider        字号/行距偏好(本机)
 ├── AppProvider            身份/分组/任务缓存/WebSocket(核心状态)
 └── MediaViewerProvider    全屏看大图/放视频(挂在根,不跟随滚动)

src/screens/               页面(欢迎 → 加入房间 → 家长端/儿童端;分组、设置是弹层)
src/ui.tsx                 通用组件 874 行:Screen / Overlay / TopBar / DateNav / WeekNav / TaskRow …
src/AppContext.tsx         全局状态 + 乐观更新 + WS 重连 + 附件上传编排
src/api.ts                 服务端 API 封装(含原生字节流上传)
src/media.ts               附件本机缓存(去重 / 并发 2 / 大小统计 / 清理)
src/MediaAttachments.tsx   附件选择与展示(809 行)
src/media-viewer.tsx       全屏媒体查看器
src/storage.ts             AsyncStorage 持久化 + 类型定义 + 服务器地址规范化
src/dates.ts               本地时区日期工具(全程 YYYY-MM-DD)
src/keyboard.ts            键盘避让高度(Android 15+ 必须自己算)
src/display.tsx            显示偏好 Provider
src/task-groups.ts          家长/儿童端共用的任务分组逻辑
src/theme.ts / theme 常量  颜色 / spacing(n)=n*8 / radius / 分组配色盘
src/ServerField.tsx        服务器地址:行 + 点击弹出的输入层
```

**路由方式**:没有引入 `react-navigation`。根组件用 `identity` / `pickedRole` 两个状态做**条件渲染**,
每次换页外层包一层 `<FadeIn key="...">`,靠 key 变化重新挂载 → 重放进场动画。
在"只有一个角色、最多三级层次"的产品里,这比引入导航库更少概念、更少 bug。

**弹层约定(重要)**:弹层(分组 / 设置 / 详情 / 服务器输入)一律:
1. 用 `ui.tsx` 的 `Overlay`,**不**用 RN `Modal`;
2. **和它的页面根节点平级渲染**,页面根节点本身不加安全区 padding(否则安全区让位两次);
3. **常驻渲染 + `visible` 控制**,而不是条件挂载 —— 否则关闭时会被当场卸载,退场动画没机会播(见 6.6)。

### 4.2 服务端结构

```
server/src/index.js   入口:Express 路由 + 附件上传/下载 + 过期清理定时器 + /api/stats
server/src/db.js      数据库层:建表、老库补列、CRUD、附件行管理
server/src/ws.js      WebSocket:/ws?room=CODE,房间广播
server/src/util.js    校验与常量:房间号/日期正则、各类上限、mime→扩展名、TTL
server/Dockerfile     node:22-slim
server/test-*.mjs     冒烟测试(见 §11.3)
```

---

## 5. 数据模型与协议

### 5.1 表结构(全部按 `room_code` 隔离)

```sql
rooms       (code PK, created_at)
subjects    (room_code, id, name, color, sort_order, archived, created_at, PK(room_code,id))
tasks       (room_code, id, for_date, subject_id, content, done,
             audio_path, audio_mime, audio_size,           -- 旧版"一条作业一段语音"
             created_at, updated_at, PK(room_code,id))
task_media  (room_code, id, task_id, kind,                  -- image|audio|video|file
             name, mime, size, media_path, position,
             created_at, expires_at, deleted_at, PK(room_code,id))
```

索引:`idx_tasks_room_date`、`idx_subjects_room_sort`、`idx_media_task`、`idx_media_expiry`。

**两个刻意的取舍**:

1. **`archived` 而不是物理删除分组**:历史任务仍能显示原分组名与颜色,不会出现"这条作业的分组是空的"。
2. **附件过期只删文件、保留行(打 `deleted_at`)**:客户端才能显示「已过期」,而不是让它从界面上莫名其妙消失。
   `expires_at` 有索引,清理走 `WHERE deleted_at IS NULL AND expires_at <= ? LIMIT ?`。

**升级不跑迁移**:建表一律 `CREATE TABLE IF NOT EXISTS`;新增列用 `ensureColumn()`(`PRAGMA table_info` 检查后 `ALTER TABLE ADD COLUMN`)。所以升级 = 覆盖代码 + 重启,老库自动补齐,数据不丢。

### 5.2 REST API

| 方法 | 路径 | 语义与状态码 |
|---|---|---|
| GET | `/api/health` | `{ok:true,ts}` 排障第一步 |
| GET | `/api/stats` | 房间数/任务数/语音与附件占用/保留期(运维小工具) |
| POST | `/api/rooms` | 建房;房间号不合规 400、**已存在 409** |
| GET | `/api/rooms/:code` | 房间信息 + 分组(儿童加入前校验用);不存在 404 |
| GET/POST | `/api/rooms/:code/subjects` | 列/加分组(名称 ≤ 20 字) |
| PUT | `/api/rooms/:code/subjects/:sid` | 改分组 |
| DELETE | `/api/rooms/:code/subjects/:sid` | **归档**(不是删除) |
| GET | `/api/rooms/:code/tasks/:date` | 某日任务,含每条作业的 `media[]`(联表一次取完,避免 N+1) |
| POST | `/api/rooms/:code/tasks` | 加任务(可选 `audio_base64`);日期格式错 400、内容空 400、超 500 字 400 |
| PUT | `/api/rooms/:code/tasks/:tid` | 改内容/分组/**`done`** |
| DELETE | `/api/rooms/:code/tasks/:tid` | 删任务(连语音与附件文件一起清) |
| POST | `/api/rooms/:code/tasks/:tid/media` | 上传附件(**请求体就是文件字节流**,元数据走 query) |
| GET | `/api/rooms/:code/media/:mid` | 下载附件(支持 Range);**已过期 410** |
| DELETE | `/api/rooms/:code/media/:mid` | 家长删附件 |
| GET | `/api/rooms/:code/audio/:tid` | 旧版语音下载 |
| WS | `/ws?room=CODE` | 广播 `tasks_changed{date}` / `subjects_changed` |

**统一错误响应**:末尾的 error 中间件把 `entity.too.large`(body 超限)转成 `413 JSON`,
否则默认返回 HTML,客户端 `JSON.parse` 失败会显示成"请求失败(413)"这种没信息量的提示。

### 5.3 实时同步协议与策略

- 连接:`ws(s)://<server>/ws?room=CODE`(由 `http` → `ws` 字符串替换得到)。
- 广播载荷极小,只通知"哪一天变了",**不带数据**;客户端收到后**重新拉取**那一天。宁可多一次请求,也不做增量合并 —— 数据量小、逻辑简单、不会出现"本地和服务端各说各话"。
- **重连指数退避**:1s 起、翻倍、上限 15s;`AppState` 为 `unknown` 时不重连。
- **重连成功即全量刷新**(`subjects` + 所有已加载的日期),防止断线期间漏掉的消息。
- **App 从后台回前台**也全量刷新已加载日期。
- 兜底:收到**不带 `date`** 的 `tasks_changed`(旧版服务端)时,刷新所有已加载日期 —— 这个兜底就是 §6.5 那个 bug 的直接产物。

### 5.4 附件的生命周期(设计要点)

```
① 家长选择文件(iPhone 相册多选 / App 内录音 / 系统文件)
② 逐张串行上传(不并发:家里服务器弱,并发更容易失败)
   请求体 = 原始字节流,Content-Type = 文件 mime,元数据在 query
③ 服务端落盘 data/media/<id><ext>,入库记 expires_at = now + MEDIA_TTL_MS
   —— 先入库再广播,保证儿童端收到通知时就能拉到
④ 家长端把刚上传的文件 copy 进本机缓存(不用再下载一遍自己的附件)
⑤ 儿童端翻到那一天 → ensureMediaCached() 把该日所有未缓存附件下载到
   document/homework-media/ 长期保留
⑥ 7 天到期:服务端删文件 + 标 deleted_at;客户端该条显示「已过期」
   但已下载到本机的副本照常能看/听/播
⑦ 设置页可查看本机缓存占用并一键清理
```

上限(服务端强制,`util.js`):图片 12MB / 音频 25MB / 视频 80MB / 其他文件 25MB;
每条作业最多 20 个附件;上传体总限 `video 上限 + 10MB`;旧版语音单条 15MB;任务内容 500 字;分组名 20 字。

保留期:`MEDIA_TTL_DAYS` 环境变量,默认 7(允许小数,方便本地验证);清理时机为**启动时一遍 + 每 10 分钟一遍 + 每次附件下载请求顺手扫 50 条**(所以"过期了但还没到 10 分钟"也能立刻得到 410)。

---

## 6. 关键实现细节与踩坑记录

> 这一节是本文档最有价值的部分:每个都是**真机上出现过、定位到根因、并修掉**的问题。

### 6.1 弹层不能用 RN `Modal`(安全区失效)

**现象**:分组/设置这类二级页面顶到状态栏下面,左上角「完成」按钮点不到。

**根因**:RN `Modal` 把内容渲染进**独立原生窗口**(Android 是 Dialog、iOS 是新的 VC)。
在那个窗口里 `SafeAreaView` 找不到上层的 `SafeAreaProvider`,拿到的 insets 恒为 0;
而且**状态栏那块区域还会吃掉点击**。

**修法**:自研 `ui.tsx` 的 `Overlay` —— 在 App 视图树内做全屏层,安全区/键盘/返回键全部走主窗口逻辑。
**代价**:必须遵守约定"弹层与页面根节点平级,根节点不加安全区 padding",否则安全区让位两次。

### 6.2 键盘避让:Android 15+ 必须自己算

**现象**:Android 上键盘盖住输入框;RN 自带的 `KeyboardAvoidingView` 无效。

**根因**:Android 15+(targetSdk 35+)强制 edge-to-edge 后,`windowSoftInputMode="adjustResize"` 不再缩小窗口;
而 `KeyboardAvoidingView` 依赖 `endCoordinates.screenY` 计算避让量,这个值在这套环境下不准。

**修法**(`src/keyboard.ts`):用**键盘高度**自己算,并区分两种情况,避免 Android 14 及以下被重复避让:

```
额外避让量 = 键盘高度 − 窗口缩小量      (窗口缩小量 = 无键盘时的窗口高度 − 当前窗口高度)
  A. 系统确实缩小了窗口(Android 14 及以下):结果 ≈ 0,不额外避让
  B. 系统没缩小窗口(Android 15+/iOS):结果 = 键盘高度
```

细节:RN **先发 `keyboardDidShow` 再发尺寸变化**,所以 `Dimensions` 的 change 回调里要**重算一次**;
旋转屏幕后(键盘不在时)把当前窗口高度重置为新基准;iOS 侧返回 0,交给 `ScrollView` 的 `automaticallyAdjustKeyboardInsets`。

**顺带绕开两个最容易出问题的位置**:
- 服务器地址改成"**点击弹层输入**"(输入框紧贴顶部栏,键盘永远遮不到);
- 添加/编辑作业的「保存」放在**顶部栏**,而不是页面底部的按钮。

### 6.3 `SafeAreaProvider` 缺失 → insets 恒为 0

`safe-area-context` v5 下,根组件不包 `SafeAreaProvider` 时 `useSafeAreaInsets()` 全为 0,
内容直接顶到状态栏。修法:根组件最外层补 `SafeAreaProvider initialMetrics={initialWindowMetrics}`,
所有页面用 `Screen` 的 `edges` 决定避让哪几边(有固定顶栏的页面只让 `bottom/left/right`),
顶栏/底栏用 `useSafeAreaInsets()` 手动让位;内容宽度限 720dp 居中(平板/横屏不会把卡片拉成一条)。

### 6.4 Android 连不上服务器:明文 HTTP 被系统拦截

**现象**:iOS 上一切正常,Android 一直"无法连接服务器"。

**根因**:Android 9+ 默认拦截 `http://` 请求,而家庭自建服务通常就是 `http://192.168.x.x:8787`,
**REST 与 WebSocket 全被系统掐断**。

**修法**:`app.json` 里 `expo-build-properties.android.usesCleartextTraffic = true`。
注意:**改过 `app.json` / 原生配置后必须重新构建并重新安装**,只热更新 JS 不生效。

### 6.5 删除任务无法实时同步到另一台设备(广播漏了 `date`)

**现象**:另一台设备必须手动切日期或重进页面,才会发现任务已被删除。
添加/编辑/勾选都正常 —— **只有删除异常**,这个不对称就是线索。

**根因**:删除接口的 WebSocket 广播**漏带了 `date`**,而客户端只在收到带日期的广播时刷新对应日期。

**修法**:删除前先 `getTask()` 取出 `for_date` 一并广播;客户端加兜底(收到不带日期的 `tasks_changed` 就刷新所有已加载日期)。
新增 `server/test-delete-sync.mjs` 冒烟测试:连真实 WebSocket 校验四种广播载荷,并覆盖
"一方勾选、另一方已删除"的并发冲突(应返回 404、客户端回滚刷新、不产生额外广播)。

### 6.6 弹层退场动画不播

**根因**:用 `visible && <Overlay/>` 条件挂载时,`visible` 变 false 会**当场卸载**,退场动画没机会播。
**修法**:弹层**常驻渲染**,只切 `visible`;离场后再卸载。同时 `App.tsx` 里在离开家长端时主动关掉
家长端的弹层,避免下次回到家长端时"莫名其妙弹出来"。

### 6.7 添加作业页顶栏"白条割裂"

顶部白条夹在浅灰内容之间形成一条明显色带。修法:统一改成与首页一致的**扁平顶栏**。

### 6.8 中文全角括号吃掉了 shell 变量名(CI 踩坑)

**现象**:CI Step Summary 里 build 来源那一行变成乱码。

**根因**:脚本里写的是 `$SOURCE）` —— 后面紧贴**中文全角右括号**时,bash 会把多字节字符的**头一个字节**算进变量名,
于是 `${SOURCE）...}` 这种"变量名"取到空值,整行错位。

**修法**:一律写成 `${SOURCE}` 显式界定变量名。**这条经验适用于所有含中文的 shell 脚本。**

### 6.9 附件上传刻意不用 multipart / base64

- **base64**:体积膨胀 33%,几十 MB 的视频直接不可用(所以旧版语音 base64 只留给 ≤15MB 的短语音)。
- **multipart**:服务端要引入解析依赖。
- **最终方案**:**请求体就是文件字节流**,`Content-Type` = 文件 mime,元数据走 query(`?mime=&name=`);
  客户端用 `expo-file-system` 的 `File.upload(..., uploadType: BINARY_CONTENT)`,**原生上传,内存里不会一次性装下整个文件**。
- **连带的坑**:`express.json()` 中间件必须**跳过**这个路径,否则上传一个 `.json` 文件时 body 会被当 JSON 解析掉,handler 拿不到 Buffer。做法:

  ```js
  const MEDIA_UPLOAD_PATH_RE = /^\/api\/rooms\/[^/]+\/tasks\/[^/]+\/media$/;
  app.use((req, res, next) => {
    if (req.method === 'POST' && MEDIA_UPLOAD_PATH_RE.test(req.path)) return next();
    return jsonBody(req, res, next);
  });
  ```

  然后在路由上单独挂 `express.raw({ type: () => true, limit: MEDIA_UPLOAD_LIMIT })`。

### 6.10 附件下载的其他细节

- 用 `res.sendFile()`:**自带 Range 支持**,大视频能边下边播、断点续传。
- **410 而不是 404** 表示"已过期但确实存在过",客户端据此显示「已过期」而不是「附件不存在」。
- 文件名用 `safeFileName()` 清洗(去路径分隔符、只留白名单字符、截断 120 字),避免路径穿越与奇怪字符。
- mime → 扩展名有显式映射表(客户端/服务端各一份),因为**播放器(尤其安卓)很依赖扩展名**。

### 6.11 本机缓存的并发与幂等

- 缓存放 **`document` 目录**(`Paths.document/homework-media`),**不能放 `cache` 目录** —— iOS 会清理 cache。
- `inflight: Map<id, Promise>` 去重 + **最多 2 个并发**(家里服务器弱,串行程度高更稳)。
- 上传成功后 `importLocalFile()` 把刚选的文件 copy 进缓存,家长端不用再下载一遍自己的附件。
- `known: Map<id, uri|null>` 缓存"本机有没有"的判断,避免频繁访问文件系统。

### 6.12 日期全程用本地 `YYYY-MM-DD`

绝不用 UTC 或 `Date.toISOString()` 截取日期 —— 东八区下会把"今天"算成"昨天"。
`src/dates.ts` 提供 `todayStr / localDateStr / addDays / startOfWeek / weekRangeLabel / isFuture` 等,
一律基于**本地时区**;未来日期不再被客户端导航拦截,`isFuture()` 仅作为通用日期判断工具。服务端 `isValidDate()` 还会用
`new Date(s+'T00:00:00Z').toISOString().slice(0,10) === s` 反查,挡掉 `2026-02-31` 这类非法日期。

### 6.13 iOS 签名身份不能写死

工作流原本硬编码 `CODE_SIGN_IDENTITY="Apple Distribution"`,但**老式的 `iPhone Distribution` 证书同样是合法的 App Store 分发凭证**,
硬编码会让另一种证书在 archive 阶段直接失败。
修法:导入 p12 后从钥匙串**读出证书的实际名称**再传给 `xcodebuild`,并**拒绝开发证书**(名字里不含 `Distribution` 就报错退出)。

### 6.14 build 号撞车(ITMS-4238)

**现象**:上传被 Transporter 拒绝,提示同一版本号下 build 号重复。

**根因**:`github.run_number` 是**这个工作流的第几次运行**(从 1 开始),与 App Store Connect 里已有的 build 数**无关**;
而库里已经有 `1.0.0(1)`、`1.0.0(2)`,第一次跑 CI 又算出 1 → 必然撞。

**修法**:`build = 手动填的 build_number ?? (run_number + 仓库变量 IOS_BUILD_OFFSET)`,并把最终 `版本 (build)` 与来源写进 run 的 Summary。
非数字输入**带原因失败**,而不是生成一个"签名正确但传不上去"的包。本项目 `IOS_BUILD_OFFSET=1`。

### 6.15 ITMS-90683:Info.plist 缺少相册用途声明(最反直觉的一个)

**报错**:`Missing purpose string in Info.plist ... should contain a NSPhotoLibraryUsageDescription key`。

**第一反应**:我们根本没用到相册 —— `src/` 里对相册 / `expo-file-system` / `MediaLibrary` / `ImagePicker` 的引用数是 **0**。

**真实根因**(找出来后写进 commit message):

```swift
// node_modules/expo-file-system/ios/Legacy/FileSystemHelpers.swift:134
let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
```

用途是从 `ph://` 相册 URI 复制文件(`EXFileSystemAssetLibraryHandler.m` 里那套 `PHAsset` 逻辑);
而 `expo-file-system` 是 **`expo` 包自带的直接依赖,删不掉**。
App Store 的静态分析扫的是**链接进二进制的符号**,不管这个函数你有没有真的调用过 —— 苹果在报错里也专门写了
*"While your app might not use these APIs, a purpose string is still required."*

**修法**:补一条**诚实**的说明(`app.json` → `ios.infoPlist.NSPhotoLibraryUsageDescription`)。
另一条更彻底的路是**用 autolinking 把 `expo-file-system` 排除掉**,让二进制里根本没有相册符号,
但那会动到 Expo 的资产加载路径 —— 为省一条字符串不值得,所以选了零风险的补声明。

**当时顺带做的一次性排查**(避免再来第二轮同类报错):逐个 grep 了相机 / 定位 / 通讯录 / 日历 / 蓝牙 / 运动 / ATT / 健康 / 音乐库,
**均无任何引用**;当时语音识别与麦克风声明都存在。后续移除语音转文字后,对应的语音识别用途声明也随依赖一起删除。

> 附:`ITSAppUsesNonExemptEncryption = 0` 也已写入,上传后不用再回答出口合规问题。

### 6.16 Xcode 16 移除了 bitcode

`ExportOptions.plist` 里的 `compileBitcode` 在 Xcode 16 起已彻底移除支持,归档导出时可能直接报错;
它的值本来就是 `false`(现代 Xcode 默认行为),删掉不影响产物。

### 6.17 CI 上的三个环境细节

- **`MACOSX_DEPLOYMENT_TARGET`**:CocoaPods 生成头文件时会有 `MACOSX_DEPLOYMENT_TARGET` 检查警告,
  跑 pod 前把 `MACOSX_DEPLOYMENT_TARGET=$(sw_vers -productVersion)` 写进 `GITHUB_ENV`。
- **Android SDK 已预装**在 `ubuntu-latest`(`ANDROID_HOME`),`android-actions/setup-android` 是多余的步骤,已删除。
- **Gradle OOM**:CI 默认 2GB 堆 + 512m Metaspace 会 Metaspace OOM。
  新增 Expo 配置插件 `plugins/withAndroidBuildTuning.js` 注入:`-Xmx4096m`、`MaxMetaspaceSize=1024m`、
  `org.gradle.workers.max=2`、`kotlin.daemon.jvm.options=-Xmx2048m`,并在构建时 `-x lint`(release lint 也是 OOM 重灾区且出包不需要)。

---

## 7. Git 开发历程(逐 commit)

全部 15 个提交(时间倒序列表见下,**按时间正序**叙述)。仓库只有 `main` 一个分支,**没有任何 tag**。
提交信息风格:`<类型>(<范围>): <动机与根因>`,正文写"为什么"而不是"改了什么",多数带 Codebuff 署名。

| # | commit | 时间 | 主题 |
|---|---|---|---|
| 1 | `c644bfa` | 09-18 10:24 | Initial commit(create-expo-app 4.0.0 脚手架:16 文件 152 行) |
| 2 | `7eb6afd` | 09-18 11:16 | 第一版:RN 客户端 + 自建服务端 + CI(**4494 行**) |
| 3 | `b52da87` | 09-18 11:31 | 修 CI:仓库根即项目根,删掉错误的 `working-directory` 与 `setup-android` |
| 4 | `a5597d8` | 09-18 11:47 | 修 Android CI OOM:Gradle 内存调优插件 + 跳过 release lint |
| 5 | `f35f8ae` | 09-18 13:51 | 真机三问题:Android 明文 HTTP、键盘遮住输入框、安全区 |
| 6 | `546beea` | 09-18 14:36 | 树内 `Overlay` 修二级页面安全区 + 家长端补日期导航(+839/−462) |
| 7 | `10d6fa1` | 09-18 15:47 | 单行紧凑列表 + 周导航 |
| 8 | `af0b747` | 09-18 16:56 | 任务勾选完成、详情看全文、显示偏好 |
| 9 | `e8fcc2f` | 09-18 18:04 | iOS TestFlight 自用分发(签名工作流 + bundle id 改 `com.goxofy.homework`) |
| 10 | `0763240` | 09-18 23:29 | 修删除任务不能实时同步(广播漏 `date`)+ 冒烟测试 |
| 11 | `0cba372` | 09-19 01:22 | 修添加页留白割裂 + 补齐页面/弹层切换动画 |
| 12 | `fd683fc` | 09-19 12:54 | 移除 `ExportOptions` 里的 `compileBitcode` |
| 13 | `d292900` | 09-19 15:32 | 签名身份自动识别 + 凭据本地校验脚本(+ 自测) |
| 14 | `269c765` | 09-19 15:48 | build 号支持偏移量与手动指定 |
| 15 | `4d76f45` | 09-19 16:24 | 补 `NSPhotoLibraryUsageDescription` 过 ITMS-90683 |

### 阶段一:骨架(09-18 上午)

- **`7eb6afd`** 一次性搭起客户端 + 服务端 + CI:家长/儿童双端、房间号免账号、文字为主 + 语音转文字、分组持续生效、
  儿童端只读 + 历史回查、WebSocket 实时同步、Node 内置 sqlite 服务端(含 Dockerfile)、
  CI 出 Android APK 与 iOS unsigned IPA,以及服务端部署指南(systemd/Docker/Nginx HTTPS)与 ipa 侧载指南。
- **`b52da87`** 第一次 CI 运行**直接失败**:工作流按"项目在 `homework-app/` 子目录"写,加了 `defaults.run.working-directory`,
  但**仓库根就是项目根**,那个路径不存在 → 所有 run 步骤立即失败(28s / 18s 就挂了)。
  修法:去掉 `working-directory`、删掉多余的 `setup-android`(ubuntu-latest 已预装)、`paths` 与产物路径改为仓库根视角。
- **`a5597d8`** 接着 Android 侧 Gradle OOM → 插件调内存 + `-x lint`。
  (这一串失败在 CI 历史里都留着:`35302602030` 28s 失败、`35303523769` 9m3s 失败。)

### 阶段二:真机打磨(09-18 下午)

这一阶段的核心方法是**真机试、发现一个问题修一个问题**,而不是照着设计稿空想:

- **`f35f8ae`** 三个问题一次修:Android 明文 HTTP 被拦(§6.4)、键盘避让自己算(§6.2)、补 `SafeAreaProvider`(§6.3)。
- **`546beea`** 换掉 RN `Modal`(§6.1),顺手把服务器地址改成点击弹层输入、保存移到顶栏、
  家长端补日期导航、去掉重复分组入口、儿童端齿轮改带字按钮、预取最近 7 天让切日期即时可见。
- **`10d6fa1`** 一屏只能看 5–6 条 → 单行紧凑 + 周导航;两端分组标题统一为同一组件以消除 iOS/Android 外观差异。
- **`af0b747`** 单行紧凑的代价(看不到全文)用**详情弹层**补上:看全文、勾选完成、回放语音,家长端可编辑/删除;
  设置页加字号/行距档位。`done` 落在服务端 `tasks.done`,老库启动时自动补列。
- **`0cba372`** 视觉收尾:顶栏割裂 + 弹层退场动画(§6.6)。

### 阶段三:iOS 发布链路(09-18 晚 ~ 09-19)

- **`e8fcc2f`** 新增 `ios-signed.yml`:临时钥匙串注入证书与描述文件、自动算 build 号、产出可直接上传 TestFlight 的 ipa;
  同时把 bundle id 改为 `com.goxofy.homework`(需重新注册 App ID)并补出口合规声明。**上传仍由本机 Transporter 完成,凭证不进仓库。**
- **`0763240`** 靠孩子那台设备反馈发现"删除不同步"(§6.5)。
- **`fd683fc` → `d292900` → `269c765` → `4d76f45`** 这四连修全部来自**上传/构建过程中的真实报错**:
  bitcode 键被 Xcode 16 移除 → 证书名写死(§6.13)→ build 号撞车(§6.14)→ ITMS-90683(§6.15)。
  每一次都把**根因**写进了 commit message,这也是本文档 6.x 节的来源。
- 期间还修了 CI 脚本里中文全角括号吃变量名的问题(§6.8)。
- 最后实测:`1.0.0(4)` 的 ipa 解开后 `CFBundleVersion=4`、四条用途声明与 `ITSAppUsesNonExemptEncryption=0` 全部到位。

### 提交规范

- 类型前缀:`feat(ios)` / `fix(ios)` / `fix(ci)` / 无前缀的中文描述。
- 主题行说清**症状 + 根因**,正文用「现象 → 根因 → 修法」三段式,便于日后 `git log` 直接当排障手册读。
- 附带效应写在正文里(例:`fd683fc` 明确写"它的值本就是 false,删掉不影响产物")。

---

## 8. CI/CD 全解

### 8.1 三个工作流

| 工作流 | 文件 | 触发 | 运行环境 | 产物 |
|---|---|---|---|---|
| Android APK | `build-android.yml` | 手动 + push main(`src/**`、`App.tsx`、`app.json`、`package.json`、`bun.lock`、自身) | `ubuntu-latest` | `homework-release.apk`(**debug 签名,可直接安装**) |
| iOS unsigned IPA | `build-ios.yml` | 同上 | `macos-latest` | `homework-unsigned.ipa`(未签名,需侧载) |
| iOS signed IPA | `ios-signed.yml` | **仅手动 + `v*` tag**(凭证敏感) | `macos-latest` | `homework-ios-signed-ipa`(可直传 TestFlight) |

三个都带 `permissions: contents: write`(tag 推送时用 `softprops/action-gh-release` 把产物挂到 Release)。

### 8.2 为什么签名构建必须在 CI

- 本地 Mac 只需装 **Transporter** 上传;签名、归档、导出全在 CI(macos-latest 上的 Xcode 由 GitHub 维护,始终较新)。
- App Store Connect 现在要求用较新的 SDK(Xcode 16+ / iOS 18 SDK)构建,CI 自动满足;
  本机 Xcode 版本(现状 16.2,早期 15.4)不再成为卡点。
- 凭证只存在于 GitHub Secrets,不进仓库、不进本机钥匙串(CI 用的是临时钥匙串,`if: always()` 里 `security delete-keychain` 清理)。

### 8.3 签名工作流逐步拆解(`ios-signed.yml`)

```
① Check signing credentials   三条 secret 任一为空 → ::error:: 并退出(带中文提示去哪补)
② Setup Node 22 + 设置 MACOSX_DEPLOYMENT_TARGET
③ npm i -g bun && bun install --frozen-lockfile
④ Set iOS build number        见 8.4;用 node 把算出的号写进 app.json 的 expo.ios.buildNumber
                              (只改 CI 工作区里的临时文件,不进 git)
⑤ npx expo prebuild --platform ios --no-install
⑥ Import distribution certificate
     · security create-keychain / unlock / import(临时钥匙串,随机密码)
     · set-key-partition-list 让 codesign 能用这把私钥
     · 把临时钥匙串并入搜索列表,否则 codesign 找不到证书
     · security find-identity 读出**实际证书名** → SIGNING_IDENTITY
     · 名字不带 Distribution → 报错退出(挡掉开发证书)
⑦ Install provisioning profile
     · security cms -D 解码 → PlistBuddy 读 UUID/Name/TeamIdentifier/application-identifier
     · 复制到 ~/Library/MobileDevice/Provisioning Profiles/<UUID>.mobileprovision
     · **比对描述文件里的 bundle id 与 app.json 的 bundleIdentifier,不一致直接失败**
⑧ pod install
⑨ Write ExportOptions.plist     method=app-store-connect / signingStyle=manual /
                               teamID 取自描述文件 / provisioningProfiles 映射 bundleID → profile 名
⑩ xcodebuild archive           DEVELOPMENT_TEAM + CODE_SIGN_STYLE=Manual + CODE_SIGN_IDENTITY=$SIGNING_IDENTITY
                               + PROVISIONING_PROFILE_SPECIFIER + OTHER_CODE_SIGN_FLAGS=--keychain <临时钥匙串>
⑪ xcodebuild -exportArchive → dist/*.ipa
⑫ upload-artifact(名字 homework-ios-signed-ipa)+ tag 时挂 Release
⑬ if: always() security delete-keychain
```

**设计原则**:每一步失败都**带上可操作的原因**(缺哪个 secret、证书名不对、bundle id 不匹配),
而不是让日志停在 Xcode 一句 "Code signing failed"。

### 8.4 build 号策略(实战版)

```
build 号 = 手动输入的 build_number  ??  (github.run_number + 仓库变量 IOS_BUILD_OFFSET)
```

- 手动输入优先级最高,适合"我想指定某个号"或临时救场。
- `IOS_BUILD_OFFSET` 用来错开历史 build。本项目取值 **1**(首发时 App Store Connect 里已有 `1.0.0(1)`、`1.0.0(2)`,
  而工作流是第一次跑 run number = 1 → 得到 `1.0.0(3)`,之后 run 3 → 4、run 4 → 5,永久单调递增)。
- 规则:**只要保证 `run_number + offset ≥ 已发布最大 build 号 + 1`** 就不会撞。
- 非数字/小于 1 的输入**直接失败**(不生成"签名正确但传不上去"的包)。
- 换小版本(如 `1.1.0`)时 offset 可以不动 —— build 号只需在**同一版本号内**唯一。
- 版本号(`1.0.0`)走 `app.json` 的 `expo.version`,改完提交。
- run 页面的 **Summary** 会写明这次的 `版本 (build 号)` 以及来源(自动/手动)。

### 8.5 secrets / variables 清单(现状)

| 名称 | 类型 | 作用 | 现状 |
|---|---|---|---|
| `IOS_DIST_P12_BASE64` | secret | 分发证书(base64) | 已设置(09-19 07:34) |
| `IOS_DIST_P12_PASSWORD` | secret | p12 导出密码(明文存) | 已设置(09-19 07:34) |
| `IOS_PROFILE_BASE64` | secret | App Store 描述文件(base64) | 已设置(09-19 07:34) |
| `IOS_BUILD_OFFSET` | **variable** | build 号偏移量 | `1`(09-19 07:48) |

设置方式(两者等价,脚本更省事):

```bash
# 脚本:校验通过后直接推送(需要已登录的 gh CLI)
bash scripts/ios-credentials.sh ~/Desktop/distribution.p12 ~/Desktop/app.mobileprovision --set

# 手工
gh secret set IOS_DIST_P12_BASE64 < <(base64 -i distribution.p12)
gh variable set IOS_BUILD_OFFSET --body 1 --repo goxofy/homework-arrangement
```

### 8.6 凭据本地校验脚本(提交 CI 之前先验)

`scripts/ios-credentials.sh` + `scripts/ios-credentials.selftest.sh`(239 + 138 行):

- 检查项:描述文件是否 **App Store 分发**类型(不是 Ad Hoc/Development)、是否过期(剩余天数)、
  Bundle ID 是否与 `app.json` 一致、p12 **是否含私钥**、证书与描述文件**是否配对**、证书是否过期、
  证书是不是分发证书(开发证书会被拒)。
- 每条不过都**带原因停下**,每条都对应 CI 里会踩的坑。
- **全程只读**:不往登录钥匙串导入任何东西、不改项目文件,临时文件在 `mktemp -d` 里,退出即删。
- 自测用**合成的假证书**跑全部分支,不需要真实凭据 → 换证书或改脚本后可以随时复跑。
- 证书主体名是 `Apple Distribution: X` 还是 `iPhone Distribution: X` 都接受。

### 8.7 CI 历史(实测记录)

| run | commit | 结论 | 备注 |
|---|---|---|---|
| 35302602017 / 35302602030 | `7eb6afd` | ❌ 18s / 28s | `working-directory` 指向不存在的路径 |
| 35303523781 / 35303523769 | `b52da87` | ✅ / ❌ 9m3s | Android 侧还在 OOM |
| 35304522871 / 35304522821 | `a5597d8` | ✅ / ✅ 16m2s | Gradle 调优后首次通过(Android 最慢的一次) |
| …(中间全部 ✅)… | | | APK 9–16 分钟,unsigned IPA 4–12 分钟 |
| 35431910890 | `4d76f45` | ✅ 6m26s | **签名构建,产出 `1.0.0(4)`**(已解 ipa 复核) |

---

## 9. iOS 签名与发布链路

### 9.1 角色与约束(这是本项目最绕的部分)

| 角色 | 是谁 | 有什么权限 |
|---|---|---|
| 团队(App Store Connect) | **朋友的个人开发者账号** | 账号持有者;能进 Certificates, Identifiers & Profiles |
| 你 | 被邀请的 **Admin** | 能建 App 记录、传 build、管 TestFlight;**个人账号邀请的成员拿不到证书/描述文件入口** |

因此:**证书、App ID、描述文件只能朋友本人操作**;你负责建 App 记录、跑 CI、上传、管理测试。

### 9.2 一次性准备(只有证书持有者能做)

在 [developer.apple.com/account](https://developer.apple.com/account) → Certificates, Identifiers & Profiles:

1. **Identifiers → ＋ → App IDs → App**,Bundle ID 选 *Explicit*,填 `com.goxofy.homework`
2. **Certificates → ＋ → Apple Distribution**(或 **iOS Distribution**,两者都能用于 App Store / TestFlight,
   工作流会自动识别实际名称,不需要为了它重新签发)
   - 需要 CSR:钥匙串访问 → 证书助理 → 从证书颁发机构请求证书 → 存到磁盘后上传
   - 生成后下载 `.cer` → 双击装进钥匙串 → 右键**导出** `.p12`(设密码,**必须带私钥**)
   - 个人账号每团队分发证书有上限(历史上 3 张),占满要先吊销一张
3. **Profiles → ＋ → Distribution → App Store**,选上面的 App ID + 刚生成的证书 → 下载 `.mobileprovision`
4. 交付三样:**`.p12` + 密码 + `.mobileprovision`**(Team ID 由工作流从描述文件里自己读)

> 这是分发凭证:**别提交进 git**(`.gitignore` 已含 `*.p12` / `*.p8` / `*.key` / `*.mobileprovision`)。
> 签名散件应放在仓库之外、权限受限的本机目录中;文档不记录真实文件名、持有人姓名或 Team ID。
> 另请证书持有者在有效期内不要吊销这张证书(过期或被吊销后要重新走一遍)。

### 9.3 出包 → 上传 → 内测

```
① Actions → iOS signed IPA (TestFlight) → Run workflow(或打 v* tag)
② 下载产物 homework-ios-signed-ipa(或 gh run download <run-id> --name homework-ios-signed-ipa --dir ./tf-build)
③ Mac App Store 装 Transporter → 打开 → Apple ID 登录 → 把 ipa 拖进去 → Deliver
④ 等 5–15 分钟:App Store Connect → TestFlight → 内部测试 → 建测试组把自己加进去
⑤ iPhone/iPad 装 TestFlight App → 接受邀请 → 安装
```

前提补充:

- **上传前必须已有 App 记录**:App Store Connect → Apps → ＋ → New App,名称随意,Bundle ID 选 `com.goxofy.homework`。
  Admin 通常能自己建;若「＋」是灰的(个人账号对建 App 记录有限制),让朋友建一次。
- **内部测试不需要审核**(也不涉及备案);**build 有效期 90 天**,过期重跑工作流重传即可;内部测试员上限 100 人。

### 9.4 Transporter 到底是什么(实测结论)

Transporter **不是 Xcode 组件,也不是 developer.apple.com 的下载项**,而是 **Mac App Store 上一个独立的免费 App**
(开发者标为 Apple,分类 Developer Tools)。但它的 GUI 外壳里**装的正是命令行工具** —— 拆开本机 `/Applications/Transporter.app` 实测:

| 里面有什么 | 路径 | 版本 |
|---|---|---|
| **iTMSTransporter**(GUI 在背后调的引擎) | `Contents/itms/bin/iTMSTransporter` | 2025-04 构建 |
| **自带 Java 运行时**(不用另装 Java) | `Contents/itms/java/bin/java` | OpenJDK 21 |
| **自带 altool** | `Contents/Frameworks/ContentDeliveryServices.framework/Versions/A/Frameworks/AppStoreService.framework/Versions/A/Support/altool` | **10.001.27001**(CD version 27.0.5) |
| Transporter.app 本身 | `/Applications/Transporter.app` | 1.4.5 |
| Xcode 里的 `xcrun altool` | — | 7.x(比上面旧不少) |
| Xcode 里的 `xcrun iTMSTransporter` | 只是个 symlink → `ContentDelivery.framework/.../TransporterShim` | 转发器 |

**结论**:装 Transporter 这个动作顺带装上了新版 altool + iTMSTransporter + JRE。
"Transporter 只能 GUI 拖动"是误解,但 Apple 官方为"上传 build"背书的 CLI 只有 **`altool`**
(他们的原话是 *Xcode、Swift Playground、altool 或 Transporter*);`iTMSTransporter` 虽能用、fastlane 也一直在用,
但它是 Transporter 的内部引擎,**Apple 不承诺接口稳定**。

### 9.5 命令行上传的两种认证方式

CLI **没有交互式双重验证**,所以只有两条路:

**① Apple ID + App 专用密码**(不需要 API Key,立刻能用)

```bash
ALTOOL=/Applications/Transporter.app/Contents/Frameworks/ContentDeliveryServices.framework/Versions/A/Frameworks/AppStoreService.framework/Versions/A/Support/altool
# 先在 appleid.apple.com → App 专用密码 生成一个(形如 abcd-efgh-ijkl-mnop)
"$ALTOOL" --upload-app -f /tmp/hw-ipa/app.ipa -t ios \
  -u 你的AppleID --asc-provider 你的ProviderID
# 不加 -p 会交互式提示密码 → 密码不进 shell 历史
```

⚠️ **坑**:如果是其他账号团队下的成员,必须加 `--asc-provider`(Provider ID)。
不知道就用 `"$ALTOOL" --list-providers -u 你的AppleID` 列出来;不加会报"无法确定 provider"。
真实 Provider ID 应从本机凭据或 App Store Connect 查询,不要写进公开仓库文档。

**② App Store Connect API Key(`.p8`)** —— 不需要 provider 参数、不需要 App 专用密码,
即可自动化上传,是目前**唯一推荐**的 CI 自动化路径(代价:把密钥放进 GitHub Secrets)。

> 如果只是偶尔手动上传,GUI 拖拽仍然是最省心的;要做成"完全自动发布",绕不开一把 `.p8`。

### 9.6 ITMS 报错速查(本项目真实遇到过的)

| 码 | 含义 | 根因与本项目处置 |
|---|---|---|
| `ITMS-4238` | 同一版本号下 build 号重复 | `run_number` 与已发布 build 数无关 → 引入 `IOS_BUILD_OFFSET`(§6.14) |
| `ITMS-90683` | Info.plist 缺少用途声明 | `expo-file-system` Legacy 里的 `PHPhotoLibrary` 符号 → 补 `NSPhotoLibraryUsageDescription`(§6.15) |
| — | Xcode 16 移除 bitcode | `ExportOptions.plist` 删掉 `compileBitcode`(§6.16) |

排查思路:**报错码 → 是不是我们写的代码?→ grep 依赖里的敏感 API 引用 → 补声明或改配置 → 重新构建+上传**。
`ITMS-90683` 有可能是**警告**(build 仍可用)、也可能拦下,社区说法不一 —— 但既然要重传,直接补声明跳过这个疑问即可。

---

## 10. 隐私、安全与合规

### 10.1 Info.plist 用途声明(现状,已实测在 ipa 里)

| 键 | 值(摘要) | 来源 |
|---|---|---|
| `NSPhotoLibraryUsageDescription` | 用于选择自己的作业照片/音视频作为附件;**仅供内置文件系统模块要求** | 我们的代码(`expo-image-picker`)+ 依赖符号(`expo-file-system`) |
| `NSMicrophoneUsageDescription` | 录制作业语音讲解附件 | `expo-audio` |
| `ITSAppUsesNonExemptEncryption` | `0`(false) | 出口合规,上传后不用再回答 |

相机、定位、通讯录、日历、蓝牙、运动、ATT、健康、音乐库:**无任何引用,不需要声明**。

### 10.2 安全边界(README 与 server/README 已写明)

- **房间号即唯一凭据**(8–32 位字母/数字/连字符,正则 `^[A-Za-z0-9-]{8,32}$`)。接口按房间号隔离数据;
  房间号别外泄(附件下载地址形如 `/api/rooms/:code/media/:id`,房间号就是凭证)。
- **服务端未做速率限制**;暴露公网建议在 Nginx 层加 `limit_req`。
- **明文 HTTP 的风险**:局域网用没问题;公网(4G/5G 下看作业)强烈建议 HTTPS(Nginx + certbot),
  否则明文可能被运营商/中间设备篡改或拦截。Android 端已显式放行明文(否则连不上家里服务器,见 §6.4),iOS 侧系统放行局域网 http。
- **权限约定**:完成状态两端都可写(`PUT .../tasks/:tid` 带 `{done}`);**内容编辑/删除客户端只有家长端有入口**(服务端未做角色鉴权,这是"家庭内自用"的取舍)。
- 上传上限全部在服务端强制(见 §5.4),不是只靠客户端拦。

### 10.3 数据归属

- 所有数据在**自己家的服务器**:`data/`(SQLite + 语音 + `data/media/` 附件),备份就是 `tar` 这个目录。
- 不上传任何云服务;附件到期自动清理,不在服务器永久囤积。
- 换设备/换身份:设置页可改服务器、换房间、切换家长↔儿童。

---

## 11. 当前状态与未完成事项

### 11.1 已发布状态

| 项 | 值 |
|---|---|
| 最新签名 build | **`1.0.0(4)`**(run `35431910890`,2026-09-19 08:24) |
| ipa 实测 | `CFBundleIdentifier=com.goxofy.homework`、`CFBundleShortVersionString=1.0.0`、`CFBundleVersion=4`、四条用途声明齐、`ITSAppUsesNonExemptEncryption=0` |
| ipa 校验方式 | `gh run download 35431910890 --name homework-ios-signed-ipa` 下载后解开 `Info.plist` 逐项比对(当时放在 `/tmp/hw-ipa/`,`/tmp` 会被系统清理,需要时重新下载) |
| 遗留 | build 3 已在 App Store Connect 里(上传 4 之后可删掉,避免自己装错版本) |
| 工作流状态 | 三条工作流全绿;`IOS_BUILD_OFFSET=1` |

### 11.2 附件功能的版本保护

作业资料功能已在保护性提交中进入 Git,并推送到独立功能分支;不会再因为清理未跟踪文件而丢失。
后续图片附件加固和未来日期改动应继续在功能分支验证后再合并,不要直接覆盖线上 `main`。

当前产品约定:

- 新增附件支持图片、录音和普通文件;视频保留历史数据展示兼容,暂不新增上传。
- 服务端附件默认保留 7 天,配置只能缩短,不能超过 7 天。
- 客户端缓存下载文件会校验大小,避免把不完整文件当成有效副本。

### 11.3 验证手段(可复跑)

| 手段 | 命令 | 说明 |
|---|---|---|
| 类型检查 | `cd homework-app && npx tsc --noEmit` | **2026-10-16 实测通过(exit 0)**,含未提交改动 |
| 迁移自测 | `cd server && node test-migrate.mjs` | 用 `/tmp` 里的模拟老库验证自动补列,**不动 `data/`** |
| 同步冒烟 | `node server/test-delete-sync.mjs` | 连真实 WebSocket 校验四种广播 + 并发冲突 |
| 附件冒烟 | `node server/test-media.mjs` | 附件上传/下载/过期(未跟踪文件) |
| 凭据自测 | `bash scripts/ios-credentials.selftest.sh` | 合成假证书跑全部分支 |
| 产物校验 | `unzip -o app.ipa -d /tmp/ipa-check` 后 `plutil -p /tmp/ipa-check/Payload/*.app/Info.plist` | 上传前确认 build 号与用途声明 |

> 项目**没有单元测试框架**(没有 jest/vitest),验证靠类型检查 + 这几个 Node 冒烟脚本 + 真机。

### 11.4 本机环境(2026-10-16 实测)

| 项 | 值 |
|---|---|
| macOS | 14.8.3(23J220) |
| Xcode | 16.2(16C5032a) |
| Transporter | `/Applications/Transporter.app` 1.4.5 |
| 仓库根 | 项目 checkout 根目录 |
| 签名散件(仓库外) | 存放在权限受限的本机目录;不在仓库记录真实路径或文件名 |

---

## 12. 运维与故障排查手册

### 12.1 App 连不上服务器(按顺序查)

1. 用手机浏览器打开服务器地址的 `/api/health`,能返回 `{"ok":true}` → 网络通,问题在 App 侧;
   打不开 → 网络/地址/服务端问题。
2. App 的报错会带上它**实际请求的地址**(`api.ts` 里特意拼进去的),先核对地址有没有写错。
3. Android 专用:确认构建时 `usesCleartextTraffic` 已生效(§6.4),并且**是重新安装的包**,不是热更新。
4. 不在同一局域网:要么把服务暴露到公网(HTTPS + 防火墙),要么让手机连回家里的网(VPN/WireGuard)。
5. 服务器地址填好会**自动记住**(AsyncStorage),之后可在「设置」里改,**不需要改源码**。

### 12.2 孩子打不开作业资料

1. 先看 `GET /api/stats`:`media`(有效附件数)、`expired_media`(已过期条目)、`media_ttl_days`。
2. 如果已过期且孩子当时没打开过这一天 → 文件已被删,详情里显示「已过期」是**预期行为**(作业文字仍在)。
3. 如果还在有效期内却打不开 → 查服务器 `data/media/` 里文件是否存在、`/api/rooms/:code/media/:mid` 是否返回 410/404。
4. 能确认已在 iPad 上打开过这一天 → 本机 `document/homework-media/` 里应有副本,服务器删了也能看。

### 12.3 服务端升级

覆盖代码 → 重启即可,不需要手跑迁移(建表 `IF NOT EXISTS`,新列用 `ensureColumn` 自动 `ALTER TABLE`)。
升级前可先跑 `node test-migrate.mjs` 验证迁移逻辑(用模拟老库,不动真实数据)。
备份:`tar czf homework-backup-$(date +%F).tar.gz data/`(SQLite 开了 WAL,备份前最好停服务或用 `.backup`)。

### 12.4 CI 常见失败对照

| 现象 | 原因 | 处置 |
|---|---|---|
| 构建一开始就失败并提示缺少 secret | 仓库里没有那三条签名 secret | 跑 `scripts/ios-credentials.sh ... --set` |
| `p12 里没有可用的签名身份` | 导出 p12 时没带私钥 | 钥匙串访问里展开证书确认下面挂着私钥,重新导出 |
| `导入的是 "Apple Development: ...",不是分发证书` | 拿错了开发证书 | 要 App Store 分发证书 |
| `描述文件的 bundle id (X) 与 app.json 的 (Y) 不一致` | 描述文件与 App 不匹配 | 让证书持有者按 `app.json` 的值重新注册 App ID + 描述文件 |
| 上传被拒 `ITMS-4238` | build 号重复 | 提高 `IOS_BUILD_OFFSET` 或手动指定 build 号 |
| 上传后报 `ITMS-90683` | Info.plist 缺用途声明 | 见 §6.15 |
| Android 构建 OOM | Gradle 内存不足 | 已由 `withAndroidBuildTuning` 插件 + `-x lint` 处理 |

---

## 13. 换一个新 App 复用这套设施

**结论一句话:证书属于"团队",描述文件属于"某一个 App"。**

Apple 官方两句话定死:

- 证书页:*Distribution certificates belong to the **team**… only one type of each distribution certificate is allowed per team.*
- 描述文件页:*Uploading an app to App Store Connect requires an app record registered with an **explicit App ID**.
  An App Store provisioning profile contains a **single** distribution certificate.*

| 手上的东西 | 做第二个 App 时 | 说明 |
|---|---|---|
| **p12**(团队分发证书 + 私钥) | ✅ **直接复用** | 同一团队下所有 App 都用它签,不用重新生成 |
| **p12 密码** | ✅ 复用 | 只是导出时自己设的压缩密码,与 Apple 无关 |
| **mobileprovision** | ❌ **必须新建** | 绑死在 `com.goxofy.homework` 这一个 bundle ID 上 |

增量工作:① 注册新的**显式 App ID** → ② 为它建新的 **App Store 分发描述文件**(证书选**同一张**,不用新 CSR、不用再导 p12)
→ ③ App Store Connect 建新的 **App 记录**。

⚠️ 现实约束:个人账号下描述文件入口只有 Account Holder 能进,所以第 ② 步**仍然得麻烦朋友**(两分钟,不用再导出任何 p12)。
也**不要**为了图省事重复创建证书 —— 每团队分发证书有上限(历史上 3 张),复用同一张才不会哪天撞到上限。

**CI 侧要改的地方**:

| 场景 | 要动什么 |
|---|---|
| 新 App 放**另一个仓库** | 在那边重设三条 secret:`IOS_DIST_P12_BASE64` / `IOS_DIST_P12_PASSWORD` **复制过来即可**(证书相同),`IOS_PROFILE_BASE64` 换新 profile;`IOS_BUILD_OFFSET` 也要按同样思路设(新仓库第一次跑 `run_number=1`,会撞已有的 build) |
| 新 App 放**同一个仓库** | 不能共用 `IOS_PROFILE_BASE64`,需要改成"每个 App 一份 profile secret + 触发时选择哪个 App"(工作流目前没做这件事) |

**已有的安全网**:工作流会读描述文件里的 bundle id 与 `app.json` 的 `bundleIdentifier` 比对,
不一致**直接带原因失败** —— 贴错 profile 是"报错停下来",而不是"产出一个签错名的包白传一遍"。

---

## 14. 命令速查与术语表

### 14.1 常用命令

```bash
# ---- 本地开发 ----
cd homework-app
bun install
npx expo run:android        # 需要 Android Studio/ADB
npx expo run:ios            # 需要 Mac + Xcode
npx tsc --noEmit            # 类型检查(验证改动的最小闭环)

# ---- 服务端 ----
cd server && PORT=8787 node src/index.js
MEDIA_TTL_DAYS=3 node src/index.js       # 缩短附件保留期(方便本地验证过期)
curl http://127.0.0.1:8787/api/health
curl http://127.0.0.1:8787/api/stats
node test-migrate.mjs                    # 迁移自测(不动真实 data/)
docker build -t homework-server . && docker run -d -p 8787:8787 -v homework-data:/app/data --restart unless-stopped homework-server

# ---- CI ----
gh workflow run ios-signed.yml --repo goxofy/homework-arrangement           # 触发签名构建
gh run list --repo goxofy/homework-arrangement --limit 10
gh run watch <run-id> --repo goxofy/homework-arrangement
gh run download <run-id> --repo goxofy/homework-arrangement --name homework-ios-signed-ipa --dir ./tf-build

# ---- iOS 凭据 ----
bash scripts/ios-credentials.sh ~/Desktop/distribution.p12 ~/Desktop/app.mobileprovision          # 只校验
bash scripts/ios-credentials.sh ~/Desktop/distribution.p12 ~/Desktop/app.mobileprovision --set    # 校验并推送 secret
bash scripts/ios-credentials.selftest.sh                                                          # 脚本自测
gh variable set IOS_BUILD_OFFSET --body 1 --repo goxofy/homework-arrangement

# ---- 校验产物 ----
unzip -o homework-ios-signed-ipa/*.ipa -d /tmp/ipa-check
plutil -p /tmp/ipa-check/Payload/*.app/Info.plist | grep -E 'CFBundleVersion|CFBundleIdentifier|UsageDescription'
```

### 14.2 术语表

| 术语 | 含义 |
|---|---|
| **房间号(roomCode)** | 8–32 位字母/数字/连字符;无账号体系下的唯一关联凭据 |
| **分组(subject)** | 语文/数学/英语/其他 这类科目分组;删除是**归档**,历史任务仍显示原分组 |
| **附件(media)** | 挂在一条作业下的图片/语音/视频/文件;**服务器只暂存 7 天** |
| **本机缓存** | `document/homework-media/`,儿童端翻到那一天自动下载并长期保留 |
| **`Overlay`** | 自研的树内全屏弹层组件(替代 RN `Modal`,见 §6.1) |
| **`Screen`** | 页面容器,由 `edges` 决定避让哪几边安全区 |
| **build 号** | App Store Connect 内同一版本号下必须唯一;由 `run_number + IOS_BUILD_OFFSET` 或手动指定 |
| **profile(描述文件)** | 把一个显式 App ID 与一张分发证书绑定,**每个 App 一份** |
| **p12** | 导出后的分发证书 + 私钥,**团队级可复用** |
| **Admin 角色** | App Store Connect 里的管理角色;个人账号下**没有** Certificates 入口 |
| **Transporter** | Mac App Store 的免费上传工具;内含 `iTMSTransporter` / `altool` / JRE |
| **altool** | Apple 官方背书的命令行上传工具;需 App 专用密码或 ASC API Key |

---

## 15. 后续规划

README 里已列出的方向:

- 房间内家长/儿童文字/语音聊天
- 家长导入钉钉作业截图 → **OCR + 语义切分** → 确认后一键添加
- **附件永久保存开关**(不走 7 天暂存)
- 极端方言口音下的识别准确度(保存前可修改,当前用系统识别:中文效果好且免费)

工程上值得做的:

- 把附件功能(WIP,§11.2)**提交进 git** —— 目前是最大的风险点
- 全自动发布:申请 **App Store Connect API Key(`.p8`)**,把上传也搬进 CI(目前上传是手工 Transporter 拖拽)
- 服务端限流(Nginx `limit_req`)与可选的角色鉴权(区分家长/儿童写权限)
- 同一仓库承载多个 App 的签名改造(§13)
- 为客户端引入最基础的测试(哪怕只是纯函数:`dates.ts`、`mediaExt`、`safeFileName`)

---

*本文档基于仓库实际代码、git 历史、GitHub Actions 运行记录与本机实测结果整理;
文中"实测"字样均指当场跑过命令并看过输出。*
