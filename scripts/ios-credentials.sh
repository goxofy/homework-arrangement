#!/usr/bin/env bash
#
# 校验 iOS 分发凭据并把 GitHub Secrets 的值准备好。
#
#   分发证书(.p12,必须含私钥) + App Store 描述文件(.mobileprovision)
#   证书两种名字都可以:
#     - Apple Distribution(2020 年后 Apple 的统一分发证书)
#     - iPhone Distribution / iOS Distribution(旧的 iOS 专用分发证书,用于 App Store 依然有效)
#
# 用法:
#   bash scripts/ios-credentials.sh ~/Desktop/distribution.p12 ~/Desktop/app.mobileprovision
#   # 密码不写在命令行更安全,脚本会交互式询问(输入不回显)
#   bash scripts/ios-credentials.sh dist.p12 app.mobileprovision '<p12密码>'
#
#   加 --set 直接把三条 secret 推到 GitHub(需要已登录的 gh CLI):
#   bash scripts/ios-credentials.sh dist.p12 app.mobileprovision --set
#
# 安全性:全程只读。不会往登录钥匙串导入任何东西,不修改项目文件,
#        临时文件都在 mktemp 出来的目录里,退出即删。
#
set -uo pipefail

P12=""
PROFILE=""
PASSWORD="${P12_PASSWORD:-}"
DO_SET=0
REPO="goxofy/homework-arrangement"

for arg in "$@"; do
  case "$arg" in
    --set) DO_SET=1 ;;
    --repo=*) REPO="${arg#--repo=}" ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) if [ -z "$P12" ]; then P12="$arg"; elif [ -z "$PROFILE" ]; then PROFILE="$arg"; else PASSWORD="$arg"; fi ;;
  esac
done

red()  { printf '\033[31m✗ %s\033[0m\n' "$1"; }
grn()  { printf '\033[32m✓ %s\033[0m\n' "$1"; }
ylw()  { printf '\033[33m! %s\033[0m\n' "$1"; }
dim()  { printf '  \033[2m%s\033[0m\n' "$1"; }
hr()   { printf '\n\033[2m──────────────────────────────────────────────\033[0m\n'; }
die()  { red "$1"; exit 1; }

hr
printf 'iOS 分发凭据校验\n'
hr

[ -n "$P12" ]     || die "用法: bash scripts/ios-credentials.sh <证书.p12> <描述文件.mobileprovision>"
[ -n "$PROFILE" ] || die "用法: bash scripts/ios-credentials.sh <证书.p12> <描述文件.mobileprovision>"
[ -f "$P12" ]     || die "找不到证书文件: $P12"
[ -f "$PROFILE" ] || die "找不到描述文件: $PROFILE"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ---------- 1. 描述文件 ----------
printf '\n[1/4] 解析描述文件\n'
security cms -D -i "$PROFILE" > "$TMP/profile.plist" 2>/dev/null \
  || die "解析描述文件失败(文件损坏?或不是 .mobileprovision)"

eval "$(python3 - "$TMP/profile.plist" <<'PY'
import plistlib, shlex, datetime
p = plistlib.load(open(__import__("sys").argv[1], "rb"))
ent = p.get("Entitlements", {})
exp = p.get("ExpirationDate")
# plistlib 里的日期是「无时区的 UTC」,比较时也要用 UTC,否则跨时区会差一天
now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
days = (exp - now).days if isinstance(exp, datetime.datetime) else None
fields = {
    "PROFILE_NAME":   p.get("Name", ""),
    "PROFILE_UUID":   p.get("UUID", ""),
    "TEAM_ID":        (p.get("TeamIdentifier") or [""])[0],
    "APP_ID":         ent.get("application-identifier", ""),
    "GET_TASK_ALLOW": str(ent.get("get-task-allow", False)).lower(),
    "PROVIS_DEVICES": str(len(p.get("ProvisionedDevices") or [])),
    "ALL_DEVICES":    str(p.get("ProvisionsAllDevices", False)).lower(),
    "EXPIRES":        exp.strftime("%Y-%m-%d") if exp else "",
    "DAYS_LEFT":      str(days if days is not None else ""),
    "PLATFORM":       ",".join(p.get("Platform") or []),
}
for k, v in fields.items():
    print(f"{k}={shlex.quote(v)}")
PY
)" || die "解析描述文件内容失败"

dim "名称       : $PROFILE_NAME"
dim "UUID       : $PROFILE_UUID"
dim "Team ID    : $TEAM_ID"
dim "有效期至   : $EXPIRES (剩余 ${DAYS_LEFT} 天)"
dim "平台       : $PLATFORM"

