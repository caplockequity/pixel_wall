import releaseData from "../../../public/desktop/latest.json";
import firstDesktopRelease from "../../../public/desktop/releases/0.2.0.json";
import { pageMetadata, SITE_URL } from "../../site";
import { StructuredData } from "../../structured-data";
import "./downloads.css";

export const metadata = pageMetadata(
  "Download PixelWall for Mac, Windows & Linux",
  "Download PixelWall for Apple silicon and Intel Macs, Windows, and Linux. Draw pixel art, animate sprites, and keep your projects on your own device.",
  "/downloads",
);

type Platform = "darwin-arm64" | "darwin-x64" | "win32-x64" | "linux-x64";
type Download = { url: string; filename: string; size?: number; sha256?: string; signed?: boolean; notarized?: boolean };
type Release = {
  schemaVersion: number;
  version: string;
  publishedAt: string;
  releaseNotesUrl: string;
  releaseNotes: string[];
  downloads: Partial<Record<Platform, Download>>;
};
const release: Release = releaseData;
const platforms: { key: Platform; family: string; label: string; detail: string; fileType: string; install: string }[] = [
  { key: "darwin-arm64", family: "macOS", label: "Mac · Apple silicon", detail: "For Apple silicon Macs running macOS 12 or newer. Check Apple menu → About This Mac if you’re unsure.", fileType: "ZIP", install: "Open the ZIP, then move PixelWall to your Applications folder." },
  { key: "darwin-x64", family: "macOS", label: "Mac · Intel", detail: "For Intel Macs running macOS 12 or newer. Check Apple menu → About This Mac if you’re unsure.", fileType: "ZIP", install: "Open the ZIP, then move PixelWall to your Applications folder." },
  { key: "win32-x64", family: "Windows", label: "Windows · 64-bit", detail: "For Windows PCs with a 64-bit Intel or AMD processor.", fileType: "EXE", install: "Run the downloaded installer and follow the setup steps." },
  { key: "linux-x64", family: "Linux", label: "Linux · AppImage", detail: "For 64-bit Linux computers with an Intel or AMD processor.", fileType: "AppImage", install: "Allow the downloaded file to run as a program in its file permissions, then open it." },
];
const releaseId = `release-${release.version.replace(/[^a-zA-Z0-9]+/g, "-")}`;
const publicLink = (path: string) => `${SITE_URL}${path}`;
const launchNotes = [
  { title: "Drawing tools", detail: "Pixel-perfect brushes, custom brush masks, symmetry, shapes, gradients, bitmap text, selections, and transforms." },
  { title: "Color and layers", detail: "RGBA, indexed, and grayscale editing, with palettes, layer groups, blend modes, and reference layers." },
  { title: "Animation", detail: "A layer-and-frame timeline, linked cels, frame timing, animation clips, onion skin, and editable frames created with tween and particle tools." },
  { title: "Tiles and maps", detail: "Independent tilesets, tilemap layers, and Manual, Auto, and Stack tile editing." },
  { title: "File compatibility", detail: "Native PixelWall projects, supported Aseprite import and export, PNG/BMP/TGA/GIF imports, sprite-sheet slicing, and image sequences." },
  { title: "Exports", detail: "Free native project and individual PNG/BMP/TGA exports. Pro adds animated GIFs, sprite atlases with JSON, Tiled game packages, and saved export presets." },
  { title: "Local ownership", detail: "A document library with recovery versions, portable project backups, downloadable browser and CLI bundles, and offline Pro ownership licenses." },
  { title: "Free automation", detail: "JavaScript commands, a scripting API, WebMCP, extensions, and a local CLI. External tools can control PixelWall; no AI runs inside the app." },
];

function downloadUrl(download: Download) {
  const url = new URL(download.url);
  if (!["https://pixelwall.dev", SITE_URL].includes(url.origin) || !url.pathname.startsWith("/downloads/desktop/")) {
    throw new Error("Desktop downloads must use the public PixelWall download address.");
  }
  return url.href;
}
function fileSize(size?: number) {
  if (!Number.isFinite(size) || !size || size < 1) return null;
  return size >= 1024 * 1024
    ? `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(size / (1024 * 1024))} MB`
    : `${Math.ceil(size / 1024)} KB`;
}
function releaseDate(value: string) {
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date)
    : value;
}

