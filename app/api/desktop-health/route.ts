import { handleDesktopHealthRequest } from "../../desktop-health-core.mjs";
export async function POST(request: Request) { return handleDesktopHealthRequest(request, { env: process.env }); }
export function OPTIONS() { return new Response(null, { status: 204, headers: { Allow: "POST, OPTIONS" } }); }
