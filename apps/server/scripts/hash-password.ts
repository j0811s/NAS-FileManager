import { hashPassword } from "../src/lib/password";

const password = process.argv[2];
if (!password) {
  console.error("Usage: npx tsx apps/server/scripts/hash-password.ts <password>");
  process.exit(1);
}
console.log(hashPassword(password));
