"use client";

// ─── Chip primitive ─────────────────────────────────────────────────────────
// One selectable-pill component for every chip in the app: vibes, travel
// style, budget, pace (page.tsx), and the preset/time-of-day/visited-place
// toggles (LiveMode.tsx). Previously each screen re-implemented its own
// selected/hover states by hand, and even disagreed with itself — vibes and
// travel style inverted to solid white on selection, budget and pace used a
// translucent overlay tint instead. Chip now has exactly one selected
// treatment (the white-fill/dark-text inversion) used everywhere, which is
// also the thing that makes a selection state legible against the photo
// backdrop on the landing page.

import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Icon } from "../icons";
import { Check } from "../icons";

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  selected?: boolean;
  icon?: Icon;
  /** Small line under the label — budget/pace's "under ₹500/day" style hint. */
  subtitle?: string;
  /** Draws a line-through on the label once selected — LiveMode's visited-place toggle. */
  strikethroughWhenSelected?: boolean;
  /** Prefixes a check icon once selected — same visited-place toggle. */
  showCheckWhenSelected?: boolean;
  /** "row": inline icon+label pill (vibes, travel style, presets, time-of-day).
   *  "column": icon above label above subtitle, card-shaped (budget, pace). */
  layout?: "row" | "column";
  children: ReactNode;
}

export default function Chip({
  selected = false,
  icon: IconComp,
  subtitle,
  strikethroughWhenSelected = false,
  showCheckWhenSelected = false,
  layout = "row",
  className = "",
  children,
  ...props
}: ChipProps) {
  const isColumn = layout === "column";

  const base = [
    "inline-flex items-center transition-all duration-200 font-medium",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "active:scale-[0.98]",
  ];

  const shapeAndTone = isColumn
    ? [
        "flex-col gap-1 text-small text-center rounded-2xl px-2 py-3.5 border",
        selected
          ? "bg-foreground-strong text-on-emphasis border-foreground-strong"
          : "bg-surface text-muted-soft border-border-subtle hover:border-border-subtle-hover",
      ]
    : [
        "gap-1.5 text-small rounded-full px-4 py-2.5 border",
        selected
          ? "bg-foreground-strong text-on-emphasis border-foreground-strong"
          : "bg-transparent text-muted-soft border-border-subtle hover:border-border-subtle-hover hover:text-foreground",
        selected && strikethroughWhenSelected ? "opacity-60" : "",
      ];

  return (
    <button
      type="button"
      aria-pressed={selected}
      className={[...base, ...shapeAndTone, className].filter(Boolean).join(" ")}
      {...props}
    >
      {showCheckWhenSelected && selected && <Check size={13} aria-hidden="true" />}
      {IconComp && <IconComp size={isColumn ? 16 : 15} aria-hidden="true" />}
      <span className={selected && strikethroughWhenSelected ? "line-through" : ""}>{children}</span>
      {subtitle && (
        <span className={`text-caption ${selected ? "text-on-emphasis/70" : "text-muted-soft"}`}>
          {subtitle}
        </span>
      )}
    </button>
  );
}
