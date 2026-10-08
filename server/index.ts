// 伺服器進入點：API + 前端 (開發模式用 Vite middleware，正式環境提供 dist/)
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { getDb } from './db.ts';
import { seedInstruments } from './instruments.ts';
import { bootstrapAdmin } from './auth.ts';
import { setFinmindToken } from './quotes/providers.ts';
import { publicRouter } from './routes/public.ts';
import { adminRouter } from './routes/admin.ts';
import { errorHandler } from './routes/util.ts';

const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === 'production';

// 初始化資料庫與種子資料
getDb();
seedInstruments();
bootstrapAdmin();
const savedToken = getDb().prepare("SELECT value FROM settings WHERE key = '__finmind_token'").get() as any;
if (savedToken && !process.env.FINMIND_TOKEN) setFinmindToken(JSON.parse(savedToken.value));

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

app.get('/healthz', (_req, res) => res.send('OK'));
app.use('/api/admin', adminRouter);
app.use('/api', publicRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: '找不到此 API' }));
app.use(errorHandler);

async function start() {
  const server = http.createServer(app);
  if (!isProd) {
    const { createServer } = await import('vite');
    // HMR 使用同一個 HTTP 伺服器，不另開連接埠
    const vite = await createServer({
      configFile: path.resolve('vite.config.ts'),
      server: { middlewareMode: true, hmr: { server } },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const dist = path.resolve('dist');
    if (!fs.existsSync(dist)) {
      console.error('找不到 dist/，請先執行 npm run build');
      process.exit(1);
    }
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  server.listen(PORT, '0.0.0.0', () => console.log(`伺服器啟動：http://localhost:${PORT}  (${isProd ? 'production' : 'development'})`));
}

start();
