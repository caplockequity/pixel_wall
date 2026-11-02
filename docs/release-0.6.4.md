# PixelWall 0.6.4 — desktop health and clearer reporting

PixelWall can now report anonymous app launches and update outcomes, alongside the existing MCP operation counts. This helps distinguish a downloaded update, an installation attempt, and an editor that opens on the expected new version.

The shared **Help → Share anonymous app and MCP usage** control remains on by default for packaged builds. An existing off preference stays off. The reports contain fixed categories, app and target release versions, platform, and processor type. They never include artwork, scripts, file paths, email, customer identifiers, or raw errors. Offline activity is not queued or backfilled.

Reporting failures cannot stop an update. The save-before-restart protections from 0.6.3 remain in place.

The hosted analytics now also have maintained metric definitions, a desktop health dashboard, and a separate verified business scorecard. Purchase totals come from Stripe payment records; checkout interest and complimentary licenses are reported separately.
