"use client";

import { useState } from "react";
import type { Slot, LiveResponse } from "@/app/types";
import { Broadcast, Refresh, Bus, Bulb, TIME_OF_DAY_ICONS } from "@/app/components/icons";
import Chip from "@/app/components/ui/Chip";
import Button from "@/app/components/ui/Button";

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
    <main id="main-content" className="min-h-dvh bg-background flex flex-col">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 flex items-center gap-3">
        <button
          onClick={onBack}
          className="text-muted-soft hover:text-foreground transition-colors text-sm flex items-center gap-1.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          ← Back to map
        </button>
        <div className="h-4 w-px bg-border" />
        <div>
          <p className="text-muted-soft text-caption font-semibold">Naviro</p>
          <p className="text-foreground text-sm font-bold leading-tight">{destination}</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-accent animate-pulse motion-reduce:animate-none" />
          <span className="text-accent text-xs font-semibold">Live Mode</span>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 p-3 border-b border-border">
        <Chip
          selected={tab === "live"}
          onClick={() => setTab("live")}
          icon={Broadcast}
          className="flex-1 justify-center rounded-xl"
        >
          What to do now
        </Chip>
        <Chip
          selected={tab === "replan"}
          onClick={() => setTab("replan")}
          icon={Refresh}
          className="flex-1 justify-center rounded-xl"
        >
          Replan my day
        </Chip>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5 max-w-xl mx-auto w-full">

        {/* ── Visited today (shared between tabs) ─────────────────── */}
        {currentDaySlots.length > 0 && (
          <div>
            <p className="text-caption text-muted-soft mb-2">
              Places on today&apos;s plan — tick what you&apos;ve visited
            </p>
            <div className="flex flex-wrap gap-2">
              {currentDaySlots.map((s) => (
                <Chip
                  key={s.place_name}
                  selected={visitedSlots.includes(s.place_name)}
                  showCheckWhenSelected
                  strikethroughWhenSelected
                  onClick={() => toggleVisited(s.place_name)}
                >
                  {s.place_name}
                </Chip>
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
                <p className="text-caption text-muted-soft mb-2">Where are you right now</p>
                <input
                  value={currentLoc}
                  onChange={(e) => setCurrentLoc(e.target.value)}
                  placeholder="e.g. Banjara Hills, near the café…"
                  className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-foreground placeholder-muted-soft outline-none text-sm transition-colors focus-visible:ring-2 focus-visible:ring-focus-ring"
                  disabled={liveLoading}
                />
              </div>

              {/* Time of day */}
              <div>
                <p className="text-caption text-muted-soft mb-2">Time of day</p>
                <div className="flex gap-2">
                  {["morning", "afternoon", "evening"].map((t) => (
                    <Chip
                      key={t}
                      selected={timeOfDay === t}
                      onClick={() => setTimeOfDay(t)}
                      icon={TIME_OF_DAY_ICONS[t]}
                      className="flex-1 justify-center rounded-xl capitalize"
                    >
                      {t}
                    </Chip>
                  ))}
                </div>
              </div>

              {/* Hours remaining */}
              <div>
                <p className="text-caption text-muted-soft mb-2">
                  Hours left in your trip
                </p>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={1}
                    max={12}
                    value={hoursLeft}
                    onChange={(e) => setHoursLeft(Number(e.target.value))}
                    className="flex-1 accent-accent"
                  />
                  <span className="text-foreground font-bold text-sm w-16 text-right font-mono">
                    {hoursLeft} hr{hoursLeft !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>

              {liveError && <p className="text-danger text-sm">{liveError}</p>}

              <Button
                type="submit"
                variant="primary"
                pill
                fullWidth
                size="lg"
                disabled={!currentLoc.trim() || liveLoading}
              >
                {liveLoading ? "Finding the best spots…" : "Tell me what to do →"}
              </Button>
            </form>

            {/* Live suggestions */}
            {liveResult && (
              <div className="space-y-3 pb-6">
                <div className="bg-surface border border-border rounded-xl px-4 py-3">
                  <p className="text-foreground text-sm italic">{liveResult.context}</p>
                </div>
                {liveResult.suggestions.map((s, i) => (
                  <div key={i} className="bg-surface border border-border rounded-2xl p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="text-foreground font-semibold text-base">{s.place_name}</h3>
                      <span className="text-muted-soft text-xs shrink-0 mt-1 font-mono">{s.estimated_duration}</span>
                    </div>
                    <p className="text-accent text-xs font-medium mb-2">{s.why_now}</p>
                    <p className="text-muted text-xs mb-2 flex items-center gap-1.5">
                      <Bus size={14} aria-hidden="true" />
                      {s.how_to_get_there}
                    </p>
                    <div className="bg-warning-bg border border-warning-border rounded-lg p-2 text-xs flex items-start gap-1.5">
                      <Bulb size={14} className="text-warning shrink-0 mt-0.5" aria-hidden="true" />
                      <span className="text-warning/80">{s.local_tip}</span>
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
                <p className="text-caption text-muted-soft mb-2">What happened?</p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {[
                    "It's raining heavily",
                    "The place is closed",
                    "I'm running late",
                    "Too crowded",
                    "Not feeling well — need something easy",
                    "Budget is tight today",
                  ].map((preset) => (
                    <Chip
                      key={preset}
                      selected={disruption === preset}
                      onClick={() => setDisruption(preset)}
                    >
                      {preset}
                    </Chip>
                  ))}
                </div>
                <input
                  value={disruption}
                  onChange={(e) => setDisruption(e.target.value)}
                  placeholder="Or type something else…"
                  className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-foreground placeholder-muted-soft outline-none text-sm transition-colors focus-visible:ring-2 focus-visible:ring-focus-ring"
                  disabled={replanLoading}
                />
              </div>

              {/* Time remaining */}
              <div>
                <p className="text-caption text-muted-soft mb-2">Time left today</p>
                <div className="flex gap-2 flex-wrap">
                  {["1 hour", "2 hours", "3 hours", "4 hours", "5+ hours"].map((t) => (
                    <Chip
                      key={t}
                      selected={timeRemaining === t}
                      onClick={() => setTimeRemaining(t)}
                    >
                      {t}
                    </Chip>
                  ))}
                </div>
              </div>

              {replanError && <p className="text-danger text-sm">{replanError}</p>}

              <Button
                type="submit"
                variant="primary"
                pill
                fullWidth
                size="lg"
                disabled={!disruption.trim() || replanLoading}
              >
                {replanLoading ? "Rebuilding your day…" : "Replan my day →"}
              </Button>

              <p className="text-caption text-muted-soft text-center">
                This will update the map with a new plan for today
              </p>
            </form>

            {/* Current plan summary */}
            {currentDaySlots.length > 0 && (
              <div className="pb-6">
                <p className="text-caption text-muted-soft mb-2">Today&apos;s current plan</p>
                <div className="space-y-2">
                  {currentDaySlots.map((s, i) => (
                    <div key={i}
                      className={`flex items-center gap-3 p-3 rounded-xl border text-sm transition-all ${
                        visitedSlots.includes(s.place_name)
                          ? "border-border bg-surface opacity-40"
                          : "border-border bg-surface"
                      }`}
                    >
                      <span className="text-muted-soft text-xs capitalize w-16 shrink-0">{s.time_of_day}</span>
                      <span className={`text-foreground font-medium ${visitedSlots.includes(s.place_name) ? "line-through" : ""}`}>
                        {s.place_name}
                      </span>
                      {visitedSlots.includes(s.place_name) && (
                        <span className="ml-auto text-muted-soft text-xs">done</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
