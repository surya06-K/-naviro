"use client";

// ─── Icon system ────────────────────────────────────────────────────────────
// Hand-rolled inline SVG set, zero dependencies. Replaces every emoji that
// was doing real UI work across the app (safety shield, live badge, export
// calendar, share link, get-me-there arrow, stat labels, vibe/pace/travel-
// style chips, time-of-day markers) — emoji render inconsistently across OS
// and font versions, which is the single biggest "not premium" tell in the
// previous UI.
//
// Convention: 24x24 viewBox, 1.5px stroke, round caps/joins, currentColor —
// so an icon always inherits the text color of whatever it sits inside.
// Icons default to aria-hidden="true": they are decorative by convention.
// A button that is icon-only MUST carry its own aria-label — the icon
// itself never substitutes for one.

import type { ComponentType, ReactNode, SVGProps } from "react";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  size?: number;
}

export type Icon = ComponentType<IconProps>;

function stroke(children: ReactNode): Icon {
  return function StrokeIcon({ size = 20, ...props }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
      >
        {children}
      </svg>
    );
  };
}

// ── Core / chrome ────────────────────────────────────────────────────────
export const ArrowLeft = stroke(<path d="M19 12H5M11 18l-6-6 6-6" />);
export const ArrowRight = stroke(<path d="M5 12h14M13 6l6 6-6 6" />);
export const X = stroke(<path d="M6 6l12 12M18 6L6 18" />);
export const Plus = stroke(<path d="M12 5v14M5 12h14" />);
export const Minus = stroke(<path d="M5 12h14" />);
export const Check = stroke(<path d="M5 13l4 4L19 7" />);
export const MapPin = stroke(
  <>
    <path d="M12 21s7-7.58 7-12a7 7 0 1 0-14 0c0 4.42 7 12 7 12z" />
    <circle cx="12" cy="9" r="2.5" />
  </>
);
export const Navigation = stroke(<path d="M3 11l17-8-8 17-2.5-6.5L3 11z" />);
export const Clock = stroke(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </>
);
export const Bus = stroke(
  <>
    <rect x="3" y="6" width="18" height="10" rx="2" />
    <path d="M3 11h18" />
    <circle cx="7.5" cy="18" r="1.5" />
    <circle cx="16.5" cy="18" r="1.5" />
  </>
);
export const Bulb = stroke(
  <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />
);
export const Calendar = stroke(
  <>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </>
);
export const LinkIcon = stroke(
  <>
    <path d="M10 14a4 4 0 0 1 0-5.66l3-3a4 4 0 1 1 5.66 5.66l-1.5 1.5" />
    <path d="M14 10a4 4 0 0 1 0 5.66l-3 3a4 4 0 1 1-5.66-5.66l1.5-1.5" />
  </>
);
export const Shield = stroke(
  <>
    <path d="M12 3l8 3v6c0 4.5-3.2 8.3-8 9-4.8-.7-8-4.5-8-9V6l8-3z" />
    <path d="M9 12l2 2 4-4" />
  </>
);
export const Broadcast = stroke(
  <>
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    <path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7" />
    <path d="M5.5 5.5a9 9 0 0 0 0 13M18.5 5.5a9 9 0 0 1 0 13" />
  </>
);
export const Message = stroke(
  <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 4v-4H6a2 2 0 0 1-2-2V6z" />
);
export const Warning = stroke(
  <>
    <path d="M12 3l10 18H2L12 3z" />
    <path d="M12 10v4M12 17h.01" />
  </>
);

// ── Time of day ──────────────────────────────────────────────────────────
export const Sunrise = stroke(
  <>
    <path d="M12 4v3" />
    <path d="M5 16h14" />
    <path d="M7 16a5 5 0 0 1 10 0" />
    <path d="M4.5 9.5l1.8 1.8M19.5 9.5l-1.8 1.8" />
  </>
);
export const Sun = stroke(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </>
);
export const Moon = stroke(<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />);

// ── Vibes ────────────────────────────────────────────────────────────────
export const Utensils = stroke(<path d="M8 2v6M10 2v6M12 2v6M10 8v14" />);
export const Landmark = stroke(
  <>
    <path d="M3 10l9-6 9 6" />
    <path d="M4 10v10M9 10v10M15 10v10M20 10v10" />
    <path d="M2 21h20" />
  </>
);
export const Leaf = stroke(
  <>
    <path d="M5 21c0-9 6-15 15-15 0 9-6 15-15 15z" />
    <path d="M5 21c3-3 6-9 6-13" />
  </>
);
export const Mask = stroke(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 10c0-1 .8-1.5 1.5-1M16 10c0-1-.8-1.5-1.5-1" />
    <path d="M8 15c1.5 1.5 6.5 1.5 8 0" />
  </>
);
export const ShoppingBag = stroke(
  <>
    <path d="M6 8h12l-1 12H7L6 8z" />
    <path d="M9 8V6a3 3 0 0 1 6 0v2" />
  </>
);
export const MusicNote = stroke(
  <>
    <circle cx="8" cy="17" r="2.5" />
    <circle cx="18.5" cy="15" r="2.5" />
    <path d="M10.5 17V4l8-2v13" />
  </>
);
export const Temple = stroke(
  <>
    <path d="M12 3a4 4 0 0 1 4 4v1H8V7a4 4 0 0 1 4-4z" />
    <path d="M4 21V12h16v9" />
    <path d="M9 21v-6h6v6" />
    <path d="M2 21h20" />
  </>
);

