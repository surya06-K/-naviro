"use client";

import { useState, useRef, useEffect } from "react";
import dynamic from "next/dynamic";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Slot {
  time_of_day: string;
  place_name: string;
  description: string;
  category: string;
  how_to_get_there: string;
  estimated_duration: string;
  estimated_cost: string;
  local_tip: string;
  coordinates: { lat: number; lng: number };
}

interface Day {
  day_number: number;
  day_title: string;
  slots: Slot[];
}

interface Itinerary {
  destination: string;
  total_days: number;
  summary: string;
  days: Day[];
}

// ─── Filter config ────────────────────────────────────────────────────────────
const VIBES = [
  { label: "Street Food", icon: "🍜" },
  { label: "History", icon: "🏛️" },
  { label: "Nature", icon: "🌿" },
  { label: "Local Culture", icon: "🎭" },
  { label: "Markets", icon: "🛍️" },
  { label: "Nightlife", icon: "🌙" },
  { label: "Art & Music", icon: "🎨" },
  { label: "Spiritual", icon: "🕌" },
];

const TRAVEL_STYLES = [
  { label: "Solo", icon: "🧍" },
  { label: "Couple", icon: "👫" },
  { label: "Friends", icon: "👥" },
  { label: "Family", icon: "👨‍👩‍👧" },
];

const BUDGETS = [
  { label: "Budget", icon: "₹", sub: "under ₹500/day" },
  { label: "Mid-range", icon: "₹₹", sub: "₹500–2000/day" },
  { label: "Luxury", icon: "₹₹₹", sub: "₹2000+/day" },
];

const PACES = [
  { label: "Relaxed", icon: "🌊", sub: "2–3 places/day" },
  { label: "Balanced", icon: "⚖️", sub: "3–4 places/day" },
  { label: "Packed", icon: "⚡", sub: "max places" },
];

// ─── Dynamic import (Leaflet needs browser) ───────────────────────────────────
const TravelMap = dynamic(() => import("./components/TravelMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-screen flex items-center justify-center bg-black">
      <div className="text-zinc-600 text-sm animate-pulse">Loading map…</div>
    </div>
  ),
});

function generateSessionId() {
  return "session-" + Math.random().toString(36).slice(2, 10);
}

