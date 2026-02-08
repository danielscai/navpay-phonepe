import "dotenv/config";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword, validateStrongPassword } from "@/lib/password";

function usage(): never {
  // eslint-disable-next-line no-console
  console.error("Usage: tsx scripts/reset-admin.ts <username> [password]");
  process.exit(2);
}

async function main() {
  const username = process.argv[2];
  const password = process.argv[3] ?? "NavPay@123456!";
  if (!username) usage();

  const ok = validateStrongPassword(password);
  if (!ok.ok) {
    // eslint-disable-next-line no-console
    console.error("Password not strong enough:", ok.reason);
    process.exit(2);
  }

  const row = await db.select().from(users).where(eq(users.username, username)).limit(1);
  const u = row[0];
  if (!u) {
    // eslint-disable-next-line no-console
    console.error("User not found:", username);
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  await db
    .update(users)
    .set({
      passwordHash,
      passwordUpdatedAtMs: Date.now(),
      failedLoginCount: 0,
      lockUntilMs: null as any,
      // Reset 2FA so the account can log in with password, then enroll again.
      totpEnabled: false,
      totpMustEnroll: true,
      totpSecretEnc: null,
      totpBackupCodesHashJson: null,
      updatedAtMs: Date.now(),
    })
    .where(eq(users.id, u.id));

  // eslint-disable-next-line no-console
  console.log("Admin reset ok:", { username, password });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

