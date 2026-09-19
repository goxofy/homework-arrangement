#!/usr/bin/env bash
#
# ios-credentials.sh 的自测:用合成的假证书/假描述文件把每条校验分支都跑一遍。
# 不需要真实 Apple 凭据,也不会写入任何 secret。用法:bash scripts/ios-credentials.selftest.sh
#
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/ios-credentials.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PASS="secret"
TEAM="ABCDE12345"
BUNDLE="com.goxofy.homework"

PASSED=0
FAILED=0
CASE=""

say()  { printf '\n\033[1m%s\033[0m\n' "$1"; }
pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; PASSED=$((PASSED + 1)); }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; printf '%s\n' "$2" | sed 's/^/       | /' | head -n 12; FAILED=$((FAILED + 1)); }

# ---------- 造测试物料 ----------
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$TMP/k1.pem" -out "$TMP/c1.pem" -days 365 \
  -subj "/CN=Apple Distribution: Test User ($TEAM)/OU=$TEAM/O=Test Org/C=CN" >/dev/null 2>&1
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$TMP/k2.pem" -out "$TMP/c2.pem" -days 365 \
  -subj "/CN=Apple Distribution: Someone Else (ZZZZZ99999)/OU=ZZZZZ99999/O=Other/C=CN" >/dev/null 2>&1
# 旧的 iOS 专用分发证书(同样能用于 App Store / TestFlight)
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$TMP/k3.pem" -out "$TMP/c3.pem" -days 365 \
  -subj "/CN=iPhone Distribution: Test User ($TEAM)/OU=$TEAM/O=Test Org/C=CN" >/dev/null 2>&1
# 开发证书:应该被拒
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$TMP/k4.pem" -out "$TMP/c4.pem" -days 365 \
  -subj "/CN=Apple Development: Test User ($TEAM)/OU=$TEAM/O=Test Org/C=CN" >/dev/null 2>&1
openssl x509 -in "$TMP/c1.pem" -outform DER -out "$TMP/c1.der"
openssl x509 -in "$TMP/c2.pem" -outform DER -out "$TMP/c2.der"
openssl x509 -in "$TMP/c3.pem" -outform DER -out "$TMP/c3.der"
openssl x509 -in "$TMP/c4.pem" -outform DER -out "$TMP/c4.der"

p12() { # <key> <cert> <out> [extra...]
  local key="$1" cert="$2" out="$3"; shift 3
  openssl pkcs12 -export -inkey "$key" -in "$cert" -out "$out" -passout "pass:$PASS" "$@" >/dev/null 2>&1
}
LEGACY_OK=1
p12 "$TMP/k1.pem" "$TMP/c1.pem" "$TMP/good.p12"                                 || exit 1
p12 "$TMP/k3.pem" "$TMP/c3.pem" "$TMP/iosdist.p12"                              || exit 1
p12 "$TMP/k4.pem" "$TMP/c4.pem" "$TMP/dev.p12"                                  || exit 1
p12 "$TMP/k1.pem" "$TMP/c1.pem" "$TMP/legacy.p12" -legacy \
  -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1                     || LEGACY_OK=0
openssl pkcs12 -export -nokeys -in "$TMP/c1.pem" -out "$TMP/certonly.p12" \
  -passout "pass:$PASS" >/dev/null 2>&1                                          || exit 1

# 描述文件:plist → openssl cms 签成 .mobileprovision(security cms -D 只解码不验签)
python3 - "$TMP" "$TEAM" "$BUNDLE" <<'PY'
import plistlib, sys, datetime, os
tmp, team, bundle = sys.argv[1], sys.argv[2], sys.argv[3]
now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
der = open(os.path.join(tmp, "c1.der"), "rb").read()
other = open(os.path.join(tmp, "c2.der"), "rb").read() if os.path.exists(os.path.join(tmp, "c2.der")) else der
ios_dist = open(os.path.join(tmp, "c3.der"), "rb").read()
dev_cert = open(os.path.join(tmp, "c4.der"), "rb").read()

