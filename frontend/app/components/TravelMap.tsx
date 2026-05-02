"use client";

import { useEffect, useRef, useState } from "react";
import type {
  Map as LeafletMap,
  Marker as LeafletMarker,
  Polyline as LeafletPolyline,
} from "leaflet";

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
  loading: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const PIN_COLORS = ["#f97316", "#facc15", "#a855f7"]; // morning / afternoon / evening
const TIME_LABELS = ["Morning", "Afternoon", "Evening"];
const TIME_ICONS = ["🌅", "☀️", "🌙"];

function getTimeSlotIndex(timeOfDay: string, fallbackIndex: number) {
  const normalized = timeOfDay.toLowerCase();
  if (normalized.includes("morning")) return 0;
  if (normalized.includes("afternoon")) return 1;
  if (normalized.includes("evening") || normalized.includes("night")) return 2;
  return fallbackIndex % PIN_COLORS.length;
}

function getDisplayNumber(timeOfDay: string, fallbackIndex: number) {
  return getTimeSlotIndex(timeOfDay, fallbackIndex) + 1;
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
  loading,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<LeafletMarker[]>([]);
  const polylineRef = useRef<LeafletPolyline | null>(null);

  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [refineMsg, setRefineMsg] = useState("");
  const [mapReady, setMapReady] = useState(false);

  // ── Init map (once) ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    // Inject animation keyframes + leaflet overrides
    const style = document.createElement("style");
    style.id = "travel-map-styles";
    style.textContent = `
      @keyframes pinDrop {
        0%   { transform: rotate(-45deg) scale(0) translateY(-30px); opacity: 0; }
        65%  { transform: rotate(-45deg) scale(1.2) translateY(5px);  opacity: 1; }
        100% { transform: rotate(-45deg) scale(1)   translateY(0);    opacity: 1; }
      }
      @keyframes fadeInLine {
        from { opacity: 0; } to { opacity: 1; }
      }
      .leaflet-container { background: #111 !important; }
      .leaflet-control-zoom a {
        background: rgba(0,0,0,0.75) !important;
        color: #e4e4e7 !important;
        border-color: rgba(255,255,255,0.15) !important;
        backdrop-filter: blur(8px);
      }
      .leaflet-control-zoom a:hover { background: rgba(0,0,0,0.9) !important; color: #fff !important; }
      .leaflet-control-attribution {
        background: rgba(0,0,0,0.55) !important;
        color: #71717a !important;
        font-size: 10px !important;
        backdrop-filter: blur(4px);
      }
      .leaflet-control-attribution a { color: #a1a1aa !important; }
    `;
    if (!document.getElementById("travel-map-styles")) {
      document.head.appendChild(style);
    }

    // Leaflet CSS via CDN (avoids SSR import issues)
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }

    import("leaflet").then((L) => {
      if (!containerRef.current || mapRef.current) return;

      mapRef.current = L.map(containerRef.current, {
        zoomControl: false,
        attributionControl: true,
        preferCanvas: true,
      }).setView([20.5937, 78.9629], 5); // India center default

      // ESRI Satellite imagery (free, no API key — shows real terrain + buildings)
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
          maxZoom: 19,
          attribution: "© Esri, Maxar, Earthstar Geographics",
        }
      ).addTo(mapRef.current);

      // Labels overlay on top of satellite (roads, place names, borders)
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 19, opacity: 0.85 }
      ).addTo(mapRef.current);

      L.control.zoom({ position: "bottomright" }).addTo(mapRef.current);

      setMapReady(true);
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // ── Update markers when day changes ─────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    import("leaflet").then((L) => {
      // Clear previous markers + route line
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      if (polylineRef.current) {
        polylineRef.current.remove();
        polylineRef.current = null;
      }

      const day = days[activeDay];
      if (!day) return;

      const validSlots = day.slots.filter(
        (s) =>
          s.coordinates?.lat &&
          s.coordinates?.lng &&
          !(s.coordinates.lat === 0 && s.coordinates.lng === 0)
      );
      if (validSlots.length === 0) return;

      const latlngs: [number, number][] = [];

      day.slots.forEach((slot, slotIndex) => {
        if (
          !slot.coordinates?.lat ||
          !slot.coordinates?.lng ||
          (slot.coordinates.lat === 0 && slot.coordinates.lng === 0)
        ) {
          return;
        }

        const timeSlotIndex = getTimeSlotIndex(slot.time_of_day, slotIndex);
        const color = PIN_COLORS[timeSlotIndex] ?? "#888";
        const displayNumber = getDisplayNumber(slot.time_of_day, slotIndex);
        const delay = latlngs.length * 380; // stagger only visible pins

        const icon = L.divIcon({
          html: `
            <div style="
              width:44px; height:54px;
              position:relative;
              filter: drop-shadow(0 6px 12px rgba(0,0,0,0.7));
            ">
              <div style="
                position:absolute; bottom:0; left:0;
                width:44px; height:44px;
                background:${color};
                border:3px solid rgba(255,255,255,0.95);
                border-radius:50% 50% 50% 0;
                display:flex; align-items:center; justify-content:center;
                transform:rotate(-45deg) scale(0);
                animation:pinDrop 0.55s cubic-bezier(0.34,1.56,0.64,1) ${delay}ms forwards;
              ">
                <span style="
                  transform:rotate(45deg);
                  font-size:16px;
                  font-weight:900;
                  color:#fff;
                  font-family:system-ui,sans-serif;
                  line-height:1;
                  text-shadow:0 1px 3px rgba(0,0,0,0.4);
                ">${displayNumber}</span>
              </div>
            </div>
          `,
          className: "",
          iconSize: [44, 54],
          iconAnchor: [22, 54],
          popupAnchor: [0, -58],
        });

        const marker = L.marker(
          [slot.coordinates.lat, slot.coordinates.lng],
          { icon }
        )
          .addTo(map)
          .on("click", () =>
            setSelectedSlot((prev) => (prev === slotIndex ? null : slotIndex))
          );

        markersRef.current.push(marker);
        latlngs.push([slot.coordinates.lat, slot.coordinates.lng]);
      });

      // Draw dashed route line after all pins appear
      if (latlngs.length > 1) {
        const routeDelay = validSlots.length * 380 + 150;
        setTimeout(() => {
          polylineRef.current = L.polyline(latlngs, {
            color: "rgba(255,255,255,0.2)",
            weight: 2,
            dashArray: "6 10",
          }).addTo(map);
        }, routeDelay);
      }

      // Fly camera to fit all pins
      const bounds = L.latLngBounds(latlngs);
      setTimeout(() => {
        map.flyToBounds(bounds, {
          padding: [90, 90],
          duration: 1.3,
          maxZoom: 14,
        });
      }, 100);

      setSelectedSlot(null);
    });
  }, [mapReady, activeDay, days]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || selectedSlot === null) return;

    const selected = days[activeDay]?.slots[selectedSlot];
    if (
      !selected?.coordinates?.lat ||
      !selected?.coordinates?.lng ||
      (selected.coordinates.lat === 0 && selected.coordinates.lng === 0)
    ) {
      return;
    }

    mapRef.current.flyTo(
      [selected.coordinates.lat, selected.coordinates.lng],
      Math.max(mapRef.current.getZoom(), 14),
      {
        animate: true,
        duration: 1.1,
      }
    );
  }, [mapReady, selectedSlot, activeDay, days]);

  function handleRefine(e: React.FormEvent) {
    e.preventDefault();
    if (!refineMsg.trim() || loading) return;
    onRefine(refineMsg.trim());
    setRefineMsg("");
    setSelectedSlot(null);
  }

  const day = days[activeDay];
  const slot = day && selectedSlot !== null ? day.slots[selectedSlot] : null;
  const slotTimeIndex =
    slot && selectedSlot !== null
      ? getTimeSlotIndex(slot.time_of_day, selectedSlot)
      : null;

  return (
    <div className="relative w-full h-screen overflow-hidden bg-black">
      {/* ── Map canvas ─────────────────────────────────────────────────── */}
      <div ref={containerRef} className="absolute inset-0 z-0" />

      {/* ── Top bar ────────────────────────────────────────────────────── */}
      <div className="absolute top-0 left-0 right-0 z-10 p-3 pointer-events-none">
        <div className="max-w-xl mx-auto pointer-events-auto">
          <div className="bg-black/75 backdrop-blur-lg rounded-2xl p-3.5 border border-zinc-800/80 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-zinc-600 text-[10px] font-semibold tracking-widest uppercase mb-0.5">
                  Naviro
                </p>
                <h1 className="text-white font-bold text-xl leading-tight truncate">
                  {destination}
                </h1>
                <p className="text-zinc-400 text-xs mt-0.5 line-clamp-1">
                  {summary}
                </p>
              </div>
              {loading && (
                <span className="text-zinc-500 text-xs animate-pulse shrink-0 mt-1">
                  Updating…
                </span>
              )}
            </div>

            {/* Day tabs */}
            {totalDays > 1 && (
              <div className="flex gap-1.5 mt-3">
                {days.map((d, i) => (
                  <button
                    key={i}
                    onClick={() => onDayChange(i)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      activeDay === i
                        ? "bg-white text-black shadow"
                        : "bg-zinc-800/80 text-zinc-400 hover:bg-zinc-700 hover:text-white"
                    }`}
                  >
                    Day {d.day_number}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Left legend (pin shortcuts) ────────────────────────────────── */}
      <div className="absolute left-3 top-1/2 -translate-y-1/2 z-10 flex flex-col gap-2">
        {day?.slots.map((s, i) => {
          const timeSlotIndex = getTimeSlotIndex(s.time_of_day, i);
          const displayNumber = getDisplayNumber(s.time_of_day, i);
          const label = TIME_LABELS[timeSlotIndex] ?? s.time_of_day;
          const icon = TIME_ICONS[timeSlotIndex] ?? "📍";
          return (
          <button
            key={i}
            onClick={() => setSelectedSlot(selectedSlot === i ? null : i)}
            className={`flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs font-medium transition-all backdrop-blur-md border shadow-lg ${
              selectedSlot === i
                ? "bg-white text-black border-white"
                : "bg-black/65 text-zinc-300 border-zinc-700/70 hover:border-zinc-500 hover:text-white"
            }`}
          >
            <span
              className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
              style={{ background: PIN_COLORS[timeSlotIndex] ?? "#888" }}
            >
              {displayNumber}
            </span>
            <span className="hidden sm:block">{label}</span>
            <span className="sm:hidden">{icon}</span>
          </button>
          );
        })}
      </div>

      {/* ── Bottom: slot detail OR refine bar ──────────────────────────── */}
      <div className="absolute bottom-0 left-0 right-0 z-10 p-3">
        <div className="max-w-xl mx-auto">
          {slot ? (
            /* Slot detail card */
            <div className="bg-black/80 backdrop-blur-lg rounded-2xl p-4 border border-zinc-700/80 shadow-2xl animate-in slide-in-from-bottom-4 duration-300">
              {/* Header */}
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                    style={{
                      background:
                        PIN_COLORS[
                          getTimeSlotIndex(slot.time_of_day, selectedSlot!)
                        ] ?? "#888",
                    }}
                  >
                    {getDisplayNumber(slot.time_of_day, selectedSlot!)}
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-white font-semibold truncate">
                      {slot.place_name}
                    </h2>
                    <p className="text-zinc-500 text-xs capitalize">
                      {slotTimeIndex !== null ? TIME_ICONS[slotTimeIndex] : "📍"} {slot.time_of_day} · {slot.category}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedSlot(null)}
                  className="text-zinc-500 hover:text-white transition-colors shrink-0 text-xl leading-none"
                >
                  ×
                </button>
              </div>

              <p className="text-zinc-300 text-sm mb-3 leading-relaxed">
                {slot.description}
              </p>

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

              <div className="bg-amber-950/50 border border-amber-800/40 rounded-lg p-2.5 text-xs">
                <p className="text-amber-400 font-semibold mb-0.5">💡 Local tip</p>
                <p className="text-amber-100/80">{slot.local_tip}</p>
              </div>
            </div>
          ) : (
            /* Refine bar */
            <form
              onSubmit={handleRefine}
              className="bg-black/70 backdrop-blur-lg border border-zinc-700/70 rounded-2xl p-2 flex gap-2 shadow-2xl"
            >
              <input
                value={refineMsg}
                onChange={(e) => setRefineMsg(e.target.value)}
                placeholder="Tap a pin to explore · or ask to change something…"
                className="flex-1 bg-transparent px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none"
                disabled={loading}
              />
              <button
                type="submit"
                disabled={loading || !refineMsg.trim()}
                className="bg-white text-black px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-40 hover:bg-zinc-200 transition-colors shrink-0"
              >
                {loading ? "…" : "Update →"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
