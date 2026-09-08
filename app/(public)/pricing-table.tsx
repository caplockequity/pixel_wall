export function PricingTable() {
  return <div className="price-grid">
    <section className="price-card"><p className="eyebrow">FREE STUDIO</p><h2>$0</h2><p>Draw, animate, and keep your work.</p><ul><li>Drawing, four layers, and references</li><li>Animation editing and playback</li><li>Tilemap editing and seam preview</li><li>Individual frame PNG exports</li><li>Autosave and editable project files</li></ul><a className="site-button secondary" href="/editor">Start drawing</a></section>
    <section className="price-card pro"><p className="eyebrow">PIXELWALL PRO</p><h2>$19 <small>USD once</small></h2><p>The free studio, plus more ways to export.</p><ul><li>Animated GIFs at 1×, 2×, 4×, or 8×</li><li>Sprite-sheet PNGs</li><li>Sprite ZIPs with PNG and JSON</li><li>Tiled-compatible tilemap packages</li><li>Named export presets</li></ul><a className="site-button" href="/editor">View Pro in the editor</a><p className="fine-print">No subscription. Taxes may apply. Listed Pro features for as long as PixelWall is available.</p></section>
  </div>;
}
