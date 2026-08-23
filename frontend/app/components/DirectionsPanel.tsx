"use client";

import { useState, useEffect } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface TransitStep {
  type: "walk" | "transit";
  // walk
  instruction?: string;
  duration?: string;
  distance?: string;
  // transit
  vehicle_type?: string;
  line?: string;
  line_full_name?: string;
  agency?: string;
  headsign?: string;
  from_stop?: string;
  to_stop?: string;
  departure_time?: string;
  arrival_time?: string;
  num_stops?: number;
  is_realtime?: boolean;
}

interface TransportOption {
  mode: "transit" | "auto" | "cab" | "walk" | "rapido" | "share_auto" | "erickshaw" | "ferry";
  icon: string;
  label: string;
  duration: string;
  fare_estimate: string;
  distance?: string;
  note?: string;
  ola_link?: string;
  uber_link?: string;
  rapido_link?: string;
  agencies?: string[];
  is_realtime?: boolean;
  steps: TransitStep[];
}

interface DirectionsResult {
  origin: string;
  destination: string;
  distance_km: number;
  options: TransportOption[];
}

interface Props {
  destinationName: string;
  destinationLat: number;
  destinationLng: number;
  city: string;
  localTransportHint?: string;   // AI-generated how_to_get_there from the slot
  onBack: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function vehicleIcon(type?: string): string {
  switch (type) {
    case "BUS":                           return "🚌";
    case "SUBWAY": case "METRO_RAIL":     return "🚇";
    case "HEAVY_RAIL": case "COMMUTER_TRAIN":
    case "HIGH_SPEED_TRAIN": case "RAIL": return "🚆";
    case "TRAM":                          return "🚊";
    case "FERRY":                         return "⛴️";
    default:                              return "🚌";
  }
}

function ModeColor(mode: string): string {
  switch (mode) {
    case "transit":    return "border-blue-700/60 bg-blue-950/30";
    case "auto":       return "border-yellow-700/60 bg-yellow-950/30";
    case "cab":        return "border-green-700/60 bg-green-950/30";
    case "walk":       return "border-zinc-700/60 bg-zinc-900/40";
    case "rapido":     return "border-orange-700/60 bg-orange-950/30";
    case "share_auto": return "border-purple-700/60 bg-purple-950/30";
    case "erickshaw":  return "border-teal-700/60 bg-teal-950/30";
    case "ferry":      return "border-cyan-700/60 bg-cyan-950/30";
    default:           return "border-zinc-700/60 bg-zinc-900/40";
  }
}

function ModeAccent(mode: string): string {
  switch (mode) {
    case "transit":    return "text-blue-300";
    case "auto":       return "text-yellow-300";
    case "cab":        return "text-green-300";
    case "walk":       return "text-zinc-300";
    case "rapido":     return "text-orange-300";
    case "share_auto": return "text-purple-300";
    case "erickshaw":  return "text-teal-300";
    case "ferry":      return "text-cyan-300";
    default:           return "text-zinc-300";
  }
}

// ─── Step breakdown ───────────────────────────────────────────────────────────
function StepRow({ step }: { step: TransitStep }) {
  if (step.type === "walk") {
    return (
      <div className="flex gap-3 items-start py-2 border-l-2 border-zinc-800 pl-3">
        <span className="text-base mt-0.5">🚶</span>
        <div className="flex-1 min-w-0">
          <p className="text-zinc-300 text-xs">{step.instruction}</p>
          <p className="text-zinc-600 text-xs mt-0.5">{step.duration}{step.distance ? ` · ${step.distance}` : ""}</p>
        </div>
      </div>
    );
  }

  // Transit step
  return (
    <div className="flex gap-3 items-start py-2 border-l-2 border-blue-800/50 pl-3">
      <span className="text-base mt-0.5">{vehicleIcon(step.vehicle_type)}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {step.line && (
            <span className="bg-blue-900/50 border border-blue-700/50 text-blue-200 text-xs font-bold px-2 py-0.5 rounded-md">
              {step.line}
            </span>
          )}
          {step.headsign && (
            <span className="text-zinc-400 text-xs">→ {step.headsign}</span>
          )}
          {step.is_realtime && (
            <span className="flex items-center gap-1 text-green-400 text-[10px] font-semibold">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
              LIVE
            </span>
          )}
        </div>
        <p className="text-zinc-300 text-xs mt-1">
          Board at <span className="text-white font-medium">{step.from_stop}</span>
        </p>
        {step.departure_time && (
          <p className="text-zinc-500 text-xs">
            Departs <span className="text-zinc-300 font-medium">{step.departure_time}</span>
            {step.arrival_time && <> · Arrives <span className="text-zinc-300 font-medium">{step.arrival_time}</span></>}
          </p>
        )}
        <p className="text-zinc-500 text-xs">
          {step.num_stops ? `${step.num_stops} stops` : ""} · Alight at{" "}
          <span className="text-zinc-300 font-medium">{step.to_stop}</span>
        </p>
        {step.agency && (
          <p className="text-zinc-600 text-[10px] mt-0.5">{step.agency}</p>
        )}
      </div>
    </div>
  );
}

// ─── Transport card ───────────────────────────────────────────────────────────
function TransportCard({ option }: { option: TransportOption }) {
  const [expanded, setExpanded] = useState(false);
  const hasSteps = option.steps && option.steps.length > 0;

  return (
    <div className={`rounded-2xl border p-4 transition-all ${ModeColor(option.mode)}`}>
      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-2xl shrink-0">{option.icon}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className={`font-semibold text-sm ${ModeAccent(option.mode)}`}>{option.label}</p>
              {option.is_realtime && (
                <span className="flex items-center gap-1 text-green-400 text-[10px] font-semibold">
                  <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                  Real-time
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-white text-xs font-medium">⏱ {option.duration}</span>
              <span className="text-zinc-400 text-xs">· {option.fare_estimate}</span>
              {option.distance && (
                <span className="text-zinc-500 text-xs">· {option.distance}</span>
              )}
            </div>
          </div>
        </div>

        {hasSteps && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-zinc-500 hover:text-white transition-colors text-xs shrink-0 px-2 py-1 rounded-lg border border-zinc-800 hover:border-zinc-600"
          >
            {expanded ? "Hide ▲" : "Steps ▼"}
          </button>
        )}
      </div>

      {/* Note */}
      {option.note && (
        <p className="text-zinc-600 text-xs mt-2 leading-relaxed">{option.note}</p>
      )}

      {/* Ola / Uber buttons */}
      {option.mode === "cab" && (
        <div className="flex gap-2 mt-3">
          {option.ola_link && (
            <a href={option.ola_link} target="_blank" rel="noopener noreferrer"
              className="flex-1 text-center py-2 rounded-xl bg-yellow-900/40 border border-yellow-700/50 text-yellow-300 text-xs font-semibold hover:bg-yellow-800/50 transition-colors">
              🟡 Open in Ola
            </a>
          )}
          {option.uber_link && (
            <a href={option.uber_link} target="_blank" rel="noopener noreferrer"
              className="flex-1 text-center py-2 rounded-xl bg-zinc-800/60 border border-zinc-700 text-zinc-200 text-xs font-semibold hover:bg-zinc-700/60 transition-colors">
              ⚫ Open in Uber
            </a>
          )}
        </div>
      )}

      {/* Rapido button */}
      {option.mode === "rapido" && option.rapido_link && (
        <div className="mt-3">
          <a href={option.rapido_link} target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-2 rounded-xl bg-orange-900/40 border border-orange-700/50 text-orange-300 text-xs font-semibold hover:bg-orange-800/50 transition-colors">
            🛵 Open Rapido
          </a>
        </div>
      )}

      {/* Step-by-step breakdown */}
      {expanded && hasSteps && (
        <div className="mt-3 space-y-0 border-t border-zinc-800/60 pt-3">
          {option.steps.map((step, i) => (
            <StepRow key={i} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function DirectionsPanel({
  destinationName,
  destinationLat,
  destinationLng,
  city,
  localTransportHint,
  onBack,
}: Props) {
  const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");

  const [originText,   setOriginText]   = useState("");
  const [originLat,    setOriginLat]    = useState(0);
  const [originLng,    setOriginLng]    = useState(0);
  const [gpsStatus,    setGpsStatus]    = useState<"idle" | "loading" | "done" | "denied">("idle");
  const [result,       setResult]       = useState<DirectionsResult | null>(null);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState("");

  // ── Auto-try GPS on mount ───────────────────────────────────────────────────
  useEffect(() => {
    if (!navigator.geolocation) return;
    setGpsStatus("loading");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOriginLat(pos.coords.latitude);
        setOriginLng(pos.coords.longitude);
        setOriginText("My current location (GPS)");
        setGpsStatus("done");
      },
      () => setGpsStatus("denied"),
      { timeout: 8000, maximumAge: 30000 }
    );
  }, []);

  function retryGps() {
    if (!navigator.geolocation) return;
    setGpsStatus("loading");
    setOriginLat(0); setOriginLng(0);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOriginLat(pos.coords.latitude);
        setOriginLng(pos.coords.longitude);
        setOriginText("My current location (GPS)");
        setGpsStatus("done");
      },
      () => setGpsStatus("denied"),
      { timeout: 8000 }
    );
  }

  function clearGps() {
    setOriginLat(0); setOriginLng(0);
    setOriginText("");
    setGpsStatus("idle");
  }

  async function fetchDirections() {
    if ((!originText.trim() && originLat === 0) || loading) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch(`${apiUrl}/api/directions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin_text:       originLat !== 0 ? "" : originText.trim(),
          origin_lat:        originLat,
          origin_lng:        originLng,
          destination_name:  destinationName,
          destination_lat:   destinationLat,
          destination_lng:   destinationLng,
          city,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? "Something went wrong");
      }
      setResult(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  const canSearch = (originLat !== 0 || originText.trim().length > 2) && !loading;

  return (
    <div className="min-h-screen bg-[#0b0f14] flex flex-col">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="border-b border-zinc-800/80 px-4 py-3 flex items-center gap-3 shrink-0">
        <button onClick={onBack}
          className="text-zinc-500 hover:text-white transition-colors text-sm flex items-center gap-1.5">
          ← Back
        </button>
        <div className="h-4 w-px bg-zinc-800" />
        <div className="min-w-0">
          <p className="text-zinc-600 text-[10px] font-semibold tracking-widest uppercase">Getting there</p>
          <p className="text-white text-sm font-bold truncate">{destinationName}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5 max-w-xl mx-auto w-full">

        {/* ── Origin input ─────────────────────────────────────── */}
        <div className="space-y-3">
          <p className="text-zinc-600 text-xs uppercase tracking-widest">Where are you starting from?</p>

          {/* GPS pill */}
          <div className="flex gap-2 flex-wrap">
            {gpsStatus === "loading" && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-400 text-xs">
                <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
                Detecting GPS…
              </div>
            )}
            {gpsStatus === "done" && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-green-700/60 bg-green-950/30 text-green-300 text-xs font-medium">
                <span className="w-2 h-2 bg-green-400 rounded-full" />
                GPS detected
                <button onClick={clearGps} className="text-zinc-500 hover:text-white ml-1">×</button>
              </div>
            )}
            {(gpsStatus === "idle" || gpsStatus === "denied") && (
              <button onClick={retryGps}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-400 text-xs hover:border-zinc-500 hover:text-white transition-all">
                📍 Use my GPS location
              </button>
            )}
            {gpsStatus === "denied" && (
              <p className="text-zinc-600 text-xs self-center">GPS blocked — type your location below</p>
            )}
          </div>

          {/* Manual text input */}
          <div className="relative">
            <input
              value={originText}
              onChange={(e) => {
                setOriginText(e.target.value);
                // If user types manually, clear GPS coords so text is used
                if (gpsStatus === "done") { setOriginLat(0); setOriginLng(0); setGpsStatus("idle"); }
              }}
              placeholder={`e.g. Banjara Hills, ${city}…`}
              className="w-full bg-zinc-900/70 border border-zinc-800 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-700 text-sm transition-colors"
              disabled={loading}
            />
          </div>
        </div>

        {/* ── Destination preview ───────────────────────────────── */}
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-zinc-800 bg-zinc-900/40">
          <span className="text-xl">📍</span>
          <div>
            <p className="text-zinc-500 text-xs">Going to</p>
            <p className="text-white text-sm font-semibold">{destinationName}</p>
            <p className="text-zinc-600 text-xs">{city}</p>
          </div>
        </div>

        {/* ── AI Local Transport Hint ───────────────────────────── */}
        {localTransportHint && (
          <div className="bg-amber-950/30 border border-amber-700/40 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-amber-400 text-sm">🧠</span>
              <p className="text-amber-400 text-xs font-semibold uppercase tracking-widest">Naviro local tip</p>
            </div>
            <p className="text-amber-100/85 text-sm leading-relaxed">{localTransportHint}</p>
            <p className="text-amber-700 text-[10px] mt-2">AI-generated · specific to this place</p>
          </div>
        )}

        {error && (
          <div className="bg-red-950/40 border border-red-800/50 rounded-xl px-4 py-3">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* ── Search button ─────────────────────────────────────── */}
        <button
          onClick={fetchDirections}
          disabled={!canSearch}
          className="w-full bg-white text-black py-3.5 rounded-2xl font-semibold text-sm disabled:opacity-40 hover:bg-zinc-100 transition-colors"
        >
          {loading ? "Finding all routes…" : "Show me how to get there →"}
        </button>

        {/* ── Results ───────────────────────────────────────────── */}
        {result && (
          <div className="space-y-4 pb-8">
            {/* Summary bar */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white text-sm font-semibold">
                  {result.options.length} way{result.options.length !== 1 ? "s" : ""} to get there
                </p>
                {result.distance_km > 0 && (
                  <p className="text-zinc-500 text-xs">{result.distance_km} km away</p>
                )}
              </div>
              <p className="text-zinc-600 text-xs text-right">
                Transit times from Google Maps.<br />
                Auto/cab fares are estimates.
              </p>
            </div>

            {/* Real-time data note for transit */}
            {result.options.some((o) => o.mode === "transit" && o.is_realtime) && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-green-950/30 border border-green-800/40">
                <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse shrink-0" />
                <p className="text-green-400 text-xs">
                  Live departure times available for this route
                </p>
              </div>
            )}

            {result.options.map((opt, i) => (
              <TransportCard key={i} option={opt} />
            ))}

            {/* Disclaimer */}
            <div className="px-3 py-3 rounded-xl border border-zinc-800/50 bg-zinc-900/20">
              <p className="text-zinc-600 text-xs leading-relaxed">
                🚌 Bus routes and metro times are from Google Maps transit data (GTFS feeds from TSRTC, BMTC, MTC, and other Indian RTCs). Auto fares are calculated from official RTA-published meter rates. Cab fares are approximate — actual price shown in Ola/Uber app.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
