"use client";

import { useState } from "react";

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

interface LiveSuggestion {
  place_name: string;
  why_now: string;
  how_to_get_there: string;
  estimated_duration: string;
  local_tip: string;
}

interface LiveResponse {
  context: string;
  suggestions: LiveSuggestion[];
}

interface Props {
  destination: string;
  currentDaySlots: Slot[];
  onReplan: (newSlots: Slot[]) => void;
  onBack: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function LiveMode({ destination, currentDaySlots, onReplan, onBack }: Props) {
  const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");

  // Live mode state
  const [tab,            setTab]            = useState<"live" | "replan">("live");
  const [currentLoc,     setCurrentLoc]     = useState("");
  const [timeOfDay,      setTimeOfDay]      = useState(() => {
    const h = new Date().getHours();
    if (h < 12) return "morning";
    if (h < 17) return "afternoon";
    return "evening";
  });
  const [hoursLeft,      setHoursLeft]      = useState(4);
  const [visitedSlots,   setVisitedSlots]   = useState<string[]>([]);
  const [liveResult,     setLiveResult]     = useState<LiveResponse | null>(null);
  const [liveLoading,    setLiveLoading]    = useState(false);
  const [liveError,      setLiveError]      = useState("");

  // Replan state
  const [disruption,     setDisruption]     = useState("");
  const [timeRemaining,  setTimeRemaining]  = useState("3 hours");
  const [replanLoading,  setReplanLoading]  = useState(false);
  const [replanError,    setReplanError]    = useState("");

  function toggleVisited(name: string) {
    setVisitedSlots((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  }

  async function handleLive(e: React.FormEvent) {
    e.preventDefault();
    if (!currentLoc.trim() || liveLoading) return;
    setLiveLoading(true);
    setLiveError("");
    setLiveResult(null);
    try {
      const res = await fetch(`${apiUrl}/api/live`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: "live-" + Date.now(),
          destination,
          current_location: currentLoc.trim(),
          time_of_day: timeOfDay,
          hours_remaining: hoursLeft,
          past_slots: visitedSlots,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? "Something went wrong");
      }
      setLiveResult(await res.json());
    } catch (e: unknown) {
      setLiveError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLiveLoading(false);
    }
  }

  async function handleReplan(e: React.FormEvent) {
    e.preventDefault();
    if (!disruption.trim() || replanLoading) return;
    setReplanLoading(true);
    setReplanError("");
    try {
      const remainingSlots = currentDaySlots.filter(
        (s) => !visitedSlots.includes(s.place_name)
      );
      const res = await fetch(`${apiUrl}/api/replan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: "replan-" + Date.now(),
          destination,
          original_slots: remainingSlots,
          completed_slots: visitedSlots,
          disruption: disruption.trim(),
          time_remaining: timeRemaining,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? "Something went wrong");
      }
      const data = await res.json();
      // Merge: completed slots (from original) + new replanned slots
      const completedOriginal = currentDaySlots.filter((s) =>
        visitedSlots.includes(s.place_name)
      );
      onReplan([...completedOriginal, ...data.slots]);
    } catch (e: unknown) {
      setReplanError(e instanceof Error ? e.message : "Network error");
    } finally {
      setReplanLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0b0f14] flex flex-col">
      {/* Header */}
      <div className="border-b border-zinc-800/80 px-4 py-3 flex items-center gap-3">
        <button
          onClick={onBack}
          className="text-zinc-500 hover:text-white transition-colors text-sm flex items-center gap-1.5"
        >
          ← Back to map
        </button>
        <div className="h-4 w-px bg-zinc-800" />
        <div>
          <p className="text-zinc-600 text-[10px] font-semibold tracking-widest uppercase">Naviro</p>
          <p className="text-white text-sm font-bold leading-tight">{destination}</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-green-400 text-xs font-semibold">Live Mode</span>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 p-3 border-b border-zinc-800/60">
        <button
          onClick={() => setTab("live")}
          className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
            tab === "live"
              ? "bg-white text-black"
              : "bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800"
          }`}
        >
          🔴 What to do now
        </button>
        <button
          onClick={() => setTab("replan")}
          className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
            tab === "replan"
              ? "bg-white text-black"
              : "bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800"
          }`}
        >
          🔄 Replan my day
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5 max-w-xl mx-auto w-full">

        {/* ── Visited today (shared between tabs) ─────────────────── */}
        {currentDaySlots.length > 0 && (
          <div>
            <p className="text-zinc-600 text-xs uppercase tracking-widest mb-2">
              Places on today&apos;s plan — tick what you&apos;ve visited
            </p>
            <div className="flex flex-wrap gap-2">
              {currentDaySlots.map((s) => (
                <button
                  key={s.place_name}
                  type="button"
                  onClick={() => toggleVisited(s.place_name)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition-all ${
                    visitedSlots.includes(s.place_name)
                      ? "bg-zinc-100 text-black border-zinc-100 line-through opacity-60"
                      : "bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-600"
                  }`}
                >
                  {visitedSlots.includes(s.place_name) ? "✓" : "○"} {s.place_name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ══ TAB: LIVE ═══════════════════════════════════════════════ */}
        {tab === "live" && (
          <>
            <form onSubmit={handleLive} className="space-y-4">
              {/* Current location */}
              <div>
                <p className="text-zinc-600 text-xs uppercase tracking-widest mb-2">Where are you right now</p>
                <input
                  value={currentLoc}
                  onChange={(e) => setCurrentLoc(e.target.value)}
                  placeholder="e.g. Banjara Hills, near the café…"
                  className="w-full bg-zinc-900/70 border border-zinc-800 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-700 text-sm transition-colors"
                  disabled={liveLoading}
                />
              </div>

              {/* Time of day */}
              <div>
                <p className="text-zinc-600 text-xs uppercase tracking-widest mb-2">Time of day</p>
                <div className="flex gap-2">
                  {["morning", "afternoon", "evening"].map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTimeOfDay(t)}
                      className={`flex-1 py-2 rounded-xl border text-xs font-semibold capitalize transition-all ${
                        timeOfDay === t
                          ? "bg-white text-black border-white"
                          : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-600 hover:text-zinc-200"
                      }`}
                    >
                      {t === "morning" ? "🌅" : t === "afternoon" ? "☀️" : "🌙"} {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Hours remaining */}
              <div>
                <p className="text-zinc-600 text-xs uppercase tracking-widest mb-2">
                  Hours left in your trip
                </p>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={1}
                    max={12}
                    value={hoursLeft}
                    onChange={(e) => setHoursLeft(Number(e.target.value))}
                    className="flex-1 accent-white"
                  />
                  <span className="text-white font-bold text-sm w-16 text-right">
                    {hoursLeft} hr{hoursLeft !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>

              {liveError && <p className="text-red-400 text-sm">{liveError}</p>}

              <button
                type="submit"
                disabled={!currentLoc.trim() || liveLoading}
                className="w-full bg-white text-black py-3.5 rounded-2xl font-semibold text-sm disabled:opacity-40 hover:bg-zinc-100 transition-colors"
              >
                {liveLoading ? "Finding the best spots…" : "Tell me what to do →"}
              </button>
            </form>

            {/* Live suggestions */}
            {liveResult && (
              <div className="space-y-3 pb-6">
                <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl px-4 py-3">
                  <p className="text-zinc-300 text-sm italic">{liveResult.context}</p>
                </div>
                {liveResult.suggestions.map((s, i) => (
                  <div key={i} className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="text-white font-semibold text-base">{s.place_name}</h3>
                      <span className="text-zinc-500 text-xs shrink-0 mt-1">{s.estimated_duration}</span>
                    </div>
                    <p className="text-green-400 text-xs font-medium mb-2">{s.why_now}</p>
                    <p className="text-zinc-400 text-xs mb-2">🚌 {s.how_to_get_there}</p>
                    <div className="bg-amber-950/40 border border-amber-800/30 rounded-lg p-2 text-xs">
                      <span className="text-amber-400 font-semibold">💡 </span>
                      <span className="text-amber-100/80">{s.local_tip}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ══ TAB: REPLAN ═════════════════════════════════════════════ */}
        {tab === "replan" && (
          <>
            <form onSubmit={handleReplan} className="space-y-4">
              {/* Disruption */}
              <div>
                <p className="text-zinc-600 text-xs uppercase tracking-widest mb-2">What happened?</p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {[
                    "It's raining heavily",
                    "The place is closed",
                    "I'm running late",
                    "Too crowded",
                    "Not feeling well — need something easy",
                    "Budget is tight today",
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setDisruption(preset)}
                      className={`px-3 py-1.5 rounded-xl border text-xs font-medium transition-all ${
                        disruption === preset
                          ? "bg-white text-black border-white"
                          : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-600 hover:text-zinc-200"
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <input
                  value={disruption}
                  onChange={(e) => setDisruption(e.target.value)}
                  placeholder="Or type something else…"
                  className="w-full bg-zinc-900/70 border border-zinc-800 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-700 text-sm transition-colors"
                  disabled={replanLoading}
                />
              </div>

              {/* Time remaining */}
              <div>
                <p className="text-zinc-600 text-xs uppercase tracking-widest mb-2">Time left today</p>
                <div className="flex gap-2 flex-wrap">
                  {["1 hour", "2 hours", "3 hours", "4 hours", "5+ hours"].map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTimeRemaining(t)}
                      className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
                        timeRemaining === t
                          ? "bg-white text-black border-white"
                          : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-600"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {replanError && <p className="text-red-400 text-sm">{replanError}</p>}

              <button
                type="submit"
                disabled={!disruption.trim() || replanLoading}
                className="w-full bg-white text-black py-3.5 rounded-2xl font-semibold text-sm disabled:opacity-40 hover:bg-zinc-100 transition-colors"
              >
                {replanLoading ? "Rebuilding your day…" : "Replan my day →"}
              </button>

              <p className="text-zinc-600 text-xs text-center">
                This will update the map with a new plan for today
              </p>
            </form>

            {/* Current plan summary */}
            {currentDaySlots.length > 0 && (
              <div className="pb-6">
                <p className="text-zinc-600 text-xs uppercase tracking-widest mb-2">Today&apos;s current plan</p>
                <div className="space-y-2">
                  {currentDaySlots.map((s, i) => (
                    <div key={i}
                      className={`flex items-center gap-3 p-3 rounded-xl border text-sm transition-all ${
                        visitedSlots.includes(s.place_name)
                          ? "border-zinc-800/40 bg-zinc-900/20 opacity-40"
                          : "border-zinc-800 bg-zinc-900/40"
                      }`}
                    >
                      <span className="text-zinc-500 text-xs capitalize w-16 shrink-0">{s.time_of_day}</span>
                      <span className={`text-zinc-200 font-medium ${visitedSlots.includes(s.place_name) ? "line-through" : ""}`}>
                        {s.place_name}
                      </span>
                      {visitedSlots.includes(s.place_name) && (
                        <span className="ml-auto text-zinc-600 text-xs">done</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
