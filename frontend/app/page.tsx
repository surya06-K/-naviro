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
  { name: "Goa", icon: "🌊", desc: "Beaches & culture" },
  { name: "Jaipur", icon: "🏰", desc: "The Pink City" },
  { name: "Manali", icon: "⛰️", desc: "Mountain escape" },
  { name: "Varanasi", icon: "🕯️", desc: "Spiritual journey" },
  { name: "Coorg", icon: "🌿", desc: "Coffee & mist" },
  { name: "Udaipur", icon: "🏯", desc: "City of lakes" },
  { name: "Rishikesh", icon: "🧘", desc: "Adventure & yoga" },
  { name: "Hampi", icon: "🗿", desc: "Ancient ruins" },
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
    <div className="w-full h-screen flex items-center justify-center bg-white">
      <div className="text-gray-400 text-sm animate-pulse">Loading map…</div>
    </div>
  ),
});

function generateSessionId() {
  return "session-" + Math.random().toString(36).slice(2, 10);
}

// ─── Chip ─────────────────────────────────────────────────────────────────────
function Chip({
  icon, label, sub, selected, onClick,
}: {
  icon: string; label: string; sub?: string; selected: boolean; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm transition-all ${
        selected
          ? "bg-indigo-600 text-white border-indigo-600 font-semibold shadow-sm"
          : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300 hover:text-indigo-700"
      }`}>
      <span>{icon}</span>
      <span>{label}</span>
      {sub && (
        <span className={`text-xs ${selected ? "text-indigo-200" : "text-gray-400"}`}>{sub}</span>
      )}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-gray-400 text-xs uppercase tracking-widest mb-2 font-medium">{children}</p>
  );
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

      if (data.itinerary && Array.isArray(data.itinerary.days) && data.itinerary.days.length > 0) {
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
    <div className="min-h-screen lg:flex">

      {/* ── LEFT: Form panel ──────────────────────────────────────── */}
      <div className="w-full lg:w-[42%] bg-white flex flex-col justify-center px-8 xl:px-14 py-12 min-h-screen lg:overflow-y-auto">
        <div className="w-full max-w-md mx-auto space-y-7">

          {/* Logo */}
          <div className="space-y-1">
            <h1 className="text-4xl font-bold tracking-tight text-gray-900">
              Navi<span className="text-indigo-500">ro</span>
            </h1>
            {isCityStep ? (
              <>
                <p className="text-gray-500 text-base">Pick your city first. We&apos;ll tune the trip next.</p>
                <p className="text-gray-300 text-xs pt-0.5">✦ 2,400+ trips planned</p>
              </>
            ) : (
              <p className="text-gray-500 text-base">Tell me who you are. I&apos;ll plan for you, not for everyone.</p>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">

            {/* City input */}
            <div className="space-y-1.5">
              <SectionLabel>Where are you going</SectionLabel>
              <input
                ref={cityRef}
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder={PLACEHOLDERS[placeholderIdx]}
                className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900 placeholder-gray-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-50 transition-all text-sm shadow-sm"
                disabled={loading}
              />
            </div>

            {/* ── City step: discovery helpers ─────────────────────── */}
            {isCityStep && (
              <>
                {/* Seasonal picks */}
                <div className="space-y-1.5">
                  <SectionLabel>🌤 {seasonal.label}</SectionLabel>
                  <div className="flex flex-wrap gap-2">
                    {seasonal.cities.map((c) => (
                      <button key={c} type="button" onClick={() => pickDestination(c)}
                        className="px-3 py-1.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-600 text-xs font-medium hover:border-indigo-300 hover:text-indigo-700 hover:bg-indigo-50 transition-all">
                        {c}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Popular destinations */}
                <div className="space-y-1.5">
                  <SectionLabel>Popular right now</SectionLabel>
                  <div className="flex flex-wrap gap-2">
                    {POPULAR_DESTINATIONS.map((d) => (
                      <button key={d.name} type="button" onClick={() => pickDestination(d.name)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 bg-white text-gray-700 text-sm font-medium hover:border-indigo-300 hover:text-indigo-700 hover:bg-indigo-50 transition-all shadow-sm">
                        <span>{d.icon}</span> {d.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Past trips */}
                {pastDestinations.length > 0 && (
                  <div className="space-y-1.5">
                    <SectionLabel>Your past trips</SectionLabel>
                    <div className="flex flex-wrap gap-2">
                      {pastDestinations.slice(0, 5).map((d) => (
                        <button key={d} type="button" onClick={() => pickDestination(d)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-500 text-xs font-medium hover:border-indigo-300 hover:text-indigo-700 transition-all">
                          🕐 {d}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── Filters step ─────────────────────────────────────── */}
            {!isCityStep && (
              <>
                <div className="space-y-1.5">
                  <SectionLabel>How long</SectionLabel>
                  <div className="w-fit flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-xl px-3">
                    <button type="button"
                      onClick={() => setDays((d) => String(Math.max(1, Number(d) - 1)))}
                      className="text-gray-400 hover:text-indigo-600 w-7 h-7 flex items-center justify-center text-lg transition-colors">−</button>
                    <span className="text-gray-900 text-sm font-semibold w-14 text-center">
                      {days} {Number(days) === 1 ? "day" : "days"}
                    </span>
                    <button type="button"
                      onClick={() => setDays((d) => String(Math.min(7, Number(d) + 1)))}
                      className="text-gray-400 hover:text-indigo-600 w-7 h-7 flex items-center justify-center text-lg transition-colors">+</button>
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
              </>
            )}

            {error && (
              <p className="text-red-500 text-sm px-1 flex items-center gap-1.5">
                <span>⚠️</span> {error}
              </p>
            )}

            <div className="space-y-2 pt-1">
              <button type="submit" disabled={!canSubmit}
                className="w-full bg-indigo-600 text-white py-3.5 rounded-2xl font-semibold text-sm disabled:opacity-40 hover:bg-indigo-700 transition-colors shadow-sm">
                {loading ? "Planning your trip…" : isCityStep ? "Continue →" : "Plan my trip →"}
              </button>

              {isCityStep && (
                <button type="button" onClick={surpriseMe} disabled={loading}
                  className="w-full border border-gray-200 text-gray-500 py-3 rounded-2xl font-medium text-sm hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50 transition-all">
                  🎲 Surprise me — pick a destination
                </button>
              )}

              {!isCityStep && (
                <button type="button" onClick={() => setFormStep("city")}
                  className="w-full border border-gray-200 text-gray-500 py-3 rounded-2xl font-medium text-sm hover:border-gray-300 hover:text-gray-700 transition-colors">
                  ← Edit city
                </button>
              )}
            </div>
          </form>
        </div>
      </div>

      {/* ── RIGHT: Visual panel (desktop only) ───────────────────── */}
      <div className="hidden lg:flex lg:w-[58%] sticky top-0 h-screen overflow-hidden flex-col">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-900 via-indigo-800 to-violet-900" />
        {/* Dot grid overlay */}
        <div className="absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: "radial-gradient(circle at 1px 1px, white 1.5px, transparent 0)", backgroundSize: "28px 28px" }} />
        {/* Glow blobs */}
        <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-indigo-500 rounded-full opacity-20 blur-3xl" />
        <div className="absolute bottom-1/4 left-1/4 w-64 h-64 bg-violet-600 rounded-full opacity-20 blur-3xl" />

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-center h-full px-12 xl:px-16 py-12">

          {isCityStep ? (
            /* ── City step: destination showcase ── */
            <div className="space-y-8">
              <div>
                <p className="text-indigo-300 text-sm font-medium mb-3">✦ 2,400+ trips planned across India</p>
                <h2 className="text-white text-5xl font-bold leading-tight tracking-tight">
                  Where will<br />you go next?
                </h2>
                <p className="text-indigo-200 mt-4 text-base leading-relaxed max-w-sm">
                  Tell us your destination and we&apos;ll craft a personalized, day-by-day itinerary in seconds.
                </p>
              </div>

              {/* Featured destination grid */}
              <div className="grid grid-cols-2 gap-3">
                {POPULAR_DESTINATIONS.slice(0, 4).map((d) => (
                  <button key={d.name} type="button" onClick={() => pickDestination(d.name)}
                    className="group flex items-center gap-3 p-3.5 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 hover:bg-white/20 hover:border-white/40 transition-all text-left">
                    <span className="text-3xl">{d.icon}</span>
                    <div>
                      <p className="text-white text-sm font-semibold group-hover:text-white">{d.name}</p>
                      <p className="text-indigo-300 text-xs">{d.desc}</p>
                    </div>
                  </button>
                ))}
              </div>

              {/* Seasonal picks */}
              <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/20">
                <p className="text-indigo-200 text-xs font-semibold uppercase tracking-wider mb-3">🌤 {seasonal.label}</p>
                <div className="flex flex-wrap gap-2">
                  {seasonal.cities.map((c) => (
                    <button key={c} type="button" onClick={() => pickDestination(c)}
                      className="px-3 py-1.5 rounded-xl bg-white/20 text-white text-xs font-medium hover:bg-white/30 transition-all border border-white/10">
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              {/* Stats row */}
              <div className="flex items-center gap-6 text-sm">
                {[["100+", "Cities"], ["3", "Travel modes"], ["Instant", "Planning"]].map(([val, lbl]) => (
                  <div key={lbl}>
                    <p className="text-white font-bold text-lg">{val}</p>
                    <p className="text-indigo-300 text-xs">{lbl}</p>
                  </div>
                ))}
              </div>
            </div>

          ) : (
            /* ── Filters step: live trip preview ── */
            <div className="space-y-7">
              <div>
                <p className="text-indigo-300 text-sm font-medium mb-2">✦ Trip preview</p>
                <h2 className="text-white text-4xl font-bold leading-tight">{city}</h2>
                <p className="text-indigo-200 text-base mt-1">Your personalized trip is taking shape.</p>
              </div>

              {/* Live preview card */}
              <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-5 border border-white/20 space-y-5">

                {/* Duration */}
                <div>
                  <p className="text-indigo-200 text-xs font-semibold uppercase tracking-wider mb-2.5">Duration</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {Array.from({ length: Number(days) }).map((_, i) => (
                      <div key={i}
                        className="w-9 h-9 rounded-xl bg-white/25 border border-white/30 flex items-center justify-center text-white text-xs font-bold">
                        {i + 1}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Vibes */}
                {selectedVibes.length > 0 && (
                  <div>
                    <p className="text-indigo-200 text-xs font-semibold uppercase tracking-wider mb-2.5">Your vibes</p>
                    <div className="flex flex-wrap gap-2">
                      {selectedVibes.map((v) => {
                        const vibe = VIBES.find((x) => x.label === v);
                        return (
                          <span key={v}
                            className="flex items-center gap-1 px-2.5 py-1 bg-indigo-500/40 text-white text-xs rounded-lg border border-indigo-400/30">
                            {vibe?.icon} {v}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Style / Budget / Pace */}
                {(travelStyle || budget || pace) && (
                  <div className="flex flex-wrap gap-2">
                    {travelStyle && (
                      <span className="px-2.5 py-1 bg-white/20 text-white text-xs rounded-lg border border-white/20">
                        {travelStyle}
                      </span>
                    )}
                    {budget && (
                      <span className="px-2.5 py-1 bg-white/20 text-white text-xs rounded-lg border border-white/20">
                        {budget}
                      </span>
                    )}
                    {pace && (
                      <span className="px-2.5 py-1 bg-white/20 text-white text-xs rounded-lg border border-white/20">
                        {pace}
                      </span>
                    )}
                  </div>
                )}

                {/* Prompt preview */}
                <div className="border-t border-white/20 pt-4">
                  <p className="text-indigo-300 text-xs font-semibold uppercase tracking-wider mb-1.5">AI will plan for:</p>
                  <p className="text-white/80 text-sm italic leading-relaxed">
                    &ldquo;{buildPrompt(city.trim(), days, selectedVibes, travelStyle, budget, pace)}&rdquo;
                  </p>
                </div>
              </div>

              {/* What you'll get */}
              <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                <p className="text-indigo-200 text-xs font-semibold uppercase tracking-wider mb-3">What you&apos;ll get</p>
                <div className="space-y-2">
                  {[
                    ["🗺️", "Day-by-day itinerary with timings"],
                    ["📍", "Real places with map pins"],
                    ["💡", "Local tips & how to get there"],
                    ["💰", "Cost estimates for every stop"],
                  ].map(([icon, text]) => (
                    <div key={text} className="flex items-center gap-2.5">
                      <span className="text-base">{icon}</span>
                      <span className="text-indigo-100 text-xs">{text}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
