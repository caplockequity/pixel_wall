import { sitePageGroup } from './site-analytics-core.mjs';

export const WORKFLOW_PAGES = Object.freeze(['tracing', 'tileset', 'animation', 'sprite_sheet']);
const WORKFLOW_PATHS = new Map([
  ['/pixel-art-tracing', 'tracing'], ['/tileset-maker', 'tileset'],
  ['/pixel-art-animation', 'animation'], ['/sprite-sheet-maker', 'sprite_sheet'],
]);

export function workflowPage(pathname) {
  return typeof pathname === 'string' ? WORKFLOW_PATHS.get(pathname.replace(/\/+$/, '')) : undefined;
}

// Inspect only a same-origin handoff. The URL is never returned or retained.
export function workflowFromReferrer(referrer, currentOrigin) {
  try {
    const source = new URL(referrer);
    const destination = new URL(currentOrigin);
    if (!['https:', 'http:'].includes(source.protocol) || source.origin !== destination.origin || source.username || source.password) return undefined;
    return workflowPage(source.pathname);
  } catch { return undefined; }
}

// Tab-memory only: a workflow page followed directly by either editor. Clear
// attribution on any other page; do not create campaign/session/visitor storage.
export function createWorkflowAttribution() {
  let previousPage;
  let workflow;
  const editor = page => page === 'editor' || page === 'classic_editor';
  return {
    /**
     * @param {string} pathname
     * @param {() => string | undefined} [initialWorkflow]
     * @returns {Record<string, string>}
     */
    update(pathname, initialWorkflow = () => undefined) {
      const page = sitePageGroup(pathname);
      if (page === 'workflow') workflow = workflowPage(pathname);
      else if (editor(page)) {
        if (previousPage === undefined) workflow = initialWorkflow();
        else if (previousPage !== 'workflow' && !editor(previousPage)) workflow = undefined;
      } else workflow = undefined;
      previousPage = page;
      return WORKFLOW_PAGES.includes(workflow) ? { workflow_page: workflow } : {};
    },
  };
}

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
            : path === "/support" ? "support"
              : path === "/downloads" ? "downloads"
                : path === "/editor" || path.startsWith("/editor/") ? "editor" : "other";
    return { referral_source: "internal", entry_page: entry };
  }

  const host = source.hostname.toLowerCase().replace(/\.$/, "");
  const domain = (name) => host === name || host.endsWith(`.${name}`);
  if (domain("chatgpt.com") || domain("chat.openai.com")) return { referral_source: "chatgpt" };
  if (domain("claude.ai")) return { referral_source: "claude" };
  if (domain("perplexity.ai")) return { referral_source: "perplexity" };
  if (domain("copilot.microsoft.com")) return { referral_source: "copilot" };
  if (domain("reddit.com")) return { referral_source: "reddit" };
  if (domain("github.com")) return { referral_source: "github" };
  if (domain("bing.com")) return { referral_source: "bing" };
  if (["google.com", "google.co.uk", "google.ca", "google.com.au", "google.de", "google.fr", "google.co.in", "google.co.jp"].some(domain)) return { referral_source: "google" };
  return { referral_source: "other" };
}
