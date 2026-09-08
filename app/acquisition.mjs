/**
 * Describes only the current document's immediate referrer. No cross-page
 * attribution, campaign parsing, browser access, or persistence happens here.
 * @param {string} referrer
 * @param {string} currentOrigin
 * @returns {{referral_source: string, entry_page?: string}}
 */
export function classifyAcquisition(referrer, currentOrigin) {
  const unknown = { referral_source: "direct_or_unknown" };
  if (!referrer) return unknown;
  let source;
  let destination;
  try {
    source = new URL(referrer);
    destination = new URL(currentOrigin);
  } catch { return unknown; }
  if (!["https:", "http:"].includes(source.protocol) || !["https:", "http:"].includes(destination.protocol)) return unknown;

  if (source.origin === destination.origin) {
    const path = source.pathname.replace(/\/+$/, "") || "/";
    const entry = path === "/" ? "home"
      : path === "/guides" || path.startsWith("/guides/") ? "guides"
        : ["/sprite-sheet-maker", "/pixel-art-animation", "/pixel-art-tracing", "/tileset-maker"].includes(path) ? "workflow"
          : path === "/pricing" ? "pricing"
            : path === "/support" ? "support" : "other";
    return { referral_source: "internal", entry_page: entry };
  }

  const host = source.hostname.toLowerCase().replace(/\.$/, "");
  const domain = (name) => host === name || host.endsWith(`.${name}`);
  if (domain("chatgpt.com") || domain("chat.openai.com")) return { referral_source: "chatgpt" };
  if (domain("claude.ai")) return { referral_source: "claude" };
  if (domain("perplexity.ai")) return { referral_source: "perplexity" };
  if (domain("copilot.microsoft.com")) return { referral_source: "copilot" };
  if (domain("bing.com")) return { referral_source: "bing" };
  if (["google.com", "google.co.uk", "google.ca", "google.com.au", "google.de", "google.fr", "google.co.in", "google.co.jp"].some(domain)) return { referral_source: "google" };
  return { referral_source: "other" };
}
