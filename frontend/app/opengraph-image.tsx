import { ImageResponse } from "next/og";

// Next's file-convention OG image route (app/opengraph-image.tsx) — Next
// evaluates this at build time and wires the resulting <meta property="og:image">
// tags into the root route's <head> automatically. ImageResponse renders its
// own JSX-to-image pipeline (Satori), which only understands inline styles —
// no Tailwind classes, no globals.css, no next/font. Hex values below are
// hand-copied from app/globals.css's design tokens (--background, --foreground,
// --accent) since ImageResponse can't read CSS custom properties at all.

export const alt = "Naviro — your AI travel guide";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

const BACKGROUND = "#0d1117";
const FOREGROUND = "#e6edf3";
const ACCENT = "#397091";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          backgroundColor: BACKGROUND,
          padding: "96px",
          position: "relative",
        }}
      >
        {/* Corner mark — the one quiet accent detail, no gradient */}
        <div
          style={{
            position: "absolute",
            top: 64,
            left: 96,
            width: 40,
            height: 3,
            backgroundColor: ACCENT,
            display: "flex",
          }}
        />

        <div
          style={{
            display: "flex",
            fontSize: 104,
            fontWeight: 700,
            color: FOREGROUND,
            letterSpacing: "-0.02em",
          }}
        >
          Naviro
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 24,
            fontSize: 34,
            fontWeight: 400,
            color: ACCENT,
          }}
        >
          Your AI travel guide
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
