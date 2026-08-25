"use client";

import { useEffect, useRef, useState } from "react";
import type {
  Map as LeafletMap,
  Marker as LeafletMarker,
  Polyline as LeafletPolyline,
} from "leaflet";
import LiveMode from "./LiveMode";
import type { Slot, TravelMapProps } from "@/app/types";
import {
  Shield,
  Broadcast,
  Calendar,
  LinkIcon,
  Navigation,
  Clock,
  Rupee,
  Bus,
  Bulb,
  MapPin,
  X,
  ArrowLeft,
  Warning,
  TIME_OF_DAY_ICONS,
} from "@/app/components/icons";
import Button from "@/app/components/ui/Button";
import Panel from "@/app/components/ui/Panel";

// ─── Time-of-day helpers ────────────────────────────────────────────────────
// Pins used to be colored by time-of-day band (morning/afternoon/evening).
// Under the single-accent design system all pins share one color, so this no
// longer feeds a color lookup — it only resolves the label/icon shown in the
// legend and slot detail sheet.
const TIME_BAND_LABELS: Record<string, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
};

function normalizeTimeOfDay(timeOfDay: string | undefined, fallbackIndex: number): string {
  const n = (timeOfDay ?? "").toLowerCase();
  if (n.includes("morning")) return "morning";
  if (n.includes("afternoon")) return "afternoon";
  if (n.includes("evening") || n.includes("night")) return "evening";
  const bands = ["morning", "afternoon", "evening"];
  return bands[fallbackIndex % bands.length];
}

function getDisplayNumber(timeOfDay: string | undefined, fallbackIndex: number) {
  // Sequential position within the day, not the time-of-day band. A day can
  // have two slots in the same band (e.g. two "morning" stops), which must
  // still get distinct numbers even though they share a time-of-day icon.
  // fallbackIndex is always the slot's real index in day.slots at every call
  // site, so it doubles as the display number.
  return fallbackIndex + 1;
}

// ─── Calendar export helper ───────────────────────────────────────────────────
// India has no DST and sits at a fixed UTC+5:30, so every slot's clock time is
// built as an explicit UTC instant offset by that amount — this is what makes
// "9am" mean 9am India time in the exported event regardless of the visitor's
// own browser/OS timezone, instead of drifting with wherever they happen to be.
const IST_OFFSET_MINUTES = 5 * 60 + 30;

function istWallClockToUTC(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(year, month, day, hour, minute) - IST_OFFSET_MINUTES * 60 * 1000);
}

// Google Calendar's dates= param must keep its trailing Z — that's what tells
// it these are UTC instants to convert, rather than bare digits it renders
// as-is. Stripping the Z (the previous bug) silently reinterpreted the UTC
// clock digits as if they were already the viewer's local time, e.g. showing
// a 9am IST plan at 3:30am instead.
const fmtUTC = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

const SLOT_TIME_BANDS: Record<string, [number, number]> = {
  morning: [9, 11],
  afternoon: [13, 15],
  evening: [18, 20],
};

function buildCalendarEvent(slot: Slot, dayNumber: number, destination: string) {
  const base = new Date();
  base.setDate(base.getDate() + 7 + dayNumber - 1);
  const [startH, endH] = SLOT_TIME_BANDS[slot.time_of_day.toLowerCase()] ?? [10, 11];
  const y = base.getFullYear(), m = base.getMonth(), d = base.getDate();
  const start = istWallClockToUTC(y, m, d, startH, 0);
  const end = istWallClockToUTC(y, m, d, endH, 0);
  return {
    summary: slot.place_name,
    dates: `${fmtUTC(start)}/${fmtUTC(end)}`,
    description: `${slot.description}\n\nLocal tip: ${slot.local_tip}\n\nGetting there: ${slot.how_to_get_there}`,
    location: `${slot.place_name}, ${destination}`,
  };
}

function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

