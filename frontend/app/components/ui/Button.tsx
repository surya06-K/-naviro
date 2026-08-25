"use client";

// ─── Button primitive ───────────────────────────────────────────────────────
// Replaces the ~20 onMouseEnter/onMouseLeave handlers across the app that
// mutated element.style directly (page.tsx especially) — hover, active,
// focus-visible, and disabled are now real CSS via Tailwind pseudo-class
// variants, which also means they work on touch and for keyboard users,
// neither of which the old JS handlers supported.
//
// Variant note: "primary" is accent-colored (--accent), not the white-fill
// inversion the old landing CTA used. The white-fill/dark-text inversion
// pattern still exists — it now lives in Chip.tsx's `selected` state
// (vibes, travel style, budget/pace, tab switchers), which is what it was
// actually communicating (a toggled/selected state, not a submit action).
// Before this pass, buttons AND chips both reached for the same
// highest-emphasis look, diluting which one was the actual call to action.
// Making the accent color mean "the action to take," full stop, is the
// point of the single-accent rule in the design system.

import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Icon } from "../icons";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  variant?: Variant;
  size?: Size;
  /** Fully-rounded pill instead of the size's default radius — hero CTAs, form submits. */
  pill?: boolean;
  loading?: boolean;
  icon?: Icon;
  /** Square, icon-only button. Requires aria-label (enforced by prop type). */
  iconOnly?: boolean;
  fullWidth?: boolean;
  children?: ReactNode;
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-accent text-foreground-strong hover:bg-accent-light active:bg-accent shadow-sm",
  secondary:
    "bg-surface-2 text-foreground border border-border hover:border-border-subtle-hover hover:bg-surface",
  ghost: "bg-transparent text-muted hover:text-foreground hover:bg-overlay-subtle",
  danger: "bg-danger-bg text-danger border border-danger-border hover:bg-danger-bg/70",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "px-3 py-1.5 text-small rounded-lg gap-1.5",
  md: "px-4 py-2.5 text-body rounded-xl gap-2",
  lg: "px-6 py-4 text-body font-medium rounded-2xl gap-2",
};

const ICON_ONLY_SIZE_CLASSES: Record<Size, string> = {
  sm: "p-1.5 rounded-lg",
  md: "p-2.5 rounded-xl",
  lg: "p-3.5 rounded-2xl",
};

function Spinner({ size }: { size: Size }) {
  const px = size === "sm" ? 14 : size === "md" ? 16 : 18;
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin motion-reduce:animate-none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={2.5} opacity={0.25} />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
    </svg>
  );
}

export default function Button({
  variant = "primary",
  size = "md",
  pill = false,
  loading = false,
  icon: IconComp,
  iconOnly = false,
  fullWidth = false,
  disabled,
  className = "",
  children,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      disabled={isDisabled}
      className={[
        "relative inline-flex items-center justify-center font-semibold",
        "transition-[background-color,border-color,color,transform,box-shadow] duration-200",
        "active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:opacity-40 disabled:pointer-events-none",
        VARIANT_CLASSES[variant],
        iconOnly ? ICON_ONLY_SIZE_CLASSES[size] : SIZE_CLASSES[size],
        pill ? "rounded-full" : "",
        fullWidth ? "w-full" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      <span className={loading ? "invisible inline-flex items-center gap-2" : "inline-flex items-center gap-2"}>
        {IconComp && <IconComp size={size === "sm" ? 15 : 17} aria-hidden="true" />}
        {children}
      </span>
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner size={size} />
        </span>
      )}
    </button>
  );
}
