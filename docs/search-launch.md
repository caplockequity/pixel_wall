# PixelWall search launch

Public production is https://www.pixelwall.dev on Vercel. The apex redirects there. The OpenAI Sites copy must remain owner-only; do not publish it publicly or submit its URLs for indexing.

## Implemented

- Static public homepage, four workflow pages, pricing/about/support/privacy/terms, a guide index, export reference, three engine guides, getting-started guide, and downloadable starter example.
- Same-origin editor at /editor; unchanged project storage keys and purchase cookies. Legacy /?checkout=… returns redirect with their query parameters intact. Installed app identity remains / while start_url is /editor.
- Canonical metadata uses www.pixelwall.dev. Sitemap and robots are generated from the content inventory. Preview builds and vercel.app aliases get noindex protection.
- Server-only public pages, ordinary links without editor prefetch, separate studio styles, and no global analytics initializer. Optional SDK download begins only after consent; a failed or delayed download cannot bypass privacy choices.
- SoftwareApplication, organization, website and breadcrumb data; technical article data for guides. No invented reviews or ratings.
- Studio's existing Desert Signal starter exported as a tiny static homepage image and downloadable project, PNGs, GIF and JSON. Regenerate with `node scripts/export-demo.mjs`.

## Verify and publish

1. Run `npm run lint`, `npm test`, and `npm run build:vercel` (run the two build systems sequentially).
2. Run a production Next server and `node scripts/audit-search.mjs http://localhost:3100` to audit public routes, checkout redirects, sitemap, app manifest, and initial scripts. Gzip figures are controlled local script-size estimates, not measured Core Web Vitals.
3. Review and deploy through the existing Vercel production workflow. Keep current production payment and analytics settings. No new service dependency is required.
4. Repeat the audit against https://www.pixelwall.dev after release. Confirm the OpenAI Sites URL still blocks anonymous access.

## Account setup still required

- Verify pixelwall.dev as a domain property in Google Search Console and Bing Webmaster Tools. Domain verification normally uses DNS. If using HTML verification, set GOOGLE_SITE_VERIFICATION / BING_SITE_VERIFICATION in Vercel and rebuild; leave them absent until actual tokens are issued.
- Submit https://www.pixelwall.dev/sitemap.xml. Inspect the homepage and a workflow page. Check Google's generative-AI inclusion setting and Bing's AI Performance report when data is available.
- Confirm legitimate Googlebot, Bingbot, OAI-SearchBot, Claude-SearchBot and PerplexityBot can retrieve production through the host/firewall. robots.txt permits public crawling; that alone does not verify firewall behavior or guarantee indexing.
- Optional IndexNow: configure verified ownership and change notifications when the production publishing workflow is connected. Do not submit preview or private Sites URLs.

## Next content and measurement work

- Engine examples follow linked official APIs and the export planners. Browser engine playback and Tiled desktop opening still need integration validation before calling them runtime-tested.
- Build a complete original character-and-tile game kit with a playable demo, then seek relevant creator, educator and engine-community coverage. The starter example is not a full game kit.
- Use Search Console/Bing for acquisition and citations. Public pages intentionally have no analytics JavaScript. After consent, editor events include fixed immediate-referral and internal entry-page categories, with raw referral/campaign fields removed. They cannot recover an external referrer lost through a public-page handoff.
- Establish a fixed prompt sample across ChatGPT, Google AI/Gemini, Claude, Perplexity and Copilot. Record date, mode, citation URL, recommendation and factual accuracy. Do not treat one answer as a stable ranking.
- Performance targets: real-user LCP ≤2.5 s, INP ≤200 ms and CLS ≤0.1 at the 75th percentile. No field scores or traffic growth are claimed from a local build.
