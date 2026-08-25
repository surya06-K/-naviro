"use client";

import { useEffect, useRef, useState } from "react";
import type { Itinerary } from "@/app/types";
import Button from "@/app/components/ui/Button";

export interface Props {
  // Called once a message's response includes a complete itinerary — the
  // parent is expected to switch to the map view when this fires.
  onItineraryReady: (itinerary: Itinerary) => void;
  // Returns to whatever view launched this (e.g. the landing form).
  onBack: () => void;
}

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  isError?: boolean;
}

// ─── Config ───────────────────────────────────────────────────────────────────
// Rotating status copy for the "thinking" bubble — same honest-progress voice
// and cadence as page.tsx's PROGRESS_MESSAGES, just sized for a chat bubble
// instead of a submit button.
const THINKING_MESSAGES = [
  "Thinking about your trip…",
  "Reading your vibe…",
  "Checking real places…",
  "Putting your plan together…",
];

const GREETING =
  "Where do you want to go? Tell me the place, how many days, and what you're into — I'll build a real plan, not a tourist checklist.";

function generateSessionId() {
  return "session-" + Math.random().toString(36).slice(2, 10);
}

// Best-effort destination guess from the conversation so far. Purely an
// optimization — it lets the backend prefetch weather context before
// generating, same as the destination field page.tsx's form already knows up
// front (see PlanRequest.destination in backend/main.py). The field is
// optional server-side, so when nothing obviously matches we just omit it.
function guessDestination(userTexts: string[]): string | undefined {
  const joined = userTexts.join(" ");
  const match = joined.match(
    /\b(?:in|to|around|near|visit(?:ing)?)\s+([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+){0,2})/
  );
  return match?.[1]?.trim();
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function AgentChat({ onItineraryReady, onBack }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    { id: 0, role: "assistant", text: GREETING },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [progressIdx, setProgressIdx] = useState(0);

  // Stable per-mount session id, matching page.tsx's exact pattern — a fresh
  // conversation on the backend, separate from any session the plan form started.
  const sessionId = useRef(generateSessionId());
  const lastMessageRef = useRef("");
  const destinationRef = useRef<string | undefined>(undefined);
  const userTextsRef = useRef<string[]>([]);
  const nextIdRef = useRef(1);
  const activeControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    isMountedRef.current = true;
    const t = setTimeout(() => inputRef.current?.focus(), 300);
    return () => {
      isMountedRef.current = false;
      clearTimeout(t);
      // In-flight request no longer has anywhere to land (Back tapped, or the
      // parent swapped views) — abort instead of letting it resolve into a
      // state update on an unmounted component.
      activeControllerRef.current?.abort();
    };
  }, []);

  // Rotate through honest progress copy while a request is in flight. Clamp
  // at the last message instead of wrapping — matches page.tsx's reasoning:
  // repeating "thinking about your trip" after 20s of a real request would
  // undercut the point of showing progress at all.
  useEffect(() => {
    if (!thinking) {
      setProgressIdx(0);
      return;
    }
    const t = setInterval(() => {
      setProgressIdx((p) => Math.min(p + 1, THINKING_MESSAGES.length - 1));
    }, 3500);
    return () => clearInterval(t);
  }, [thinking]);

  // Keep the thread scrolled to the latest message/thinking bubble.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, thinking]);

  function appendMessage(msg: Omit<ChatMessage, "id">) {
    const id = nextIdRef.current++;
    setMessages((prev) => [...prev, { ...msg, id }]);
  }

  async function runPlanRequest(message: string) {
    lastMessageRef.current = message;
    setThinking(true);
    // Render free tier can cold-start (p95 15-40s), and a request with several
    // unverified places can legitimately run long too — matches the just-
    // updated 80s timeout in page.tsx's callAPI.
    const controller = new AbortController();
    activeControllerRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), 80000);
    try {
      const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");
      const res = await fetch(`${apiUrl}/api/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId.current,
          message,
          destination: destinationRef.current ?? guessDestination(userTextsRef.current),
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? "Something went wrong");
      }
      const data = await res.json();
      if (!isMountedRef.current) return;

      if (data.itinerary && Array.isArray(data.itinerary.days) && data.itinerary.days.length > 0) {
        destinationRef.current = data.itinerary.destination;
        appendMessage({
          role: "assistant",
          text: `Here's your plan for ${data.itinerary.destination} — opening the map now.`,
        });
        onItineraryReady(data.itinerary as Itinerary);
      } else {
        // Model is still asking clarifying questions (e.g. the first message
        // was too vague) — keep the conversation going instead of forcing a plan.
        appendMessage({
          role: "assistant",
          text: data.reply || "Tell me a bit more about what you're looking for.",
        });
      }
    } catch (e: unknown) {
      if (!isMountedRef.current) return;
      const text =
        e instanceof DOMException && e.name === "AbortError"
          ? "This is taking longer than usual — the server might be waking up from sleep. Try again in a moment."
          : e instanceof Error
          ? e.message
          : "Network error — make sure the backend is running";
      appendMessage({ role: "assistant", text, isError: true });
    } finally {
      clearTimeout(timeoutId);
      if (isMountedRef.current) setThinking(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || thinking) return;
    setInput("");
    userTextsRef.current.push(text);
    appendMessage({ role: "user", text });
    runPlanRequest(text);
  }

  function handleRetry() {
    if (!lastMessageRef.current || thinking) return;
    runPlanRequest(lastMessageRef.current);
  }

  return (
    <main id="main-content" className="flex flex-col min-h-dvh bg-background">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-border bg-surface/90 backdrop-blur-lg">
        <button
          onClick={onBack}
          className="shrink-0 -mx-1 rounded-lg px-1 py-0.5 text-sm text-muted outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          ← Back
        </button>
        <div className="h-4 w-px shrink-0 bg-border" />
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-accent">Naviro</p>
          <p className="truncate text-sm font-bold leading-tight text-foreground">Plan by chat</p>
        </div>
      </div>

      {/* ── Message list ───────────────────────────────────── */}
      <div
        role="log"
        aria-live="polite"
        aria-label="Conversation with Naviro"
        tabIndex={0}
        className="flex-1 overflow-y-auto px-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring"
      >
        <div className="mx-auto w-full max-w-xl space-y-3">
          {messages.map((m, i) => (
            <MessageBubble
              key={m.id}
              message={m}
              showRetry={Boolean(m.isError) && i === messages.length - 1}
              onRetry={handleRetry}
            />
          ))}
          {thinking && <ThinkingBubble text={THINKING_MESSAGES[progressIdx]} />}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Input bar ──────────────────────────────────────── */}
      <form
        onSubmit={handleSubmit}
        className="shrink-0 border-t border-border bg-surface/90 p-3 backdrop-blur-lg"
      >
        <div className="mx-auto flex max-w-xl gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="5 days in Goa, budget trip, solo, love street food…"
            maxLength={2000}
            disabled={thinking}
            aria-label="Message Naviro"
            className="flex-1 rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-soft disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-focus-ring"
          />
          <Button
            type="submit"
            variant="primary"
            disabled={thinking || !input.trim()}
            className="shrink-0"
          >
            {thinking ? "…" : "Send"}
          </Button>
        </div>
      </form>
    </main>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────
