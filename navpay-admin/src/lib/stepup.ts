import type { NextRequest } from "next/server";
import { readCookieFromHeader } from "@/lib/webauthn-cookie";

export const STEPUP_COOKIE = "np_stepup_until";
export const STEPUP_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function isStepUpSatisfied(req: NextRequest): boolean {
  const cookieHeader = req.headers.get("cookie");
  const v = readCookieFromHeader(cookieHeader, STEPUP_COOKIE);
  if (!v) return false;
  const until = Number(v);
  if (!Number.isFinite(until)) return false;
  return until > Date.now();
}

