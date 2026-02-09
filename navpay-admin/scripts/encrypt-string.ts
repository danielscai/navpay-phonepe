import "dotenv/config";
import { encryptString } from "@/lib/crypto";

const [plaintext, key] = process.argv.slice(2);
if (!plaintext || !key) {
  console.error("Usage: tsx scripts/encrypt-string.ts <plaintext> <key>");
  process.exit(2);
}
console.log(encryptString(plaintext, key));

