// Owner-only support tool. Never expose this as an HTTP endpoint.
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { billingConfig, createBillingService } from "../app/billing-core.mjs";

const [sessionId, destination] = process.argv.slice(2);
if (!sessionId || !destination) {
  console.error("Usage: node --env-file=.env.local scripts/recover-pro.mjs <checkout-session-id> <private-output-file>");
  process.exitCode = 1;
} else {
  try {
    const config = billingConfig(process.env);
    if (!config.ready) throw new Error("Configure the Stripe price, server key, store URL, and existing license secret first.");
    const service = createBillingService({ env: process.env });
    await service.readPurchase(sessionId);
    const code = await service.licenseFor(sessionId);
    await writeFile(resolve(destination), `PixelWall Pro recovery code\n\n${code}\n\nKeep this code private. Restore it from the Pro menu at ${config.origin}.\n`, { mode: 0o600, flag: "wx" });
    console.log("Private recovery file created. Deliver only to the verified purchase email.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Recovery failed.");
    process.exitCode = 1;
  }
}
