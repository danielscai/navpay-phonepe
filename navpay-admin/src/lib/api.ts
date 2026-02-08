import { getServerSession } from "next-auth";
import type { NextRequest } from "next/server";
import { authOptions } from "@/auth/auth-options";
import { requireCsrf } from "@/lib/csrf";
import { requirePerm } from "@/lib/rbac";

export async function requireApiUser(req: NextRequest, opts?: { csrf?: boolean }) {
  const method = req.method.toUpperCase();
  const needsCsrf = !["GET", "HEAD", "OPTIONS"].includes(method);
  if (needsCsrf && opts?.csrf !== false) requireCsrf(req);
  const session = await getServerSession(authOptions);
  const uid = (session as any)?.uid as string | undefined;
  if (!uid) {
    const e = new Error("unauthorized");
    (e as any).status = 401;
    throw e;
  }
  return { uid };
}

export async function requireApiPerm(req: NextRequest, perm: string) {
  const { uid } = await requireApiUser(req);
  await requirePerm(uid, perm);
  return { uid };
}
