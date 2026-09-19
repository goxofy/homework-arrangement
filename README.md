# 今日作业 (homework-app)

家长布置作业、儿童查看作业的跨平台 App(iOS iPhone/iPad + Android)。

- **家长端**(iPhone/Android):按 语文/数学/英语/其他 分组展示**任意日期**(上周/下周 + 本周七天)、**文字录入为主**、语音说话自动转文字(辅助)、分组配置(配置一次长期生效)、编辑/删除
- **儿童端**(iPad 为主):作业大字展示、语音回放、**回查历史日期**、不改作业内容
- **任务勾选完成**:家长端和儿童端都能给每条作业打勾(任务前的圆圈),打完勾自动加**删除线**并统计「已完成 x/y」
- **看完整内容**:列表每条只占一行(保持紧凑),内容过长会省略;点任务文字进入**详情弹层**可看全文、勾选完成、回放语音(家长端还能直接编辑/删除)
- **显示偏好**:设置页可调**字号**(小/标准/大/特大)和**行距紧凑度**(紧凑/标准/宽松),只影响本机显示
- **同一套界面骨架**:家长端/儿童端共用日期导航与安全区/键盘避让逻辑,两端行为一致(都不能翻到未来)
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
│   ├── keyboard.ts       # 键盘避让高度(Android 15+ edge-to-edge 必须自己算)
│   ├── ServerField.tsx   # 服务器地址:行 + 点击弹出的输入层
│   ├── theme.ts / ui.tsx # 主题、Screen/Overlay/TopBar/DateNav 等通用组件
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
- `iOS signed IPA (TestFlight)`:产出**已签名**的 ipa,用于上传 TestFlight(只手动触发/tag 触发,需要签名凭证,见下文)

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

## 网络说明(连不上时先看这里)

- **服务器地址在 App 里填写**(欢迎页底部),会自动记住,之后在「设置」里可改,**不需要改源码**。
- **Android 已显式放行明文 HTTP**(`app.json` 里 `expo-build-properties.android.usesCleartextTraffic`)。原因:Android 9 以上默认拦截 `http://` 请求,而家庭自建服务通常就是 `http://192.168.x.x:8787`,不放行的话 Android 端会一直报「无法连接服务器」(iOS 因为系统放行局域网 http,所以看起来是好的)。
- 改过 `app.json` / 原生配置后**必须重新构建并重新安装 App**,只重新加载 JS 不生效。
- 想用公网访问(4G/5G 下看作业)**强烈建议配 HTTPS 域名**(见 [server/README.md](server/README.md) 的 Nginx 示例):明文 HTTP 在公网上会被运营商/中间设备篡改或拦截。
- 排障:App 的报错会带上它**实际请求的地址**,先用手机浏览器打开该地址的 `/api/health`,能返回 `{"ok":true}` 说明网络通、问题在 App 侧;打不开就是网络/地址/服务端问题。
- 手机和服务器不在同一个局域网时,要么把服务暴露到公网(记得加 HTTPS + 防火墙),要么让手机连回家里的网络(如 VPN/WireGuard)。

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

> 如果你能拿到 App Store Connect 团队的 Admin 角色(见下文),更省事的做法是走 **TestFlight 内测**:签名有效期内不用刷新,装一次能一直用到 build 过期。

### 4. 日常使用

1. **家长**(手机):首次打开选「我是家长」→ 填服务器地址(如 `192.168.1.10:8787`,填一次会记住)→ 创建房间(手动指定或随机生成 ≥8 位房间号)
2. **儿童**(iPad):选「我是儿童」→ 填同一服务器地址 → 输入同一房间号 → 加入
3. 家长点「＋ 添加作业」:**直接打字输入**;或点「🎤 说话转文字」辅助输入,识别结果可修改后保存
4. 家长端右上角「分组」:新增/改名/归档分组,配置一次后续每天沿用(全 App 只有这一个分组入口)
5. 家长端/儿童端都用同一套周导航:「‹ 上一周 / 下一周 ›」+ 周一到周日七个按钮(有作业的日子带小圆点),回看历史作业,不能翻到未来
6. 每条作业前面的圆圈点一下 = 标记完成(加删除线,分组标题会显示「已完成 x/y」);家长和孩子**两端都能打勾,状态实时同步**
7. 作业文字太长被省略号截断时,点任务文字进入详情页看全文(儿童端在详情里也能播放语音)
8. 不想一屏只能看几条?设置页 →「显示偏好」调字号/行距(家长端、儿童端各自设置本机)
9. 换设备/换身份:设置页可改服务器、换房间、切换家长↔儿童

