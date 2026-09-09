export function PricingTable() {
  return <div className="price-grid">
    <section className="price-card"><p className="eyebrow">FREE STUDIO</p><h2>$0</h2><p>Draw, animate, and keep your work.</p><ul><li>Drawing, layers, groups, and references</li><li>Animation, scripting, API, and CLI</li><li>Tilemap editing and seam preview</li><li>Frame PNG, BMP, and TGA exports</li><li>Recovery and editable project files</li></ul><a className="site-button secondary" href="/editor">Start drawing</a></section>
    <section className="price-card pro"><p className="eyebrow">PIXELWALL PRO</p><h2>$15 <small>USD once</small></h2><p>The free studio, plus more ways to export.</p><ul><li>Animated GIFs at 1×, 2×, 4×, or 8×</li><li>Sprite-sheet PNGs</li><li>Sprite ZIPs with PNG and JSON</li><li>Tiled-compatible tilemap packages</li><li>Named export presets</li></ul><a className="site-button" href="/editor">View Pro in the editor</a><p className="fine-print">No subscription. Taxes may apply. Keep listed Pro exports with your downloaded app and ownership license.</p></section>
  </div>;
}
