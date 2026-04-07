import Link from "next/link";
import { mockShopList } from "@/lib/report-data";

export default function ReportListPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #1a1a2e 0%, #0f3460 100%)",
        fontFamily: "'Noto Sans JP', sans-serif",
      }}
    >
      {/* Header */}
      <header
        style={{
          background: "rgba(255,255,255,0.05)",
          backdropFilter: "blur(10px)",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
          padding: "20px 40px",
        }}
      >
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <h1
            style={{
              margin: 0,
              fontSize: 24,
              fontWeight: 700,
              color: "#fff",
              letterSpacing: "0.05em",
            }}
          >
            <span style={{ color: "#e94560" }}>SPOTLIGHT</span> NAVIGATOR
            <span
              style={{
                marginLeft: 16,
                fontSize: 14,
                fontWeight: 400,
                color: "rgba(255,255,255,0.6)",
              }}
            >
              レポート管理
            </span>
          </h1>
        </div>
      </header>

      {/* Content */}
      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 20px" }}>
        <h2
          style={{
            fontSize: 20,
            fontWeight: 500,
            color: "rgba(255,255,255,0.8)",
            marginBottom: 32,
          }}
        >
          店舗レポート一覧
        </h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
            gap: 24,
          }}
        >
          {mockShopList.map((shop) => (
            <div
              key={shop.id}
              style={{
                background: "rgba(255,255,255,0.07)",
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,0.1)",
                padding: 28,
                transition: "transform 0.2s, box-shadow 0.2s",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 12,
                    background: "linear-gradient(135deg, #e94560 0%, #0f3460 100%)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 20,
                    color: "#fff",
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {shop.name.charAt(0)}
                </div>
                <div>
                  <h3
                    style={{
                      margin: 0,
                      fontSize: 18,
                      fontWeight: 700,
                      color: "#fff",
                    }}
                  >
                    {shop.name}
                  </h3>
                  <p
                    style={{
                      margin: "4px 0 0",
                      fontSize: 12,
                      color: "rgba(255,255,255,0.5)",
                    }}
                  >
                    {shop.address}
                  </p>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 16,
                  marginBottom: 20,
                  flexWrap: "wrap",
                }}
              >
                <div
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    borderRadius: 8,
                    padding: "8px 14px",
                  }}
                >
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
                    対象期間
                  </div>
                  <div style={{ fontSize: 14, color: "#fff", fontWeight: 500 }}>
                    {shop.period}
                  </div>
                </div>
                <div
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    borderRadius: 8,
                    padding: "8px 14px",
                  }}
                >
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
                    評価
                  </div>
                  <div style={{ fontSize: 14, color: "#ffd54f", fontWeight: 500 }}>
                    ★ {shop.rating}
                  </div>
                </div>
                <div
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    borderRadius: 8,
                    padding: "8px 14px",
                  }}
                >
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
                    口コミ数
                  </div>
                  <div style={{ fontSize: 14, color: "#4fc3f7", fontWeight: 500 }}>
                    {shop.totalReviews.toLocaleString()}件
                  </div>
                </div>
              </div>

              <Link
                href={`/report/${shop.id}`}
                style={{
                  display: "block",
                  textAlign: "center",
                  background: "linear-gradient(135deg, #e94560 0%, #c73050 100%)",
                  color: "#fff",
                  padding: "12px 24px",
                  borderRadius: 10,
                  textDecoration: "none",
                  fontSize: 14,
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                  transition: "opacity 0.2s",
                }}
              >
                レポートを見る
              </Link>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
