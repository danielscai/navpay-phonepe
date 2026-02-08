type CookieOpts = {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
  path?: string;
  maxAgeSec?: number;
};

export function buildSetCookie(name: string, value: string, opts?: CookieOpts): string {
  const parts: string[] = [];
  parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(value)}`);
  parts.push(`Path=${opts?.path ?? "/"}`);
  if (opts?.httpOnly ?? true) parts.push("HttpOnly");
  const sameSite = opts?.sameSite ?? "lax";
  parts.push(`SameSite=${sameSite[0].toUpperCase() + sameSite.slice(1)}`);
  if (opts?.secure) parts.push("Secure");
  if (typeof opts?.maxAgeSec === "number") parts.push(`Max-Age=${Math.floor(opts.maxAgeSec)}`);
  return parts.join("; ");
}

export function readCookieFromHeader(cookieHeader: string | undefined | null, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx < 0) continue;
    const k = decodeURIComponent(p.slice(0, idx).trim());
    if (k !== name) continue;
    return decodeURIComponent(p.slice(idx + 1).trim());
  }
  return null;
}

