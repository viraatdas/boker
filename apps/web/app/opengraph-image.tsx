import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "boker — Play-money NLHE poker with friends and AI";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
          fontFamily: "Georgia, serif",
        }}
      >
        {/* Suit symbols backdrop */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 300,
            opacity: 0.06,
            color: "#fff",
            gap: 40,
          }}
        >
          <span>♠</span>
          <span>♥</span>
        </div>

        {/* Cards fan */}
        <div
          style={{
            display: "flex",
            gap: 12,
            marginBottom: 40,
          }}
        >
          {[
            { rank: "A", suit: "♠", color: "#fff" },
            { rank: "K", suit: "♥", color: "#e74c3c" },
            { rank: "Q", suit: "♦", color: "#e74c3c" },
            { rank: "J", suit: "♣", color: "#fff" },
            { rank: "10", suit: "♠", color: "#fff" },
          ].map((card, i) => (
            <div
              key={i}
              style={{
                width: 90,
                height: 130,
                borderRadius: 10,
                background: "#fff",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
                transform: `rotate(${(i - 2) * 6}deg)`,
              }}
            >
              <span style={{ fontSize: 36, fontWeight: "bold", color: card.color }}>
                {card.rank}
              </span>
              <span style={{ fontSize: 28, color: card.color }}>{card.suit}</span>
            </div>
          ))}
        </div>

        {/* Title */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span
            style={{
              fontSize: 80,
              fontWeight: "bold",
              color: "#e8c547",
              letterSpacing: -2,
            }}
          >
            boker
          </span>
          <span
            style={{
              fontSize: 28,
              color: "rgba(255,255,255,0.7)",
              fontFamily: "sans-serif",
            }}
          >
            Play-money No-Limit Hold&apos;em with friends &amp; AI
          </span>
        </div>

        {/* Bottom accent */}
        <div
          style={{
            position: "absolute",
            bottom: 30,
            display: "flex",
            gap: 24,
            fontSize: 24,
            color: "rgba(255,255,255,0.3)",
          }}
        >
          <span>♠</span>
          <span style={{ color: "rgba(231,76,60,0.4)" }}>♥</span>
          <span style={{ color: "rgba(231,76,60,0.4)" }}>♦</span>
          <span>♣</span>
        </div>
      </div>
    ),
    { ...size }
  );
}
