"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { Day, Itinerary } from "@/app/types";
import Button from "@/app/components/ui/Button";

// ─── Dynamic import — Leaflet touches `window`, so this can never render on the server ─
const TravelMap = dynamic(() => import("../../components/TravelMap"), {
  ssr: false,
  loading: () => (
    <main id="main-content" className="w-full min-h-dvh flex items-center justify-center bg-background">
      <div className="text-sm animate-pulse text-muted-soft">Loading map…</div>
    </main>
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
  const router = useRouter();

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
      <main id="main-content" className="w-full min-h-dvh flex items-center justify-center bg-background">
        <div className="text-sm animate-pulse text-muted-soft">Loading trip…</div>
      </main>
    );
  }

  if (status === "not-found") {
    return (
      <main id="main-content" className="w-full min-h-dvh flex flex-col items-center justify-center gap-4 text-center px-6 bg-background">
        <p className="text-lg font-medium text-foreground">
          This trip link doesn&apos;t exist or has expired.
        </p>
        <Link
          href="/"
          className="text-sm text-muted underline underline-offset-2 transition-colors duration-200 hover:text-foreground-strong rounded outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          Plan a new trip →
        </Link>
      </main>
    );
  }

  if (status === "error" || !itinerary) {
    return (
      <main id="main-content" className="w-full min-h-dvh flex flex-col items-center justify-center gap-4 text-center px-6 bg-background">
        <p className="text-sm text-danger">Couldn&apos;t load this trip.</p>
        <Button variant="ghost" size="sm" onClick={() => setRetryCount((c) => c + 1)}>
          Try again
        </Button>
      </main>
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
      onExit={() => router.push("/")}
    />
  );
}
