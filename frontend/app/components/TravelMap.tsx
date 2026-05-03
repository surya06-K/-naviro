"use client";

import { useEffect, useRef, useState } from "react";
import type {
  Map as LeafletMap,
  Marker as LeafletMarker,
  Polyline as LeafletPolyline,
} from "leaflet";
import LiveMode from "./LiveMode";

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

interface Props {
  days: Day[];
  activeDay: number;
  destination: string;
  summary: string;
  totalDays: number;
  onDayChange: (i: number) => void;
  onRefine: (msg: string) => void;
  onDaysUpdate?: (updatedDays: Day[]) => void;
  loading: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const PIN_COLORS = ["#f97316", "#facc15", "#a855f7"];
const TIME_LABELS = ["Morning", "Afternoon", "Evening"];
const TIME_ICONS = ["🌅", "☀️", "🌙"];

function getTimeSlotIndex(timeOfDay: string, fallbackIndex: number) {
  const n = timeOfDay.toLowerCase();
  if (n.includes("morning")) return 0;
  if (n.includes("afternoon")) return 1;
  if (n.includes("evening") || n.includes("night")) return 2;
  return fallbackIndex % PIN_COLORS.length;
}

function getDisplayNumber(timeOfDay: string, fallbackIndex: number) {
  return getTimeSlotIndex(timeOfDay, fallbackIndex) + 1;
}

// ─── Calendar export helper ───────────────────────────────────────────────────
function buildCalendarUrl(slot: Slot, dayNumber: number, destination: string): string {
  const base = new Date();
  base.setDate(base.getDate() + 7 + dayNumber - 1);
  const timeMap: Record<string, [number, number]> = {
    morning: [9, 11],
    afternoon: [13, 15],
    evening: [18, 20],
  };
  const [startH, endH] = timeMap[slot.time_of_day.toLowerCase()] ?? [10, 11];
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").split(".")[0];
  const start = new Date(base); start.setHours(startH, 0, 0, 0);
  const end   = new Date(base); end.setHours(endH, 0, 0, 0);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: slot.place_name,
    dates: `${fmt(start)}/${fmt(end)}`,
    details: `${slot.description}\n\n💡 Local tip: ${slot.local_tip}\n\n🚌 Getting there: ${slot.how_to_get_there}`,
    location: `${slot.place_name}, ${destination}`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function TravelMap({
  days,
  activeDay,
  destination,
  summary,
  totalDays,
  onDayChange,
  onRefine,
  onDaysUpdate,
  loading,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<LeafletMap | null>(null);
  const markersRef   = useRef<LeafletMarker[]>([]);
  const polylineRef  = useRef<LeafletPolyline | null>(null);

  const [selectedSlot,  setSelectedSlot]  = useState<number | null>(null);
  const [refineMsg,     setRefineMsg]     = useState("");
  const [mapReady,      setMapReady]      = useState(false);

  // Phase 2 state
  const [showEmergency, setShowEmergency] = useState(false);
  const [emergency,     setEmergency]     = useState<any>(null);
  const [showLive,      setShowLive]      = useState(false);

  // ── Fetch emergency info once per destination ───────────────────────────────
  useEffect(() => {
    const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");
    fetch(`${apiUrl}/api/emergency`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destination }),
    })
      .then((r) => r.json())
      .then(setEmergency)
      .catch(() => {});
  }, [destination]);

  // ── Init Leaflet map (once) ─────────────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    const style = document.createElement("style");
    style.id = "travel-map-styles";
    style.textContent = `
      @keyframes pinDrop {
        0%   { transform: rotate(-45deg) scale(0) translateY(-30px); opacity: 0; }
        65%  { transform: rotate(-45deg) scale(1.2) translateY(5px);  opacity: 1; }
        100% { transform: rotate(-45deg) scale(1)   translateY(0);    opacity: 1; }
      }
      @keyframes fadeInLine { from { opacity: 0; } to { opacity: 1; } }
      .leaflet-container { background: #111 !important; }
      .leaflet-control-zoom a {
        background: rgba(0,0,0,0.75) !important; color: #e4e4e7 !important;
        border-color: rgba(255,255,255,0.15) !important; backdrop-filter: blur(8px);
      }
      .leaflet-control-zoom a:hover { background: rgba(0,0,0,0.9) !important; color: #fff !important; }
      .leaflet-control-attribution {
        background: rgba(0,0,0,0.55) !important; color: #71717a !important;
        font-size: 10px !important; backdrop-filter: blur(4px);
      }
      .leaflet-control-attribution a { color: #a1a1aa !important; }
    `;
    if (!document.getElementById("travel-map-styles")) document.head.appendChild(style);

    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css"; link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }

