# syntax=docker/dockerfile:1
# StreamServer 生产镜像：Node 20 + ffmpeg（HLS 切片/录制/推流测试均依赖）
# 构建：docker build -t stream-server .
# 运行：见 docs/DEPLOY.md（生产环境必须提供 AUTH_SECRET 与 ADMIN_TOKEN）

# ---------- 构建层 ----------
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- 运行层 ----------
FROM node:20-slim AS runtime
# ffmpeg 是运行时硬依赖（egress HLS 切片、FLV 录制）
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && ffmpeg -version | head -1
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist

# 非 root 运行
RUN useradd --system --create-home appuser \
  && mkdir -p /app/media /app/records \
  && chown -R appuser:appuser /app
USER appuser

EXPOSE 1935 8000 8001
# 生产环境必须注入：AUTH_SECRET（≥16 字符）、ADMIN_TOKEN（≥8 字符）
CMD ["node", "dist/index.js"]