def make(name, certs, appid, days, devices=None, task_allow=False, platform=["iOS"]):
    p = {
        "Name": name, "UUID": f"11111111-2222-3333-4444-{abs(hash(name)) % 10**12:012d}",
        "TeamIdentifier": [team], "Platform": platform,
        "CreationDate": now, "ExpirationDate": now + datetime.timedelta(days=days),
        "DeveloperCertificates": certs,
        "Entitlements": {"application-identifier": appid, "get-task-allow": task_allow,
                         "com.apple.developer.team-identifier": team},
    }
    if devices:
        p["ProvisionedDevices"] = devices
    with open(os.path.join(tmp, name + ".plist"), "wb") as f:
        plistlib.dump(p, f, fmt=plistlib.FMT_XML)

make("ok",            [der],   f"{team}.{bundle}", 365)
make("expired",       [der],   f"{team}.{bundle}", -5)
make("wrongbundle",   [der],   f"{team}.com.someone.else", 365)
make("adhoc",         [der],   f"{team}.{bundle}", 365, devices=["00008030-000123456789001E"])
make("unpaired",      [other], f"{team}.{bundle}", 365)
make("expiringsoon",  [der],   f"{team}.{bundle}", 10)
make("iosdist",       [ios_dist], f"{team}.{bundle}", 365)
make("devcert",       [dev_cert], f"{team}.{bundle}", 365)
PY

for name in ok expired wrongbundle adhoc unpaired expiringsoon iosdist devcert; do
  openssl cms -sign -in "$TMP/$name.plist" -signer "$TMP/c1.pem" -inkey "$TMP/k1.pem" \
    -out "$TMP/$name.mobileprovision" -outform der -nodetach -binary >/dev/null 2>&1 \
    || { printf '生成假描述文件失败(cms)\n'; exit 1; }
done

# ---------- 断言 ----------
run() { # <期望:ok|err> <输出中应包含的文字> <p12> <profile> [密码]
  local expect="$1" pattern="$2" p12f="$3" prof="$4" pw="${5:-$PASS}"
  local out code
  out="$(bash "$SCRIPT" "$p12f" "$prof" "$pw" 2>&1)"; code=$?
  local got="ok"; [ "$code" -eq 0 ] || got="err"
  local label="$expect/$pattern"
  if [ "$got" != "$expect" ]; then
    fail "$label (期望 $expect,实际 exit=$code)" "$out"; return
  fi
  if ! printf '%s' "$out" | grep -q "$pattern"; then
    fail "$label (期望 $expect,实际 exit=$code)" "$out"; return
  fi
  pass "$label"
}

say "1) 正常凭据"
run ok "校验通过" "$TMP/good.p12" "$TMP/ok.mobileprovision"
run ok "App Store 分发描述文件" "$TMP/good.p12" "$TMP/ok.mobileprovision"
run ok "证书与描述文件配对" "$TMP/good.p12" "$TMP/ok.mobileprovision"

say "2) 证书主体是 iPhone Distribution(旧式 iOS 分发证书,应当通过)"
run ok "iOS 分发证书" "$TMP/iosdist.p12" "$TMP/iosdist.mobileprovision"
run ok "校验通过" "$TMP/iosdist.p12" "$TMP/iosdist.mobileprovision"
run err "开发" "$TMP/dev.p12" "$TMP/devcert.mobileprovision"

say "3) 老式 3DES 加密的 p12(OpenSSL 3 需要 -legacy)"
if [ "$LEGACY_OK" = 1 ]; then
  run ok "校验通过" "$TMP/legacy.p12" "$TMP/ok.mobileprovision"
else
  printf '  \033[33mSKIP\033[0m 本机 openssl 生成的 legacy p12 失败,跳过\n'
fi

say "4) 坏凭据"
run err "读取 p12 失败"      "$TMP/good.p12" "$TMP/ok.mobileprovision" "wrongpassword"
run err "没有私钥"           "$TMP/certonly.p12" "$TMP/ok.mobileprovision"
run err "Bundle ID"          "$TMP/good.p12" "$TMP/wrongbundle.mobileprovision"
run err "不是 App Store"     "$TMP/good.p12" "$TMP/adhoc.mobileprovision"
run err "不配对"             "$TMP/good.p12" "$TMP/unpaired.mobileprovision"
run err "已过期"             "$TMP/good.p12" "$TMP/expired.mobileprovision"
run err "找不到证书文件"     "$TMP/nope.p12" "$TMP/ok.mobileprovision"

say "5) 快过期提醒"
run ok "天后过期" "$TMP/good.p12" "$TMP/expiringsoon.mobileprovision"

printf '\n\033[1m结果: %d passed, %d failed\033[0m\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ]
