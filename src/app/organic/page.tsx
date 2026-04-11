"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function OrganicPage() {
  const router = useRouter();
  useEffect(() => { router.replace("/posts"); }, [router]);
  return null;
}
