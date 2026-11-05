/** `npm run verify:receipt [path]` — independently re-verify a swarm audit receipt. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyReceipt } from "./receipt-verifier";

const path = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..", "latest-swarm-receipt.json");
const receipt = JSON.parse(readFileSync(path, "utf8"));
const result = verifyReceipt(receipt);
console.log(`Verifying ${path}`);
for (const check of result.checks) console.log(`  ${check.ok ? "✓" : "✗"} ${check.name.padEnd(32)} ${check.detail}`);
console.log(result.ok ? "RECEIPT VERIFIED" : "RECEIPT VERIFICATION FAILED");
process.exit(result.ok ? 0 : 1);
