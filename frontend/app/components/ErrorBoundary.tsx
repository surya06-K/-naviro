"use client";

import React from "react";

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
        <div className="min-h-screen flex flex-col items-center justify-center px-4 text-center" style={{ background: "#0d1117" }}>
          <p className="text-3xl mb-4">⚠️</p>
          <h2 className="font-bold text-xl mb-2" style={{ color: "#e6edf3" }}>Something went wrong</h2>
          <p className="text-sm mb-6 max-w-sm" style={{ color: "#8b949e" }}>{this.state.message}</p>
          <button
            onClick={() => this.setState({ hasError: false, message: "" })}
            className="px-6 py-3 text-white rounded-2xl font-semibold text-sm transition-colors"
            style={{ background: "#397091" }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
