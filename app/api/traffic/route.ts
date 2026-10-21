import { handleTrafficCountRequest } from "../../traffic-count-core.mjs";

export async function POST(request: Request) {
  return handleTrafficCountRequest(request, { env: process.env });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { Allow: "POST, OPTIONS" } });
}
