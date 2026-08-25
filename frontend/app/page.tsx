"use client";

import { useState, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import LivingPhoto from "./components/LivingPhoto";
import AgentChat from "./components/AgentChat";
import type { Day, Itinerary } from "./types";
import Button from "./components/ui/Button";
import Chip from "./components/ui/Chip";
import {
  ArrowRight,
  Minus,
  Plus,
  MapPin,
  Message,
  Rupee,
  VIBE_ICONS,
  TRAVEL_STYLE_ICONS,
  PACE_ICONS,
} from "./components/icons";

// ─── Config ───────────────────────────────────────────────────────────────────
const VIBES: { label: string }[] = [
  { label: "Street Food" },
  { label: "History" },
  { label: "Nature" },
  { label: "Local Culture" },
  { label: "Markets" },
  { label: "Nightlife" },
  { label: "Art & Music" },
  { label: "Spiritual" },
];

const TRAVEL_STYLES: { label: string }[] = [
  { label: "Solo" },
  { label: "Couple" },
  { label: "Friends" },
  { label: "Family" },
];

const BUDGETS: { label: string; sub: string; tier: 1 | 2 | 3 }[] = [
  { label: "Budget", sub: "under ₹500/day", tier: 1 },
  { label: "Mid-range", sub: "₹500–2000/day", tier: 2 },
  { label: "Luxury", sub: "₹2000+/day", tier: 3 },
];

const PACES: { label: string; sub: string }[] = [
  { label: "Relaxed", sub: "2–3 places/day" },
  { label: "Balanced", sub: "3–4 places/day" },
  { label: "Packed", sub: "max places" },
];

const POPULAR_DESTINATIONS: { name: string; desc: string }[] = [
  { name: "Goa", desc: "Beaches & culture" },
  { name: "Jaipur", desc: "The Pink City" },
  { name: "Manali", desc: "Mountain escape" },
  { name: "Varanasi", desc: "Spiritual journey" },
  { name: "Coorg", desc: "Coffee & mist" },
  { name: "Udaipur", desc: "City of lakes" },
  { name: "Rishikesh", desc: "Adventure & yoga" },
  { name: "Hampi", desc: "Ancient ruins" },
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

// Rotating status copy shown on the submit button while a plan request is in flight.
const PROGRESS_MESSAGES = [
  "Reading your vibe…",
  "Picking real spots…",
  "Checking they're actually open…",
  "Placing them on the map…",
];

// ─── Dynamic imports ──────────────────────────────────────────────────────────
const TravelMap = dynamic(() => import("./components/TravelMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full min-h-dvh flex items-center justify-center bg-background">
      <div className="text-small text-muted-soft animate-pulse">Loading map…</div>
    </div>
  ),
});

function generateSessionId() {
  return "session-" + Math.random().toString(36).slice(2, 10);
}

// Stop-count guidance per pace tier — must match the backend's enforced bounds exactly.
const PACE_STOP_COUNTS: Record<string, string> = {
  Relaxed: "Pace: relaxed (2-3 stops per day)",
  Balanced: "Pace: balanced (3-4 stops per day)",
  Packed: "Pace: packed (4-5 stops per day)",
};

function buildPrompt(
  city: string,
  days: string,
  vibes: string[],
  style: string,
  budget: string,
  pace: string,
  pastDestinations: string[]
): string {
  const parts: string[] = [];
  if (days) parts.push(`${days} day${days === "1" ? "" : "s"} in ${city}`);
  else parts.push(`Trip to ${city}`);
  if (vibes.length > 0) parts.push(`Interests: ${vibes.join(", ")}`);
  if (style) parts.push(style + " traveller");
  if (budget) parts.push(`Budget: ${budget}`);
  if (PACE_STOP_COUNTS[pace]) parts.push(PACE_STOP_COUNTS[pace]);
  if (pastDestinations.length > 0) {
    parts.push(`Traveler has previously planned trips with Naviro to: ${pastDestinations.join(", ")}`);
  }
  return parts.join(". ") + ".";
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function Home() {
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [livedays, setLiveDays] = useState<Day[]>([]);
  const [activeDay, setActiveDay] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showChat, setShowChat] = useState(false);

  const [city, setCity] = useState("");
  const [days, setDays] = useState("2");
  const [selectedVibes, setSelectedVibes] = useState<string[]>([]);
  const [travelStyle, setTravelStyle] = useState("");
  const [budget, setBudget] = useState("");
  const [pace, setPace] = useState("");
  const [pastDestinations, setPastDestinations] = useState<string[]>([]);

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
  const [progressIdx, setProgressIdx] = useState(0);
  const sessionId = useRef(generateSessionId());
  const lastMessageRef = useRef("");

  useEffect(() => {
    const t = setInterval(() => setPlaceholderIdx((p) => (p + 1) % PLACEHOLDERS.length), 2200);
    return () => clearInterval(t);
  }, []);

  // Rotate through honest progress copy while a plan request is in flight. Clamp at the
  // last message instead of wrapping — repeating "reading your vibe" after 20s of a real
  // request would undercut the point of showing progress at all.
  useEffect(() => {
    if (!loading) {
      setProgressIdx(0);
      return;
    }
    const t = setInterval(() => {
      setProgressIdx((p) => Math.min(p + 1, PROGRESS_MESSAGES.length - 1));
    }, 3500);
    return () => clearInterval(t);
  }, [loading]);

  useEffect(() => {
    const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");
    fetch(`${apiUrl}/api/preferences/${userId}`)
      .then((r) => r.json())
      .then((prefs) => {
        if (prefs.vibes?.length) setSelectedVibes(prefs.vibes);
        if (prefs.travel_style) setTravelStyle(prefs.travel_style);
        if (prefs.budget) setBudget(prefs.budget);
        if (prefs.pace) setPace(prefs.pace);
        if (Array.isArray(prefs.past_destinations)) setPastDestinations(prefs.past_destinations);
      })
      .catch(() => {});
  }, [userId]);

  function toggleVibe(label: string) {
    setSelectedVibes((prev) =>
      prev.includes(label) ? prev.filter((v) => v !== label) : [...prev, label]
    );
  }

  async function callAPI(message: string) {
    lastMessageRef.current = message;
    setLoading(true);
    setError("");
    // Render free tier can cold-start (p95 15-40s), and a request with several
    // unverified places can legitimately run long too — LocationIQ's smaller
    // India dataset means more slots fall through to the throttled Nominatim
    // fallback plus a repair round-trip (measured: 54.6s for a real Narsipatnam
    // request). 80s gives that room without waiting forever on a truly hung one.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 80000);
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
        body: JSON.stringify({ session_id: sessionId.current, message, destination: city.trim() || undefined }),
        signal: controller.signal,
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
      if (e instanceof DOMException && e.name === "AbortError") {
        setError("This is taking longer than usual — the server might be waking up from sleep. Try again in a moment.");
      } else {
        setError(e instanceof Error ? e.message : "Network error — make sure the backend is running");
      }
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  }

  function handlePlan() {
    if (!city.trim() || loading) return;
    callAPI(buildPrompt(city.trim(), days, selectedVibes, travelStyle, budget, pace, pastDestinations));
  }

  function handleRetry() {
    if (lastMessageRef.current) callAPI(lastMessageRef.current);
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
        onExit={() => setItinerary(null)}
      />
    );
  }

  // ── Chat view ────────────────────────────────────────────────────────────────
  if (showChat) {
    return (
      <AgentChat
        onItineraryReady={(chatItinerary) => {
          setItinerary(chatItinerary);
          setLiveDays(chatItinerary.days);
          setActiveDay(0);
          setShowChat(false);
        }}
        onBack={() => setShowChat(false)}
      />
    );
  }

  return (
    <PlanTripView
      city={city} setCity={setCity}
      days={days} setDays={setDays}
      selectedVibes={selectedVibes} toggleVibe={toggleVibe}
      travelStyle={travelStyle} setTravelStyle={setTravelStyle}
      budget={budget} setBudget={setBudget}
      pace={pace} setPace={setPace}
      placeholderIdx={placeholderIdx}
      progressIdx={progressIdx}
      loading={loading} error={error}
      onSubmit={handlePlan}
      onRetry={handleRetry}
      onOpenChat={() => setShowChat(true)}
    />
  );
}


