import type { Settings } from '../shared/types.ts';
import { getDb } from './db.ts';

export const DEFAULT_SETTINGS: Settings = {
  competitionName: '5000 萬股市大富翁實戰模擬',
  initialCapital: 50_000_000,
  allowSelfRegister: true,
  enforceTradingHours: false,
  allowStaleQuotes: true,
  maxQuoteAgeMinutesWhenOpen: 0,
  allowManualQuotes: true,
  manualUsdTwd: null,
  tradingFrozen: false,
};

export function getSettings(): Settings {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const out: any = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (r.key in DEFAULT_SETTINGS) out[r.key] = JSON.parse(r.value);
  }
  return out as Settings;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const stmt = getDb().prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  for (const [k, v] of Object.entries(patch)) {
    if (k in DEFAULT_SETTINGS && v !== undefined) stmt.run(k, JSON.stringify(v));
  }
  return getSettings();
}