# 类型判断:App Store 分发描述文件不该包含设备列表,也不该开 get-task-allow
if [ "$PROVIS_DEVICES" != "0" ] || [ "$ALL_DEVICES" = "true" ] || [ "$GET_TASK_ALLOW" = "true" ]; then
  red "这个不是 App Store 分发描述文件"
  dim "它里面带着 $PROVIS_DEVICES 台设备 / get-task-allow=$GET_TASK_ALLOW —— 说明是 Ad Hoc、Development 或 In-House 的描述文件。"
  dim "请让对方重新建:Profiles → ＋ → Distribution → App Store"
  exit 1
fi
grn "类型正确:App Store 分发描述文件"

if [ -n "$DAYS_LEFT" ] && [ "$DAYS_LEFT" -lt 0 ] 2>/dev/null; then
  die "描述文件已过期"
elif [ -n "$DAYS_LEFT" ] && [ "$DAYS_LEFT" -lt 30 ] 2>/dev/null; then
  ylw "描述文件 $DAYS_LEFT 天后过期,建议现在就让对方重新生成一份"
else
  grn "描述文件未过期"
fi

# ---------- 2. bundle id 与项目配置是否一致 ----------
printf '\n[2/4] 核对 Bundle ID\n'
PROFILE_BUNDLE="${APP_ID#*.}"
CONFIG_BUNDLE="$(node -p "require('$PROJECT_ROOT/app.json').expo.ios.bundleIdentifier" 2>/dev/null || echo "")"
[ -n "$CONFIG_BUNDLE" ] || die "读不到 app.json 里的 ios.bundleIdentifier"
dim "描述文件 : $PROFILE_BUNDLE"
dim "app.json : $CONFIG_BUNDLE"
if [ "$PROFILE_BUNDLE" != "$CONFIG_BUNDLE" ]; then
  red "不一致 —— CI 会直接报错,上传也会被拒"
  dim "让证书持有者按 $CONFIG_BUNDLE 重新注册 App ID(Explicit)并重建 App Store 描述文件。"
  exit 1
fi
grn "Bundle ID 一致"

# ---------- 3. 证书 ----------
printf '\n[3/4] 校验证书(.p12)\n'
if [ -z "$PASSWORD" ]; then
  if [ -t 0 ]; then
    read -r -s -p "  请输入 p12 密码(不回显): " PASSWORD
    printf '\n'
  else
    die "需要 p12 密码(可用第三个参数传入,或设置环境变量 P12_PASSWORD)"
  fi
fi

# 钥匙串导出的 p12 常用 3DES/RC2 老式加密,OpenSSL 3 需要 -legacy 才能读,
# 所以每个读取动作都先按默认参数试,失败了再带 -legacy 试一次。
pk12() {
  openssl pkcs12 -in "$P12" -passin "pass:$PASSWORD" "$@" 2>/dev/null && return 0
  openssl pkcs12 -legacy -in "$P12" -passin "pass:$PASSWORD" "$@" 2>/dev/null && return 0
  return 1
}

if ! pk12 -clcerts -nokeys -out "$TMP/cert.pem"; then
  die "读取 p12 失败 —— 密码不对,或文件损坏(也可能导出时用了不受支持的加密方式)"
fi

if ! pk12 -nocerts -nodes -out "$TMP/key.pem" \
   || ! grep -q "PRIVATE KEY" "$TMP/key.pem" 2>/dev/null; then
  red "p12 里没有私钥(只有一个证书)"
  dim "在「钥匙串访问」里找到这张分发证书 → 展开左侧小三角(确认下面挂着私钥)"
  dim "→ 右键这张证书 → 导出 → 存为 .p12 并设密码。只导出证书的话没法签名。"
  exit 1
fi
grn "p12 含私钥,密码正确"

CERT_SUBJECT="$(openssl x509 -in "$TMP/cert.pem" -noout -subject | sed 's/^subject=//')"
CERT_END="$(openssl x509 -in "$TMP/cert.pem" -noout -enddate | sed 's/^notAfter=//')"
CERT_END_EPOCH="$(date -j -f "%b %d %T %Y %Z" "$CERT_END" "+%s" 2>/dev/null || echo 0)"
NOW_EPOCH="$(date "+%s")"
dim "主体   : $CERT_SUBJECT"
dim "到期   : $CERT_END"
if [ "$CERT_END_EPOCH" != "0" ] && [ "$CERT_END_EPOCH" -lt "$NOW_EPOCH" ]; then
  die "证书已过期,请让对方重新签发一张分发证书(Apple Distribution)"
fi

