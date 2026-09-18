# 服务端部署指南

同步服务端:房间 / 分组 / 任务 REST API + 语音文件 + WebSocket 实时广播。

- 仅依赖 Node.js ≥ **22.5**(使用内置 `node:sqlite`,无原生编译)
- 依赖包只有 express / cors / ws
- 所有数据落在 `data/` 目录(SQLite + 语音文件),**备份该目录即可**

## 一、获取代码

```bash
git clone https://github.com/goxofy/homework-arrangement.git
cd homework-arrangement/server
```

## 二、方式 A:直接运行(最快验证)

```bash
npm install          # 或 bun install
PORT=8787 node src/index.js
```

验证:

```bash
curl http://127.0.0.1:8787/api/health
# {"ok":true,"ts":...}
```

## 三、方式 B:systemd 常驻(推荐生产)

```bash
sudo tee /etc/systemd/system/homework-server.service > /dev/null <<'EOF'
[Unit]
Description=Homework App Sync Server
After=network.target

[Service]
Type=simple
# 改成你的实际部署路径和运行用户
WorkingDirectory=/opt/homework-arrangement/homework-app/server
ExecStart=/usr/bin/node src/index.js
Environment=PORT=8787
# 可选:自定义数据目录(默认 server/data)
# Environment=DATA_DIR=/var/lib/homework-server
Restart=always
RestartSec=3
User=www-data

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now homework-server
sudo systemctl status homework-server
```

## 四、方式 C:Docker

服务器上没有 Node 22+ 时可用 Docker(Node 22 镜像):

```bash
cd server
docker build -t homework-server .
docker run -d --name homework-server \
  -p 8787:8787 \
  -v homework-data:/app/data \
  --restart unless-stopped \
  homework-server
```

`Dockerfile` 与 `.dockerignore` 已包含在本目录。

## 五、对外暴露与 HTTPS

手机/iPad 要连上服务器,需要网络可达:

**场景 1:全家在家庭 WiFi 内使用**

App 内服务器地址填 `服务器内网IP:8787`(如 `192.168.1.10:8787`)。
注意:iOS 的 App 传输安全策略允许 HTTP 明文连接局域网地址(NSAllowsLocalNetworking 语义下 App 已配置 arbitrary loads 为仅在需要时),如果连接失败建议直接上 HTTPS(场景 2/3)。

**场景 2:有公网 IP(你的情况),用 Nginx 反代 + HTTPS**

```nginx
server {
    listen 443 ssl;
    server_name hw.example.com;   # 你的域名

    ssl_certificate     /etc/letsencrypt/live/hw.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/hw.example.com/privkey.pem;

    client_max_body_size 25m;     # 语音 base64 上传

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;    # WebSocket
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 300s;
    }
}
```

证书用 certbot 一键签发:`sudo certbot --nginx -d hw.example.com`。
App 内服务器地址填 `https://hw.example.com`。

**场景 3:只有公网 IP、没有域名**

可以用自签证书(客户端需要信任)或 IP 证书,最省事的方案是套 Cloudflare(免费)拿一个域名再回源。家庭宽带无公网 IP 时可用 frp/内网穿透。

## 六、防火墙

```bash
# ufw
sudo ufw allow 8787/tcp    # 直接暴露端口时
# 或只放行 80/443,Nginx 反代到 8787
```

## 七、数据备份与迁移

所有状态都在 `data/` 目录(默认 `server/data/`,可用 `DATA_DIR` 环境变量改):

```bash
# 备份
tar czf homework-backup-$(date +%F).tar.gz data/

# 迁移到新机器:停服务 → 拷贝 data/ 目录 → 起服务
```

SQLite 已开 WAL 模式,备份前最好停服务或用 `sqlite3 data/homework.db ".backup ..."`。

## 八、运维小工具

```
GET /api/health   -> {"ok":true}            健康检查
GET /api/stats    -> 房间数/任务数/语音占用   容量统计
```

## 九、安全说明

- 房间号即唯一凭据(8-32 位),请使用不易猜的房间号;接口按房间号隔离数据
- 服务端目前未做速率限制;如暴露公网,建议 Nginx 层加 `limit_req`
- 语音文件上限 15MB/条,单条任务文字上限 500 字,服务端会校验
