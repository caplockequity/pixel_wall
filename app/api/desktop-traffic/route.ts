import { handleDesktopTrafficRequest } from "../../desktop-traffic-core.mjs";

export async function POST(request: Request) {
  return handleDesktopTrafficRequest(request, { env: process.env });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { Allow: "POST, OPTIONS" } });
}
