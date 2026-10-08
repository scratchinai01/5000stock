#!/bin/sh
# 容器啟動腳本
# - 有設定 LITESTREAM_REPLICA_URL：先從雲端還原資料庫，再由 Litestream 啟動伺服器並持續備份
# - 沒設定：直接啟動 (資料只存在容器內，重啟會消失，請掛永久磁碟)
set -e
export DATA_DIR="${DATA_DIR:-/data}"
mkdir -p "$DATA_DIR"
APP="node_modules/.bin/tsx server/index.ts"
CFG="${LITESTREAM_CONFIG:-/app/deploy/litestream.yml}"

if [ -n "$LITESTREAM_REPLICA_URL" ]; then
  echo "[start] 從 $LITESTREAM_REPLICA_URL 還原資料庫 (若存在)…"
  litestream restore -if-db-not-exists -if-replica-exists -config "$CFG" "$DATA_DIR/tycoon.db"
  exec litestream replicate -config "$CFG" -exec "$APP"
else
  echo "[start] 未設定 LITESTREAM_REPLICA_URL，資料不會備份到雲端"
  exec $APP
fi