// One .ics file covering every slot in the day, downloaded once — the previous
// version opened one Google Calendar tab per slot via window.open(), which
// browsers block as popups after the first.
function downloadDayCalendar(slots: Slot[], dayNumber: number, destination: string) {
  const events = slots.map((s) => buildCalendarEvent(s, dayNumber, destination));
  const now = fmtUTC(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Naviro//Trip Export//EN",
    ...events.flatMap((e, i) => [
      "BEGIN:VEVENT",
      `UID:naviro-${dayNumber}-${i}-${now}@naviro`,
      `DTSTAMP:${now}`,
      `DTSTART:${e.dates.split("/")[0]}`,
      `DTEND:${e.dates.split("/")[1]}`,
      `SUMMARY:${icsEscape(e.summary)}`,
      `DESCRIPTION:${icsEscape(e.description)}`,
      `LOCATION:${icsEscape(e.location)}`,
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ];
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `naviro-day-${dayNumber}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
  onExit,
}: TravelMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<LeafletMap | null>(null);
  const markersRef   = useRef<LeafletMarker[]>([]);
  const polylineRef  = useRef<LeafletPolyline | null>(null);

  const [selectedSlot,  setSelectedSlot]  = useState<number | null>(null);
  const [refineMsg,     setRefineMsg]     = useState("");
  const [mapReady,      setMapReady]      = useState(false);

  // Phase 2 state
  const [showEmergency,    setShowEmergency]    = useState(false);
  const [emergency,        setEmergency]        = useState<import("@/app/types").EmergencyInfo | null>(null);
  const [emergencyLoading, setEmergencyLoading] = useState(false);
  const [emergencyError,   setEmergencyError]   = useState(false);
  const [showLive,         setShowLive]         = useState(false);

  // Save & Share
  const [sharing,     setSharing]     = useState(false);
  const [shareStatus, setShareStatus] = useState<"idle" | "copied" | "error">("idle");

  // Destination changed (e.g. a refine swapped cities) — drop any stale safety
  // info so the next Safety tap re-fetches for the new place, not the old one.
  useEffect(() => {
    setEmergency(null);
    setEmergencyError(false);
  }, [destination]);

  // ── Fetch emergency info on demand (first tap of Safety, not every render) ──
  function openEmergency() {
    setShowEmergency(true);
    if (emergency || emergencyLoading) return;
    setEmergencyLoading(true);
    setEmergencyError(false);
    const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");
    fetch(`${apiUrl}/api/emergency`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destination }),
    })
      .then((r) => {
        if (!r.ok) throw new Error("request failed");
        return r.json();
      })
      .then(setEmergency)
      .catch(() => setEmergencyError(true))
      .finally(() => setEmergencyLoading(false));
  }

  // ── Save & share the current itinerary as a link ────────────────────────────
  async function handleShareTrip() {
    if (sharing) return;
    setSharing(true);
    try {
      const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");
      const res = await fetch(`${apiUrl}/api/trip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination, total_days: totalDays, summary, days }),
      });
      if (!res.ok) throw new Error("request failed");
      const data = await res.json();
      const shareUrl = `${window.location.origin}/trip/${data.slug}`;
      await navigator.clipboard.writeText(shareUrl);
      setShareStatus("copied");
    } catch {
      setShareStatus("error");
    } finally {
      setSharing(false);
      setTimeout(() => setShareStatus("idle"), 2000);
    }
  }

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
      /* Leaflet's marker HTML is injected outside React's render tree via this
         manually-created <style> tag, so it isn't guaranteed to be caught by
         globals.css's universal prefers-reduced-motion rule — this is the
         explicit safety net for the pin-drop transform/opacity animation. */
      @media (prefers-reduced-motion: reduce) {
        .pin-inner { animation: none !important; opacity: 1 !important; transform: rotate(-45deg) scale(1) !important; }
      }
      /* Single-accent pin system: selected pin inverts to foreground-strong
         fill with on-emphasis (dark) text instead of a second hue. */
      .pin-selected .pin-inner { background: var(--foreground-strong) !important; }
      .pin-selected .pin-inner span { color: var(--on-emphasis) !important; }
      .leaflet-container { background: var(--background) !important; }
      .leaflet-control-zoom a {
        background: var(--surface) !important; color: var(--muted) !important;
        border-color: var(--border) !important; backdrop-filter: blur(8px);
      }
      .leaflet-control-zoom a:hover { background: var(--surface-2) !important; color: var(--foreground) !important; }
      .leaflet-control-attribution {
        background: var(--background) !important; color: var(--muted-soft) !important;
        font-size: 10px !important; backdrop-filter: blur(4px);
      }
      .leaflet-control-attribution a { color: var(--muted) !important; }
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

      // CartoDB Dark Matter — deep dark map
      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        {
          maxZoom: 19,
          attribution: "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors © <a href='https://carto.com/attributions'>CARTO</a>",
          subdomains: "abcd",
        }
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
      if (!day || !Array.isArray(day.slots)) return;

      const validSlots = day.slots.filter(
        (s) => s.coordinates?.lat && s.coordinates?.lng &&
               !(s.coordinates.lat === 0 && s.coordinates.lng === 0)
      );
      if (validSlots.length === 0) return;

      const latlngs: [number, number][] = [];

      day.slots.forEach((slot, slotIndex) => {
        if (!slot.coordinates?.lat || !slot.coordinates?.lng ||
            (slot.coordinates.lat === 0 && slot.coordinates.lng === 0)) return;

        const num   = getDisplayNumber(slot.time_of_day, slotIndex);
        const delay = latlngs.length * 380;

        // All pins share the single brand accent — time-of-day is now
        // communicated by the legend/sheet's label and icon, not by hue.
        // `pin-marker` is a stable hook for the reduced-motion/selection CSS
        // above; `data-slot-index` (set just below) lets the selected-slot
        // effect find and re-tag the right marker without rebuilding any of
        // them.
        const icon = L.divIcon({
          html: `<div style="width:44px;height:54px;position:relative;filter:drop-shadow(0 4px 10px rgba(0,0,0,0.25))">
            <div class="pin-inner" style="position:absolute;bottom:0;left:0;width:44px;height:44px;background:var(--accent);border:3px solid var(--foreground-strong);border-radius:50% 50% 50% 0;display:flex;align-items:center;justify-content:center;transform:rotate(-45deg) scale(0);animation:pinDrop 0.55s cubic-bezier(0.34,1.56,0.64,1) ${delay}ms forwards;box-shadow:0 2px 8px rgba(0,0,0,0.2)">
              <span style="transform:rotate(45deg);font-size:16px;font-weight:900;color:var(--foreground-strong);font-family:var(--font-geist-mono),ui-monospace,monospace;line-height:1">${num}</span>
            </div></div>`,
          className: "pin-marker", iconSize: [44, 54], iconAnchor: [22, 54], popupAnchor: [0, -58],
        });

        const marker = L.marker([slot.coordinates.lat, slot.coordinates.lng], { icon })
          .addTo(map)
          .on("click", () => setSelectedSlot((prev) => (prev === slotIndex ? null : slotIndex)));
        marker.getElement()?.setAttribute("data-slot-index", String(slotIndex));

        markersRef.current.push(marker);
        latlngs.push([slot.coordinates.lat, slot.coordinates.lng]);
      });

      if (latlngs.length > 1) {
        setTimeout(() => {
          polylineRef.current = L.polyline(latlngs, {
            color: "var(--accent)", opacity: 0.4, weight: 2.5, dashArray: "6 10",
          }).addTo(map);
        }, validSlots.length * 380 + 150);
      }

      setTimeout(() => {
        map.flyToBounds(L.latLngBounds(latlngs), { padding: [90, 90], duration: 1.3, maxZoom: 14 });
      }, 100);

      setSelectedSlot(null);
    });
  }, [mapReady, activeDay, days]);

  // ── Toggle the selected pin's style + fly to it ─────────────────────────────
  // Kept as one effect (not split) because both reactions are driven by the
  // same selectedSlot change. Markers themselves are never rebuilt here —
  // that only happens in the [mapReady, activeDay, days] effect above — so
  // toggling a class on the existing marker element is what avoids
  // re-triggering the drop-in animation on every tap.
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;

    markersRef.current.forEach((m) => {
      const el = m.getElement();
      if (!el) return;
      const idx = Number(el.getAttribute("data-slot-index"));
      el.classList.toggle("pin-selected", idx === selectedSlot);
    });

    if (selectedSlot === null) return;
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

  const day          = Array.isArray(days) ? days[activeDay] : undefined;
  const safeSlots    = Array.isArray(day?.slots) ? day!.slots : [];
  const slot         = day && selectedSlot !== null ? (safeSlots[selectedSlot] ?? null) : null;
  const slotBand     = slot && selectedSlot !== null
    ? normalizeTimeOfDay(slot.time_of_day ?? "morning", selectedSlot) : null;
  const SlotTimeIcon = slotBand ? (TIME_OF_DAY_ICONS[slotBand] ?? MapPin) : MapPin;

  // Legend entries — shared by both the mobile horizontal strip and the
  // desktop left rail so the two layouts never drift out of sync.
  function renderLegendItems() {
    return safeSlots.map((s, i) => {
      const band     = normalizeTimeOfDay(s.time_of_day, i);
      const num      = getDisplayNumber(s.time_of_day, i);
      const label    = TIME_BAND_LABELS[band] ?? s.time_of_day;
      const TimeIcon = TIME_OF_DAY_ICONS[band] ?? MapPin;
      const isSelected = selectedSlot === i;
      return (
        <button
          key={i}
          type="button"
          onClick={() => setSelectedSlot(isSelected ? null : i)}
          aria-pressed={isSelected}
          className={`flex items-center gap-2 px-2.5 py-2 rounded-xl text-small font-medium transition-all backdrop-blur-md border shadow-md shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
            isSelected
              ? "bg-foreground-strong text-on-emphasis border-foreground-strong"
              : "bg-surface/85 text-muted border-border hover:border-accent hover:text-foreground"
          }`}
        >
          <span
            className={`w-5 h-5 rounded-full flex items-center justify-center text-caption font-bold shrink-0 ${
              isSelected ? "bg-on-emphasis text-foreground-strong" : "bg-accent text-foreground-strong"
            }`}
          >
            {num}
          </span>
          <TimeIcon size={14} aria-hidden="true" />
          <span className="hidden lg:inline">{label}</span>
        </button>
      );
    });
  }

  // ── Live Mode overlay ───────────────────────────────────────────────────────
  if (showLive) {
    return (
      <main id="main-content" className="min-h-dvh">
        <LiveMode
          destination={destination}
          currentDaySlots={day?.slots ?? []}
          onReplan={handleReplan}
          onBack={() => setShowLive(false)}
        />
      </main>
    );
  }

  return (
    <main id="main-content" className="relative w-full min-h-dvh overflow-hidden bg-background">
      {/* ── Map canvas ───────────────────────────────────────── */}
      <div ref={containerRef} className="absolute inset-0 z-map" />

      {/* ── Top bar ──────────────────────────────────────────── */}
      <header className="absolute top-0 left-0 right-0 z-header p-3 pointer-events-none">
        <div className="max-w-xl mx-auto pointer-events-auto">
          <Panel variant="glass" radius="2xl" padding="md">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon={ArrowLeft}
                  onClick={() => onExit?.()}
                  className="!px-1.5 !py-1 -ml-1.5 mb-1 text-caption"
                >
                  New trip
                </Button>
                <h1 className="text-foreground font-bold text-h2 leading-tight truncate">{destination}</h1>
                <p className="text-muted text-small mt-0.5 line-clamp-1">{summary}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 mt-1">
                {loading && (
                  <span className="text-muted-soft text-caption animate-pulse hidden sm:inline">Updating…</span>
                )}
                <Button
                  type="button"
                  variant={showEmergency ? "danger" : "secondary"}
                  size="sm"
                  icon={Shield}
                  aria-label="Safety and emergency info"
                  onClick={() => (showEmergency ? setShowEmergency(false) : openEmergency())}
                >
                  <span className="hidden sm:inline">Safety</span>
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  icon={Broadcast}
                  aria-label="Live mode"
                  onClick={() => setShowLive(true)}
                >
                  <span className="hidden sm:inline">Live</span>
                </Button>
              </div>
            </div>

            {/* Day tabs */}
            {totalDays > 1 && (
              <div className="flex gap-1.5 mt-3 flex-wrap" role="tablist" aria-label="Day">
                {(days ?? []).map((d, i) => (
                  <button
                    key={i}
                    type="button"
                    role="tab"
                    aria-selected={activeDay === i}
                    onClick={() => onDayChange(i)}
                    className={`px-3 py-1.5 rounded-lg text-small font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                      activeDay === i
                        ? "bg-accent text-foreground-strong shadow-sm"
                        : "bg-surface-2 text-muted hover:bg-border-subtle-hover hover:text-foreground"
                    }`}
                  >
                    Day {d.day_number}
                  </button>
                ))}
              </div>
            )}

            {/* Calendar export + Save & Share */}
            <div className="flex justify-end items-center gap-2 mt-2">
              {shareStatus === "copied" && (
                <span className="text-caption text-success font-medium">Link copied!</span>
              )}
              {shareStatus === "error" && (
                <span className="text-caption text-danger font-medium">Couldn&apos;t share — try again</span>
              )}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={LinkIcon}
                loading={sharing}
                aria-label="Share trip"
                onClick={handleShareTrip}
              >
                <span className="hidden sm:inline">Share trip</span>
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={Calendar}
                aria-label={`Export day ${day?.day_number ?? 1} to calendar`}
                onClick={() => downloadDayCalendar(safeSlots, day?.day_number ?? 1, destination)}
              >
                <span className="hidden sm:inline">Export day {day?.day_number}</span>
              </Button>
            </div>
          </Panel>
        </div>
      </header>

      {/* ── Emergency Panel ───────────────────────────────────── */}
      {showEmergency && (
        <div className="absolute inset-0 z-sheet flex items-end justify-center p-3 pointer-events-none">
          <div className="max-w-xl w-full pointer-events-auto">
            <Panel
              variant="glass"
              radius="sheet-top"
              padding="lg"
              className="!border-danger-border max-h-[75vh] overflow-y-auto animate-in slide-in-from-bottom-4 duration-300 motion-reduce:animate-none"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Shield size={18} className="text-danger" aria-hidden="true" />
                  <div>
                    <h2 className="text-foreground font-bold text-body">Safety &amp; emergency</h2>
                    <p className="text-muted text-small">{destination}</p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  iconOnly
                  icon={X}
                  aria-label="Close safety panel"
                  onClick={() => setShowEmergency(false)}
                />
              </div>

              {emergencyLoading && (
                <p className="text-muted-soft text-body animate-pulse">Loading safety info…</p>
              )}

              {emergencyError && (
                <p className="text-muted text-body">
                  Couldn&apos;t load safety info right now. In an emergency, dial{" "}
                  <span className="text-foreground font-semibold">112</span> — India&apos;s
                  national emergency number.
                </p>
              )}

              {emergency && (
                <div className="space-y-3">
                  <div className="bg-danger-bg border border-danger-border rounded-xl p-3">
                    <p className="flex items-center gap-1.5 text-danger text-caption font-semibold mb-1">
                      <Warning size={14} aria-hidden="true" /> Emergency number
                    </p>
                    <p className="text-foreground font-bold text-h1 font-mono">{emergency.emergency_number}</p>
                  </div>

                  <div>
                    <p className="flex items-center gap-1.5 text-muted-soft text-caption font-semibold mb-2">
                      <MapPin size={13} aria-hidden="true" /> Nearest hospitals
                    </p>
                    {emergency.hospitals.length > 0 ? (
                      <div className="space-y-2">
                        {emergency.hospitals.map((h, i) => (
                          <a key={i} href={h.maps_url} target="_blank" rel="noopener noreferrer"
                            className="block bg-surface-2 border border-border rounded-xl p-3 hover:border-border-subtle-hover transition-colors">
                            <p className="text-foreground text-small font-semibold">{h.name}</p>
                            <p className="text-muted text-caption">{h.address}</p>
                            <p className="text-accent-light text-caption mt-1">View on map →</p>
                          </a>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted text-caption">
                        Couldn&apos;t verify nearby hospitals. Search &quot;hospital near me&quot; on maps once you arrive.
                      </p>
                    )}
                  </div>

                  <div>
                    <p className="flex items-center gap-1.5 text-muted-soft text-caption font-semibold mb-2">
                      <MapPin size={13} aria-hidden="true" /> Police station
                    </p>
                    {emergency.police_station ? (
                      <a href={emergency.police_station.maps_url} target="_blank" rel="noopener noreferrer"
                        className="block bg-surface-2 border border-border rounded-xl p-3 hover:border-border-subtle-hover transition-colors">
                        <p className="text-foreground text-small font-semibold">{emergency.police_station.name}</p>
                        <p className="text-muted text-caption">{emergency.police_station.address}</p>
                        <p className="text-accent-light text-caption mt-1">View on map →</p>
                      </a>
                    ) : (
                      <p className="text-muted text-caption">Couldn&apos;t verify the nearest police station.</p>
                    )}
                  </div>

                  {emergency.safety_tips.length > 0 && (
                    <div>
                      <p className="flex items-center gap-1.5 text-muted-soft text-caption font-semibold mb-2">
                        <Bulb size={13} aria-hidden="true" /> Safety tips
                      </p>
                      <div className="space-y-1">
                        {emergency.safety_tips.map((tip, i) => (
                          <p key={i} className="text-muted text-caption flex gap-2">
                            <span className="text-muted-soft shrink-0">•</span>{tip}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Panel>
          </div>
        </div>
      )}

      {/* ── Desktop left legend rail ─────────────────────────── */}
      <div className="hidden lg:flex absolute left-3 top-36 bottom-32 z-chrome flex-col justify-center gap-2 pointer-events-none">
        <div className="flex flex-col gap-2 pointer-events-auto">{renderLegendItems()}</div>
      </div>

      {/* ── Bottom: mobile legend strip + slot detail OR refine bar ─ */}
      <div className="absolute bottom-0 left-0 right-0 z-chrome p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pointer-events-none">
        <div className="max-w-xl mx-auto flex flex-col gap-2">
          {/* Mobile horizontal legend strip — replaces the old vertically
              centered rail, which was unreachable by thumb and collided with
              this sheet on small screens. */}
          <div className="lg:hidden overflow-x-auto flex gap-2 pointer-events-auto [-webkit-overflow-scrolling:touch]">
            {renderLegendItems()}
          </div>

          <div className="pointer-events-auto">
            {slot ? (
              <Panel variant="glass" radius="sheet-top" padding="lg" className="animate-in slide-in-from-bottom-4 duration-300 motion-reduce:animate-none">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-7 h-7 rounded-full flex items-center justify-center bg-foreground-strong text-on-emphasis text-caption font-bold shrink-0">
                      {getDisplayNumber(slot.time_of_day, selectedSlot!)}
                    </span>
                    <div className="min-w-0">
                      <h2 className="text-foreground font-semibold truncate">{slot.place_name}</h2>
                      <p className="flex items-center gap-1 text-muted text-small capitalize">
                        <SlotTimeIcon size={12} aria-hidden="true" />
                        {slot.time_of_day} · {slot.category}
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    iconOnly
                    icon={X}
                    aria-label="Close slot details"
                    onClick={() => setSelectedSlot(null)}
                    className="shrink-0"
                  />
                </div>

                <p className="text-muted text-body mb-3 leading-relaxed">{slot.description}</p>

                {/* Inline meta row — mono figures read as verified data
                    rather than three equal-weight bordered stat cards. */}
                <div className="flex items-center gap-3 text-small font-mono text-foreground border-y border-border-subtle py-2.5 mb-3 overflow-x-auto">
                  <span className="flex items-center gap-1.5 shrink-0">
                    <Clock size={14} className="text-muted-soft" aria-hidden="true" />
                    {slot.estimated_duration}
                  </span>
                  <span className="w-px h-4 bg-border shrink-0" aria-hidden="true" />
                  <span className="flex items-center gap-1.5 shrink-0">
                    <Rupee size={14} className="text-muted-soft" aria-hidden="true" />
                    {slot.estimated_cost}
                  </span>
                  <span className="w-px h-4 bg-border shrink-0" aria-hidden="true" />
                  <span className="flex items-center gap-1.5 min-w-0">
                    <Bus size={14} className="text-muted-soft shrink-0" aria-hidden="true" />
                    <span className="truncate">{slot.how_to_get_there.split(",")[0]}</span>
                  </span>
                </div>

                <div className="rounded-lg p-2.5 text-small mb-3 bg-surface-2 border border-border-subtle">
                  <p className="flex items-center gap-1.5 text-accent-light font-semibold mb-0.5">
                    <Bulb size={14} aria-hidden="true" /> Local tip
                  </p>
                  <p className="text-muted">{slot.local_tip}</p>
                </div>

                {/* LocationIQ has no ratings/reviews/hours data, so the only
                    evidence signal left is existence verification itself. */}
                {slot.verified === false && (
                  <p className="flex items-center gap-1.5 text-muted-soft text-caption leading-snug mb-3">
                    <MapPin size={13} aria-hidden="true" />
                    Approximate location — couldn&apos;t independently verify this spot.
                  </p>
                )}

                {/* Directions — plain Google Maps deep link, live turn-by-turn
                    beats an in-app fare estimate that goes stale the moment
                    rates change. Routed through Button's onClick (rather than
                    a plain <a>) so it stays a real Button primitive; a
                    same-tick window.open() from a click handler isn't
                    blocked by popup blockers. */}
                <Button
                  type="button"
                  variant="primary"
                  pill
                  fullWidth
                  icon={Navigation}
                  onClick={() =>
                    window.open(
                      `https://www.google.com/maps/dir/?api=1&destination=${slot.coordinates.lat},${slot.coordinates.lng}`,
                      "_blank",
                      "noopener,noreferrer"
                    )
                  }
                >
                  Get me there
                </Button>
              </Panel>
            ) : (
              <Panel variant="glass" radius="2xl" padding="none" className="p-2 flex gap-2">
                <form onSubmit={handleRefine} className="flex-1 flex gap-2">
                  <input
                    value={refineMsg}
                    onChange={(e) => setRefineMsg(e.target.value)}
                    placeholder="Tap a pin to explore · or ask to change something…"
                    className="flex-1 bg-transparent px-3 py-2 text-body text-foreground placeholder-muted-soft outline-none"
                    disabled={loading}
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={loading || !refineMsg.trim()}
                    loading={loading}
                    className="shrink-0"
                  >
                    Update
                  </Button>
                </form>
              </Panel>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
