// SQLite (Node 內建 node:sqlite，免安裝原生套件)。
// 資料檔位置：環境變數 DATA_DIR (預設 ./var)；測試時可設 DB_PATH=':memory:'。
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export type DB = DatabaseSync;

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  const dbPath = process.env.DB_PATH || path.join(process.env.DATA_DIR || path.resolve('var'), 'tycoon.db');
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

/** 測試用：關閉並重置連線 */
export function resetDbForTests() {
  db?.close();
  db = null;
}

/** 以交易包住多個寫入，失敗自動回滾 */
export function tx<T>(fn: () => T): T {
  const d = getDb();
  d.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    d.exec('COMMIT');
    return r;
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

function migrate(d: DatabaseSync) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','admin')),
      team TEXT,
      password_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS accounts (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      initial_capital REAL NOT NULL,
      cash REAL NOT NULL,
      realized_pnl REAL NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('LONG','SHORT')),
      qty REAL NOT NULL,
      avg_price REAL NOT NULL,
      multiplier REAL NOT NULL,
      currency TEXT NOT NULL,
      fx_at_entry REAL NOT NULL,
      margin_locked REAL NOT NULL DEFAULT 0,
      cost_basis REAL NOT NULL DEFAULT 0,
      opened_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_mark_price REAL,
      last_mark_quote TEXT,
      UNIQUE (user_id, symbol, side)
    );

    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      side TEXT NOT NULL,
      intent TEXT NOT NULL,
      qty REAL NOT NULL,
      price REAL NOT NULL,
      fx REAL NOT NULL,
      notional REAL NOT NULL,
      fee REAL NOT NULL,
      tax REAL NOT NULL,
      cash_change REAL NOT NULL,
      margin_change REAL NOT NULL,
      realized_pnl REAL NOT NULL DEFAULT 0,
      executed_at INTEGER NOT NULL,
      market_open INTEGER NOT NULL,
      session_name TEXT NOT NULL,
      quote_json TEXT NOT NULL,
      note TEXT,
      flagged INTEGER NOT NULL DEFAULT 0,
      flag_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_trades_user ON trades(user_id, executed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_trades_time ON trades(executed_at DESC);

    CREATE TABLE IF NOT EXISTS instruments (
      symbol TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      currency TEXT NOT NULL,
      multiplier REAL NOT NULL,
      unit_label TEXT NOT NULL,
      margin_rate REAL NOT NULL DEFAULT 0,
      shortable INTEGER NOT NULL DEFAULT 0,
      min_qty REAL NOT NULL DEFAULT 1,
      provider TEXT NOT NULL,
      provider_symbol TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      option_type TEXT,
      strike REAL,
      contract_month TEXT
    );

    CREATE TABLE IF NOT EXISTS manual_quotes (
      symbol TEXT PRIMARY KEY,
      price REAL NOT NULL,
      prev_close REAL,
      quote_date TEXT NOT NULL,
      quote_time TEXT,
      note TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'fallback' CHECK (mode IN ('fallback','override')),
      set_by TEXT NOT NULL,
      set_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quote_cache (
      symbol TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at DESC);
  `);
}

export function audit(actor: string, action: string, detail: string) {
  getDb()
    .prepare('INSERT INTO audit_logs (actor, action, detail, created_at) VALUES (?, ?, ?, ?)')
    .run(actor, action, detail, Date.now());
}
