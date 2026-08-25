"use client";

// ─── Panel primitive ────────────────────────────────────────────────────────
// The glass surface used by TravelMap's top bar, slot detail sheet, emergency
// sheet, and refine input bar. Real glassmorphism, not just backdrop-blur:
// a translucent surface, a 1px top highlight simulating edge refraction, and
// a shadow tinted to the app's own hue rather than generic black — the
// "surface upgrades" pass from the redesign audit, applied once here instead
// of re-approximated per screen.

import type { HTMLAttributes } from "react";

type Variant = "glass" | "solid";
type Padding = "none" | "sm" | "md" | "lg";
type Radius = "lg" | "xl" | "2xl" | "3xl" | "sheet-top";

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
  padding?: Padding;
  radius?: Radius;
}

const PADDING_CLASSES: Record<Padding, string> = {
  none: "",
  sm: "px-3 py-2",
  md: "p-4",
  lg: "p-5 sm:p-6",
};

const RADIUS_CLASSES: Record<Radius, string> = {
  lg: "rounded-lg",
  xl: "rounded-xl",
  "2xl": "rounded-2xl",
  "3xl": "rounded-3xl",
  "sheet-top": "rounded-t-3xl",
};

const GLASS_SHADOW = "var(--shadow-color-lg), inset 0 1px 0 rgba(255,255,255,0.06)";
const SOLID_SHADOW = "var(--shadow-color-md)";

export default function Panel({
  variant = "glass",
  padding = "md",
  radius = "2xl",
  className = "",
  style,
  children,
  ...props
}: PanelProps) {
  const variantClasses =
    variant === "glass"
      ? "backdrop-blur-xl bg-surface/85 border border-white/[0.06]"
      : "bg-surface border border-border";

  return (
    <div
      className={[variantClasses, PADDING_CLASSES[padding], RADIUS_CLASSES[radius], className]
        .filter(Boolean)
        .join(" ")}
      style={{
        boxShadow: variant === "glass" ? GLASS_SHADOW : SOLID_SHADOW,
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}
