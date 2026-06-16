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

// ─── Config ───────────────────────────────────────────────────────────────────
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

const PLACEHOLDERS = [
  "Goa",
  "Jaipur",
  "Manali",
  "Varanasi",
  "Coorg",
  "Hampi",
  "Any city in India…",
];

// ─── Dynamic imports ──────────────────────────────────────────────────────────
const TravelMap = dynamic(() => import("./components/TravelMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-screen flex items-center justify-center" style={{ background: "#0a0a0a" }}>
      <div className="text-sm animate-pulse" style={{ color: "#333" }}>Loading map…</div>
    </div>
  ),
});

function generateSessionId() {
  return "session-" + Math.random().toString(36).slice(2, 10);
}

function buildPrompt(city: string, days: string, vibes: string[], style: string, budget: string, pace: string): string {
  const parts: string[] = [];
  if (days) parts.push(`${days} day${days === "1" ? "" : "s"} in ${city}`);
  else parts.push(`Trip to ${city}`);
  if (vibes.length > 0) parts.push(`Interests: ${vibes.join(", ")}`);
  if (style) parts.push(style + " traveller");
  if (budget) parts.push(`Budget: ${budget}`);
  if (pace) parts.push(`Pace: ${pace}`);
  return parts.join(". ") + ".";
}

