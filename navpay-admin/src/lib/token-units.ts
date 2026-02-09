import Decimal from "decimal.js";

export function fromTokenUnits(opts: { value: string; decimals: number }): string {
  const raw = String(opts.value ?? "").trim();
  const decs = Math.max(0, Math.floor(Number(opts.decimals) || 0));
  if (!raw) throw new Error("bad_value");
  if (!/^\d+$/.test(raw)) throw new Error("bad_value");
  const n = new Decimal(raw);
  const d = new Decimal(10).pow(decs);
  return n.div(d).toFixed(decs).replace(/\.?0+$/, (m) => (m.startsWith(".") ? "" : m));
}

