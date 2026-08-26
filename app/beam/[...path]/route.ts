import {
  posthogRequestHeaders,
  posthogResponseHeaders,
  posthogUpstreamUrl,
} from "../../posthog-proxy-core.mjs";

async function proxyPostHogRequest(request: Request) {
  try {
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const upstream = await fetch(posthogUpstreamUrl(
      request.url,
      process.env.NEXT_PUBLIC_POSTHOG_HOST,
    ), {
      method: request.method,
      headers: posthogRequestHeaders(request.headers),
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: "manual",
      signal: request.signal,
    });
    const responseHasBody = request.method !== "HEAD" && upstream.status !== 204 && upstream.status !== 304;
    return new Response(responseHasBody ? upstream.body : null, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: posthogResponseHeaders(upstream.headers),
    });
  } catch {
    return new Response(null, { status: 502 });
  }
}

export const GET = proxyPostHogRequest;
export const POST = proxyPostHogRequest;
export const HEAD = proxyPostHogRequest;

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: { Allow: "GET, POST, HEAD, OPTIONS" },
  });
}
