"use client";

import React from "react";
import { Warning } from "@/app/components/icons";
import Button from "@/app/components/ui/Button";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: unknown): State {
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred";
    return { hasError: true, message };
  }

  override render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback != null) return this.props.fallback;
      return (
        <main id="main-content" className="min-h-dvh flex flex-col items-center justify-center px-4 text-center bg-background">
          <Warning size={32} className="mb-4 text-warning" aria-hidden="true" />
          <h2 className="font-bold text-xl mb-2 text-foreground">Something went wrong</h2>
          <p className="text-sm mb-6 max-w-sm text-muted">{this.state.message}</p>
          <Button
            variant="primary"
            pill
            onClick={() => this.setState({ hasError: false, message: "" })}
          >
            Try again
          </Button>
        </main>
      );
    }
    return this.props.children;
  }
}
