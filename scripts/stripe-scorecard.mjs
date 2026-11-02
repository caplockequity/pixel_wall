#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createBillingService } from "../app/billing-core.mjs";

const args = process.argv.slice(2);
function value(flag) { const index = args.indexOf(flag); return index < 0 ? null : args[index + 1] ?? null; }
const envPath = resolve(value("--env") ?? ".env.production.local");
try { process.loadEnvFile(envPath); } catch { console.error(`Unable to read ${envPath}`); process.exit(2); }
const service = createBillingService({ env: process.env });
const from = value("--from");
const to = value("--to");
if (!from || !to) { console.error("Usage: stripe-scorecard.mjs --env <path> --from <ISO UTC> --to <ISO UTC> [--out <path>]"); process.exit(2); }
let report;
try { report = await service.scorecard({ from, to }); } catch (error) { console.error("Unable to produce a complete scorecard. Check the date range, configured Stripe account, and source availability."); process.exit(1); }
const output = value("--out");
if (output) { const path = resolve(output); await mkdir(dirname(path), { recursive: true }); await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }); }
console.log(JSON.stringify(report, null, 2));
