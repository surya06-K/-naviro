import { ImageResponse } from "next/og";

// Next's file-convention icon route (app/icon.tsx) — generates the
// rel="icon" <link> tag. Coexists with the existing app/favicon.ico (still
// served for direct /favicon.ico requests); this is the one that actually
// renders in modern browser tabs. Same ImageResponse/inline-style
// constraints as opengraph-image.tsx — see that file's comment.

export const size = {
  width: 32,
  height: 32,
};
export const contentType = "image/png";

const BACKGROUND = "#0d1117";
const ACCENT = "#397091";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: BACKGROUND,
          borderRadius: 7,
        }}
      >
        {/* Simplified map-pin glyph — same silhouette as icons.tsx's MapPin,
            hand-copied since ImageResponse can't import that SVG component
            (its renderer needs plain inline-styled markup, not currentColor
            strokes from an app component). */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 21s7-7.58 7-12a7 7 0 1 0-14 0c0 4.42 7 12 7 12z"
            fill={ACCENT}
          />
          <circle cx="12" cy="9" r="2.5" fill={BACKGROUND} />
        </svg>
      </div>
    ),
    {
      ...size,
    }
  );
}
