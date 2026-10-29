import assert from "node:assert/strict";
import test from "node:test";
import { classifyAcquisition, createWorkflowAttribution, workflowPage, workflowFromReferrer } from "../app/acquisition.mjs";

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

test("workflow categories accept exact public paths and discard referrer details", () => {
  assert.equal(workflowPage('/pixel-art-tracing/'), 'tracing');
  assert.equal(workflowPage('/tileset-maker'), 'tileset');
  assert.equal(workflowPage('/pixel-art-animation'), 'animation');
  assert.equal(workflowPage('/sprite-sheet-maker'), 'sprite_sheet');
  for (const path of ['/private/tracing', '/pixel-art-tracing/private', '/tileset-maker?private=1', {}, undefined]) assert.equal(workflowPage(path), undefined);
  assert.equal(workflowFromReferrer(`${origin}/pixel-art-tracing?private=secret#artwork`, origin), 'tracing');
  for (const referrer of ['https://evil.example/tileset-maker', 'https://www.pixelwall.dev.evil.example/tileset-maker', 'https://user:secret@www.pixelwall.dev/tileset-maker', '/tileset-maker', 'invalid']) {
    assert.equal(workflowFromReferrer(referrer, origin), undefined);
  }
});

test("workflow handoffs survive both editor routes but clear on unrelated navigation", () => {
  const journey = createWorkflowAttribution();
  assert.deepEqual(journey.update('/pixel-art-tracing'), { workflow_page: 'tracing' });
  assert.deepEqual(journey.update('/editor/classic'), { workflow_page: 'tracing' });
  assert.deepEqual(journey.update('/editor'), { workflow_page: 'tracing' });
  assert.deepEqual(journey.update('/tileset-maker'), { workflow_page: 'tileset' });
  assert.deepEqual(journey.update('/editor'), { workflow_page: 'tileset' });
  assert.deepEqual(journey.update('/'), {});
  assert.deepEqual(journey.update('/editor', () => 'tracing'), {}, 'a stale document referrer cannot revive attribution after another page');
});

test("a fresh editor document can classify its immediate referrer once without persistent storage", () => {
  const journey = createWorkflowAttribution();
  let reads = 0;
  assert.deepEqual(journey.update('/editor/classic', () => { reads++; return 'tracing'; }), { workflow_page: 'tracing' });
  assert.deepEqual(journey.update('/editor/classic', () => { reads++; return 'tileset'; }), { workflow_page: 'tracing' });
  assert.equal(reads, 1);
  assert.deepEqual(createWorkflowAttribution().update('/editor', () => 'private-user'), {});
  assert.deepEqual(createWorkflowAttribution().update('/editor'), {}, 'another document has no inherited state');
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
