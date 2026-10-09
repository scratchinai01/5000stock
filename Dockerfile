FROM node:22-slim

# Litestream (Go) 連 Cloud Storage 需要系統根憑證；slim 映像檔預設沒有
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

# Litestream：SQLite 雲端即時備份 (Cloud Run 等無狀態平台需要)
ADD https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-amd64.tar.gz /tmp/litestream.tar.gz
RUN tar -C /usr/local/bin -xzf /tmp/litestream.tar.gz && rm /tmp/litestream.tar.gz

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && chmod +x deploy/start.sh

ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
EXPOSE 8080
CMD ["/app/deploy/start.sh"]