// ── Travel style ─────────────────────────────────────────────────────────
export const UserSolo = stroke(
  <>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 21c0-4 3-6.5 7-6.5s7 2.5 7 6.5" />
  </>
);
export const UserCouple = stroke(
  <>
    <circle cx="9" cy="8" r="3" />
    <path d="M3.5 20c0-3.3 2.5-5.5 5.5-5.5" />
    <circle cx="16" cy="9" r="2.7" />
    <path d="M11.5 20c.3-3 2.4-5 4.7-5s4.4 2 4.8 5" />
  </>
);
export const UserFriends = stroke(
  <>
    <circle cx="7" cy="9" r="2.3" />
    <circle cx="17" cy="9" r="2.3" />
    <circle cx="12" cy="7.5" r="2.6" />
    <path d="M3 20c.3-2.6 2-4.3 4-4.3M21 20c-.3-2.6-2-4.3-4-4.3M8 20c.4-3 2-4.8 4-4.8s3.6 1.8 4 4.8" />
  </>
);
export const UserFamily = stroke(
  <>
    <circle cx="9" cy="7" r="3" />
    <path d="M3.5 20c0-3.6 2.5-6 5.5-6s5.5 2.4 5.5 6" />
    <circle cx="18" cy="11" r="2" />
    <path d="M14.5 20c0-2.6 1.7-4.3 3.5-4.3s3.5 1.7 3.5 4.3" />
  </>
);

// ── Pace ─────────────────────────────────────────────────────────────────
export const Waves = stroke(
  <path d="M2 8c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 14c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 20c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />
);
export const Scale = stroke(
  <>
    <path d="M12 3v18M5 21h14" />
    <path d="M5 7h14" />
    <path d="M5 7l-3 6a3 3 0 0 0 6 0L5 7z" />
    <path d="M19 7l-3 6a3 3 0 0 0 6 0l-3-6z" />
  </>
);
export const Bolt = stroke(<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />);

// ── Actions ──────────────────────────────────────────────────────────────
// Refresh/replan — LiveMode's "Replan my day" tab.
export const Refresh = stroke(
  <>
    <path d="M3 12a9 9 0 0 1 15.3-6.4L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15.3 6.4L3 16" />
    <path d="M3 21v-5h5" />
  </>
);

// Rupee is a typographic glyph, not a stroke path — hand-drawing a precise
// ₹ as a line icon is error-prone, and the character itself is already
// exact. Sized/positioned to match the stroke icons' visual weight.
export function Rupee({ size = 20, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <text
        x="12"
        y="17"
        textAnchor="middle"
        fontSize="16"
        fontWeight={600}
        fill="currentColor"
        fontFamily="var(--font-geist-mono), ui-monospace, monospace"
      >
        ₹
      </text>
    </svg>
  );
}

// ── Lookup maps ──────────────────────────────────────────────────────────
// Keyed to the exact label strings already used in page.tsx's VIBES /
// TRAVEL_STYLES / PACES arrays and TravelMap.tsx's time_of_day values, so
// every screen resolves the same icon for the same label instead of each
// component guessing its own mapping.
export const VIBE_ICONS: Record<string, Icon> = {
  "Street Food": Utensils,
  History: Landmark,
  Nature: Leaf,
  "Local Culture": Mask,
  Markets: ShoppingBag,
  Nightlife: Moon,
  "Art & Music": MusicNote,
  Spiritual: Temple,
};

export const TRAVEL_STYLE_ICONS: Record<string, Icon> = {
  Solo: UserSolo,
  Couple: UserCouple,
  Friends: UserFriends,
  Family: UserFamily,
};

export const PACE_ICONS: Record<string, Icon> = {
  Relaxed: Waves,
  Balanced: Scale,
  Packed: Bolt,
};

// Keys are lowercase to match Slot.time_of_day / TravelMap's normalize step.
export const TIME_OF_DAY_ICONS: Record<string, Icon> = {
  morning: Sunrise,
  afternoon: Sun,
  evening: Moon,
  night: Moon,
};
