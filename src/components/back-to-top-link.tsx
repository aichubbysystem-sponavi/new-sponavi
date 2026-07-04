"use client";

import { useEffect, useState } from "react";

/**
 * メインドメインのTop（/）へ戻るリンク。
 * report.* / p-max.* サブドメインは顧客向け表示のため、メインドメインでのみ表示する
 * （サブドメインでは "/" がmiddlewareで同じページにリライトされ、ボタンが機能しないため）
 */
export default function BackToTopLink({ className = "" }: { className?: string }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const h = window.location.hostname;
    if (!/^(report|p-max)\./.test(h)) setShow(true);
  }, []);

  if (!show) return null;

  return (
    <a href="/" className={className}>
      ← Topへ戻る
    </a>
  );
}
