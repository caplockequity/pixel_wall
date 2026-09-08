import assert from "node:assert/strict";
import test from "node:test";
import { classifyAcquisition } from "../app/acquisition.mjs";

const origin = "https://www.pixelwall.dev";

test("immediate external referrers become fixed source categories without URL details", () => {
  for (const [referrer, source] of [
    ["https://chatgpt.com/c/private?utm_source=private#secret", "chatgpt"],
    ["https://chat.openai.com/", "chatgpt"],
    ["https://claude.ai/chat/private", "claude"],
    ["https://www.perplexity.ai/search/private", "perplexity"],
    ["https://copilot.microsoft.com/", "copilot"],
    ["https://www.bing.com/search?q=private", "bing"],
    ["https://www.google.com/search?q=private", "google"],
    ["https://www.google.co.uk/", "google"],
    ["https://gemini.google.com/app/private", "google"],
    ["https://chatgpt.com.evil.example/", "other"],
    ["https://notchatgpt.com/", "other"],
    ["https://chatgpt.com@evil.example/", "other"],
    ["https://example.com/private", "other"],
    ["", "direct_or_unknown"],
    ["not a URL", "direct_or_unknown"],
    ["/guides", "direct_or_unknown"],
    ["data:text/plain,private", "direct_or_unknown"],
  ]) assert.deepEqual(classifyAcquisition(referrer, origin), { referral_source: source });
  assert.deepEqual(classifyAcquisition("https://chatgpt.com/", "invalid"), { referral_source: "direct_or_unknown" });
});

test("same-origin handoffs expose only page categories and cannot claim earlier acquisition", () => {
  for (const [path, page] of [
    ["/", "home"], ["/guides", "guides"], ["/guides/private?source=chatgpt", "guides"],
    ["/sprite-sheet-maker", "workflow"], ["/pixel-art-tracing", "workflow"],
    ["/pixel-art-animation", "workflow"], ["/tileset-maker", "workflow"],
    ["/pricing/?utm_source=chatgpt", "pricing"], ["/support", "support"],
    ["/private-path?secret=value", "other"], ["/guides-private", "other"],
  ]) assert.deepEqual(classifyAcquisition(`${origin}${path}`, origin), { referral_source: "internal", entry_page: page });
  assert.deepEqual(classifyAcquisition("https://pixelwall.dev/guides", origin), { referral_source: "other" }, "a different origin is not an internal handoff");
});
