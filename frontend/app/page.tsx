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

// ─── Palette constants ────────────────────────────────────────────────────────
const C = {
  bg:      "#0d1117",
  surface: "#161b22",
  surface2:"#1c2128",
  border:  "#2d333b",
  muted:   "#8b949e",
  text:    "#e6edf3",
  dim:     "#484f58",
  accent:  "#397091",
  accentH: "#4a8ab0",
  accentL: "#6bb3d9",
  glow:    "rgba(57,112,145,0.25)",
  glowSm:  "rgba(57,112,145,0.12)",
} as const;

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
    <div className="w-full h-screen flex items-center justify-center" style={{ background: C.bg }}>
      <div className="text-sm animate-pulse" style={{ color: C.dim }}>Loading map…</div>
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
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm transition-all"
      style={
        selected
          ? { background: C.accent, color: "#fff", borderColor: C.accent, fontWeight: 600,
              boxShadow: `0 2px 12px ${C.glow}` }
          : { background: C.surface, color: C.muted, borderColor: C.border }
      }
      onMouseEnter={(e) => {
        if (!selected) {
          e.currentTarget.style.borderColor = C.accent;
          e.currentTarget.style.color = C.text;
        }
      }}
      onMouseLeave={(e) => {
        if (!selected) {
          e.currentTarget.style.borderColor = C.border;
          e.currentTarget.style.color = C.muted;
        }
      }}
    >
      <span>{icon}</span>
      <span>{label}</span>
      {sub && (
        <span className="text-xs" style={{ color: selected ? "rgba(255,255,255,0.6)" : C.dim }}>{sub}</span>
      )}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs uppercase tracking-widest mb-2 font-medium" style={{ color: C.dim }}>{children}</p>
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

  const [city,          setCity]          = useState("");
  const [days,          setDays]          = useState("2");
  const [selectedVibes, setSelectedVibes] = useState<string[]>([]);
  const [travelStyle,   setTravelStyle]   = useState("");
  const [budget,        setBudget]        = useState("");
  const [pace,          setPace]          = useState("");

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
  const [placeholderIdx,   setPlaceholderIdx]   = useState(0);

  const sessionId = useRef(generateSessionId());
  const cityRef   = useRef<HTMLInputElement>(null);
  const seasonal  = SEASONAL[new Date().getMonth()];

  useEffect(() => { cityRef.current?.focus(); }, []);

  useEffect(() => {
    const t = setInterval(() => setPlaceholderIdx((p) => (p + 1) % PLACEHOLDERS.length), 2200);
    return () => clearInterval(t);
  }, []);

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
    setSelectedVibes((prev) =>
      prev.includes(label) ? prev.filter((v) => v !== label) : [...prev, label]
    );
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

  const canSubmit  = city.trim().length > 0 && !loading;
  const isCityStep = formStep === "city";

  // ── Landing ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen lg:flex" style={{ background: C.bg }}>

      {/* ════════════════════════════════════════════════════════
          LEFT — Form
      ════════════════════════════════════════════════════════ */}
      <div
        className="w-full lg:w-[44%] flex flex-col justify-center px-8 xl:px-14 py-14 min-h-screen lg:overflow-y-auto"
        style={{ background: C.bg }}
      >
        <div className="w-full max-w-md mx-auto space-y-8">

          {/* Logo */}
          <div className="space-y-2">
            <h1 className="text-5xl font-bold tracking-tight" style={{ color: C.text }}>
              Navi<span style={{ color: C.accent }}>ro</span>
            </h1>
            {isCityStep ? (
              <>
                <p className="text-base" style={{ color: C.muted }}>
                  Pick your city first. We&apos;ll tune the trip next.
                </p>
                <p className="text-xs pt-0.5" style={{ color: C.dim }}>✦ 2,400+ trips planned</p>
              </>
            ) : (
              <p className="text-base" style={{ color: C.muted }}>
                Tell me who you are. I&apos;ll plan for you, not for everyone.
              </p>
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
                className="w-full rounded-xl px-4 py-3.5 text-sm outline-none transition-all"
                style={{
                  background: C.surface,
                  border: `1px solid ${C.border}`,
                  color: C.text,
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = C.accent;
                  e.currentTarget.style.boxShadow = `0 0 0 3px ${C.glowSm}`;
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = C.border;
                  e.currentTarget.style.boxShadow = "none";
                }}
                disabled={loading}
              />
            </div>

            {/* ── City step ──────────────────────────────────────── */}
            {isCityStep && (
              <>
                <div className="space-y-2">
                  <SectionLabel>🌤 {seasonal.label}</SectionLabel>
                  <div className="flex flex-wrap gap-2">
                    {seasonal.cities.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => pickDestination(c)}
                        className="px-3 py-1.5 rounded-xl text-xs font-medium transition-all"
                        style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.muted }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = C.accent;
                          e.currentTarget.style.color = C.accentL;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = C.border;
                          e.currentTarget.style.color = C.muted;
                        }}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <SectionLabel>Popular right now</SectionLabel>
                  <div className="flex flex-wrap gap-2">
                    {POPULAR_DESTINATIONS.map((d) => (
                      <button
                        key={d.name}
                        type="button"
                        onClick={() => pickDestination(d.name)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-all"
                        style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = C.accent;
                          e.currentTarget.style.color = C.accentL;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = C.border;
                          e.currentTarget.style.color = C.text;
                        }}
                      >
                        <span>{d.icon}</span>
                        {d.name}
                      </button>
                    ))}
                  </div>
                </div>

                {pastDestinations.length > 0 && (
                  <div className="space-y-2">
                    <SectionLabel>Your past trips</SectionLabel>
                    <div className="flex flex-wrap gap-2">
                      {pastDestinations.slice(0, 5).map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => pickDestination(d)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium transition-all"
                          style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.dim }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = C.accent;
                            e.currentTarget.style.color = C.accentL;
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = C.border;
                            e.currentTarget.style.color = C.dim;
                          }}
                        >
                          🕐 {d}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── Filters step ──────────────────────────────────── */}
            {!isCityStep && (
              <>
                <div className="space-y-1.5">
                  <SectionLabel>How long</SectionLabel>
                  <div
                    className="w-fit flex items-center gap-1 rounded-xl px-3"
                    style={{ background: C.surface, border: `1px solid ${C.border}` }}
                  >
                    <button
                      type="button"
                      onClick={() => setDays((d) => String(Math.max(1, Number(d) - 1)))}
                      className="w-7 h-7 flex items-center justify-center text-lg transition-colors"
                      style={{ color: C.dim }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = C.accent)}
                      onMouseLeave={(e) => (e.currentTarget.style.color = C.dim)}
                    >−</button>
                    <span className="text-sm font-semibold w-14 text-center" style={{ color: C.text }}>
                      {days} {Number(days) === 1 ? "day" : "days"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setDays((d) => String(Math.min(7, Number(d) + 1)))}
                      className="w-7 h-7 flex items-center justify-center text-lg transition-colors"
                      style={{ color: C.dim }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = C.accent)}
                      onMouseLeave={(e) => (e.currentTarget.style.color = C.dim)}
                    >+</button>
                  </div>
                </div>

                <div>
                  <SectionLabel>What you love</SectionLabel>
                  <div className="flex flex-wrap gap-2">
                    {VIBES.map((v) => (
                      <Chip key={v.label} icon={v.icon} label={v.label}
                        selected={selectedVibes.includes(v.label)} onClick={() => toggleVibe(v.label)} />
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
              <p className="text-red-400 text-sm px-1">⚠️ {error}</p>
            )}

            <div className="space-y-2.5 pt-2">
              <button
                type="submit"
                disabled={!canSubmit}
                className="w-full py-3.5 rounded-2xl font-semibold text-sm transition-all disabled:opacity-40"
                style={{
                  background: C.accent,
                  color: "#fff",
                  boxShadow: canSubmit ? `0 4px 20px ${C.glow}` : "none",
                }}
                onMouseEnter={(e) => { if (canSubmit) e.currentTarget.style.background = C.accentH; }}
                onMouseLeave={(e) => { if (canSubmit) e.currentTarget.style.background = C.accent; }}
              >
                {loading ? "Planning your trip…" : isCityStep ? "Continue →" : "Plan my trip →"}
              </button>

              {isCityStep && (
                <button
                  type="button"
                  onClick={surpriseMe}
                  disabled={loading}
                  className="w-full py-3 rounded-2xl font-medium text-sm transition-all"
                  style={{ border: `1px solid ${C.border}`, color: C.muted }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = C.accent;
                    e.currentTarget.style.color = C.text;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = C.border;
                    e.currentTarget.style.color = C.muted;
                  }}
                >
                  🎲 Surprise me — pick a destination
                </button>
              )}

              {!isCityStep && (
                <button
                  type="button"
                  onClick={() => setFormStep("city")}
                  className="w-full py-3 rounded-2xl font-medium text-sm transition-all"
                  style={{ border: `1px solid ${C.border}`, color: C.muted }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = C.border;
                    e.currentTarget.style.color = C.text;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = C.border;
                    e.currentTarget.style.color = C.muted;
                  }}
                >
                  ← Edit city
                </button>
              )}
            </div>
          </form>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════
          RIGHT — Visual panel (desktop only)
      ════════════════════════════════════════════════════════ */}
      <div
        className="hidden lg:flex lg:w-[56%] sticky top-0 h-screen overflow-hidden flex-col"
        style={{ background: "#0a0e14" }}
      >
        {/* Star-field */}
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.3) 1px, transparent 0)",
            backgroundSize: "40px 40px",
          }}
        />
        {/* Steel blue glow */}
        <div
          className="absolute rounded-full"
          style={{
            top: "-10%", right: "-5%", width: "600px", height: "600px",
            background: `radial-gradient(circle, ${C.accent} 0%, transparent 65%)`,
            opacity: 0.08,
          }}
        />
        {/* Secondary glow */}
        <div
          className="absolute rounded-full"
          style={{
            bottom: "5%", left: "-10%", width: "400px", height: "400px",
            background: `radial-gradient(circle, ${C.accentL} 0%, transparent 70%)`,
            opacity: 0.05,
          }}
        />

        <div className="relative z-10 flex flex-col justify-center h-full px-12 xl:px-16 py-12">

          {isCityStep ? (
            <div className="space-y-9">
              <div>
                <p className="text-sm font-medium mb-3 tracking-wide" style={{ color: C.accent }}>
                  ✦ AI-powered travel planning
                </p>
                <h2 className="text-5xl font-bold leading-[1.1] tracking-tight" style={{ color: C.text }}>
                  Where will<br />you go next?
                </h2>
                <p className="mt-4 text-base leading-relaxed max-w-sm" style={{ color: C.muted }}>
                  Type a destination and we&apos;ll craft you a personalized,
                  day-by-day itinerary in seconds.
                </p>
              </div>

              {/* Destination grid */}
              <div className="grid grid-cols-2 gap-3">
                {POPULAR_DESTINATIONS.slice(0, 4).map((d) => (
                  <button
                    key={d.name}
                    type="button"
                    onClick={() => pickDestination(d.name)}
                    className="group flex items-center gap-3 p-4 rounded-2xl text-left transition-all"
                    style={{ background: "rgba(22,27,34,0.7)", border: `1px solid ${C.border}` }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = C.accent;
                      e.currentTarget.style.background = `rgba(57,112,145,0.06)`;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = C.border;
                      e.currentTarget.style.background = "rgba(22,27,34,0.7)";
                    }}
                  >
                    <span className="text-3xl">{d.icon}</span>
                    <div>
                      <p className="text-sm font-semibold transition-colors" style={{ color: C.text }}>{d.name}</p>
                      <p className="text-xs" style={{ color: C.dim }}>{d.desc}</p>
                    </div>
                  </button>
                ))}
              </div>

              {/* Seasonal card */}
              <div className="rounded-2xl p-4" style={{ background: "rgba(22,27,34,0.5)", border: `1px solid ${C.border}` }}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: C.dim }}>
                  🌤 {seasonal.label}
                </p>
                <div className="flex flex-wrap gap-2">
                  {seasonal.cities.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => pickDestination(c)}
                      className="px-3 py-1.5 rounded-xl text-xs font-medium transition-all"
                      style={{ background: "rgba(45,51,59,0.5)", border: `1px solid ${C.border}`, color: C.muted }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = C.accent;
                        e.currentTarget.style.color = C.accentL;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = C.border;
                        e.currentTarget.style.color = C.muted;
                      }}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              {/* Stats */}
              <div className="flex items-center gap-8">
                {[["100+", "Cities"], ["3", "Travel modes"], ["Instant", "Planning"]].map(([val, lbl]) => (
                  <div key={lbl}>
                    <p className="font-bold text-xl" style={{ color: C.accent }}>{val}</p>
                    <p className="text-xs mt-0.5" style={{ color: C.dim }}>{lbl}</p>
                  </div>
                ))}
              </div>
            </div>

          ) : (
            /* Filters step — live preview */
            <div className="space-y-7">
              <div>
                <p className="text-sm font-medium mb-2 tracking-wide" style={{ color: C.accent }}>
                  ✦ Trip preview
                </p>
                <h2 className="text-4xl font-bold tracking-tight" style={{ color: C.text }}>{city}</h2>
                <p className="text-base mt-1" style={{ color: C.muted }}>
                  Your personalized trip is taking shape.
                </p>
              </div>

              {/* Preview card */}
              <div className="rounded-2xl p-5 space-y-5" style={{ background: "rgba(22,27,34,0.7)", border: `1px solid ${C.border}` }}>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-2.5" style={{ color: C.dim }}>Duration</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {Array.from({ length: Number(days) }).map((_, i) => (
                      <div
                        key={i}
                        className="w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold"
                        style={{ background: C.glowSm, border: `1px solid rgba(57,112,145,0.2)`, color: C.accentL }}
                      >
                        {i + 1}
                      </div>
                    ))}
                  </div>
                </div>

                {selectedVibes.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider mb-2.5" style={{ color: C.dim }}>Your vibes</p>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedVibes.map((v) => {
                        const vibe = VIBES.find((x) => x.label === v);
                        return (
                          <span
                            key={v}
                            className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg"
                            style={{ background: C.glowSm, border: `1px solid rgba(57,112,145,0.2)`, color: C.accentL }}
                          >
                            {vibe?.icon} {v}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                {(travelStyle || budget || pace) && (
                  <div className="flex flex-wrap gap-1.5">
                    {[travelStyle, budget, pace].filter(Boolean).map((tag) => (
                      <span
                        key={tag}
                        className="px-2.5 py-1 text-xs rounded-lg"
                        style={{ background: `rgba(45,51,59,0.6)`, border: `1px solid ${C.border}`, color: C.muted }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: "1rem" }}>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: C.dim }}>
                    AI will plan for:
                  </p>
                  <p className="text-sm italic leading-relaxed" style={{ color: C.muted }}>
                    &ldquo;{buildPrompt(city.trim(), days, selectedVibes, travelStyle, budget, pace)}&rdquo;
                  </p>
                </div>
              </div>

              <div className="rounded-2xl p-4" style={{ background: "rgba(22,27,34,0.4)", border: `1px solid rgba(45,51,59,0.5)` }}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: C.dim }}>
                  What you&apos;ll get
                </p>
                <div className="space-y-2.5">
                  {[
                    ["🗺️", "Day-by-day itinerary with timings"],
                    ["📍", "Real places with interactive map pins"],
                    ["💡", "Local tips & how to get there"],
                    ["💰", "Cost estimates for every stop"],
                  ].map(([icon, text]) => (
                    <div key={text} className="flex items-center gap-2.5">
                      <span className="text-base">{icon}</span>
                      <span className="text-xs" style={{ color: C.muted }}>{text}</span>
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