## iOS 自用发布到 TestFlight(不上架 App Store)

TestFlight 只收**已签名**的 ipa;而且 App Store Connect 现在要求用 Xcode 16+/iOS 18+ SDK 构建,所以签名构建放在 CI(CI 上的 Xcode 是新的),你的 Mac 只需要装一个 **Transporter** 来上传。

前提:你的 Apple ID 已经被 App Store Connect 团队邀请,角色是**管理(Admin)**;订阅是对方的**个人**开发者账号。

### 一次性准备(只有证书持有者能做)

朋友在 [developer.apple.com/account](https://developer.apple.com/account) → Certificates, Identifiers & Profiles:

1. **Identifiers → ＋ → App IDs → App**,Bundle ID 选 *Explicit*,填 `com.goxofy.homework`
2. **Certificates → ＋ → Apple Distribution**(或 **iOS Distribution** —— 二者都能用于 App Store / TestFlight:前者是 2020 年后 Apple 的统一分发证书,后者只覆盖 iOS/iPadOS 但同样有效。工作流会自动识别证书实际名称,不用为了它重新签发)
   - 需要 CSR:在他 Mac 上「钥匙串访问 → 证书助理 → 从证书颁发机构请求证书」,存到磁盘后上传
   - 生成后下载 `.cer`,双击装进钥匙串 → 钥匙串里右键这张证书 → **导出** → 存成 `.p12`(设个密码)
   - 个人账号最多 3 张分发证书,若已满会要求先吊销一张
3. **Profiles → ＋ → Distribution → App Store**,选上面的 App ID + 刚生成的证书 → 下载 `.mobileprovision`
4. 把三样东西给你:**`.p12` 文件 + 它的密码 + `.mobileprovision`**(Team ID 由工作流自己从描述文件里读)

> 这是分发凭证,别提交进 git。请他一年内不要吊销这张证书(过期或被吊销后要重新给一份)。
> 另外:个人账号邀请的成员拿不到证书/描述文件入口,所以上面几步只能他做;你在 App Store Connect 里建 App 记录、传 build、管 TestFlight 都没问题。

### 校验凭据 + 配置 GitHub Secrets

拿到三个文件后,先在本地验一遍(**强烈建议** —— 否则要等 10 分钟 CI 才知道证书有问题):

```bash
cd homework-app
bash scripts/ios-credentials.sh ~/Desktop/distribution.p12 ~/Desktop/app.mobileprovision
# 会提示输入 p12 密码(不回显)
```

它会检查:描述文件是不是 **App Store 分发**类型(不是 Ad Hoc/Development)、有没有过期、Bundle ID 是否和 `app.json` 一致、p12 **是否含私钥**、证书和描述文件**是否配对**、证书是否过期、证书是不是「分发」证书(开发证书会被拒)。任一不过就带着原因停下来,每条都对应 CI 里会踩的坑。

> 证书主体名是 `Apple Distribution: X` 还是 `iPhone Distribution: X` 都行,两者都是合法的 App Store 分发证书;CI 会读证书的实际名称再签名。

全绿后,三条 secret 一条命令推上去(需要已登录的 `gh CLI`;不加 `--set` 则只打印出网页上要填的值):

```bash
bash scripts/ios-credentials.sh ~/Desktop/distribution.p12 ~/Desktop/app.mobileprovision --set
```

> 手工填的话是这三条(仓库 → Settings → Secrets and variables → Actions):`IOS_DIST_P12_BASE64`、`IOS_DIST_P12_PASSWORD`(明文密码)、`IOS_PROFILE_BASE64`。
>
> 校验脚本本身也有自测(用合成的假证书跑全部校验分支,不需要真实凭据):`bash scripts/ios-credentials.selftest.sh`。换了证书或改了脚本后可以复跑。

### 出包 + 上传

1. Actions → **iOS signed IPA (TestFlight)** → Run workflow(打 `v*` tag 也会自动触发)
2. 下载产物 `homework-ios-signed-ipa`
3. Mac App Store 装 **Transporter** → 打开 → 用你的 Apple ID 登录 → 把 ipa 拖进去 → Deliver
4. 等 5–15 分钟:App Store Connect → TestFlight → 内部测试 → 建个测试组,把自己加进去
5. iPhone/iPad 装 **TestFlight** App → 接受邀请 → 安装

### 三个必须知道的点

- **上传前必须已有 App 记录**:App Store Connect → Apps → ＋ → New App,名称随意(如「今日作业」),Bundle ID 选 `com.goxofy.homework`。Admin 通常能自己建;若「＋」是灰的(个人账号对建 App 记录有限制),让朋友建一次。
- **build 号自动递增**:工作流每次把 GitHub run number 写进 `ios.buildNumber`,不用手动改(改的是 CI 里的临时文件,不进 git)。
- **内部测试不需审核**(也不涉及备案),但 **build 有效期 90 天**,过期重新跑工作流 + 重新上传即可;TestFlight 内部测试员上限 100 人。

## 界面与适配说明(踩过的坑)

- **弹层不用 RN 的 `Modal`**:Modal 会把内容渲染进独立原生窗口(Android 是 Dialog、iOS 是新的 VC),在那里 `SafeAreaView` 拿到的 insets 通常是 0,结果二级页面(分组/设置)会顶到状态栏下面,左上角的「完成」还会被状态栏吃掉点击。现在统一用 `ui.tsx` 里的 **`Overlay`**(直接渲染在 App 视图树里的全屏层),安全区/键盘/返回键都走主窗口的正确逻辑。
  - 约定:**弹层要和它的页面根节点平级渲染**(根节点不加安全区 padding),否则安全区会让位两次。
- **键盘避让**:Android 15+ / targetSdk 35+ 强制 edge-to-edge 后,系统的 `adjustResize` 不再缩小窗口,RN 的 `KeyboardAvoidingView` 也不可靠。`keyboard.ts` 自己用「键盘高度 − 窗口缩小量」算出避让高度,`Screen` 据此收缩滚动区域并把聚焦的输入框滚到键盘上方。
  - 另外把两个最容易出问题的地方直接绕开了:服务器地址改成**点击弹层输入**(输入框紧贴顶部栏,键盘永远遮不到),添加/编辑作业的「保存」放在**顶部栏**(而不是页面底部的按钮)。
- **安全区/大屏**:所有页面用 `Screen` 的 `edges` 决定避让哪几边(有固定顶栏的页面只让 bottom/left/right),顶栏/底栏用 `useSafeAreaInsets()` 手动让位;横屏刘海也会让位。内容宽度限制在 720dp 并居中,平板/横屏下不会把卡片拉成一条。

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
PUT  /api/rooms/:code/tasks/:tid         改任务 {content,subject_id,done}
DELETE /api/rooms/:code/tasks/:tid       删任务
GET  /api/rooms/:code/audio/:tid         下载语音
WS   /ws?room=CODE                       实时广播 tasks_changed/subjects_changed
```

## 已知边界与后续规划

- 语音识别用系统自带能力(iOS 听写 / Android 语音服务),中文效果好且免费;极端方言口音可能转写不准,保存前可修改
- 房间号即凭据(无账号),请勿外泄;同一房间多台儿童 iPad 可同时查看
- 儿童端没有编辑/删除作业的入口,但可以和家长一样**勾选完成**(这是刻意设计:孩子自己记录进度)
- 规划中:房间内家长/儿童文字/语音聊天;家长导入钉钉作业截图 → OCR+语义切分 → 确认后一键添加
