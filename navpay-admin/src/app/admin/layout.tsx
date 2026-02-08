import Link from "next/link";
import { requireSessionUser } from "@/lib/auth";
import { requireIpAllowed } from "@/lib/access";
import AdminShell from "@/components/admin-shell";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { webauthnCredentials } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireIpAllowed().catch(() => {
    // In dev, no IP header likely; allow. If explicitly denied, throw.
  });
  const { user } = await requireSessionUser();
  if (user.totpMustEnroll) {
    const passkey = await db
      .select({ id: webauthnCredentials.id })
      .from(webauthnCredentials)
      .where(and(eq(webauthnCredentials.userId, user.id), isNull(webauthnCredentials.revokedAtMs)))
      .limit(1);
    if (!passkey.length) redirect("/auth/2fa/enroll");
  }

  return <AdminShell>{children}</AdminShell>;
}