# 分发证书有两种主体名,都是合法的 App Store 分发证书:
#   Apple Distribution: X   —— 2020 年起 Apple 的统一分发证书(iOS/macOS/tvOS/watchOS)
#   iPhone Distribution: X  —— 旧的 iOS 专用分发证书,只覆盖 iOS/iPadOS
# 二者都能配 App Store 描述文件、也都能签名上传 TestFlight;CI 会按证书实际名称签名。
# 真正会失败的是「开发」证书。
case "$CERT_SUBJECT" in
  *"Apple Development"*|*"iPhone Developer"*|*"iOS Development"*|*"Mac Developer"*)
    red "这是「开发」证书,不能用于 TestFlight 分发"
    dim "请让对方重新签发一张分发证书:Certificates → ＋ → Apple Distribution"
    exit 1
    ;;
  *"Apple Distribution"*)
    grn "证书类型:Apple Distribution(统一分发证书)"
    ;;
  *"iPhone Distribution"*|*"iOS Distribution"*)
    grn "证书类型:iOS 分发证书(iPhone Distribution)"
    dim "只覆盖 iOS/iPadOS,但用于 App Store / TestFlight 完全有效,CI 会按这个名称签名。"
    dim "(Apple 现推荐用统一的 Apple Distribution,后者还多覆盖 macOS/watchOS;不换也不影响。)"
    ;;
  *)
    ylw "无法识别的证书主体:$CERT_SUBJECT"
    dim "只要它是「分发」用途(不是 Development)通常也能签名;CI 会按证书实际名称签名。"
    ;;
esac

openssl x509 -in "$TMP/cert.pem" -outform DER -out "$TMP/cert.der"

# 证书必须就是描述文件里绑定的那张,否则签名必失败
if python3 - "$TMP/profile.plist" "$TMP/cert.der" <<'PY'
import plistlib, hashlib, sys
p = plistlib.load(open(sys.argv[1], "rb"))
want = hashlib.sha256(open(sys.argv[2], "rb").read()).hexdigest()
certs = [hashlib.sha256(c).hexdigest() for c in p.get("DeveloperCertificates") or []]
print("  描述文件绑定的证书指纹:")
for c in certs:
    print(f"    {c}")
print("  你的 p12 指纹(前 16 位):")
print(f"    {want[:16]}")
sys.exit(0 if want in certs else 1)
PY
then
  grn "证书与描述文件配对"
else
  red "证书和描述文件不配对"
  dim "描述文件绑定的是另一张证书。让对方用这张证书重新生成描述文件,或者反过来。"
  exit 1
fi

# ---------- 4. 生成 secrets ----------
printf '\n[4/4] GitHub Secrets\n'
hr
if [ "$DO_SET" = 1 ]; then
  command -v gh >/dev/null || die "没找到 gh CLI(brew install gh),或去掉 --set 手动到网页上填"
  # 注意:两个凭据都是二进制,必须走 base64(直接读成文本会因为非法 UTF-8 序列被截断)
  base64 < "$P12" | tr -d '\n' | gh secret set IOS_DIST_P12_BASE64 --repo "$REPO" || die "写入 IOS_DIST_P12_BASE64 失败"
  printf '%s' "$PASSWORD" | gh secret set IOS_DIST_P12_PASSWORD --repo "$REPO" || die "写入 IOS_DIST_P12_PASSWORD 失败"
  base64 < "$PROFILE" | tr -d '\n' | gh secret set IOS_PROFILE_BASE64 --repo "$REPO" || die "写入 IOS_PROFILE_BASE64 失败"
  grn "三条 secret 已写入 $REPO"
  dim "验证:gh secret list --repo $REPO"
else
  printf '在仓库 Settings → Secrets and variables → Actions 里新增三条 secret:\n\n'
  printf '  IOS_DIST_P12_BASE64      = base64 -i %s | tr -d "\\n"\n' "$P12"
  printf '  IOS_DIST_P12_PASSWORD    = %s\n' "$PASSWORD"
  printf '  IOS_PROFILE_BASE64       = base64 -i %s | tr -d "\\n"\n' "$PROFILE"
  printf '\n或者用 gh 一条命令搞定(本机已有 gh 且已登录):\n\n'
  printf '  bash scripts/ios-credentials.sh %s %s --set\n' "$(basename "$P12")" "$(basename "$PROFILE")"
fi
hr
grn "校验通过,可以触发构建了"
printf '  1. 先确认 App Store Connect 里已建好 App 记录(Bundle ID = %s)\n' "$CONFIG_BUNDLE"
printf '  2. Actions → "iOS signed IPA (TestFlight)" → Run workflow\n'
printf '  3. 下载 artifact 里的 ipa,用 Transporter 上传\n'
hr
