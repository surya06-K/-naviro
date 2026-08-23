"use client";

import { useState, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import LivingPhoto from "./components/LivingPhoto";

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

// Destinations that cycle as the living backdrop on the landing slides.
const HERO_PLACES = ["Varanasi", "Goa", "Jaipur", "Manali", "Udaipur", "Hampi"];

const SLIDES = [
  {
    emoji: "🗺️",
    title: "Plan your trip",
    desc: ["Pick a city. Choose your vibe.", "Get a full itinerary in seconds."],
    cta: "Start planning",
    mode: "plan" as const,
    glow: "rgba(255,255,255,0.03)",
  },
  {
    emoji: "🤖",
    title: "AI travel agent",
    desc: ["Tell Naviro what you want.", "It plans the entire trip for you."],
    cta: "Chat with agent",
    mode: "agent" as const,
    glow: "rgba(255,255,255,0.03)",
  },
  {
    emoji: "📍",
    title: "I'm travelling now",
    desc: ["Already on a trip? Get live tips,", "replan your day, find nearby food."],
    cta: "Enter live mode",
    mode: "live" as const,
    glow: "rgba(255,255,255,0.03)",
  },
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
  const [slide, setSlide] = useState(0);
  const [mode, setMode] = useState<"plan" | "agent" | "live" | null>(null);

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
  const [heroIdx, setHeroIdx] = useState(0);
  const sessionId = useRef(generateSessionId());

  const touchStartX = useRef(0);
  const touchDeltaX = useRef(0);
  const isDragging = useRef(false);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => setPlaceholderIdx((p) => (p + 1) % PLACEHOLDERS.length), 2200);
    return () => clearInterval(t);
  }, []);

  // Cycle the living backdrop through hero destinations on the landing.
  useEffect(() => {
    if (mode !== null) return;
    const t = setInterval(() => setHeroIdx((h) => (h + 1) % HERO_PLACES.length), 7000);
    return () => clearInterval(t);
  }, [mode]);

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

  // ── Mode views ─────────────────────────────────────────────────────────────
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
      {/* Inline keyframes */}
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* ── Living photo backdrop (cycles through hero destinations) ── */}
      <div className="absolute inset-0 z-0">
        <LivingPhoto query={HERO_PLACES[heroIdx]} intensity={0.7} scrim={0.62} />
      </div>

      {/* Which place you're looking at */}
      <div className="fixed top-16 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 pointer-events-none">
        <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, letterSpacing: "2px", textTransform: "uppercase" }}>
          ✦ {HERO_PLACES[heroIdx]}
        </span>
      </div>

      {/* ── Top bar ────────────────────────────────────────────── */}
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center h-14"
        style={{ background: "rgba(10,10,10,0.85)", backdropFilter: "blur(20px)" }}>
        <span className="text-xs tracking-[3px] uppercase" style={{ color: "#2a2a2a" }}>
          naviro
        </span>
      </div>

      {/* ── Slide track ──────────────────────────────────────── */}
      <div
        ref={trackRef}
        className="flex h-full relative z-10"
        style={{
          transform: `translateX(-${slide * 100}vw)`,
          transition: "transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        }}
      >
        {SLIDES.map((s, i) => (
          <section key={i} className="min-w-[100vw] h-full flex flex-col items-center justify-center px-8 relative">
            <div className="max-w-sm w-full text-center relative z-10">
              <p className="text-6xl mb-7" style={{ animation: "float 4s ease-in-out infinite", filter: "drop-shadow(0 4px 16px rgba(0,0,0,0.5))" }}>
                {s.emoji}
              </p>
              <h2 className="text-3xl font-semibold mb-3" style={{ color: "#fff", letterSpacing: "-0.5px", textShadow: "0 2px 24px rgba(0,0,0,0.6)" }}>
                {s.title}
              </h2>
              <p className="text-sm leading-relaxed mb-12" style={{ color: "rgba(255,255,255,0.78)", textShadow: "0 1px 16px rgba(0,0,0,0.7)" }}>
                {s.desc[0]}<br />{s.desc[1]}
              </p>
              <button
                onClick={() => setMode(s.mode)}
                className="px-10 py-3.5 rounded-full text-sm font-medium transition-all duration-200"
                style={{ background: "#fff", color: "#000", boxShadow: "0 8px 30px rgba(0,0,0,0.35)" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "scale(1.03)";
                  e.currentTarget.style.boxShadow = "0 0 24px rgba(255,255,255,0.25)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "scale(1)";
                  e.currentTarget.style.boxShadow = "0 8px 30px rgba(0,0,0,0.35)";
                }}
              >
                {s.cta}
              </button>
            </div>
          </section>
        ))}
      </div>

      {/* ── Bottom nav ────────────────────────────────────────── */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4">
        <button
          onClick={() => setSlide(s => Math.max(s - 1, 0))}
          className="w-8 h-8 flex items-center justify-center rounded-full transition-all duration-200"
          style={{ color: slide === 0 ? "#111" : "#555", background: slide === 0 ? "transparent" : "rgba(255,255,255,0.03)" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <div className="flex items-center gap-2 px-3 py-2 rounded-full" style={{ background: "rgba(255,255,255,0.03)" }}>
          {Array.from({ length: TOTAL_SLIDES }).map((_, i) => (
            <button
              key={i}
              onClick={() => setSlide(i)}
              className="transition-all duration-300"
              style={{
                width: i === slide ? 20 : 6,
                height: 4,
                borderRadius: 2,
                background: i === slide ? "#fff" : "#1a1a1a",
              }}
            />
          ))}
        </div>
        <button
          onClick={() => setSlide(s => Math.min(s + 1, TOTAL_SLIDES - 1))}
          className="w-8 h-8 flex items-center justify-center rounded-full transition-all duration-200"
          style={{ color: slide === TOTAL_SLIDES - 1 ? "#111" : "#555", background: slide === TOTAL_SLIDES - 1 ? "transparent" : "rgba(255,255,255,0.03)" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
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
  const [bgQuery, setBgQuery] = useState(city.trim() || "India travel landscape");

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 300);
  }, []);

  // Debounce the backdrop so we don't refetch on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setBgQuery(city.trim() || "India travel landscape"), 550);
    return () => clearTimeout(id);
  }, [city]);

  return (
    <div className="relative min-h-screen overflow-y-auto" style={{ background: "#0a0a0a" }}>
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .fade-section { animation: fadeUp 0.5s ease-out both; }
      `}</style>

      {/* Living backdrop — morphs into the chosen place */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <LivingPhoto query={bgQuery} intensity={0.45} scrim={0.82} showCredit={false} />
      </div>

      {/* Foreground content sits above the backdrop */}
      <div className="relative z-10">

      {/* Top bar */}
      <div className="sticky top-0 z-50 flex items-center h-14 px-6"
        style={{ background: "rgba(10,10,10,0.9)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm transition-all"
          style={{ color: "#444" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#888"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "#444"; }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
          Back
        </button>
        <span className="flex-1 text-center text-xs tracking-[3px] uppercase" style={{ color: "#2a2a2a" }}>
          naviro
        </span>
        <div style={{ width: 60 }} />
      </div>

      <div className="max-w-md mx-auto px-6 pt-8 pb-12">
        {/* Where to */}
        <div className="text-center space-y-5 mb-14 fade-section" style={{ animationDelay: "0.05s" }}>
          <h2 className="text-3xl font-semibold" style={{ color: "#fff", letterSpacing: "-0.5px" }}>
            Where to?
          </h2>
          <input
            ref={inputRef}
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder={PLACEHOLDERS[placeholderIdx]}
            className="w-full bg-transparent text-center text-xl font-medium outline-none pb-3 transition-colors duration-200"
            style={{ color: "#fff", borderBottom: "1px solid #1a1a1a", caretColor: "#fff" }}
            onFocus={(e) => { e.currentTarget.style.borderBottomColor = "#444"; }}
            onBlur={(e) => { e.currentTarget.style.borderBottomColor = "#1a1a1a"; }}
          />
          <div className="grid grid-cols-2 gap-2 pt-2">
            {POPULAR_DESTINATIONS.map((d) => (
              <button key={d.name}
                onClick={() => setCity(d.name)}
                className="flex items-center gap-3 p-3 rounded-2xl text-left transition-all duration-200"
                style={{
                  background: city === d.name ? "rgba(255,255,255,0.08)" : "#0f0f0f",
                  border: city === d.name ? "1px solid rgba(255,255,255,0.12)" : "1px solid #151515",
                }}
                onMouseEnter={(e) => {
                  if (city !== d.name) e.currentTarget.style.borderColor = "#252525";
                }}
                onMouseLeave={(e) => {
                  if (city !== d.name) e.currentTarget.style.borderColor = "#151515";
                }}>
                <span className="text-lg">{d.icon}</span>
                <div>
                  <p className="text-sm font-medium" style={{ color: "#ddd" }}>{d.name}</p>
                  <p className="text-xs" style={{ color: "#3a3a3a" }}>{d.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Duration */}
        <div className="text-center space-y-4 mb-14 fade-section" style={{ animationDelay: "0.1s" }}>
          <h3 className="text-lg font-medium" style={{ color: "#888" }}>How many days?</h3>
          <div className="flex items-center justify-center gap-6">
            <button onClick={() => setDays(String(Math.max(1, Number(days) - 1)))}
              className="w-11 h-11 rounded-full flex items-center justify-center text-lg transition-all duration-200"
              style={{ background: "#0f0f0f", border: "1px solid #1a1a1a", color: "#555" }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#333"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#1a1a1a"; }}>
              −
            </button>
            <div className="min-w-[80px]">
              <span className="text-4xl font-semibold tabular-nums" style={{ color: "#fff" }}>{days}</span>
              <span className="text-sm ml-1.5" style={{ color: "#3a3a3a" }}>{Number(days) === 1 ? "day" : "days"}</span>
            </div>
            <button onClick={() => setDays(String(Math.min(7, Number(days) + 1)))}
              className="w-11 h-11 rounded-full flex items-center justify-center text-lg transition-all duration-200"
              style={{ background: "#0f0f0f", border: "1px solid #1a1a1a", color: "#555" }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#333"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#1a1a1a"; }}>
              +
            </button>
          </div>
        </div>

        {/* Vibes */}
        <div className="text-center space-y-4 mb-14 fade-section" style={{ animationDelay: "0.15s" }}>
          <h3 className="text-lg font-medium" style={{ color: "#888" }}>What&apos;s your vibe?</h3>
          <div className="flex flex-wrap justify-center gap-2">
            {VIBES.map((v) => (
              <button key={v.label} onClick={() => toggleVibe(v.label)}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-sm transition-all duration-200"
                style={selectedVibes.includes(v.label)
                  ? { background: "#fff", color: "#000", border: "1px solid #fff", fontWeight: 500 }
                  : { background: "transparent", color: "#555", border: "1px solid #1a1a1a" }
                }
                onMouseEnter={(e) => {
                  if (!selectedVibes.includes(v.label)) e.currentTarget.style.borderColor = "#333";
                }}
                onMouseLeave={(e) => {
                  if (!selectedVibes.includes(v.label)) e.currentTarget.style.borderColor = "#1a1a1a";
                }}>
                <span>{v.icon}</span><span>{v.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Travel style */}
        <div className="text-center space-y-4 mb-14 fade-section" style={{ animationDelay: "0.2s" }}>
          <h3 className="text-lg font-medium" style={{ color: "#888" }}>Travelling as</h3>
          <div className="flex flex-wrap justify-center gap-2">
            {TRAVEL_STYLES.map((s) => (
              <button key={s.label}
                onClick={() => setTravelStyle(travelStyle === s.label ? "" : s.label)}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-sm transition-all duration-200"
                style={travelStyle === s.label
                  ? { background: "#fff", color: "#000", border: "1px solid #fff", fontWeight: 500 }
                  : { background: "transparent", color: "#555", border: "1px solid #1a1a1a" }
                }
                onMouseEnter={(e) => {
                  if (travelStyle !== s.label) e.currentTarget.style.borderColor = "#333";
                }}
                onMouseLeave={(e) => {
                  if (travelStyle !== s.label) e.currentTarget.style.borderColor = "#1a1a1a";
                }}>
                <span>{s.icon}</span><span>{s.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Budget */}
        <div className="text-center space-y-4 mb-14 fade-section" style={{ animationDelay: "0.25s" }}>
          <h3 className="text-lg font-medium" style={{ color: "#888" }}>Budget</h3>
          <div className="flex justify-center gap-3">
            {BUDGETS.map((b) => (
              <button key={b.label}
                onClick={() => setBudget(budget === b.label ? "" : b.label)}
                className="flex flex-col items-center gap-1.5 px-5 py-4 rounded-2xl text-sm transition-all duration-200"
                style={budget === b.label
                  ? { background: "rgba(255,255,255,0.08)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)", fontWeight: 500 }
                  : { background: "#0f0f0f", color: "#555", border: "1px solid #151515" }
                }
                onMouseEnter={(e) => {
                  if (budget !== b.label) e.currentTarget.style.borderColor = "#252525";
                }}
                onMouseLeave={(e) => {
                  if (budget !== b.label) e.currentTarget.style.borderColor = "#151515";
                }}>
                <span className="text-lg">{b.icon}</span>
                <span>{b.label}</span>
                <span className="text-xs" style={{ color: budget === b.label ? "#666" : "#2a2a2a" }}>{b.sub}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Pace */}
        <div className="text-center space-y-4 mb-14 fade-section" style={{ animationDelay: "0.3s" }}>
          <h3 className="text-lg font-medium" style={{ color: "#888" }}>Pace</h3>
          <div className="flex justify-center gap-3">
            {PACES.map((p) => (
              <button key={p.label}
                onClick={() => setPace(pace === p.label ? "" : p.label)}
                className="flex flex-col items-center gap-1.5 px-5 py-4 rounded-2xl text-sm transition-all duration-200"
                style={pace === p.label
                  ? { background: "rgba(255,255,255,0.08)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)", fontWeight: 500 }
                  : { background: "#0f0f0f", color: "#555", border: "1px solid #151515" }
                }
                onMouseEnter={(e) => {
                  if (pace !== p.label) e.currentTarget.style.borderColor = "#252525";
                }}
                onMouseLeave={(e) => {
                  if (pace !== p.label) e.currentTarget.style.borderColor = "#151515";
                }}>
                <span className="text-lg">{p.icon}</span>
                <span>{p.label}</span>
                <span className="text-xs" style={{ color: pace === p.label ? "#666" : "#2a2a2a" }}>{p.sub}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Error & Submit */}
        {error && <p className="text-sm text-center mb-4" style={{ color: "#e55" }}>{error}</p>}

        <div className="pb-10 fade-section" style={{ animationDelay: "0.35s" }}>
          <button onClick={onSubmit} disabled={!city.trim() || loading}
            className="w-full py-4 rounded-full text-sm font-medium transition-all duration-200 disabled:opacity-20"
            style={{ background: "#fff", color: "#000" }}
            onMouseEnter={(e) => {
              if (!e.currentTarget.disabled) {
                e.currentTarget.style.transform = "scale(1.01)";
                e.currentTarget.style.boxShadow = "0 0 24px rgba(255,255,255,0.08)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "scale(1)";
              e.currentTarget.style.boxShadow = "none";
            }}>
            {loading ? "Planning your trip…" : "Plan my trip →"}
          </button>
        </div>
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
        style={{ background: "rgba(10,10,10,0.9)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm" style={{ color: "#444" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
          Back
        </button>
        <span className="flex-1 text-center text-xs tracking-[3px] uppercase" style={{ color: "#2a2a2a" }}>naviro agent</span>
        <div style={{ width: 60 }} />
      </div>
      <div className="flex-1 flex items-center justify-center px-8">
        <div className="text-center space-y-5">
          <p className="text-4xl" style={{ animation: "float 4s ease-in-out infinite" }}>🤖</p>
          <h2 className="text-2xl font-semibold" style={{ color: "#fff" }}>AI Agent</h2>
          <p className="text-sm" style={{ color: "#3a3a3a" }}>Coming soon — conversational trip planning</p>
        </div>
      </div>
      <style>{`@keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }`}</style>
    </div>
  );
}


// ─── Live View (placeholder) ──────────────────────────────────────────────────
function LiveView({ onBack }: { onBack: () => void }) {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#0a0a0a" }}>
      <div className="sticky top-0 z-50 flex items-center h-14 px-6"
        style={{ background: "rgba(10,10,10,0.9)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm" style={{ color: "#444" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
          Back
        </button>
        <span className="flex-1 text-center text-xs tracking-[3px] uppercase" style={{ color: "#2a2a2a" }}>naviro live</span>
        <div style={{ width: 60 }} />
      </div>
      <div className="flex-1 flex items-center justify-center px-8">
        <div className="text-center space-y-5">
          <p className="text-4xl" style={{ animation: "float 4s ease-in-out infinite" }}>📍</p>
          <h2 className="text-2xl font-semibold" style={{ color: "#fff" }}>Live Mode</h2>
          <p className="text-sm" style={{ color: "#3a3a3a" }}>Coming soon — real-time travel assistance</p>
        </div>
      </div>
      <style>{`@keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }`}</style>
    </div>
  );
}
