"use client";

import Link from "next/link";
import { featureDetails } from "@/lib/feature-details";

interface FeatureCardProps {
  title: string;
  description: string;
  status?: "active" | "coming" | "beta";
  icon?: string;
}

export default function FeatureCard({ title, description, status = "active", icon }: FeatureCardProps) {
  // Find matching feature by title
  const feature = featureDetails.find((f) => f.title === title);
  const href = feature ? `/feature/${feature.slug}/` : "#";

  const content = (
    <div className="p-4 border border-slate-100 rounded-xl hover:shadow-md hover:border-blue-200 transition-all bg-white group cursor-pointer">
      <div className="flex items-start gap-3">
        {icon && <span className="text-xl mt-0.5">{icon}</span>}
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
            {status === "active" && (
              <span className="text-[10px] bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full font-medium">稼働中</span>
            )}
            {status === "coming" && (
              <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium">開発中</span>
            )}
            {status === "beta" && (
              <span className="text-[10px] bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full font-medium">Beta</span>
            )}
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">{description}</p>
        </div>
        <span className="opacity-0 group-hover:opacity-100 text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded-lg transition whitespace-nowrap">
          詳細 →
        </span>
      </div>
    </div>
  );

  if (feature) {
    return <Link href={href}>{content}</Link>;
  }

  return content;
}