// ─── Filter chip ──────────────────────────────────────────────────────────────
function Chip({
  icon,
  label,
  sub,
  selected,
  onClick,
}: {
  icon: string;
  label: string;
  sub?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm transition-all ${
        selected
          ? "bg-white text-black border-white font-semibold"
          : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-600 hover:text-zinc-200"
      }`}
    >
      <span>{icon}</span>
      <span>{label}</span>
      {sub && (
        <span className={`text-xs ${selected ? "text-zinc-500" : "text-zinc-600"}`}>
          {sub}
        </span>
      )}
    </button>
  );
}

// ─── Section label ────────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-zinc-600 text-xs uppercase tracking-widest mb-2">
      {children}
    </p>
  );
}

// ─── Build prompt from filters + free text ────────────────────────────────────
function buildPrompt(
  cityInput: string,
  days: string,
  vibes: string[],
  style: string,
  budget: string,
  pace: string
): string {
  const parts: string[] = [];

  if (days) parts.push(`${days} day${days === "1" ? "" : "s"} in ${cityInput}`);
  else parts.push(`Trip to ${cityInput}`);

  if (vibes.length > 0) parts.push(`Interests: ${vibes.join(", ")}`);
  if (style) parts.push(style + " traveller");
  if (budget) parts.push(`Budget: ${budget}`);
  if (pace) parts.push(`Pace: ${pace}`);

  return parts.join(". ") + ".";
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Home() {
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [activeDay, setActiveDay] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Filters
  const [city, setCity] = useState("");
  const [days, setDays] = useState("2");
  const [selectedVibes, setSelectedVibes] = useState<string[]>([]);
  const [travelStyle, setTravelStyle] = useState("");
  const [budget, setBudget] = useState("");
  const [pace, setPace] = useState("");

  const sessionId = useRef(generateSessionId());
  const cityRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    cityRef.current?.focus();
  }, []);

  function toggleVibe(label: string) {
    setSelectedVibes((prev) =>
      prev.includes(label) ? prev.filter((v) => v !== label) : [...prev, label]
    );
  }

  async function callAPI(message: string) {
    setLoading(true);
    setError("");
    try {
      const rawApiUrl = process.env.NEXT_PUBLIC_API_URL;
      if (!rawApiUrl) {
        if (process.env.NODE_ENV === "production") {
          throw new Error(
            "Backend URL not configured. Set NEXT_PUBLIC_API_URL in Vercel (e.g. https://<your-railway-domain>)."
          );
        }
      }

      let apiUrl = (rawApiUrl || "http://localhost:8000").trim();
      if (apiUrl && !apiUrl.startsWith("http://") && !apiUrl.startsWith("https://")) {
        apiUrl = `https://${apiUrl}`;
      }
      apiUrl = apiUrl.replace(/\/+$/, "");

      const res = await fetch(`${apiUrl}/api/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId.current, message }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? "Something went wrong");
      }

      const data = await res.json();

      if (data.itinerary) {
        setItinerary(data.itinerary);
        setActiveDay(0);
      } else {
        setError("Couldn't build an itinerary. Try adding more detail.");
      }
    } catch (e: unknown) {
      setError(
        e instanceof Error
          ? e.message
          : "Network error — make sure the backend is running"
      );
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!city.trim() || loading) return;
    const prompt = buildPrompt(city.trim(), days, selectedVibes, travelStyle, budget, pace);
    callAPI(prompt);
  }

  // ── Map view ────────────────────────────────────────────────────────────────
  if (itinerary) {
    return (
      <TravelMap
        days={itinerary.days}
        activeDay={activeDay}
        destination={itinerary.destination}
        summary={itinerary.summary}
        totalDays={itinerary.total_days}
        onDayChange={setActiveDay}
        onRefine={callAPI}
        loading={loading}
      />
    );
  }

  // ── Landing ─────────────────────────────────────────────────────────────────
  const canSubmit = city.trim().length > 0 && !loading;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-xl space-y-8">

        {/* Logo */}
        <div className="text-center space-y-1">
          <h1 className="text-5xl font-bold tracking-tight text-white">
            Navi<span className="text-zinc-500">ro</span>
          </h1>
          <p className="text-zinc-500 text-base">
            Tell me who you are. I&apos;ll plan for you, not for everyone.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">

          {/* City + Days */}
          <div className="space-y-2">
            <SectionLabel>Where & how long</SectionLabel>
            <div className="flex gap-2">
              <input
                ref={cityRef}
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="City or town…"
                className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder-zinc-600 outline-none focus:border-zinc-600 transition-colors text-sm"
                disabled={loading}
              />
              <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-xl px-3">
                <button
                  type="button"
                  onClick={() => setDays((d) => String(Math.max(1, Number(d) - 1)))}
                  className="text-zinc-400 hover:text-white w-7 h-7 flex items-center justify-center text-lg transition-colors"
                >
                  −
                </button>
                <span className="text-white text-sm font-semibold w-14 text-center">
                  {days} {Number(days) === 1 ? "day" : "days"}
                </span>
                <button
                  type="button"
                  onClick={() => setDays((d) => String(Math.min(7, Number(d) + 1)))}
                  className="text-zinc-400 hover:text-white w-7 h-7 flex items-center justify-center text-lg transition-colors"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          {/* Vibes — multi select */}
          <div>
            <SectionLabel>What you love</SectionLabel>
            <div className="flex flex-wrap gap-2">
              {VIBES.map((v) => (
                <Chip
                  key={v.label}
                  icon={v.icon}
                  label={v.label}
                  selected={selectedVibes.includes(v.label)}
                  onClick={() => toggleVibe(v.label)}
                />
              ))}
            </div>
          </div>

          {/* Travel style — single select */}
          <div>
            <SectionLabel>Travelling as</SectionLabel>
            <div className="flex flex-wrap gap-2">
              {TRAVEL_STYLES.map((s) => (
                <Chip
                  key={s.label}
                  icon={s.icon}
                  label={s.label}
                  selected={travelStyle === s.label}
                  onClick={() => setTravelStyle((prev) => (prev === s.label ? "" : s.label))}
                />
              ))}
            </div>
          </div>

          {/* Budget — single select */}
          <div>
            <SectionLabel>Budget</SectionLabel>
            <div className="flex flex-wrap gap-2">
              {BUDGETS.map((b) => (
                <Chip
                  key={b.label}
                  icon={b.icon}
                  label={b.label}
                  sub={b.sub}
                  selected={budget === b.label}
                  onClick={() => setBudget((prev) => (prev === b.label ? "" : b.label))}
                />
              ))}
            </div>
          </div>

          {/* Pace — single select */}
          <div>
            <SectionLabel>Pace</SectionLabel>
            <div className="flex flex-wrap gap-2">
              {PACES.map((p) => (
                <Chip
                  key={p.label}
                  icon={p.icon}
                  label={p.label}
                  sub={p.sub}
                  selected={pace === p.label}
                  onClick={() => setPace((prev) => (prev === p.label ? "" : p.label))}
                />
              ))}
            </div>
          </div>

          {/* Preview of what gets sent to AI */}
          {city.trim() && (
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl px-4 py-3 text-xs text-zinc-500">
              <span className="text-zinc-600 mr-1">Sending:</span>
              <span className="text-zinc-400 italic">
                {buildPrompt(city.trim(), days, selectedVibes, travelStyle, budget, pace)}
              </span>
            </div>
          )}

          {error && (
            <p className="text-red-400 text-sm px-1">{error}</p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full bg-white text-black py-3.5 rounded-2xl font-semibold text-sm disabled:opacity-40 hover:bg-zinc-100 transition-colors"
          >
            {loading ? "Planning your trip…" : "Plan my trip →"}
          </button>
        </form>
      </div>
    </div>
  );
}
