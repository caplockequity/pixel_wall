import { notFound } from "next/navigation";
import { findPage, pages } from "../../content";
import { pageMetadata } from "../../site";
import { DocumentPage } from "../document";

type Props = { params: Promise<{ slug: string }> };
export const dynamicParams = false;
export function generateStaticParams() { return pages.filter((page) => !page.slug.includes("/")).map(({ slug }) => ({ slug })); }
export async function generateMetadata({ params }: Props) {
  const page = findPage((await params).slug);
  if (!page) notFound();
  return pageMetadata(page.title, page.description, `/${page.slug}`);
}
export default async function Page({ params }: Props) {
  const page = findPage((await params).slug);
  if (!page) notFound();
  return <DocumentPage page={page} />;
}
