"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";

// ─── Types (mirrors frontend/app/page.tsx — no shared types file in this repo) ─
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

// ─── Dynamic import — Leaflet touches `window`, so this can never render on the server ─
const TravelMap = dynamic(() => import("../../components/TravelMap"), {
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

function apiBase() {
  return (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");
}

type Status = "loading" | "not-found" | "error" | "ready";

export default function SharedTripPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  // Next 16 client-component pages receive `params` as a Promise — unwrap
  // with React's `use()` (see frontend/node_modules/next/dist/docs/01-app/
  // 03-api-reference/03-file-conventions/dynamic-routes.md).
  const { slug } = use(params);

  const [status, setStatus] = useState<Status>("loading");
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [livedays, setLiveDays] = useState<Day[]>([]);
  const [activeDay, setActiveDay] = useState(0);
  const [refining, setRefining] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  // A visitor refining a shared trip gets their own brand-new planning
  // session — refining here must never reuse or mutate the original saved
  // slug/trip, it just started from a shared trip's data instead of a fresh plan.
  const sessionId = useRef(generateSessionId());

  useEffect(() => {
    setStatus("loading");
    fetch(`${apiBase()}/api/trip/${slug}`)
      .then(async (res) => {
        if (res.status === 404) {
          setStatus("not-found");
          return;
        }
        if (!res.ok) {
          setStatus("error");
          return;
        }
        const data: Itinerary = await res.json();
        setItinerary(data);
        setLiveDays(data.days);
        setActiveDay(0);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, [slug, retryCount]);

  async function handleRefine(message: string) {
    if (!itinerary) return;
    setRefining(true);
    try {
      const res = await fetch(`${apiBase()}/api/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId.current,
          message,
          destination: itinerary.destination,
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.itinerary && Array.isArray(data.itinerary.days) && data.itinerary.days.length > 0) {
        setItinerary(data.itinerary);
        setLiveDays(data.itinerary.days);
        setActiveDay(0);
      }
    } catch {
      // Best-effort, same as the normal map view: a failed refine leaves the
      // current itinerary on screen rather than showing a broken page.
    } finally {
      setRefining(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="w-full h-screen flex items-center justify-center" style={{ background: "#0a0a0a" }}>
        <div className="text-sm animate-pulse" style={{ color: "#333" }}>Loading trip…</div>
      </div>
    );
  }

  if (status === "not-found") {
    return (
      <div className="w-full h-screen flex flex-col items-center justify-center gap-4 text-center px-6" style={{ background: "#0a0a0a" }}>
        <p className="text-lg font-medium" style={{ color: "#ddd" }}>
          This trip link doesn&apos;t exist or has expired.
        </p>
        <Link
          href="/"
          className="text-sm underline underline-offset-2 transition-colors duration-200"
          style={{ color: "#888" }}
        >
          Plan a new trip →
        </Link>
      </div>
    );
  }

  if (status === "error" || !itinerary) {
    return (
      <div className="w-full h-screen flex flex-col items-center justify-center gap-4 text-center px-6" style={{ background: "#0a0a0a" }}>
        <p className="text-sm" style={{ color: "#e55" }}>Couldn&apos;t load this trip.</p>
        <button
          onClick={() => setRetryCount((c) => c + 1)}
          className="text-sm underline underline-offset-2 transition-colors duration-200"
          style={{ color: "#888" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "#888"; }}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <TravelMap
      days={livedays.length > 0 ? livedays : itinerary.days}
      activeDay={activeDay}
      destination={itinerary.destination}
      summary={itinerary.summary}
      totalDays={itinerary.total_days}
      onDayChange={setActiveDay}
      onRefine={handleRefine}
      onDaysUpdate={setLiveDays}
      loading={refining}
    />
  );
}
