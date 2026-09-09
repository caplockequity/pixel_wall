import { createBillingService } from "../../../billing-core.mjs";

export const dynamic = "force-dynamic";

function handle(request: Request) {
  return createBillingService({ env: process.env }).handle(request);
}

export const GET = handle;
export const POST = handle;

export const OPTIONS = handle;
