import type { NextRequest } from "next/server";

export function getClientIp(req: NextRequest): string | null {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]?.trim() ?? null;
  const xr = req.headers.get("x-real-ip");
  return xr ?? null;
}

