# 部署指南（DEPLOY）

StreamServer 的生产部署以 Docker 为推荐方式（镜像自带 ffmpeg 运行时依赖）。

## 一、Docker 部署（推荐）

### 1. 准备环境变量

```bash
# 生成强随机值
node -e "console.log('AUTH_SECRET=' + require('crypto').randomBytes(24).toString('hex'))"
node -e "console.log('ADMIN_TOKEN=' + require('crypto').randomBytes(12).toString('hex'))"
```

写入项目根 `.env`（已被 .gitignore 排除，不入库）：

```ini
AUTH_SECRET=<上面生成的值>
ADMIN_TOKEN=<上面生成的值>
```

### 2. 启动

```bash
docker compose up -d --build

# 验证
curl http://localhost:8001/healthz          # {"code":0,...,"status":"up"}
docker compose ps                           # healthy 状态
docker compose logs -f stream-server        # 看启动日志
```

### 3. 生成推流地址并推流

```bash
# 进入容器生成签名 URL（默认 600s 有效）
docker compose exec stream-server node -e "
const { createHmac } = require('crypto');
const path = '/live/stream1';
const expire = Math.floor(Date.now()/1000) + 600;
const sign = createHmac('sha256', process.env.AUTH_SECRET).update(path + '-' + expire).digest('hex');
console.log('rtmp://<服务器IP>:1935' + path + '?expire=' + expire + '&sign=' + sign);
"
```

播放：`http://<IP>:8000/hls/live/stream1/index.m3u8` 或 `http://<IP>:8000/live/stream1.flv`

### 4. 升级 / 回滚

```bash
git pull && docker compose up -d --build   # 升级
docker tag stream-server:latest stream-server:backup && docker compose up -d --build  # 升级前留备份
```

## 二、裸机部署（备选）

要求：Node.js >= 20.19、ffmpeg 在 PATH（`FFMPEG_PATH` 可指定绝对路径）。

```bash
npm ci && npm run build
NODE_ENV=production AUTH_SECRET=... ADMIN_TOKEN=... node dist/index.js
```

systemd 单元示例（`/etc/systemd/system/stream-server.service`）：

```ini
[Unit]
Description=StreamServer
After=network.target

[Service]
WorkingDirectory=/opt/stream-server
Environment=NODE_ENV=production
EnvironmentFile=/opt/stream-server/.env
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
# 加固
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/stream-server/media /opt/stream-server/records

[Install]
WantedBy=multi-user.target
```

## 三、环境变量清单

| 变量 | 默认 | 说明 | 生产要求 |
| --- | --- | --- | --- |
| `NODE_ENV` | — | development / production / test | 必填（production 触发全部强校验） |
| `AUTH_SECRET` | dev 弱值 | 推流签名密钥 | **必填**，trim 后 ≥16 字符 |
| `ADMIN_TOKEN` | 无 | 管理 API 令牌；未配置=只读模式 | **必填**，≥8 字符 |
| `RTMP_PORT` | 1935 | RTMP 推流端口 | |
| `HTTP_PORT` | 8000 | HLS/HTTP-FLV 拉流端口 | |
| `API_PORT` | 8001 | 管理 API 端口 | |
| `RTMP_APP` | live | RTMP 路由名（`[A-Za-z0-9_-]+`） | |
| `HLS_FRAGMENT_SEC` | 6 | 分片时长秒（1–30） | 建议配合推流端关键帧间隔 |
| `HLS_WINDOW_SIZE` | 5 | 滑窗分片数（1–60） | |
| `MEDIA_ROOT` | ./media | HLS 分片目录（拒绝 `..`） | 建议挂卷 |
| `RECORDS_ROOT` | ./records | 录像目录（拒绝 `..`） | 建议挂卷（持久） |
| `LOG_LEVEL` | info | debug/info/warn/error | |
| `FFMPEG_PATH` | ffmpeg | ffmpeg 可执行文件路径 | 容器内已内置 |

## 四、安全清单（上线前逐项确认）

- [ ] `AUTH_SECRET` / `ADMIN_TOKEN` 为强随机值，未入库未入日志
- [ ] `.env` 权限 600；密钥定期轮换（轮换会使旧签名 URL 立即失效）
- [ ] `API_PORT`(8001) 仅内网可达或加防火墙规则——管理 API 能踢流/删录像
- [ ] 拉流端口 8000 按需公开（v1 拉流无鉴权，公开=任何人可看）
- [ ] 对公网暴露时置于反向代理（nginx/caddy）之后做 TLS——RTMP 推流口的 TLS 需额外方案（如 stunnel）
- [ ] 磁盘容量规划：HLS 分片随流自动清理（delete_segments）；**录像不自动清理**，需人工/API 管理
- [ ] 关注 CVE：定期 `npm audit` 与基础镜像更新

## 五、常见问题

| 现象 | 排查 |
| --- | --- |
| 推流被秒断 | 签名过期/错误；用容器内命令重新生成 URL |
| m3u8 404 | 推流端关键帧间隔过大（建议 `-g 60` 或 OBS "2 秒关键帧"）；等 5–10s |
| 无法播放但有分片 | 检查 8000 端口与防火墙；浏览器直接开 m3u8 看响应 |
| 录像为 0 字节 | 录制启动瞬间流断开（已知 TOCTOU 限制）；重新开录 |
| 容器 unhealthy | `docker compose logs` 查启动错误（多为生产强校验未过） |
