import "./public.css";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <div className="public-site">
    <a className="skip-link" href="#content">Skip to content</a>
    <header className="site-header">
      <a href="/" className="site-brand" aria-label="PixelWall home">PIXEL<span>WALL</span><span className="brand-dot" aria-hidden="true">▧</span></a>
      <nav aria-label="Main navigation"><a href="/downloads">Downloads</a><a href="/guides">Guides</a><a href="/pricing">Pricing</a><a className="site-button small" href="/editor">Open editor <span aria-hidden="true">↗</span></a></nav>
    </header>
    {children}
    <footer className="site-footer">
      <div><a href="/" className="site-brand">PIXELWALL</a><p>A pixel-art studio by CapLock.</p></div>
      <nav aria-label="Resources"><a href="/downloads">Desktop downloads</a><a href="/guides/ai-agents">AI agent guide</a><a href="/sprite-sheet-maker">Sprite sheets</a><a href="/pixel-art-animation">Animation</a><a href="/pixel-art-tracing">Reference tracing</a><a href="/tileset-maker">Tiles &amp; maps</a></nav>
      <nav aria-label="Company and support"><a href="/about">About</a><a href="/support">Support</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav>
      <div className="footer-bottom"><span>© 2026 CapLock</span><a href="mailto:contact@caplock.ai">contact@caplock.ai</a></div>
    </footer>
  </div>;
}
