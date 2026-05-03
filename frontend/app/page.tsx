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

// ─── Popular destinations ─────────────────────────────────────────────────────
const POPULAR_DESTINATIONS = [
  { name: "Goa", icon: "🌊" },
  { name: "Jaipur", icon: "🏰" },
  { name: "Manali", icon: "⛰️" },
  { name: "Varanasi", icon: "🕯️" },
  { name: "Coorg", icon: "🌿" },
  { name: "Udaipur", icon: "🏯" },
  { name: "Rishikesh", icon: "🧘" },
  { name: "Hampi", icon: "🗿" },
];

// ─── Seasonal picks (by month 0–11) ──────────────────────────────────────────
const SEASONAL: Record<number, { label: string; cities: string[] }> = {
  0:  { label: "Best in January",   cities: ["Jaisalmer", "Goa", "Mysuru"] },
  1:  { label: "Best in February",  cities: ["Hampi", "Coorg", "Pondicherry"] },
  2:  { label: "Best in March",     cities: ["Mathura", "Sikkim", "Kaziranga"] },
  3:  { label: "Best in April",     cities: ["Munnar", "Darjeeling", "Ooty"] },
  4:  { label: "Best in May",       cities: ["Manali", "Ladakh", "Coorg"] },
  5:  { label: "Best in June",      cities: ["Valley of Flowers", "Spiti", "Leh"] },
  6:  { label: "Best in July",      cities: ["Shillong", "Cherrapunji", "Coorg"] },
  7:  { label: "Best in August",    cities: ["Spiti Valley", "Zanskar", "Lonavala"] },
  8:  { label: "Best in September", cities: ["Ranthambore", "Jim Corbett", "Coorg"] },
  9:  { label: "Best in October",   cities: ["Rajasthan", "Goa", "Andaman"] },
  10: { label: "Best in November",  cities: ["Pushkar", "Varanasi", "Kerala"] },
  11: { label: "Best in December",  cities: ["Goa", "Rann of Kutch", "Jaipur"] },
};

// ─── Rotating placeholders ────────────────────────────────────────────────────
const PLACEHOLDERS = [
  "Try Goa…",
  "Try Jaipur…",
  "Try Manali…",
  "Try Varanasi…",
  "Try Coorg…",
  "Try Hampi…",
  "Any city in India…",
];

