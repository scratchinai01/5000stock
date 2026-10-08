// 手續費與交易稅 (新台幣)。費率為教學模擬用的常見水準，可依課程需要調整。
import type { Category, Side, OrderIntent } from '../../shared/types.ts';

export const FEE_RULES = {
  twCashFeeRate: 0.001425,     // 證券手續費 0.1425%
  twCashMinFee: 20,            // 最低 20 元
  twStockSellTax: 0.003,       // 股票證交稅 0.3% (賣出)
  twEtfSellTax: 0.001,         // ETF 證交稅 0.1% (賣出)
  twBondEtfSellTax: 0,         // 債券 ETF 證交稅停徵
  twFutureFeePerLot: { TX: 50, MTX: 25, TMF: 12 } as Record<string, number>,
  twFutureTaxRate: 0.00002,    // 期交稅 十萬分之二 (買賣皆課)
  twOptionFeePerLot: 25,
  twOptionTaxRate: 0.001,      // 選擇權交易稅 千分之一 (權利金)
  usFeeRate: 0.001,            // 複委託 0.1%
  usMinFeeUsd: 1,
  commodityFeePerLotUsd: 2.5,
  cryptoFeeRate: 0.001,
};

/** 是否為「賣出」動作 (平多單或開空單) —— 證交稅只在賣出時課徵 */
function isSell(side: Side, intent: OrderIntent) {
  return (side === 'LONG' && intent === 'CLOSE') || (side === 'SHORT' && intent === 'OPEN');
}

export function calcFeeTax(args: {
  category: Category;
  symbol: string;
  side: Side;
  intent: OrderIntent;
  qty: number;
  notionalTwd: number;
  fx: number;
}): { fee: number; tax: number } {
  const { category, symbol, side, intent, qty, notionalTwd, fx } = args;
  const R = FEE_RULES;
  switch (category) {
    case 'tw_stock':
    case 'tw_etf':
    case 'tw_bond_etf': {
      const fee = Math.max(R.twCashMinFee, Math.floor(notionalTwd * R.twCashFeeRate));
      const rate = category === 'tw_stock' ? R.twStockSellTax : category === 'tw_etf' ? R.twEtfSellTax : R.twBondEtfSellTax;
      const tax = isSell(side, intent) ? Math.floor(notionalTwd * rate) : 0;
      return { fee, tax };
    }
    case 'tw_future':
      return {
        fee: (R.twFutureFeePerLot[symbol] ?? 50) * qty,
        tax: Math.round(notionalTwd * R.twFutureTaxRate),
      };
    case 'tw_option':
      return { fee: R.twOptionFeePerLot * qty, tax: Math.round(notionalTwd * R.twOptionTaxRate) };
    case 'us_stock':
      return { fee: round2(Math.max(notionalTwd * R.usFeeRate, R.usMinFeeUsd * fx)), tax: 0 };
    case 'commodity':
      return { fee: round2(R.commodityFeePerLotUsd * fx * qty), tax: 0 };
    case 'crypto':
      return { fee: round2(notionalTwd * R.cryptoFeeRate), tax: 0 };
  }
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
