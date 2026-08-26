const REQUEST_HEADER_ALLOWLIST = [
  "accept",
  "content-encoding",
  "content-type",
  "if-modified-since",
  "if-none-match",
  "range",
];

const RESPONSE_HEADER_ALLOWLIST = [
  "accept-ranges",
  "cache-control",
  "content-range",
  "content-type",
  "etag",
  "expires",
  "last-modified",
  "vary",
];

function copyAllowedHeaders(source, names, initial) {
  const headers = new Headers(initial);
  for (const name of names) {
    const value = source.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

export function posthogUpstreamUrl(requestUrl, configuredHost) {
  const incoming = new URL(requestUrl);
  const path = incoming.pathname.slice("/beam".length) || "/";
  let region = "us";
  try {
    if (new URL(configuredHost ?? "").hostname === "eu.i.posthog.com") region = "eu";
  } catch {
    // Invalid or missing configuration remains on the documented US default.
  }
  const isAssetRequest = path.startsWith("/static/") || path.startsWith("/array/");
  const upstream = new URL(isAssetRequest
    ? `https://${region}-assets.i.posthog.com`
    : `https://${region}.i.posthog.com`);
  // Assignment keeps even a path beginning with // on the fixed PostHog origin.
  upstream.pathname = path;
  upstream.search = incoming.search;
  return upstream;
}

export function posthogRequestHeaders(source) {
  return copyAllowedHeaders(source, REQUEST_HEADER_ALLOWLIST, { "accept-encoding": "identity" });
}

export function posthogResponseHeaders(source) {
  return copyAllowedHeaders(source, RESPONSE_HEADER_ALLOWLIST);
}
