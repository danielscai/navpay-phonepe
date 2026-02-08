import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/auth/auth-options";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function requireSessionUser() {
  const session = await getServerSession(authOptions);
  const uid = (session as any)?.uid as string | undefined;
  if (!uid) redirect("/auth/login");

  const row = await db.select().from(users).where(eq(users.id, uid)).limit(1);
  const user = row[0];
  if (!user) redirect("/auth/login");
  return { session, user };
}

