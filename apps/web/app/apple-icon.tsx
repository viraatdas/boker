import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 180,
          height: 180,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
          borderRadius: 40,
          fontFamily: "Georgia, serif",
        }}
      >
        <span style={{ fontSize: 110, fontWeight: "bold", color: "#e8c547", marginTop: -6 }}>
          B
        </span>
        <span
          style={{
            position: "absolute",
            top: 24,
            right: 30,
            fontSize: 36,
            color: "#e74c3c",
          }}
        >
          ♠
        </span>
      </div>
    ),
    { ...size }
  );
}
