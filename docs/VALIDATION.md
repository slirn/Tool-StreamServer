# 真实使用验证手册（VALIDATION）

目的：用真实负载回答 e2e 测试覆盖不了的问题。**逐项记录结果表（文末），产出直接决定 v0.2 范围。**

前置：服务已启动（开发 `npm run dev`，或 Docker 见 [DEPLOY.md](./DEPLOY.md)），本机装好 OBS Studio 与 VLC。

## 一、OBS 推流配置

1. OBS → 设置 → 推流：
   - 服务器：`rtmp://<IP>:1935/live`
   - 推流码：**不能直接填 key**——需要带签名的完整参数
2. 生成签名推流码（项目根执行）：

   ```bash
   node scripts/sign-url.mjs /live/test1 3600
   # 输出 rtmp://localhost:1935/live/test1?expire=...&sign=...
   # 取问号后面的整段作为 OBS「推流码」：test1?expire=...&sign=...
   ```

3. OBS → 设置 → 输出 → 高级模式：**关键帧间隔设为 2 秒**（HLS 切片依赖关键帧，默认自动可能过长）
4. 开始推流，10 秒内应能在 VLC 打开 `http://<IP>:8000/hls/live/test1/index.m3u8`

## 二、验证项与观测点

### V1 基础链路（必做，约 10 分钟）

| 检查 | 方法 | 通过标准 |
| --- | --- | --- |
| OBS 推流成功 | OBS 状态栏无报错；服务日志出现 `stream published` | ✅ |
| HLS 可播 | VLC 打开 m3u8 | 画面/声音正常，延迟 10–30s 属正常 |
| HTTP-FLV 可播 | VLC 打开 `.flv` 地址 | 延迟明显低于 HLS（2–5s） |
| 录制 | `POST /api/v1/records`（带 x-admin-token），推 1 分钟后停 | 文件 >1MB，VLC 可回放 |
| 踢流 | `DELETE /api/v1/streams/live%2Ftest1` | OBS 立即断开并显示重连失败 |
| 鉴权负向 | OBS 用无签名推流码重推 | 秒拒，日志出现 `publish rejected` |

### V2 稳定性（挂机，12–24 小时）

- 推一路真实流（摄像头/屏幕/循环视频）挂过夜
- 观测点（每几小时瞄一眼即可）：
  - **内存**：任务管理器看 node 进程内存是否持续上涨（泄漏信号）
  - **ffmpeg 进程数**：应恒等于 1（HLS）+ 录制数，无残留
  - **media/ 目录**：分片总数应稳定在滑窗范围（hls_list_size 附近），不无限增长
  - 结束后断推，确认分片目录最终被清空

### V3 多路并发（约 30 分钟）

- 用 ffmpeg 脚本同时推 5 路（各带独立签名 key）：

  ```bash
  # 每路一个 key；签名各自生成（node scripts/sign-url.mjs /live/c1 3600 ...）
  ffmpeg -re -f lavfi -i testsrc=duration=1800:size=640x360:rate=15 -g 30 -c:v libx264 -preset veryfast -an -f flv "<签名URL c1>"
  # c2~c5 同理（可写个 .ps1/.sh 循环）
  ```

- 观测：CPU 占用曲线、5 路 m3u8 全部可播、`GET /api/v1/streams` 数量正确
- 有条件加到 10 路找到本机极限（记录：__ 路 @ __ CPU）

### V4 弱网与断流重连（约 10 分钟）

1. OBS 推流中 → 断网/禁用网卡 **10 秒** → 恢复
2. OBS 应自动重连；观察服务是否在 30s 宽限期内**续传**（日志 `stream resumed`，播放端短暂卡顿后恢复）
3. 断网超过 60 秒再恢复 → 流应彻底结束（`stream unpublished`），OBS 重连视为全新推流

### V5 真实播放端兼容（约 15 分钟）

| 播放端 | HLS | HTTP-FLV | 备注 |
| --- | --- | --- | --- |
| VLC（桌面） | | | |
| Chrome + hls.js 网页 | | | 用 https://hls-js.netlify.com/demo 拉流测试 |
| 手机浏览器 | | | 同 Wi-Fi 下测试 |

## 三、结果记录表（复制填写）

```
| 项 | 结果 | 备注/异常现象 | 
| V1 基础链路 | ☐通过 ☐异常 | |
| V2 稳定运行 __ 小时 | ☐通过 ☐内存上涨 ☐进程残留 | 峰值内存 __MB |
| V3 并发 __ 路 | ☐全部可播 | CPU __% |
| V4 弱网重连（<30s） | ☐续传成功 | |
| V4 断流超 60s | ☐正常终结 | |
| V5 播放端兼容 | VLC☐ hls.js☐ 手机☐ | |
发现的问题：
1. ...
```

填写后交给 agent 分析 → 按问题优先级生成 v0.2 Plan。
