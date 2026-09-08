import documents from "./public-content.json";

export type ContentSection = {
  heading: string;
  paragraphs?: string[];
  steps?: { title: string; text: string }[];
  items?: string[];
  code?: string;
  links?: { href: string; label: string }[];
};
export type ContentPage = {
  slug: string;
  title: string;
  description: string;
  eyebrow: string;
  intro: string;
  sections: ContentSection[];
  faqs?: { question: string; answer: string }[];
  related: string[];
};

export const pages: ContentPage[] = documents;
export const findPage = (slug: string) => pages.find((page) => page.slug === slug);
