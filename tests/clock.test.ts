import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSession } from '../server/clock.ts';

const at = (iso: string) => Date.parse(iso);

test('台指期：週二凌晨 02:00 (台北) 為夜盤，不受伺服器時區影響', () => {
  assert.equal(getSession('tw_future', at('2026-10-06T02:00:00+08:00')).isOpen, true);
  assert.equal(getSession('tw_future', at('2026-10-05T02:00:00+08:00')).isOpen, false); // 週一凌晨 (週末後)
  assert.equal(getSession('tw_future', at('2026-10-10T03:00:00+08:00')).isOpen, true); // 週六凌晨 (週五夜盤)
  assert.equal(getSession('tw_future', at('2026-10-06T14:00:00+08:00')).isOpen, false); // 日夜盤間
});

test('台股：13:30 收盤、14:00–14:30 盤後定價、週末休市', () => {
  assert.equal(getSession('tw_stock', at('2026-10-05T09:00:00+08:00')).isOpen, true);
  assert.equal(getSession('tw_stock', at('2026-10-05T13:30:00+08:00')).isOpen, false);
  assert.equal(getSession('tw_stock', at('2026-10-05T14:10:00+08:00')).isOpen, true);
  assert.equal(getSession('tw_stock', at('2026-10-10T10:00:00+08:00')).isOpen, false);
});

test('美股：自動處理夏令/冬令時間', () => {
  // 夏令 (EDT)：台北 21:30 = 紐約 09:30
  assert.equal(getSession('us_stock', at('2026-07-01T21:35:00+08:00')).isOpen, true);
  // 冬令 (EST)：台北 22:00 = 紐約 09:00 → 尚未開盤；22:35 → 開盤
  assert.equal(getSession('us_stock', at('2026-12-01T22:00:00+08:00')).isOpen, false);
  assert.equal(getSession('us_stock', at('2026-12-01T22:35:00+08:00')).isOpen, true);
});
