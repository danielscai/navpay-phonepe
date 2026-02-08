import { Decimal } from "decimal.js";

export function dec(x: string | number | Decimal): Decimal {
  return new Decimal(x);
}

export function money2(x: string | number | Decimal): string {
  return dec(x).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

export function feeFromBps(amount: string, bps: number, minFee: string): { fee: string } {
  const a = dec(amount);
  const rate = new Decimal(bps).div(10000);
  const fee = a.mul(rate);
  const min = dec(minFee);
  const finalFee = Decimal.max(fee, min);
  return { fee: money2(finalFee) };
}

