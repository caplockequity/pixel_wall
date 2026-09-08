import { pageMetadata, SITE_DESCRIPTION, SITE_URL } from "../site";
import { StructuredData } from "../structured-data";
import { findPage } from "../content";

export const metadata = pageMetadata("Online Pixel Art Editor & Sprite Maker", SITE_DESCRIPTION);
const workflows = [
  { slug: "pixel-art-tracing", number: "01", title: "Start with a reference.", text: "Project a sketch or image behind your canvas. Line it up, lower its opacity, and draw your own pixels." },
  { slug: "pixel-art-animation", number: "02", title: "Make the next frame.", text: "Draw with layers, duplicate a pose, and use onion skin. Give idle, walk, and jump their own clips." },
  { slug: "sprite-sheet-maker", number: "03", title: "Take it into your game.", text: "Export a PNG for free. Pro adds animated GIFs, sprite sheets, and packages with animation metadata." },
  { slug: "tileset-maker", number: "04", title: "Build a little world.", text: "Check repeating edges, draw tiles, and paint a map. Export a Tiled-compatible package with Pro." },
];

export default function HomePage() {
  return <main id="content">
    <StructuredData data={[
      { "@context": "https://schema.org", "@type": "Organization", "@id": `${SITE_URL}/#organization`, name: "CapLock", url: `${SITE_URL}/about`, email: "contact@caplock.ai", logo: `${SITE_URL}/pixelwall-icon-512.png` },
      { "@context": "https://schema.org", "@type": "WebSite", "@id": `${SITE_URL}/#website`, name: "PixelWall", url: SITE_URL, publisher: { "@id": `${SITE_URL}/#organization` } },
      { "@context": "https://schema.org", "@type": "SoftwareApplication", "@id": `${SITE_URL}/#application`, name: "PixelWall", url: SITE_URL, applicationCategory: "DesignApplication", operatingSystem: "Web browser", description: SITE_DESCRIPTION, featureList: ["Reference tracing", "Layered pixel art", "Frame animation", "Tilemap editing", "PNG export", "Pro GIF and sprite package exports"], offers: [{ "@type": "Offer", name: "Free studio", price: "0", priceCurrency: "USD", url: `${SITE_URL}/pricing` }, { "@type": "Offer", name: "PixelWall Pro — one-time purchase", price: "19", priceCurrency: "USD", url: `${SITE_URL}/pricing` }], publisher: { "@id": `${SITE_URL}/#organization` } },
    ]} />
    <section className="home-hero">
      <div className="hero-copy"><p className="eyebrow">PIXEL ART, RIGHT IN YOUR BROWSER</p><h1>Make pixel art.<br />Build your world.</h1><p className="lede">Draw from a reference. Animate a character. Build the tiles for your next game. PixelWall brings it together in a small browser studio.</p><div className="hero-actions"><a className="site-button" href="/editor">Start drawing — free <span aria-hidden="true">↗</span></a><a className="text-link" href="/guides/getting-started">Your first sprite →</a></div><p className="fine-print">No account needed. Free editing and PNG exports.</p></div>
      <figure className="hero-art"><div className="art-label"><span>DESERT SIGNAL</span><span>16 × 16 PX</span></div>
        {/* This is the studio's existing starter artwork, exported as a tiny static PNG. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/examples/desert-signal.png" width="16" height="16" alt="Pixel-art sunset over coral, violet, and teal mountains, made on a 16 by 16 canvas" fetchPriority="high" />
        <figcaption>Small canvas. Room to explore. <a href="/guides/desert-signal">Get this editable example ↗</a></figcaption>
      </figure>
    </section>
    <div className="feature-strip" aria-label="Studio capabilities"><span>REFERENCE TRACING</span><span>LAYERS &amp; ANIMATION</span><span>SPRITES &amp; TILEMAPS</span><span>LOCAL PROJECTS</span></div>
    <section className="home-section"><div className="section-heading"><p className="eyebrow">YOUR NEXT PROJECT</p><h2>A pixel-art editor<br />that follows your ideas.</h2></div><div className="workflow-grid">{workflows.map((item) => <a className="workflow-card" href={`/${item.slug}`} key={item.slug}><span className="workflow-number">{item.number}</span><h3>{item.title}</h3><p>{item.text}</p><span className="text-link">Explore {findPage(item.slug)?.eyebrow.toLowerCase()} ↗</span></a>)}</div></section>
    <section className="home-section saving-section"><div><p className="eyebrow">YOUR WORK, ON YOUR DEVICE</p><h2>Keep the pixels.<br />Keep the project.</h2></div><div><p>Autosave keeps your current work in this browser. Save Project gives you an editable .pixelwall file with your frames, layers, and reference image.</p><p>Keep a downloaded backup before clearing browser data or switching devices.</p><a className="text-link" href="/support">How saving and recovery work →</a></div></section>
    <section className="home-section home-pricing"><div><p className="eyebrow">A FREE STUDIO. AN OPTIONAL UPGRADE.</p><h2>Draw for free.<br />Export more with Pro.</h2><p>Drawing, animation editing, tilemaps, individual PNGs, and project files are free. Pro adds GIFs, sprite sheets, sprite and tilemap ZIPs, and saved export presets.</p></div><div className="price-summary"><strong>$19 <small>USD once</small></strong><p>No subscription. Taxes may apply.</p><a className="site-button" href="/pricing">Compare Free &amp; Pro →</a></div></section>
    <section className="home-section"><div className="section-heading"><p className="eyebrow">LEARN BY MAKING</p><h2>A useful next step.</h2></div><div className="related-links"><a href="/guides/getting-started">Draw and save your first sprite <span aria-hidden="true">↗</span></a><a href="/guides/desert-signal">Download the Desert Signal example <span aria-hidden="true">↗</span></a><a href="/guides/export-formats">Choose the right export format <span aria-hidden="true">↗</span></a></div></section>
  </main>;
}
