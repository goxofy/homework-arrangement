# 今日作业 (homework-app)

家长布置作业、儿童查看作业的跨平台 App(iOS iPhone/iPad + Android)。

- **家长端**(iPhone/Android):当日作业列表(按 语文/数学/英语/其他 分组)、**文字录入为主**、语音说话自动转文字(辅助)、分组配置(配置一次长期生效)、编辑/删除
- **儿童端**(iPad 为主):当日作业大字展示、语音回放、**回查历史日期**、只读不可修改
- **无账号系统**:家长指定 ≥8 位房间号,双方输入同一房间号即关联,支持多组家庭同时使用
- **自建服务端**:Node.js(内置 sqlite,零原生依赖)+ REST + WebSocket 实时同步
- **CI 构建**:GitHub Actions 自动出 Android APK + iOS unsigned IPA

## 目录结构

```
homework-app/
├── App.tsx               # 根组件与页面路由
├── app.json              # Expo 配置(权限、平板、插件)
├── .github/workflows/    # GitHub Actions(APK / unsigned IPA)
├── src/
│   ├── AppContext.tsx    # 身份/分组/任务全局状态 + WebSocket 同步
│   ├── api.ts            # 服务端 API 封装
│   ├── speech.ts         # 语音识别 hook(expo-speech-recognition)
│   ├── storage.ts        # 本地持久化(AsyncStorage + 服务器地址记忆)
│   ├── dates.ts          # 本地时区日期工具
│   ├── theme.ts / ui.tsx # 主题与通用组件
│   └── screens/
│       ├── WelcomeScreen.tsx     # 选家长/儿童 + 填服务器地址(记住)
│       ├── JoinRoomScreen.tsx    # 输入房间号(家长可创建/加入)
│       ├── ParentHomeScreen.tsx  # 家长首页:分组列表 + 添加(文字+语音)
│       ├── SubjectsScreen.tsx    # 分组配置(持续生效)
│       ├── ChildHomeScreen.tsx   # 儿童首页:大字+历史回查+语音播放
│       └── SettingsScreen.tsx    # 设置:服务器/房间号/切换身份
└── server/               # 自建同步服务端(部署文档见 server/README.md)
```

## 快速开始

### 1. 部署服务端

见 **[server/README.md](server/README.md)**(支持裸 Node / systemd / Docker / Nginx+HTTPS,含数据备份说明)。

### 2. 构建 App

三种方式任选:

**A. GitHub Actions(推荐,无需本地环境)**

推送或手动触发工作流:
- `Android APK`:产出 `homework-release.apk`(debug 签名,可直接安装)
- `iOS unsigned IPA`:产出 `homework-unsigned.ipa`(未签名,需侧载,见下文)

在 Actions 页面 → 选工作流 → **Run workflow** 手动触发;推送 main 也会自动触发(客户端文件有变动时)。

**B. 本地构建**

```bash
cd homework-app
bun install        # 或 npm install

npx expo run:android   # 需要 Android Studio/ADB
npx expo run:ios       # 需要 Mac + Xcode
```

**C. EAS 云构建(需要 Expo 账号)**

```bash
npm i -g eas-cli
eas build --platform all --profile development
```

> 注意:因为用了原生麦克风 + 系统语音识别,**不能用 Expo Go 运行**。

### 3. 安装到设备

**Android**:直接安装 APK(首次需允许"安装未知应用")。由于是 debug 签名,覆盖安装需保持同一签名,卸载重装不影响服务器数据。

**iOS(unsigned IPA 侧载,免开发者账号)**

ipa 未签名,需通过侧载工具安装到 iPhone/iPad:

| 工具 | 适用 | 特点 |
|------|------|------|
| **AltStore / SideStore** | iPhone/iPad | 免费苹果账号即可,7 天需刷新(用电脑端 AltServer 自动刷新);SideStore 支持设备内刷新 |
| **Sideloadly** | iPhone/iPad | Windows/Mac 工具,用免费 Apple ID 签名安装 |
| **TrollStore** | 老系统设备 | 支持的系统版本上永久有效(取决于设备系统版本) |
| **Apple 开发者账号 + Xcode** | 有账号 | `xcodebuild` / AltStore 签名,或用爱思助手等 |

以 AltStore 为例:
1. 下载 Actions 产物 `homework-unsigned.ipa` 到电脑
2. 电脑安装 AltServer,手机安装 AltStore(同一 WiFi)
3. 手机打开 AltStore → `+` → 选择 ipa → 用你的 Apple ID 签名安装
4. 首次打开若提示"未受信任的企业开发者",到 设置→通用→VPN与设备管理 里信任你的 Apple ID

免费 Apple ID 签名 7 天过期,过期后重复安装即可(数据在服务器,不影响作业记录)。

### 4. 日常使用

1. **家长**(手机):首次打开选「我是家长」→ 填服务器地址(如 `192.168.1.10:8787`,填一次会记住)→ 创建房间(手动指定或随机生成 ≥8 位房间号)
2. **儿童**(iPad):选「我是儿童」→ 填同一服务器地址 → 输入同一房间号 → 加入
3. 家长点「＋ 添加作业」:**直接打字输入**;或点「🎤 说话转文字」辅助输入,识别结果可修改后保存
4. 「分组」页可新增/改名/归档分组,配置一次后续每天沿用
5. 孩子在 iPad 上看今天作业、点语音回放,也可回看之前任意日期(不能看未来,不能修改)
6. 换设备/换身份:设置页可改服务器、换房间、切换家长↔儿童

## 服务端 API 一览(供后续扩展)

```
POST /api/rooms                          创建房间 {code}
GET  /api/rooms/:code                    房间信息+分组
GET  /api/rooms/:code/subjects           分组列表
POST /api/rooms/:code/subjects           新增分组 {name,color}
PUT  /api/rooms/:code/subjects/:sid      改分组 {name,color}
DELETE /api/rooms/:code/subjects/:sid    归档分组
GET  /api/rooms/:code/tasks/:date        某日任务
POST /api/rooms/:code/tasks              加任务 {date,subject_id,content,audio_base64?,audio_mime?}
PUT  /api/rooms/:code/tasks/:tid         改任务 {content,subject_id}
DELETE /api/rooms/:code/tasks/:tid       删任务
GET  /api/rooms/:code/audio/:tid         下载语音
WS   /ws?room=CODE                       实时广播 tasks_changed/subjects_changed
```

## 已知边界与后续规划

- 语音识别用系统自带能力(iOS 听写 / Android 语音服务),中文效果好且免费;极端方言口音可能转写不准,保存前可修改
- 房间号即凭据(无账号),请勿外泄;同一房间多台儿童 iPad 可同时查看
- 规划中:房间内家长/儿童文字/语音聊天;家长导入钉钉作业截图 → OCR+语义切分 → 确认后一键添加
