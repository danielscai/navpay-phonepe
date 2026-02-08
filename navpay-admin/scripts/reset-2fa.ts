import "dotenv/config";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

function usage(): never {
  // eslint-disable-next-line no-console
  console.error("Usage: tsx scripts/reset-2fa.ts <username>");
  process.exit(2);
}

async function main() {
  const username = process.argv[2];
  if (!username) usage();

  const row = await db.select().from(users).where(eq(users.username, username)).limit(1);
  const u = row[0];
  if (!u) {
    // eslint-disable-next-line no-console
    console.error("User not found:", username);
    process.exit(1);
  }

  await db
    .update(users)
    .set({
      totpEnabled: false,
      totpMustEnroll: true,
      totpSecretEnc: null,
      totpBackupCodesHashJson: null,
      updatedAtMs: Date.now(),
    })
    .where(eq(users.id, u.id));

  // eslint-disable-next-line no-console
  console.log("2FA reset ok:", { username });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

