"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <div style={{ padding: "2rem", textAlign: "center" }}>
          <h2>予期しないエラーが発生しました</h2>
          <button onClick={() => reset()} style={{ marginTop: "1rem", padding: "0.5rem 1rem" }}>
            再試行
          </button>
        </div>
      </body>
    </html>
  );
}