function MessageBubble({
  message,
  showRetry,
  onRetry,
}: {
  message: ChatMessage;
  showRetry: boolean;
  onRetry: () => void;
}) {
  const isUser = message.role === "user";

  if (message.isError) {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-danger-border bg-danger-bg px-4 py-3">
          <p className="text-sm leading-relaxed text-danger">{message.text}</p>
          {showRetry && (
            <button
              onClick={onRetry}
              className="mt-2 rounded text-xs font-semibold text-danger underline underline-offset-2 outline-none transition-colors hover:opacity-80 focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "rounded-2xl rounded-br-md bg-accent text-foreground-strong"
            : "rounded-2xl rounded-bl-md border border-border bg-surface text-foreground"
        }`}
      >
        {message.text}
      </div>
    </div>
  );
}

// ─── Thinking indicator ───────────────────────────────────────────────────────
// A subtle animated placeholder, not a frozen spinner — three dots plus the
// rotating status copy above. The dots stop animating under prefers-reduced-
// motion (motion-reduce:animate-none) but stay visible, and the status text
// carries an aria-label of its own so screen readers get one stable
// announcement instead of hearing it re-announced every 3.5s.
function ThinkingBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-start" role="status" aria-label="Naviro is thinking">
      <div className="flex max-w-[85%] items-center gap-3 rounded-2xl rounded-bl-md border border-border bg-surface px-4 py-3">
        <div className="flex gap-1" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted motion-reduce:animate-none"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </div>
        <span className="text-xs text-muted" aria-hidden="true">
          {text}
        </span>
      </div>
    </div>
  );
}