// ─── Plan Trip View ───────────────────────────────────────────────────────────
function PlanTripView({
  city, setCity, days, setDays, selectedVibes, toggleVibe,
  travelStyle, setTravelStyle, budget, setBudget, pace, setPace,
  placeholderIdx, progressIdx, loading, error, onSubmit, onRetry, onOpenChat,
}: {
  city: string; setCity: (v: string) => void;
  days: string; setDays: (v: string) => void;
  selectedVibes: string[]; toggleVibe: (v: string) => void;
  travelStyle: string; setTravelStyle: (v: string) => void;
  budget: string; setBudget: (v: string) => void;
  pace: string; setPace: (v: string) => void;
  placeholderIdx: number; progressIdx: number; loading: boolean; error: string;
  onSubmit: () => void; onRetry: () => void; onOpenChat: () => void;
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
    <div className="relative min-h-dvh bg-background">
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .fade-section { animation: fadeUp 0.5s ease-out both; }
      `}</style>

      {/* Living backdrop — reads as atmosphere, not the loudest element */}
      <div className="fixed inset-0 z-map pointer-events-none">
        <LivingPhoto query={bgQuery} intensity={0.3} scrim={0.82} showCredit={false} />
      </div>

      {/* Foreground content sits above the backdrop */}
      <div className="relative z-chrome flex flex-col min-h-dvh">
        <header className="sticky top-0 z-header relative flex items-center justify-center h-14 px-4 sm:px-6 backdrop-blur-xl bg-background/90 border-b border-border-subtle">
          <span className="font-mono text-caption tracking-[3px] uppercase text-muted-soft">
            naviro
          </span>
          <Button
            variant="ghost"
            size="sm"
            icon={Message}
            onClick={onOpenChat}
            className="absolute right-3 sm:right-6"
          >
            Chat instead
          </Button>
        </header>

        <main id="main-content" className="flex-1">
          <div className="max-w-[1200px] mx-auto px-6 pt-10 pb-12 lg:pt-16 lg:pb-20 lg:grid lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:items-start">

            {/* Beat 1 — hero: headline, city input, destination rail */}
            <div className="fade-section lg:sticky lg:top-24" style={{ animationDelay: "0.05s" }}>
              <h2 className="text-h1 lg:text-display font-semibold text-foreground-strong text-center lg:text-left">
                Where to?
              </h2>
              <input
                ref={inputRef}
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder={PLACEHOLDERS[placeholderIdx]}
                aria-label="Destination city"
                className="w-full bg-transparent text-h2 font-medium outline-none pb-3 mt-6 text-center lg:text-left border-b border-border-subtle focus:border-accent transition-colors duration-200 text-foreground-strong placeholder:text-muted-soft"
              />

              <div
                className="flex gap-2 overflow-x-auto pb-1 mt-6 -mx-6 px-6 lg:mx-0 lg:px-0 snap-x snap-proximity"
                style={{ scrollbarWidth: "none" }}
              >
                {POPULAR_DESTINATIONS.map((d) => (
                  <Chip
                    key={d.name}
                    layout="row"
                    icon={MapPin}
                    subtitle={d.desc}
                    selected={city === d.name}
                    onClick={() => setCity(d.name)}
                    className="flex-shrink-0 whitespace-nowrap snap-start"
                  >
                    {d.name}
                  </Chip>
                ))}
              </div>
            </div>

            {/* Beat 2 — trip brief panel */}
            <div
              className="fade-section mt-10 lg:mt-0 rounded-3xl border border-border-subtle bg-surface/80 backdrop-blur-sm p-5 sm:p-6 lg:p-8 space-y-8"
              style={{ animationDelay: "0.15s" }}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                <div>
                  <h3 className="text-small font-semibold text-muted-soft mb-3">How many days</h3>
                  <div className="flex items-center gap-4">
                    <Button
                      variant="secondary"
                      size="sm"
                      pill
                      iconOnly
                      icon={Minus}
                      aria-label="One fewer day"
                      onClick={() => setDays(String(Math.max(1, Number(days) - 1)))}
                    />
                    <span className="font-mono tabular-nums text-h1 text-foreground-strong min-w-[2.5ch] text-center">
                      {days}
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      pill
                      iconOnly
                      icon={Plus}
                      aria-label="One more day"
                      onClick={() => setDays(String(Math.min(7, Number(days) + 1)))}
                    />
                  </div>
                </div>

                <div>
                  <h3 className="text-small font-semibold text-muted-soft mb-3">Travelling as</h3>
                  <div className="flex flex-wrap gap-2">
                    {TRAVEL_STYLES.map((s) => (
                      <Chip
                        key={s.label}
                        layout="row"
                        icon={TRAVEL_STYLE_ICONS[s.label]}
                        selected={travelStyle === s.label}
                        onClick={() => setTravelStyle(travelStyle === s.label ? "" : s.label)}
                      >
                        {s.label}
                      </Chip>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-small font-semibold text-muted-soft mb-3">What&apos;s your vibe?</h3>
                <div className="flex flex-wrap gap-2">
                  {VIBES.map((v) => (
                    <Chip
                      key={v.label}
                      layout="row"
                      icon={VIBE_ICONS[v.label]}
                      selected={selectedVibes.includes(v.label)}
                      onClick={() => toggleVibe(v.label)}
                    >
                      {v.label}
                    </Chip>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-small font-semibold text-muted-soft mb-3">Budget</h3>
                <div className="grid grid-cols-3 gap-3">
                  {BUDGETS.map((b) => (
                    <Chip
                      key={b.label}
                      layout="column"
                      subtitle={b.sub}
                      selected={budget === b.label}
                      onClick={() => setBudget(budget === b.label ? "" : b.label)}
                    >
                      <span className="flex justify-center gap-0.5 mb-1">
                        {Array.from({ length: b.tier }).map((_, i) => (
                          <Rupee key={i} size={14} aria-hidden="true" />
                        ))}
                      </span>
                      {b.label}
                    </Chip>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-small font-semibold text-muted-soft mb-3">Pace</h3>
                <div className="grid grid-cols-3 gap-3">
                  {PACES.map((p) => (
                    <Chip
                      key={p.label}
                      layout="column"
                      icon={PACE_ICONS[p.label]}
                      subtitle={p.sub}
                      selected={pace === p.label}
                      onClick={() => setPace(pace === p.label ? "" : p.label)}
                    >
                      {p.label}
                    </Chip>
                  ))}
                </div>
              </div>

              {error && (
                <div className="text-center space-y-2">
                  <p className="text-small text-danger">{error}</p>
                  <Button variant="ghost" size="sm" onClick={onRetry}>
                    Try again
                  </Button>
                </div>
              )}

              <Button
                variant="primary"
                pill
                size="lg"
                fullWidth
                disabled={!city.trim() || loading}
                onClick={onSubmit}
              >
                {loading ? (
                  PROGRESS_MESSAGES[progressIdx]
                ) : (
                  <>
                    Plan my trip <ArrowRight size={16} aria-hidden="true" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