export default function DownloadsPage() {
  return <main id="content" className="document-page downloads-page">
    <StructuredData data={{
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "PixelWall",
      applicationCategory: "DesignApplication",
      operatingSystem: "macOS, Windows, Linux",
      softwareVersion: release.version,
      url: publicLink("/downloads"),
      downloadUrl: platforms.flatMap(platform => {
        const artifact = release.downloads[platform.key];
        return artifact ? [downloadUrl(artifact)] : [];
      }),
      publisher: { "@type": "Organization", name: "CapLock", url: publicLink("/about") },
    }} />
    <nav className="breadcrumbs" aria-label="Breadcrumb"><a href={SITE_URL}>PixelWall</a><span aria-hidden="true">/</span><span aria-current="page">Downloads</span></nav>

    <header className="document-header downloads-header">
      <p className="eyebrow">PIXELWALL, ON YOUR COMPUTER</p>
      <h1>Your studio.<br />Your own device.</h1>
      <p className="lede">Draw pixel art, animate a character, and build your game’s tiles on Mac, Windows, or Linux. Your artwork stays on your device. No AI runs inside PixelWall.</p>
      <div className="download-release-line"><span className="download-version">Version {release.version}</span><time dateTime={release.publishedAt}>{releaseDate(release.publishedAt)}</time><a href="#release-history">Release history ↓</a></div>
    </header>

    <section aria-labelledby="desktop-downloads-heading">
      <div className="downloads-section-heading"><h2 id="desktop-downloads-heading">Choose your computer.</h2><a className="text-link" href={publicLink("/editor")}>Prefer the browser? Open the editor ↗</a></div>
      <div className="desktop-download-grid">
        {platforms.map(platform => {
          const artifact = release.downloads[platform.key];
          const size = fileSize(artifact?.size);
          const mac = platform.key.startsWith("darwin");
          return <article className="desktop-download-card" key={platform.key} aria-labelledby={`download-${platform.key}`}>
            <div className="download-card-top"><p className="eyebrow">{platform.family}</p><span className="download-file-type">{platform.fileType}</span></div>
            <h3 id={`download-${platform.key}`}>{platform.label}</h3>
            <p className="download-platform-detail">{platform.detail}</p>
            {artifact ? <>
              <a className="site-button download-platform-button" href={downloadUrl(artifact)} download={artifact.filename} aria-label={`Download PixelWall ${release.version} for ${platform.label}`}>
                Download for {platform.family}<span aria-hidden="true">↓</span>
              </a>
              <p className="download-file-info">Version {release.version}{size ? ` · ${size}` : ""}{mac ? <> · <span>{artifact.signed === true ? (artifact.notarized === true ? "Signed & notarized" : "Signed for macOS") : artifact.signed === false ? "Unsigned build" : "Signing status not listed"}</span></> : null}</p>
              <p className="download-install-note">{platform.install}</p>
              {mac && artifact.signed === false ? <p className="download-signing-note">This build is not signed with an Apple Developer ID. macOS may prevent it from opening. <a href={publicLink("/support")}>Get help</a>.</p> : null}
              {platform.key === "win32-x64" && artifact.signed === false ? <p className="download-signing-note">The Windows installer is unsigned. Windows may show an unknown-publisher warning.</p> : null}
              {artifact.sha256 ? <details className="download-checksum"><summary>File checksum</summary><p>SHA-256</p><code>{artifact.sha256}</code></details> : null}
            </> : <p className="download-unavailable">This download is being prepared. <a href={publicLink("/editor")}>Use the browser editor</a> in the meantime.</p>}
          </article>;
        })}
      </div>
      <p className="fine-print downloads-free-note">Editing, animation, local projects, and individual PNG exports are free. A retained Pro ownership license unlocks premium exports offline. <a href={publicLink("/pricing")}>Compare Free &amp; Pro →</a></p>
    </section>

    <section className="downloads-update-section" id="updating" aria-labelledby="updating-heading">
      <div><p className="eyebrow">KEEP YOUR STUDIO CURRENT</p><h2 id="updating-heading">We check.<br />You choose when.</h2></div>
      <div className="downloads-update-copy">
        <p>The desktop app checks for new releases when you’re online. You can also choose <strong>Check for Updates</strong> from the app menu. When an update is ready, PixelWall offers a download link; you download and install it yourself.</p>
        <p>Updates do not install automatically or restart your editing session. Your artwork is not uploaded, and you can keep drawing offline.</p>
        <p><strong>Using version 0.1.0 or 0.2.0?</strong> Download and install this release once to get the working update checker.</p>
        <p>Before replacing the app, save your work, download a <strong>.pixelwall</strong> backup, and quit PixelWall. Keep your Pro ownership-license file too. Replacing the app preserves its normal local library; removing app data or changing devices does not move that library for you.</p>
        <a className="text-link" href={publicLink("/guides/offline-and-downloads")}>Offline use, projects, and ownership licenses →</a>
      </div>
    </section>

    <section className="downloads-other-section" aria-labelledby="other-downloads-heading">
      <div className="downloads-section-heading"><h2 id="other-downloads-heading">Prefer another setup?</h2></div>
      <div className="downloads-other-grid">
        <article><p className="eyebrow">LOCAL BROWSER STUDIO</p><h3>Bring your own browser.</h3><p>A portable folder with the editor and a local launcher. Requires Node.js 22.13 or newer; setup instructions are included.</p><a className="text-link" href={publicLink("/downloads/pixelwall-standalone.zip")} download="pixelwall-standalone.zip">Download browser ZIP ↓</a></article>
        <article><p className="eyebrow">COMMAND LINE</p><h3>Put your pixels in a pipeline.</h3><p>Draw, inspect projects, and export from scripts. Requires Node.js 22.13 or newer. Premium exports use your saved Pro ownership license.</p><a className="text-link" href={publicLink("/downloads/pixelwall-cli.zip")} download="pixelwall-cli.zip">Download CLI ZIP ↓</a></article>
      </div>
    </section>

    <section className="downloads-history" id="release-history" aria-labelledby="release-history-heading">
      <header className="downloads-section-heading">
        <h2 id="release-history-heading">Release history.</h2>
        <nav className="downloads-release-nav" aria-label="Release versions">
          <a href={`#${releaseId}`}>{release.version} · Latest</a>
          {release.version !== firstDesktopRelease.version ? <a href="#release-0-2-0">0.2.0</a> : null}
          <a href="#release-0-1-0">0.1.0 · Launch</a>
        </nav>
      </header>
    <article className="downloads-release-notes" id={releaseId} aria-labelledby="release-notes-heading">
      <div><p className="eyebrow">LATEST RELEASE</p><h3 id="release-notes-heading">PixelWall {release.version}</h3><p className="fine-print"><time dateTime={release.publishedAt}>{releaseDate(release.publishedAt)}</time></p></div>
      <div>{release.releaseNotes.length ? <ul>{release.releaseNotes.map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}</ul> : <p>This release is ready to download above.</p>}<a className="text-link" href={publicLink("/support")}>Need a hand? Get support →</a></div>
    </article>
    {release.version !== firstDesktopRelease.version ? <article className="downloads-release-notes" id="release-0-2-0" aria-labelledby="previous-release-heading">
      <div><p className="eyebrow">PREVIOUS RELEASE</p><h3 id="previous-release-heading">PixelWall 0.2.0</h3></div>
      <div><p>The first desktop release for Mac, Windows, and Linux added update controls and public download links. Version 0.2.1 fixes its update connection. If you have 0.2.0, install the latest release above once.</p></div>
    </article> : null}
    <article className="downloads-release-notes" id="release-0-1-0" aria-labelledby="launch-release-heading">
      <div><p className="eyebrow">LAUNCH RELEASE</p><h3 id="launch-release-heading">PixelWall 0.1.0</h3><p className="fine-print">The original 2D studio.</p></div>
      <div>
        <p>Draw pixel art, animate sprites, and build tilemaps in one studio, with local projects and free automation.</p>
        <ul>{launchNotes.map(note => <li key={note.title}><strong>{note.title}.</strong> {note.detail}</li>)}</ul>
        <a className="text-link" href={publicLink("/editor")}>Open the editor →</a>
      </div>
    </article>
    </section>
  </main>;
}
