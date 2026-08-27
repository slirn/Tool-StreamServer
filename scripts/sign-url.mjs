// 生成带签名的推流 URL（M3 鉴权配套工具）
// 用法：node scripts/sign-url.mjs <streamPath> [有效秒数] [secret]
// 示例：node scripts/sign-url.mjs /live/stream1 600
import { createHmac } from 'node:crypto';

const [streamPath, ttlArg, secretArg] = process.argv.slice(2);
if (!streamPath || !streamPath.startsWith('/')) {
  console.error('用法：node scripts/sign-url.mjs <streamPath 如 /live/stream1> [有效秒数=600] [secret]');
  process.exit(1);
}
const ttl = Number(ttlArg ?? 600);
const secret = secretArg ?? process.env['AUTH_SECRET'] ?? 'dev-insecure-secret';
const expire = Math.floor(Date.now() / 1000) + ttl;
const sign = createHmac('sha256', secret).update(`${streamPath}-${expire}`).digest('hex');
console.log(`rtmp://localhost:1935${streamPath}?expire=${expire}&sign=${sign}`);