const TOTAL_SLIDES = 3;

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function Home() {
  // Slide state
  const [slide, setSlide] = useState(0);

  // Which mode is open (null = browsing slides, "plan" | "agent" | "live")
  const [mode, setMode] = useState<"plan" | "agent" | "live" | null>(null);

  // Trip planning state
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [livedays, setLiveDays] = useState<Day[]>([]);
  const [activeDay, setActiveDay] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [city, setCity] = useState("");
  const [days, setDays] = useState("2");
  const [selectedVibes, setSelectedVibes] = useState<string[]>([]);
  const [travelStyle, setTravelStyle] = useState("");
  const [budget, setBudget] = useState("");
  const [pace, setPace] = useState("");

  const [userId] = useState<string>(() => {
    if (typeof window === "undefined") return "anon";
    let id = localStorage.getItem("naviro_user_id");
    if (!id) {
      id = "user-" + Math.random().toString(36).slice(2, 10);
      localStorage.setItem("naviro_user_id", id);
    }
    return id;
  });

  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const sessionId = useRef(generateSessionId());

  // Touch tracking for swipe
  const touchStartX = useRef(0);
  const touchDeltaX = useRef(0);
  const isDragging = useRef(false);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => setPlaceholderIdx((p) => (p + 1) % PLACEHOLDERS.length), 2200);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");
    fetch(`${apiUrl}/api/preferences/${userId}`)
      .then((r) => r.json())
      .then((prefs) => {
        if (prefs.vibes?.length) setSelectedVibes(prefs.vibes);
        if (prefs.travel_style) setTravelStyle(prefs.travel_style);
        if (prefs.budget) setBudget(prefs.budget);
        if (prefs.pace) setPace(prefs.pace);
      })
      .catch(() => {});
  }, [userId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight") { e.preventDefault(); setSlide(s => Math.min(s + 1, TOTAL_SLIDES - 1)); }
      if (e.key === "ArrowLeft") { e.preventDefault(); setSlide(s => Math.max(s - 1, 0)); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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

  function handlePlan() {
    if (!city.trim() || loading) return;
    callAPI(buildPrompt(city.trim(), days, selectedVibes, travelStyle, budget, pace));
  }

  // ── Map view ────────────────────────────────────────────────────────────────
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

  // ── Mode views (opened after tapping a slide's CTA) ─────────────────────────
  if (mode === "plan") {
    return <PlanTripView
      city={city} setCity={setCity}
      days={days} setDays={setDays}
      selectedVibes={selectedVibes} toggleVibe={toggleVibe}
      travelStyle={travelStyle} setTravelStyle={setTravelStyle}
      budget={budget} setBudget={setBudget}
      pace={pace} setPace={setPace}
      placeholderIdx={placeholderIdx}
      loading={loading} error={error}
      onBack={() => setMode(null)}
      onSubmit={handlePlan}
    />;
  }

  if (mode === "agent") {
    return <AgentView onBack={() => setMode(null)} />;
  }

  if (mode === "live") {
    return <LiveView onBack={() => setMode(null)} />;
  }

  // ── Swipeable slides ────────────────────────────────────────────────────────
  return (
    <div
      className="h-screen w-screen overflow-hidden relative select-none"
      style={{ background: "#0a0a0a", touchAction: "pan-y" }}
      onTouchStart={(e) => {
        touchStartX.current = e.touches[0].clientX;
        touchDeltaX.current = 0;
        isDragging.current = true;
        if (trackRef.current) trackRef.current.style.transition = "none";
      }}
      onTouchMove={(e) => {
        if (!isDragging.current) return;
        touchDeltaX.current = e.touches[0].clientX - touchStartX.current;
        if (trackRef.current) {
          const base = -slide * window.innerWidth;
          trackRef.current.style.transform = `translateX(${base + touchDeltaX.current}px)`;
        }
      }}
      onTouchEnd={() => {
        isDragging.current = false;
        if (trackRef.current) {
          trackRef.current.style.transition = "transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)";
        }
        if (Math.abs(touchDeltaX.current) > 60) {
          if (touchDeltaX.current < 0) {
            setSlide(s => Math.min(s + 1, TOTAL_SLIDES - 1));
          } else {
            setSlide(s => Math.max(s - 1, 0));
          }
        }
      }}
    >
      {/* ── Top bar — centered logo ────────────────────────────────── */}
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center h-14"
        style={{ background: "rgba(10,10,10,0.8)", backdropFilter: "blur(16px)" }}>
        <span className="text-sm font-medium" style={{ color: "#333", letterSpacing: "1px" }}>
          naviro
        </span>
      </div>

      {/* ── Slide track ──────────────────────────────────────────── */}
      <div
        ref={trackRef}
        className="flex h-full"
        style={{
          transform: `translateX(-${slide * 100}vw)`,
          transition: "transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        }}
      >
        {/* ═══ SLIDE 1: Plan Your Trip ═══ */}
        <section className="min-w-[100vw] h-full flex flex-col items-center justify-center px-8">
          <div className="max-w-sm w-full text-center">
            <p className="text-6xl mb-6">🗺️</p>
            <h2
              className="text-3xl font-medium mb-3"
              style={{ color: "#fff", letterSpacing: "-1px" }}
            >
              Plan your trip
            </h2>
            <p
              className="text-sm leading-relaxed mb-10"
              style={{ color: "#444" }}
            >
              Pick a city. Choose your vibe.
              <br />
              Get a full itinerary in seconds.
            </p>
            <button
              onClick={() => setMode("plan")}
              className="px-10 py-3.5 rounded-full text-sm font-medium transition-all"
              style={{ background: "#fff", color: "#000" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#e0e0e0";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#fff";
              }}
            >
              Start planning
            </button>
          </div>
        </section>

        {/* ═══ SLIDE 2: AI Agent ═══ */}
        <section className="min-w-[100vw] h-full flex flex-col items-center justify-center px-8">
          <div className="max-w-sm w-full text-center">
            <p className="text-6xl mb-6">🤖</p>
            <h2
              className="text-3xl font-medium mb-3"
              style={{ color: "#fff", letterSpacing: "-1px" }}
            >
              AI travel agent
            </h2>
            <p
              className="text-sm leading-relaxed mb-10"
              style={{ color: "#444" }}
            >
              Tell Naviro what you want.
              <br />
              It plans the entire trip for you.
            </p>
            <button
              onClick={() => setMode("agent")}
              className="px-10 py-3.5 rounded-full text-sm font-medium transition-all"
              style={{ background: "#fff", color: "#000" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#e0e0e0";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#fff";
              }}
            >
              Chat with agent
            </button>
          </div>
        </section>

        {/* ═══ SLIDE 3: Live Mode ═══ */}
        <section className="min-w-[100vw] h-full flex flex-col items-center justify-center px-8">
          <div className="max-w-sm w-full text-center">
            <p className="text-6xl mb-6">📍</p>
            <h2
              className="text-3xl font-medium mb-3"
              style={{ color: "#fff", letterSpacing: "-1px" }}
            >
              I&apos;m travelling now
            </h2>
            <p
              className="text-sm leading-relaxed mb-10"
              style={{ color: "#444" }}
            >
              Already on a trip? Get live tips,
              <br />
              replan your day, find nearby food.
            </p>
            <button
              onClick={() => setMode("live")}
              className="px-10 py-3.5 rounded-full text-sm font-medium transition-all"
              style={{ background: "#fff", color: "#000" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#e0e0e0";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#fff";
              }}
            >
              Enter live mode
            </button>
          </div>
        </section>
      </div>

      {/* ── Bottom nav: arrows + pill dots ────────────────────────────── */}
      <div
        className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-5"
      >
        <button
          onClick={() => setSlide(s => Math.max(s - 1, 0))}
          className="w-8 h-8 flex items-center justify-center text-lg transition-all"
          style={{ color: slide === 0 ? "#1a1a1a" : "#666" }}
        >
          ←
        </button>
        <div className="flex items-center gap-1.5">
          {Array.from({ length: TOTAL_SLIDES }).map((_, i) => (
            <button
              key={i}
              onClick={() => setSlide(i)}
              className="transition-all duration-300"
              style={{
                width: i === slide ? 20 : 6,
                height: 4,
                borderRadius: 2,
                background: i === slide ? "#fff" : "#222",
              }}
            />
          ))}
        </div>
        <button
          onClick={() => setSlide(s => Math.min(s + 1, TOTAL_SLIDES - 1))}
          className="w-8 h-8 flex items-center justify-center text-lg transition-all"
          style={{ color: slide === TOTAL_SLIDES - 1 ? "#1a1a1a" : "#666" }}
        >
          →
        </button>
      </div>
    </div>
  );
}


// ─── Plan Trip View ───────────────────────────────────────────────────────────
function PlanTripView({
  city, setCity, days, setDays, selectedVibes, toggleVibe,
  travelStyle, setTravelStyle, budget, setBudget, pace, setPace,
  placeholderIdx, loading, error, onBack, onSubmit,
}: {
  city: string; setCity: (v: string) => void;
  days: string; setDays: (v: string) => void;
  selectedVibes: string[]; toggleVibe: (v: string) => void;
  travelStyle: string; setTravelStyle: (v: string) => void;
  budget: string; setBudget: (v: string) => void;
  pace: string; setPace: (v: string) => void;
  placeholderIdx: number; loading: boolean; error: string;
  onBack: () => void; onSubmit: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 300);
  }, []);

  return (
    <div className="min-h-screen overflow-y-auto" style={{ background: "#0a0a0a" }}>
      {/* Top bar */}
      <div className="sticky top-0 z-50 flex items-center h-14 px-6"
        style={{ background: "rgba(10,10,10,0.85)", backdropFilter: "blur(16px)" }}>
        <button onClick={onBack} className="text-sm transition-all"
          style={{ color: "#555" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#999"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "#555"; }}>
          ← Back
        </button>
        <span className="flex-1 text-center text-sm font-medium" style={{ color: "#555" }}>
          naviro
        </span>
        <div style={{ width: 50 }} />
      </div>

      <div className="max-w-md mx-auto px-6 py-8 space-y-10">
        {/* Where to */}
        <div className="text-center space-y-4">
          <h2 className="text-3xl font-medium" style={{ color: "#fff", letterSpacing: "-1px" }}>
            Where to?
          </h2>
          <input
            ref={inputRef}
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder={PLACEHOLDERS[placeholderIdx]}
            className="w-full bg-transparent text-center text-xl font-medium outline-none pb-3"
            style={{ color: "#fff", borderBottom: "1px solid #222", caretColor: "#fff" }}
            onFocus={(e) => { e.currentTarget.style.borderBottomColor = "#555"; }}
            onBlur={(e) => { e.currentTarget.style.borderBottomColor = "#222"; }}
          />
          <div className="grid grid-cols-2 gap-2 pt-2">
            {POPULAR_DESTINATIONS.map((d) => (
              <button key={d.name}
                onClick={() => setCity(d.name)}
                className="flex items-center gap-3 p-3 rounded-xl text-left transition-all"
                style={{ background: "#111", border: "1px solid #1a1a1a" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#333"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#1a1a1a"; }}>
                <span className="text-lg">{d.icon}</span>
                <div>
                  <p className="text-sm font-medium" style={{ color: "#fff" }}>{d.name}</p>
                  <p className="text-xs" style={{ color: "#444" }}>{d.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Duration */}
        <div className="text-center space-y-4">
          <h3 className="text-xl font-medium" style={{ color: "#fff" }}>How many days?</h3>
          <div className="flex items-center justify-center gap-5">
            <button onClick={() => setDays((d) => String(Math.max(1, Number(d) - 1)))}
              className="w-10 h-10 rounded-full flex items-center justify-center text-lg"
              style={{ background: "#111", border: "1px solid #1a1a1a", color: "#555" }}>−</button>
            <span className="text-3xl font-medium" style={{ color: "#fff" }}>
              {days} <span className="text-sm" style={{ color: "#444" }}>{Number(days) === 1 ? "day" : "days"}</span>
            </span>
            <button onClick={() => setDays((d) => String(Math.min(7, Number(d) + 1)))}
              className="w-10 h-10 rounded-full flex items-center justify-center text-lg"
              style={{ background: "#111", border: "1px solid #1a1a1a", color: "#555" }}>+</button>
          </div>
        </div>

        {/* Vibes */}
        <div className="text-center space-y-3">
          <h3 className="text-xl font-medium" style={{ color: "#fff" }}>What&apos;s your vibe?</h3>
          <div className="flex flex-wrap justify-center gap-2">
            {VIBES.map((v) => (
              <button key={v.label} onClick={() => toggleVibe(v.label)}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-sm transition-all"
                style={selectedVibes.includes(v.label)
                  ? { background: "#fff", color: "#000", border: "1px solid #fff", fontWeight: 500 }
                  : { background: "transparent", color: "#666", border: "1px solid #222" }
                }>
                <span>{v.icon}</span><span>{v.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Travel style */}
        <div className="text-center space-y-3">
          <h3 className="text-xl font-medium" style={{ color: "#fff" }}>Travelling as</h3>
          <div className="flex flex-wrap justify-center gap-2">
            {TRAVEL_STYLES.map((s) => (
              <button key={s.label}
                onClick={() => setTravelStyle((prev) => (prev === s.label ? "" : s.label))}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-sm transition-all"
                style={travelStyle === s.label
                  ? { background: "#fff", color: "#000", border: "1px solid #fff", fontWeight: 500 }
                  : { background: "transparent", color: "#666", border: "1px solid #222" }
                }>
                <span>{s.icon}</span><span>{s.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Budget */}
        <div className="text-center space-y-3">
          <h3 className="text-xl font-medium" style={{ color: "#fff" }}>Budget</h3>
          <div className="flex justify-center gap-3">
            {BUDGETS.map((b) => (
              <button key={b.label}
                onClick={() => setBudget((prev) => (prev === b.label ? "" : b.label))}
                className="flex flex-col items-center gap-1 px-5 py-3 rounded-xl text-sm transition-all"
                style={budget === b.label
                  ? { background: "#fff", color: "#000", border: "1px solid #fff", fontWeight: 500 }
                  : { background: "#111", color: "#666", border: "1px solid #1a1a1a" }
                }>
                <span className="text-lg">{b.icon}</span>
                <span>{b.label}</span>
                <span className="text-xs" style={{ color: budget === b.label ? "rgba(0,0,0,0.5)" : "#333" }}>{b.sub}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Pace */}
        <div className="text-center space-y-3">
          <h3 className="text-xl font-medium" style={{ color: "#fff" }}>Pace</h3>
          <div className="flex justify-center gap-3">
            {PACES.map((p) => (
              <button key={p.label}
                onClick={() => setPace((prev) => (prev === p.label ? "" : p.label))}
                className="flex flex-col items-center gap-1 px-5 py-3 rounded-xl text-sm transition-all"
                style={pace === p.label
                  ? { background: "#fff", color: "#000", border: "1px solid #fff", fontWeight: 500 }
                  : { background: "#111", color: "#666", border: "1px solid #1a1a1a" }
                }>
                <span className="text-lg">{p.icon}</span>
                <span>{p.label}</span>
                <span className="text-xs" style={{ color: pace === p.label ? "rgba(0,0,0,0.5)" : "#333" }}>{p.sub}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Error & Submit */}
        {error && <p className="text-sm text-center" style={{ color: "#e55" }}>{error}</p>}

        <div className="space-y-3 pb-8">
          <button onClick={onSubmit} disabled={!city.trim() || loading}
            className="w-full py-4 rounded-xl text-sm font-medium transition-all disabled:opacity-30"
            style={{ background: "#fff", color: "#000" }}>
            {loading ? "Planning your trip…" : "Plan my trip →"}
          </button>
        </div>
      </div>
    </div>
  );
}


// ─── Agent View (placeholder) ─────────────────────────────────────────────────
function AgentView({ onBack }: { onBack: () => void }) {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#0a0a0a" }}>
      <div className="sticky top-0 z-50 flex items-center h-14 px-6"
        style={{ background: "rgba(10,10,10,0.85)", backdropFilter: "blur(16px)" }}>
        <button onClick={onBack} className="text-sm" style={{ color: "#555" }}>← Back</button>
        <span className="flex-1 text-center text-sm font-medium" style={{ color: "#555" }}>naviro agent</span>
        <div style={{ width: 50 }} />
      </div>
      <div className="flex-1 flex items-center justify-center px-8">
        <div className="text-center space-y-4">
          <p className="text-3xl">🤖</p>
          <h2 className="text-2xl font-medium" style={{ color: "#fff" }}>AI Agent</h2>
          <p className="text-sm" style={{ color: "#555" }}>Coming soon — conversational trip planning</p>
        </div>
      </div>
    </div>
  );
}


// ─── Live View (placeholder) ──────────────────────────────────────────────────
function LiveView({ onBack }: { onBack: () => void }) {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#0a0a0a" }}>
      <div className="sticky top-0 z-50 flex items-center h-14 px-6"
        style={{ background: "rgba(10,10,10,0.85)", backdropFilter: "blur(16px)" }}>
        <button onClick={onBack} className="text-sm" style={{ color: "#555" }}>← Back</button>
        <span className="flex-1 text-center text-sm font-medium" style={{ color: "#555" }}>naviro live</span>
        <div style={{ width: 50 }} />
      </div>
      <div className="flex-1 flex items-center justify-center px-8">
        <div className="text-center space-y-4">
          <p className="text-3xl">📍</p>
          <h2 className="text-2xl font-medium" style={{ color: "#fff" }}>Live Mode</h2>
          <p className="text-sm" style={{ color: "#555" }}>Coming soon — real-time travel assistance</p>
        </div>
      </div>
    </div>
  );
}
