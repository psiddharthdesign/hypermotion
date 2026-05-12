// SPDX-License-Identifier: Apache-2.0

import { Component, type ReactNode } from 'react'

/**
 * Top-level error boundary. Without this, any thrown error during
 * render (a stale doc field, a guard I forgot to add, anything React
 * can't recover from) crashes the entire React tree to a blank page.
 *
 * The boundary captures the error and shows it in plain text so we
 * can see what went wrong rather than guessing from a white screen.
 */
interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: unknown): void {
    // Surface in the console too — easier to copy out of devtools
    // than the on-screen pre.
    // eslint-disable-next-line no-console
    console.error('App error boundary caught:', error, info)
  }

  reset = () => this.setState({ error: null })

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex h-full w-full flex-col gap-3 overflow-auto bg-app-bg p-6 text-text">
          <div className="text-[14px] font-semibold">Something broke during render</div>
          <pre className="overflow-auto rounded border border-border bg-panel p-3 font-mono text-[11px] text-text-muted whitespace-pre-wrap">
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
          <button
            type="button"
            onClick={this.reset}
            className="self-start rounded border border-border bg-panel px-3 py-1.5 text-[11px] hover:border-border-strong"
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}