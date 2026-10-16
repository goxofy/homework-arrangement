# 服务端部署指南

同步服务端:房间 / 分组 / 任务 REST API + 语音文件 + 作业附件(图片/音视频/文件)暂存 + WebSocket 实时广播。

- 仅依赖 Node.js ≥ **22.5**(使用内置 `node:sqlite`,无原生编译)
- 依赖包只有 express / cors / ws
- 所有数据落在 `data/` 目录(SQLite + 语音文件 + `data/media/` 附件),**备份该目录即可**

### 作业附件只暂存 7 天

家长上传的作业资料(拍作业本的照片、录的语音讲解、讲解视频等)走的是**临时暂存**:

- 上传后落盘在 `data/media/`,同时记下 `expires_at = 上传时间 + 保留期`
- 到期后服务端**删除文件**、但保留一条标记(客户端会显示「已过期」,不会莫名其妙消失)
- 清理时机:服务启动时扫一遍 + 每 10 分钟扫一遍 + 每次有附件下载请求时顺手扫一下
- 保留期默认 **7 天**,可用环境变量调整(支持小数,方便本地验证):

```bash
MEDIA_TTL_DAYS=3 node src/index.js     # 只保留 3 天
```

> 设计意图:不把孩子要看的资料永久堆在服务器上,而是「谁翻到这一天,谁就把它下载到本机」——
> 孩子在有效期内打开过这一天,资料就长期留在了他的 iPad 上;超过保留期且没人看过,才会被清掉。

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

### 版本升级(数据不丢)

直接覆盖代码后重启服务即可,**不需要手动跑迁移**:

- 建表用的是 `CREATE TABLE IF NOT EXISTS`,老库不会被重建;
- 新增字段(如 v1.1 的任务完成状态 `tasks.done`)启动时会自动 `ALTER TABLE ... ADD COLUMN` 补上,老任务默认为「未完成」。
- v1.2 的附件表 `task_media` 用 `CREATE TABLE IF NOT EXISTS` 新建,老库升级后自动就有,无需手工建表。

升级前想先验证一下迁移逻辑,可以跑自带的检查脚本(不会动 `data/`,它用 `/tmp` 里的模拟老库):

```bash
cd server && node test-migrate.mjs
# ✅ 老库自动补列:通过(老任务 done=false,内容完整)
```

## 八、运维小工具

```
GET /api/health   -> {"ok":true}                        健康检查
GET /api/stats    -> 房间数/任务数/语音与附件占用/保留天数   容量统计
```

`/api/stats` 返回里的 `media` 是仍在有效期内的附件数,`expired_media` 是已到期(文件已删)的条目数,
`media_ttl_days` / `media_ttl_label` 是当前保留期 —— 排查「孩子在 iPad 上打不开资料」时先看这几个值。

## 九、安全说明

- 房间号即唯一凭据(8-32 位),请使用不易猜的房间号;接口按房间号隔离数据
- 服务端目前未做速率限制;如暴露公网,建议 Nginx 层加 `limit_req`
- 语音文件上限 15MB/条,单条任务文字上限 500 字,服务端会校验
- 附件单文件上限:图片 12MB / 音频 25MB / 视频 80MB / 其他文件 25MB;每条作业最多 20 个附件
- 附件下载地址形如 `/api/rooms/:code/media/:id`,房间号就是凭据 —— 房间号别外泄
- 任务的「完成状态」是可写的,家长和儿童端都可以勾选(`PUT /api/rooms/:code/tasks/:tid` 带 `{done:true|false}`);作业内容的编辑/删除客户端只有家长端有入口