    import("leaflet").then((L) => {
      if (!containerRef.current || mapRef.current) return;
      mapRef.current = L.map(containerRef.current, {
        zoomControl: false, attributionControl: true, preferCanvas: true,
      }).setView([20.5937, 78.9629], 5);
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 19, attribution: "© Esri, Maxar, Earthstar Geographics" }
      ).addTo(mapRef.current);
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 19, opacity: 0.85 }
      ).addTo(mapRef.current);
      L.control.zoom({ position: "bottomright" }).addTo(mapRef.current);
      setMapReady(true);
    });

    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, []);

  // ── Update markers when active day changes ──────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    import("leaflet").then((L) => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      if (polylineRef.current) { polylineRef.current.remove(); polylineRef.current = null; }

      const day = days[activeDay];
      if (!day) return;

      const validSlots = day.slots.filter(
        (s) => s.coordinates?.lat && s.coordinates?.lng &&
               !(s.coordinates.lat === 0 && s.coordinates.lng === 0)
      );
      if (validSlots.length === 0) return;

      const latlngs: [number, number][] = [];

      day.slots.forEach((slot, slotIndex) => {
        if (!slot.coordinates?.lat || !slot.coordinates?.lng ||
            (slot.coordinates.lat === 0 && slot.coordinates.lng === 0)) return;

        const tsi   = getTimeSlotIndex(slot.time_of_day, slotIndex);
        const color = PIN_COLORS[tsi] ?? "#888";
        const num   = getDisplayNumber(slot.time_of_day, slotIndex);
        const delay = latlngs.length * 380;

        const icon = L.divIcon({
          html: `<div style="width:44px;height:54px;position:relative;filter:drop-shadow(0 6px 12px rgba(0,0,0,0.7))">
            <div style="position:absolute;bottom:0;left:0;width:44px;height:44px;background:${color};border:3px solid rgba(255,255,255,0.95);border-radius:50% 50% 50% 0;display:flex;align-items:center;justify-content:center;transform:rotate(-45deg) scale(0);animation:pinDrop 0.55s cubic-bezier(0.34,1.56,0.64,1) ${delay}ms forwards">
              <span style="transform:rotate(45deg);font-size:16px;font-weight:900;color:#fff;font-family:system-ui,sans-serif;line-height:1;text-shadow:0 1px 3px rgba(0,0,0,0.4)">${num}</span>
            </div></div>`,
          className: "", iconSize: [44, 54], iconAnchor: [22, 54], popupAnchor: [0, -58],
        });

        const marker = L.marker([slot.coordinates.lat, slot.coordinates.lng], { icon })
          .addTo(map)
          .on("click", () => setSelectedSlot((prev) => (prev === slotIndex ? null : slotIndex)));

        markersRef.current.push(marker);
        latlngs.push([slot.coordinates.lat, slot.coordinates.lng]);
      });

      if (latlngs.length > 1) {
        setTimeout(() => {
          polylineRef.current = L.polyline(latlngs, {
            color: "rgba(255,255,255,0.2)", weight: 2, dashArray: "6 10",
          }).addTo(map);
        }, validSlots.length * 380 + 150);
      }

      setTimeout(() => {
        map.flyToBounds(L.latLngBounds(latlngs), { padding: [90, 90], duration: 1.3, maxZoom: 14 });
      }, 100);

      setSelectedSlot(null);
    });
  }, [mapReady, activeDay, days]);

  // ── Fly to selected slot ────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current || selectedSlot === null) return;
    const sel = days[activeDay]?.slots[selectedSlot];
    if (!sel?.coordinates?.lat || !sel?.coordinates?.lng ||
        (sel.coordinates.lat === 0 && sel.coordinates.lng === 0)) return;
    mapRef.current.flyTo(
      [sel.coordinates.lat, sel.coordinates.lng],
      Math.max(mapRef.current.getZoom(), 14),
      { animate: true, duration: 1.1 }
    );
  }, [mapReady, selectedSlot, activeDay, days]);

  function handleRefine(e: React.FormEvent) {
    e.preventDefault();
    if (!refineMsg.trim() || loading) return;
    onRefine(refineMsg.trim());
    setRefineMsg("");
    setSelectedSlot(null);
  }

  function handleReplan(newSlots: Slot[]) {
    if (!onDaysUpdate) return;
    onDaysUpdate(days.map((d, i) => (i === activeDay ? { ...d, slots: newSlots } : d)));
    setShowLive(false);
  }

  const day          = days[activeDay];
  const slot         = day && selectedSlot !== null ? day.slots[selectedSlot] : null;
  const slotTimeIdx  = slot && selectedSlot !== null
    ? getTimeSlotIndex(slot.time_of_day, selectedSlot) : null;

  // ── Live Mode overlay ───────────────────────────────────────────────────────
  if (showLive) {
    return (
      <LiveMode
        destination={destination}
        currentDaySlots={day?.slots ?? []}
        onReplan={handleReplan}
        onBack={() => setShowLive(false)}
      />
    );
  }

  return (
    <div className="relative w-full h-screen overflow-hidden bg-black">
      {/* ── Map canvas ───────────────────────────────────────── */}
      <div ref={containerRef} className="absolute inset-0 z-0" />

      {/* ── Top bar ──────────────────────────────────────────── */}
      <div className="absolute top-0 left-0 right-0 z-10 p-3 pointer-events-none">
        <div className="max-w-xl mx-auto pointer-events-auto">
          <div className="bg-black/75 backdrop-blur-lg rounded-2xl p-3.5 border border-zinc-800/80 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-zinc-600 text-[10px] font-semibold tracking-widest uppercase mb-0.5">Naviro</p>
                <h1 className="text-white font-bold text-xl leading-tight truncate">{destination}</h1>
                <p className="text-zinc-400 text-xs mt-0.5 line-clamp-1">{summary}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0 mt-1">
                {loading && <span className="text-zinc-500 text-xs animate-pulse">Updating…</span>}
                <button
                  onClick={() => setShowEmergency(!showEmergency)}
                  title="Safety & Emergency Info"
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                    showEmergency
                      ? "bg-red-900/60 border-red-600/60 text-red-300"
                      : "bg-zinc-800/80 border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500"
                  }`}
                >
                  🛡️ <span className="hidden sm:inline">Safety</span>
                </button>
                <button
                  onClick={() => setShowLive(true)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-green-900/40 border border-green-700/50 text-green-300 text-xs font-medium hover:bg-green-800/50 transition-colors"
                >
                  🔴 <span className="hidden sm:inline">Live</span>
                </button>
              </div>
            </div>

            {/* Day tabs */}
            {totalDays > 1 && (
              <div className="flex gap-1.5 mt-3 flex-wrap">
                {days.map((d, i) => (
                  <button key={i} onClick={() => onDayChange(i)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      activeDay === i
                        ? "bg-white text-black shadow"
                        : "bg-zinc-800/80 text-zinc-400 hover:bg-zinc-700 hover:text-white"
                    }`}>
                    Day {d.day_number}
                  </button>
                ))}
              </div>
            )}

            {/* Calendar export */}
            <div className="flex justify-end mt-2">
              <button
                onClick={() => day?.slots.forEach((s) =>
                  window.open(buildCalendarUrl(s, day.day_number, destination), "_blank")
                )}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800/80 border border-zinc-700 text-zinc-400 text-xs font-medium hover:border-zinc-500 hover:text-white transition-colors"
              >
                📅 Export Day {day?.day_number} to Calendar
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Emergency Panel ───────────────────────────────────── */}
      {showEmergency && (
        <div className="absolute inset-0 z-20 flex items-end justify-center p-3 pointer-events-none">
          <div className="max-w-xl w-full pointer-events-auto">
            <div className="bg-black/92 backdrop-blur-lg rounded-2xl p-4 border border-red-800/50 shadow-2xl animate-in slide-in-from-bottom-4 duration-300 max-h-[75vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-white font-bold text-base">🛡️ Safety & Emergency</h2>
                  <p className="text-zinc-500 text-xs">{destination}</p>
                </div>
                <button onClick={() => setShowEmergency(false)}
                  className="text-zinc-500 hover:text-white transition-colors text-xl leading-none">×</button>
              </div>

              {!emergency ? (
                <p className="text-zinc-500 text-sm animate-pulse">Loading safety info…</p>
              ) : (
                <div className="space-y-3">
                  <div className="bg-red-950/40 border border-red-800/40 rounded-xl p-3">
                    <p className="text-red-400 text-xs font-semibold mb-1">🚨 Emergency Number</p>
                    <p className="text-white font-bold text-2xl">{emergency.emergency_number}</p>
                  </div>

                  {(emergency.hospitals || []).length > 0 && (
                    <div>
                      <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-2">🏥 Nearest Hospitals</p>
                      <div className="space-y-2">
                        {emergency.hospitals.map((h: any, i: number) => (
                          <div key={i} className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3">
                            <p className="text-white text-sm font-semibold">{h.name}</p>
                            <p className="text-zinc-500 text-xs">{h.address}</p>
                            {h.phone && <p className="text-zinc-400 text-xs mt-1">📞 {h.phone}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {emergency.police_station && (
                    <div>
                      <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-2">👮 Police Station</p>
                      <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3">
                        <p className="text-white text-sm font-semibold">{emergency.police_station.name}</p>
                        <p className="text-zinc-500 text-xs">{emergency.police_station.address}</p>
                        {emergency.police_station.phone && (
                          <p className="text-zinc-400 text-xs mt-1">📞 {emergency.police_station.phone}</p>
                        )}
                      </div>
                    </div>
                  )}

                  {emergency.embassy && (
                    <div>
                      <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-2">🇮🇳 Indian Embassy</p>
                      <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3">
                        <p className="text-white text-sm font-semibold">{emergency.embassy.country}</p>
                        <p className="text-zinc-500 text-xs">{emergency.embassy.address}</p>
                        {emergency.embassy.phone && (
                          <p className="text-zinc-400 text-xs mt-1">📞 {emergency.embassy.phone}</p>
                        )}
                      </div>
                    </div>
                  )}

                  {emergency.safety_tips?.length > 0 && (
                    <div>
                      <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-2">💡 Safety Tips</p>
                      <div className="space-y-1">
                        {emergency.safety_tips.map((tip: string, i: number) => (
                          <p key={i} className="text-zinc-400 text-xs flex gap-2">
                            <span className="text-zinc-600 shrink-0">•</span>{tip}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Left legend ──────────────────────────────────────── */}
      <div className="absolute left-3 top-1/2 -translate-y-1/2 z-10 flex flex-col gap-2">
        {day?.slots.map((s, i) => {
          const tsi   = getTimeSlotIndex(s.time_of_day, i);
          const num   = getDisplayNumber(s.time_of_day, i);
          const label = TIME_LABELS[tsi] ?? s.time_of_day;
          const icon  = TIME_ICONS[tsi] ?? "📍";
          return (
            <button key={i}
              onClick={() => setSelectedSlot(selectedSlot === i ? null : i)}
              className={`flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs font-medium transition-all backdrop-blur-md border shadow-lg ${
                selectedSlot === i
                  ? "bg-white text-black border-white"
                  : "bg-black/65 text-zinc-300 border-zinc-700/70 hover:border-zinc-500 hover:text-white"
              }`}
            >
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                style={{ background: PIN_COLORS[tsi] ?? "#888" }}>{num}</span>
              <span className="hidden sm:block">{label}</span>
              <span className="sm:hidden">{icon}</span>
            </button>
          );
        })}
      </div>

      {/* ── Bottom: slot detail OR refine bar ────────────────── */}
      <div className="absolute bottom-0 left-0 right-0 z-10 p-3">
        <div className="max-w-xl mx-auto">
          {slot ? (
            <div className="bg-black/80 backdrop-blur-lg rounded-2xl p-4 border border-zinc-700/80 shadow-2xl animate-in slide-in-from-bottom-4 duration-300">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                    style={{ background: PIN_COLORS[getTimeSlotIndex(slot.time_of_day, selectedSlot!)] ?? "#888" }}>
                    {getDisplayNumber(slot.time_of_day, selectedSlot!)}
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-white font-semibold truncate">{slot.place_name}</h2>
                    <p className="text-zinc-500 text-xs capitalize">
                      {slotTimeIdx !== null ? TIME_ICONS[slotTimeIdx] : "📍"} {slot.time_of_day} · {slot.category}
                    </p>
                  </div>
                </div>
                <button onClick={() => setSelectedSlot(null)}
                  className="text-zinc-500 hover:text-white transition-colors shrink-0 text-xl leading-none">×</button>
              </div>

              <p className="text-zinc-300 text-sm mb-3 leading-relaxed">{slot.description}</p>

              <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                <div className="bg-zinc-800/60 rounded-lg p-2.5">
                  <p className="text-zinc-500 mb-0.5">⏱ Duration</p>
                  <p className="text-zinc-200 font-medium">{slot.estimated_duration}</p>
                </div>
                <div className="bg-zinc-800/60 rounded-lg p-2.5">
                  <p className="text-zinc-500 mb-0.5">💰 Cost</p>
                  <p className="text-zinc-200 font-medium">{slot.estimated_cost}</p>
                </div>
                <div className="bg-zinc-800/60 rounded-lg p-2.5">
                  <p className="text-zinc-500 mb-0.5">🚌 Transport</p>
                  <p className="text-zinc-200 font-medium line-clamp-1">{slot.how_to_get_there.split(",")[0]}</p>
                </div>
              </div>

              <div className="bg-amber-950/50 border border-amber-800/40 rounded-lg p-2.5 text-xs mb-3">
                <p className="text-amber-400 font-semibold mb-0.5">💡 Local tip</p>
                <p className="text-amber-100/80">{slot.local_tip}</p>
              </div>

              {/* Booking links */}
              <div className="flex gap-2 flex-wrap">
                {!["food", "cultural", "market"].includes(slot.category) && (
                  <a href={`https://www.booking.com/search.html?ss=${encodeURIComponent(slot.place_name + " " + destination)}`}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-900/40 border border-blue-700/50 text-blue-300 text-xs font-medium hover:bg-blue-800/50 transition-colors">
                    🏨 Booking.com
                  </a>
                )}
                <a href={`https://www.makemytrip.com/hotels/hotel-listing/?cityCode=${encodeURIComponent(destination)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-900/40 border border-red-700/50 text-red-300 text-xs font-medium hover:bg-red-800/50 transition-colors">
                  ✈️ MakeMyTrip
                </a>
                <a href={`https://www.skyscanner.co.in/flights-to/${encodeURIComponent(destination.toLowerCase().replace(/\s+/g, "-"))}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-900/40 border border-teal-700/50 text-teal-300 text-xs font-medium hover:bg-teal-800/50 transition-colors">
                  🛫 Skyscanner
                </a>
              </div>
            </div>
          ) : (
            <form onSubmit={handleRefine}
              className="bg-black/70 backdrop-blur-lg border border-zinc-700/70 rounded-2xl p-2 flex gap-2 shadow-2xl">
              <input
                value={refineMsg}
                onChange={(e) => setRefineMsg(e.target.value)}
                placeholder="Tap a pin to explore · or ask to change something…"
                className="flex-1 bg-transparent px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none"
                disabled={loading}
              />
              <button type="submit" disabled={loading || !refineMsg.trim()}
                className="bg-white text-black px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-40 hover:bg-zinc-200 transition-colors shrink-0">
                {loading ? "…" : "Update →"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
