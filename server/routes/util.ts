import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodError } from 'zod';

/** async handler：把例外交給錯誤處理 middleware */
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>): RequestHandler =>
  (req, res, next) =>
    fn(req, res, next).catch(next);

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: '輸入資料格式錯誤', details: err.issues.map(i => `${i.path.join('.')}: ${i.message}`) });
  }
  const status = typeof err?.status === 'number' ? err.status : 400;
  if (status >= 500 || !err?.message) console.error(err);
  res.status(status).json({ error: err?.message || '伺服器錯誤' });
}
