// ─── Shared types ────────────────────────────────────────────────────────────
// Slot / Day / Itinerary were previously duplicated in page.tsx, TravelMap.tsx,
// AgentChat.tsx, and trip/[slug]/page.tsx, and had already drifted — only two
// of the four copies carried `verified?`. Single source now; every component
// imports from here instead of redeclaring its own copy.

export interface Slot {
  time_of_day: string;
  place_name: string;
  description: string;
  category: string;
  how_to_get_there: string;
  estimated_duration: string;
  estimated_cost: string;
  local_tip: string;
  coordinates: { lat: number; lng: number };
  // Set server-side by LocationIQ-backed verification, never by the LLM.
  // Absent on older cached itineraries; false means the place couldn't be
  // confirmed as real even after one repair attempt.
  verified?: boolean;
}

export interface Day {
  day_number: number;
  day_title: string;
  slots: Slot[];
}

export interface Itinerary {
  destination: string;
  total_days: number;
  summary: string;
  days: Day[];
}

// ─── Safety / emergency panel ───────────────────────────────────────────────
export interface EmergencyContact {
  name: string;
  address: string;
  maps_url: string;
}

export interface EmergencyInfo {
  emergency_number: string;
  hospitals: EmergencyContact[];
  police_station: EmergencyContact | null;
  safety_tips: string[];
}

// ─── Live Mode ───────────────────────────────────────────────────────────────
export interface LiveSuggestion {
  place_name: string;
  why_now: string;
  how_to_get_there: string;
  estimated_duration: string;
  local_tip: string;
}

export interface LiveResponse {
  context: string;
  suggestions: LiveSuggestion[];
}

// ─── TravelMap contract ─────────────────────────────────────────────────────
// Published here (not inline in TravelMap.tsx) so page.tsx and
// trip/[slug]/page.tsx can code against the exact prop signature —
// including the new onExit — without needing TravelMap's implementation.
export interface TravelMapProps {
  days: Day[];
  activeDay: number;
  destination: string;
  summary: string;
  totalDays: number;
  onDayChange: (i: number) => void;
  onRefine: (msg: string) => void;
  onDaysUpdate?: (updatedDays: Day[]) => void;
  loading: boolean;
  // Clears the current itinerary and returns to the planning form. Fixes
  // the previous dead end: once an itinerary generated, there was no way
  // back to the form short of a page refresh. page.tsx passes
  // () => setItinerary(null); trip/[slug]/page.tsx passes a Link-based
  // navigation back to "/". Optional so a caller without an exit path
  // (none currently) still type-checks.
  onExit?: () => void;
}