// ─── Dynamic TravelMap import ─────────────────────────────────────────────────
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
  icon, label, sub, selected, onClick,
}: {
  icon: string; label: string; sub?: string; selected: boolean; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm transition-all ${
        selected
          ? "bg-white text-black border-white font-semibold"
          : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-600 hover:text-zinc-200"
      }`}>
      <span>{icon}</span>
      <span>{label}</span>
      {sub && <span className={`text-xs ${selected ? "text-zinc-500" : "text-zinc-600"}`}>{sub}</span>}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-zinc-600 text-xs uppercase tracking-widest mb-2">{children}</p>;
}

function buildPrompt(city: string, days: string, vibes: string[], style: string, budget: string, pace: string): string {
  const parts: string[] = [];
  if (days) parts.push(`${days} day${days === "1" ? "" : "s"} in ${city}`);
  else parts.push(`Trip to ${city}`);
  if (vibes.length > 0) parts.push(`Interests: ${vibes.join(", ")}`);
  if (style)  parts.push(style + " traveller");
  if (budget) parts.push(`Budget: ${budget}`);
  if (pace)   parts.push(`Pace: ${pace}`);
  return parts.join(". ") + ".";
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Home() {
  const [formStep,   setFormStep]   = useState<"city" | "filters">("city");
  const [itinerary,  setItinerary]  = useState<Itinerary | null>(null);
  const [livedays,   setLiveDays]   = useState<Day[]>([]);
  const [activeDay,  setActiveDay]  = useState(0);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState("");

  // Filters
  const [city,          setCity]          = useState("");
  const [days,          setDays]          = useState("2");
  const [selectedVibes, setSelectedVibes] = useState<string[]>([]);
  const [travelStyle,   setTravelStyle]   = useState("");
  const [budget,        setBudget]        = useState("");
  const [pace,          setPace]          = useState("");

  // Phase 2 — user memory
  const [userId] = useState<string>(() => {
    if (typeof window === "undefined") return "anon";
    let id = localStorage.getItem("naviro_user_id");
    if (!id) {
      id = "user-" + Math.random().toString(36).slice(2, 10);
      localStorage.setItem("naviro_user_id", id);
    }
    return id;
  });
  const [pastDestinations, setPastDestinations] = useState<string[]>([]);

  // Landing UX
  const [placeholderIdx, setPlaceholderIdx] = useState(0);

  const sessionId = useRef(generateSessionId());
  const cityRef   = useRef<HTMLInputElement>(null);
  const seasonal  = SEASONAL[new Date().getMonth()];

  useEffect(() => { cityRef.current?.focus(); }, []);

  // Rotate placeholder every 2.2s
  useEffect(() => {
    const t = setInterval(() => setPlaceholderIdx((p) => (p + 1) % PLACEHOLDERS.length), 2200);
    return () => clearInterval(t);
  }, []);

  // Load preferences on mount
  useEffect(() => {
    const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");
    fetch(`${apiUrl}/api/preferences/${userId}`)
      .then((r) => r.json())
      .then((prefs) => {
        if (prefs.vibes?.length)             setSelectedVibes(prefs.vibes);
        if (prefs.travel_style)              setTravelStyle(prefs.travel_style);
        if (prefs.budget)                    setBudget(prefs.budget);
        if (prefs.pace)                      setPace(prefs.pace);
        if (prefs.past_destinations?.length) setPastDestinations(prefs.past_destinations);
      })
      .catch(() => {});
  }, [userId]);

  function toggleVibe(label: string) {
    setSelectedVibes((prev) => prev.includes(label) ? prev.filter((v) => v !== label) : [...prev, label]);
  }

  function pickDestination(name: string) {
    setCity(name);
    setFormStep("filters");
    setError("");
  }

  function surpriseMe() {
    const pick = POPULAR_DESTINATIONS[Math.floor(Math.random() * POPULAR_DESTINATIONS.length)];
    setCity(pick.name);
    setFormStep("filters");
    setError("");
  }

  async function callAPI(message: string) {
    setLoading(true);
    setError("");
    try {
      const rawApiUrl = process.env.NEXT_PUBLIC_API_URL;
      if (!rawApiUrl && process.env.NODE_ENV === "production") {
        throw new Error("Backend URL not configured. Set NEXT_PUBLIC_API_URL in Vercel.");
      }
      let apiUrl = (rawApiUrl || "http://localhost:8000").trim();
      if (apiUrl && !apiUrl.startsWith("http://") && !apiUrl.startsWith("https://")) apiUrl = `https://${apiUrl}`;
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
        setLiveDays(data.itinerary.days);
        setActiveDay(0);

        // Save preferences
        fetch(`${apiUrl}/api/preferences`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: userId, vibes: selectedVibes, travel_style: travelStyle,
            budget, pace, destination: city.trim(),
          }),
        }).catch(() => {});
      } else {
        setError("Couldn't build an itinerary. Try adding more detail.");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Network error — make sure the backend is running");
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!city.trim() || loading) return;
    if (formStep === "city") { setFormStep("filters"); setError(""); return; }
    callAPI(buildPrompt(city.trim(), days, selectedVibes, travelStyle, budget, pace));
  }

  // ── Map view ─────────────────────────────────────────────────────────────────
  if (itinerary) {
    return (
      <TravelMap
        days={livedays.length > 0 ? livedays : itinerary.days}
        activeDay={activeDay}
        destination={itinerary.destination}
        summary={itinerary.summary}
        totalDays={itinerary.total_days}
        onDayChange={setActiveDay}
        onRefine={callAPI}
        onDaysUpdate={setLiveDays}
        loading={loading}
      />
    );
  }

  // ── Landing ───────────────────────────────────────────────────────────────────
  const canSubmit  = city.trim().length > 0 && !loading;
  const isCityStep = formStep === "city";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-xl space-y-8">

        {/* Logo */}
        <div className="text-center space-y-1">
          <h1 className="text-5xl font-bold tracking-tight text-white">
            Navi<span className="text-zinc-500">ro</span>
          </h1>
          {isCityStep ? (
            <>
              <p className="text-zinc-500 text-base">Pick your city first. We&apos;ll tune the trip next.</p>
              <p className="text-zinc-700 text-xs pt-1">✦ 2,400+ trips planned</p>
            </>
          ) : (
            <p className="text-zinc-500 text-base">Tell me who you are. I&apos;ll plan for you, not for everyone.</p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">

          {/* City input */}
          <div className="space-y-2">
            <SectionLabel>Where are you going</SectionLabel>
            <input
              ref={cityRef}
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder={PLACEHOLDERS[placeholderIdx]}
              className="w-full bg-zinc-900/70 border border-zinc-800 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-700 focus:ring-2 focus:ring-zinc-800/70 transition-colors text-sm"
              disabled={loading}
            />
          </div>

          {/* ── City step: discovery helpers ───────────────────────── */}
          {isCityStep && (
            <>
              {/* Seasonal picks */}
              <div className="space-y-2">
                <SectionLabel>🌤 {seasonal.label}</SectionLabel>
                <div className="flex flex-wrap gap-2">
                  {seasonal.cities.map((c) => (
                    <button key={c} type="button" onClick={() => pickDestination(c)}
                      className="px-3 py-1.5 rounded-xl border border-zinc-800 bg-zinc-900/60 text-zinc-400 text-xs font-medium hover:border-zinc-600 hover:text-zinc-200 transition-all">
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              {/* Popular destinations */}
              <div className="space-y-2">
                <SectionLabel>Popular right now</SectionLabel>
                <div className="flex flex-wrap gap-2">
                  {POPULAR_DESTINATIONS.map((d) => (
                    <button key={d.name} type="button" onClick={() => pickDestination(d.name)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-800 bg-zinc-900/60 text-zinc-300 text-sm font-medium hover:border-zinc-600 hover:text-white transition-all">
                      <span>{d.icon}</span> {d.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Past trips */}
              {pastDestinations.length > 0 && (
                <div className="space-y-2">
                  <SectionLabel>Your past trips</SectionLabel>
                  <div className="flex flex-wrap gap-2">
                    {pastDestinations.slice(0, 5).map((d) => (
                      <button key={d} type="button" onClick={() => pickDestination(d)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-zinc-800 bg-zinc-900/40 text-zinc-400 text-xs font-medium hover:border-zinc-600 hover:text-zinc-200 transition-all">
                        🕐 {d}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Filters step ───────────────────────────────────────── */}
          {!isCityStep && (
            <>
              <div className="space-y-2">
                <SectionLabel>How long</SectionLabel>
                <div className="w-fit flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-xl px-3">
                  <button type="button"
                    onClick={() => setDays((d) => String(Math.max(1, Number(d) - 1)))}
                    className="text-zinc-400 hover:text-white w-7 h-7 flex items-center justify-center text-lg transition-colors">−</button>
                  <span className="text-white text-sm font-semibold w-14 text-center">
                    {days} {Number(days) === 1 ? "day" : "days"}
                  </span>
                  <button type="button"
                    onClick={() => setDays((d) => String(Math.min(7, Number(d) + 1)))}
                    className="text-zinc-400 hover:text-white w-7 h-7 flex items-center justify-center text-lg transition-colors">+</button>
                </div>
              </div>

              <div>
                <SectionLabel>What you love</SectionLabel>
                <div className="flex flex-wrap gap-2">
                  {VIBES.map((v) => (
                    <Chip key={v.label} icon={v.icon} label={v.label}
                      selected={selectedVibes.includes(v.label)}
                      onClick={() => toggleVibe(v.label)} />
                  ))}
                </div>
              </div>

              <div>
                <SectionLabel>Travelling as</SectionLabel>
                <div className="flex flex-wrap gap-2">
                  {TRAVEL_STYLES.map((s) => (
                    <Chip key={s.label} icon={s.icon} label={s.label}
                      selected={travelStyle === s.label}
                      onClick={() => setTravelStyle((prev) => (prev === s.label ? "" : s.label))} />
                  ))}
                </div>
              </div>

              <div>
                <SectionLabel>Budget</SectionLabel>
                <div className="flex flex-wrap gap-2">
                  {BUDGETS.map((b) => (
                    <Chip key={b.label} icon={b.icon} label={b.label} sub={b.sub}
                      selected={budget === b.label}
                      onClick={() => setBudget((prev) => (prev === b.label ? "" : b.label))} />
                  ))}
                </div>
              </div>

              <div>
                <SectionLabel>Pace</SectionLabel>
                <div className="flex flex-wrap gap-2">
                  {PACES.map((p) => (
                    <Chip key={p.label} icon={p.icon} label={p.label} sub={p.sub}
                      selected={pace === p.label}
                      onClick={() => setPace((prev) => (prev === p.label ? "" : p.label))} />
                  ))}
                </div>
              </div>

              {city.trim() && (
                <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl px-4 py-3 text-xs text-zinc-500">
                  <span className="text-zinc-600 mr-1">Sending:</span>
                  <span className="text-zinc-400 italic">
                    {buildPrompt(city.trim(), days, selectedVibes, travelStyle, budget, pace)}
                  </span>
                </div>
              )}
            </>
          )}

          {error && <p className="text-red-400 text-sm px-1">{error}</p>}

          <div className="space-y-2">
            <button type="submit" disabled={!canSubmit}
              className="w-full bg-white text-black py-3.5 rounded-2xl font-semibold text-sm disabled:opacity-40 hover:bg-zinc-100 transition-colors">
              {loading ? "Planning your trip…" : "Plan my trip →"}
            </button>

            {isCityStep && (
              <button type="button" onClick={surpriseMe} disabled={loading}
                className="w-full border border-zinc-800 text-zinc-400 py-3 rounded-2xl font-medium text-sm hover:border-zinc-600 hover:text-zinc-200 transition-colors">
                🎲 Surprise me — pick a destination
              </button>
            )}

            {!isCityStep && (
              <button type="button" onClick={() => setFormStep("city")}
                className="w-full border border-zinc-800 text-zinc-300 py-3 rounded-2xl font-medium text-sm hover:border-zinc-600 hover:text-white transition-colors">
                ← Edit city
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
