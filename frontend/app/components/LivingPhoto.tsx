"use client";

import { useEffect, useRef, useState } from "react";

interface PhotoData {
  url: string;
  color: string;
  credit?: string;
  creditUrl?: string;
}

/**
 * LivingPhoto — a real photograph turned into an interactive depth window.
 * It breathes (slow Ken Burns), drifts on its own, follows the cursor,
 * and reacts to device tilt. The picture is the feature, not a backdrop.
 *
 * Phase 2 hook: a `depthMap` prop can later drive true per-pixel parallax.
 */
export default function LivingPhoto({
  query,
  intensity = 1,
  scrim = 0.55,
  showCredit = true,
  className = "",
  children,
}: {
  query: string;
  intensity?: number;
  scrim?: number;
  showCredit?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const [data, setData] = useState<PhotoData | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const photoRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const motesRef = useRef<HTMLDivElement>(null);

  const tx = useRef(0);
  const ty = useRef(0);
  const cx = useRef(0);
  const cy = useRef(0);
  const t0 = useRef(0);
  const pointerActive = useRef(false);

  // ── Fetch a photo whenever the query changes ──
  useEffect(() => {
    if (!query) return;
    let cancelled = false;
    fetch(`/api/photo?q=${encodeURIComponent(query)}`)
      .then((r) => r.json())
      .then((d: PhotoData) => {
        if (cancelled || !d?.url) return;
        // Preload so we never flash a half-loaded image.
        const img = new window.Image();
        img.onload = () => { if (!cancelled) setData(d); };
        img.onerror = () => { if (!cancelled) setData({ ...d, url: "" }); }; // keep color
        img.src = d.url;
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [query]);

  // ── Apply the image with a soft crossfade ──
  useEffect(() => {
    const el = photoRef.current;
    if (!el || !data) return;
    el.style.backgroundColor = data.color || "#101010";
    if (data.url) {
      el.style.backgroundImage = `url("${data.url}")`;
      el.style.animation = "none";
      // reflow to restart the fade/ken-burns
      void el.offsetWidth;
      el.style.animation = "lpFade 1.3s ease, lpKen 28s ease-in-out infinite alternate";
    }
  }, [data]);

  // ── Build floating light motes once ──
  useEffect(() => {
    const wrap = motesRef.current;
    if (!wrap || wrap.childElementCount > 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (let i = 0; i < 16; i++) {
      const m = document.createElement("div");
      m.className = "lp-mote";
      const s = 2 + Math.random() * 3;
      m.style.width = s + "px";
      m.style.height = s + "px";
      m.style.left = Math.random() * 100 + "%";
      m.style.top = 40 + Math.random() * 60 + "%";
      m.style.animationDuration = 6 + Math.random() * 7 + "s";
      m.style.animationDelay = Math.random() * 9 + "s";
      m.dataset.depth = (0.4 + Math.random() * 0.8).toFixed(2);
      wrap.appendChild(m);
    }
  }, []);

  // ── Parallax + idle drift loop ──
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    t0.current = Date.now();
    const loop = () => {
      let targetX = tx.current;
      let targetY = ty.current;
      if (!pointerActive.current) {
        // Gentle autonomous drift so it feels alive untouched (key on mobile).
        const t = (Date.now() - t0.current) / 1000;
        targetX = Math.sin(t * 0.25) * 0.45;
        targetY = Math.cos(t * 0.19) * 0.32;
      }
      cx.current += (targetX - cx.current) * 0.06;
      cy.current += (targetY - cy.current) * 0.06;
      const k = intensity;
      if (photoRef.current)
        photoRef.current.style.transform = `translate(${cx.current * -16 * k}px, ${cy.current * -16 * k}px) scale(1.07)`;
      if (glowRef.current)
        glowRef.current.style.transform = `translate(${cx.current * 36 * k}px, ${cy.current * 36 * k}px)`;
      if (motesRef.current) {
        const kids = motesRef.current.children;
        for (let i = 0; i < kids.length; i++) {
          const el = kids[i] as HTMLElement;
          const d = parseFloat(el.dataset.depth || "0.6");
          el.style.marginLeft = cx.current * -26 * d * k + "px";
          el.style.marginTop = cy.current * -26 * d * k + "px";
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [intensity]);

  // ── Pointer + device tilt ──
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onMove = (e: MouseEvent) => {
      const r = wrap.getBoundingClientRect();
      tx.current = ((e.clientX - r.left) / r.width - 0.5) * 2;
      ty.current = ((e.clientY - r.top) / r.height - 0.5) * 2;
      pointerActive.current = true;
    };
    const onLeave = () => { pointerActive.current = false; };
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.gamma == null) return;
      tx.current = Math.max(-1, Math.min(1, e.gamma / 30));
      ty.current = Math.max(-1, Math.min(1, ((e.beta ?? 45) - 45) / 30));
      pointerActive.current = true;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("deviceorientation", onTilt);
    wrap.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("deviceorientation", onTilt);
      wrap.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      className={className}
      style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#0a0a0a" }}
    >
      <style>{`
        @keyframes lpFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes lpKen { from { filter: saturate(1.04) contrast(1.02) brightness(1); } to { filter: saturate(1.18) contrast(1.06) brightness(1.04); } }
        @keyframes lpMote { 0% { transform: translateY(20px); opacity: 0; } 15% { opacity: .7; } 100% { transform: translateY(-130px); opacity: 0; } }
        .lp-mote { position: absolute; border-radius: 50%; background: radial-gradient(circle, rgba(255,235,200,.9), transparent); animation: lpMote linear infinite; will-change: transform, margin; pointer-events: none; }
      `}</style>

      {/* Photo layer (oversized for parallax headroom) */}
      <div
        ref={photoRef}
        style={{
          position: "absolute",
          inset: "-8%",
          width: "116%",
          height: "116%",
          backgroundSize: "cover",
          backgroundPosition: "center",
          willChange: "transform",
        }}
      />

      {/* Light that follows you */}
      <div
        ref={glowRef}
        style={{
          position: "absolute",
          inset: 0,
          mixBlendMode: "screen",
          background: "radial-gradient(circle at 50% 42%, rgba(255,210,150,.16), transparent 55%)",
          pointerEvents: "none",
          willChange: "transform",
        }}
      />

      {/* Readability scrim */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: `linear-gradient(to bottom, rgba(8,8,8,${scrim * 0.55}) 0%, rgba(8,8,8,${scrim * 0.28}) 38%, rgba(8,8,8,${scrim}) 100%)`,
        }}
      />

      {/* Floating motes */}
      <div ref={motesRef} style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }} />

      {/* Vignette */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", boxShadow: "inset 0 0 140px 40px rgba(0,0,0,.5)" }} />

      {showCredit && data?.credit && (
        <a
          href={data.creditUrl || "https://unsplash.com"}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            position: "absolute",
            bottom: 8,
            right: 10,
            zIndex: 30,
            fontSize: 9,
            letterSpacing: ".3px",
            color: "rgba(255,255,255,.4)",
            textDecoration: "none",
          }}
        >
          {data.credit} · Unsplash
        </a>
      )}

      {children}
    </div>
  );
}
