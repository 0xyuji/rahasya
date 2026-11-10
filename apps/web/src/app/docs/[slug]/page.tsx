import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { brand } from "../../../brand";
import { PAGES, readDoc } from "../content";
import { DocBody } from "../doc-body";

export const dynamicParams = false;

export function generateStaticParams() {
  return PAGES.filter((p) => p.slug).map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = PAGES.find((x) => x.slug === slug);
  return { title: p ? `${p.title} — ${brand.name} docs` : `${brand.name} docs` };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = PAGES.find((x) => x.slug === slug);
  if (!p) notFound();
  return <DocBody md={readDoc(p.file)} raw={"raw" in p ? p.raw : undefined} />;
}
