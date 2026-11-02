import { handleCliTrafficRequest } from '../../cli-traffic-core.mjs';

export async function POST(request: Request) {
  return handleCliTrafficRequest(request, { env: process.env });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { Allow: 'POST, OPTIONS' } });
}
