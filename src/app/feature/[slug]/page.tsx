import { getAllSlugs } from "@/lib/feature-details";
import FeatureDetailClient from "./client";

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

export default function FeatureDetailPage({ params }: { params: { slug: string } }) {
  return <FeatureDetailClient slug={params.slug} />;
}
