"use client";

/**
 * T-56 (measured): the DEFAULT global-error crashed prerender in Next 16.1.3
 * ("Expected workUnitAsyncStorage to have a store" — known bug on /_global-error),
 * which broke the whole production build of the console. A minimal explicit
 * client-only global-error bypasses the buggy default path AND gives the
 * operator a real error surface instead of a blank screen.
 */
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="he" dir="rtl">
      <body
        style={{
          fontFamily: "system-ui, -apple-system, sans-serif",
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          background: "#101014",
          color: "#ede9df",
          margin: 0,
        }}
      >
        <div style={{ textAlign: "center", padding: 24, maxWidth: 420 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>⚠</div>
          <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>שגיאה-גלובלית</h1>
          <p style={{ opacity: 0.7, margin: "0 0 16px", fontSize: 14 }}>
            משהו-נשבר-בקונסולה-הריבונית. השומרים-כבר-עובדים-על-זה.
          </p>
          {error?.digest ? (
            <p style={{ opacity: 0.4, fontSize: 12, margin: "0 0 16px", direction: "ltr" }}>
              digest: {error.digest}
            </p>
          ) : null}
          <button
            onClick={reset}
            style={{
              padding: "10px 22px",
              fontSize: 14,
              cursor: "pointer",
              borderRadius: 8,
              border: "1px solid #3a3a42",
              background: "#1c1c22",
              color: "#ede9df",
            }}
          >
            נסה-שוב
          </button>
        </div>
      </body>
    </html>
  );
}
