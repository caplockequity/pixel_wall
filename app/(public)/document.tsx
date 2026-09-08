import { findPage, type ContentPage } from "../content";
import { StructuredData } from "../structured-data";
import { SITE_URL } from "../site";
import { PricingTable } from "./pricing-table";

const sectionId = (heading: string) => heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function DocumentPage({ page }: { page: ContentPage }) {
  const guide = page.slug.startsWith("guides/");
  const crumbs = [{ name: "PixelWall", item: SITE_URL }, ...(guide ? [{ name: "Guides", item: `${SITE_URL}/guides` }] : []), { name: page.title, item: `${SITE_URL}/${page.slug}` }];
  return <main id="content" className="document-page">
    <StructuredData data={{ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: crumbs.map((crumb, index) => ({ "@type": "ListItem", position: index + 1, ...crumb })) }} />
    {guide && <StructuredData data={{ "@context": "https://schema.org", "@type": "TechArticle", headline: page.title, description: page.description, url: `${SITE_URL}/${page.slug}`, author: { "@type": "Organization", name: "CapLock", url: `${SITE_URL}/about` }, publisher: { "@id": `${SITE_URL}/#organization` }, dateModified: "2026-09-08" }} />}
    <nav className="breadcrumbs" aria-label="Breadcrumb"><a href="/">PixelWall</a><span aria-hidden="true">/</span>{guide && <><a href="/guides">Guides</a><span aria-hidden="true">/</span></>}<span aria-current="page">{page.eyebrow.toLowerCase()}</span></nav>
    <header className="document-header"><p className="eyebrow">{page.eyebrow}</p><h1>{page.title}</h1><p className="lede">{page.intro}</p>{!['privacy', 'terms'].includes(page.slug) && <a className="site-button" href="/editor">Open the editor <span aria-hidden="true">↗</span></a>}</header>
    {page.slug === "pricing" && <PricingTable />}
    <div className="document-body">
      <aside className="contents"><strong>On this page</strong><nav aria-label="On this page">{page.sections.map((section) => <a key={section.heading} href={`#${sectionId(section.heading)}`}>{section.heading}</a>)}{page.faqs?.length ? <a href="#questions">Common questions</a> : null}</nav></aside>
      <article>
        {page.sections.map((section) => <section className="article-section" key={section.heading} id={sectionId(section.heading)}>
          <h2>{section.heading}</h2>
          {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          {section.steps && <ol className="steps">{section.steps.map((step) => <li key={step.title}><h3>{step.title}</h3><p>{step.text}</p></li>)}</ol>}
          {section.items && <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul>}
          {section.code && <pre tabIndex={0} aria-label={`${section.heading} code example`}><code>{section.code}</code></pre>}
          {section.links && <ul className="source-links">{section.links.map((link) => <li key={link.href}><a href={link.href}>{link.label} <span aria-hidden="true">↗</span></a></li>)}</ul>}
        </section>)}
        {page.faqs?.length ? <section className="article-section" id="questions"><h2>Common questions</h2>{page.faqs.map((faq) => <details className="faq" key={faq.question}><summary>{faq.question}</summary><p>{faq.answer}</p></details>)}</section> : null}
      </article>
    </div>
    <section className="related"><h2>Keep exploring</h2><div className="related-links">{page.related.map((slug) => { const target = findPage(slug); return target ? <a key={slug} href={`/${slug}`}>{target.title}<span aria-hidden="true">↗</span></a> : null; })}</div></section>
  </main>;
}
