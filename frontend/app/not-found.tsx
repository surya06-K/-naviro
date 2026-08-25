import Link from "next/link";
import { MapPin } from "@/app/components/icons";

// Standard App Router 404 convention — renders whenever `notFound()` is
// thrown in a route segment, and (per Next's docs) also catches any
// otherwise-unmatched URL for the whole app since this file lives at the
// app root. Server Component: no interactivity beyond a plain link, so no
// "use client" needed.
export default function NotFound() {
  return (
    <main
      id="main-content"
      className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background px-6 text-center"
    >
      <div className="flex size-14 items-center justify-center rounded-2xl border border-border bg-surface text-accent">
        <MapPin size={26} aria-hidden="true" />
      </div>

      <div className="flex flex-col gap-2">
        <h1 className="text-h1 font-semibold text-foreground">
          This page doesn&apos;t exist
        </h1>
        <p className="max-w-sm text-body text-muted">
          Couldn&apos;t find that page. It may have moved, or the link was
          off.
        </p>
      </div>

      <Link
        href="/"
        className="mt-2 inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-6 py-2.5 text-body font-semibold text-foreground-strong transition-[background-color,transform] duration-200 hover:bg-accent-light active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Back to planning
      </Link>
    </main>
  );
}
