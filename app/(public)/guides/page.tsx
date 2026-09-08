import { pages } from "../../content";
import { pageMetadata } from "../../site";
export const metadata = pageMetadata("Pixel Art Guides & Export Reference", "Learn to draw and save pixel art, make animations, and use PixelWall sprite sheets and tilemaps with Phaser, PixiJS, and Tiled.", "/guides");
export default function GuidesPage() {
  return <main id="content" className="document-page"><header className="document-header"><p className="eyebrow">THE FIELD GUIDE</p><h1>From first pixel<br />to your next game.</h1><p className="lede">Start small. Keep an editable backup. Take your sprites into the tools you use.</p><a className="site-button" href="/editor">Open editor ↗</a></header><div className="guide-grid">{pages.filter((page) => page.slug.startsWith("guides/")).map((page, index) => <a className="guide-card" key={page.slug} href={`/${page.slug}`}><span className="eyebrow">0{index + 1} / {page.eyebrow}</span><h2>{page.title}</h2><p>{page.description}</p><span className="text-link">Read guide ↗</span></a>)}</div></main>;
}
