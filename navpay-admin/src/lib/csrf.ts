import crypto from "node:crypto";
import type { NextRequest } from "next/server";

export const CSRF_COOKIE = "np_csrf";
export const CSRF_HEADER = "x-csrf-token";

export function newCsrfToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function requireCsrf(req: NextRequest) {
  const cookie = req.cookies.get(CSRF_COOKIE)?.value;
  const header = req.headers.get(CSRF_HEADER);
  if (!cookie || !header || cookie !== header) {
    const e = new Error("csrf_failed");
    (e as any).status = 403;
    throw e;
  }
}

