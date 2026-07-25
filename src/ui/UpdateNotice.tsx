// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react'

interface AppUpdateInfo {
  currentVersion: string
  latestVersion: string
  releaseName: string
  releaseUrl: string
  publishedAt: string | null
}

const DISMISS_KEY_PREFIX = 'hypermotion:update-dismissed:'

export function UpdateNotice() {
  const [update, setUpdate] = useState<AppUpdateInfo | null>(null)

  useEffect(() => {
    const bridge = window.hypermotion
    if (!bridge || !bridge.on) return

    let mounted = true
    const applyUpdate = (next: unknown) => {
      const info = asUpdateInfo(next)
      if (!mounted || !info) return
      const dismissed = window.localStorage.getItem(
        `${DISMISS_KEY_PREFIX}${info.latestVersion}`,
      )
      if (!dismissed) setUpdate(info)
    }

    // An update check that fails is not worth interrupting the user
    // for, but it must not vanish either — a permanently silent check
    // is indistinguishable from "you are on the latest version".
    const logCheckFailure = (err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn('[updates] check failed:', err)
    }
    bridge.invoke('updates:get-status').then(applyUpdate).catch(logCheckFailure)
    bridge.invoke('updates:check').then(applyUpdate).catch(logCheckFailure)
    const off = bridge.on('updates:available', applyUpdate)

    return () => {
      mounted = false
      off()
    }
  }, [])

  if (!update) return null

  const dismiss = () => {
    window.localStorage.setItem(
      `${DISMISS_KEY_PREFIX}${update.latestVersion}`,
      String(Date.now()),
    )
    setUpdate(null)
  }

  const openRelease = () => {
    window.open(update.releaseUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="fixed top-14 right-4 z-[2000] w-[320px] overflow-hidden rounded-md border border-border-strong bg-panel-raised shadow-2xl">
      <div className="border-b border-border px-3 py-2">
        <div className="text-[12px] font-semibold text-text">
          Update available
        </div>
        <div className="mt-0.5 text-[11px] leading-snug text-text-muted">
          Hyper Motion {update.latestVersion} is ready. You are on{' '}
          {update.currentVersion}.
        </div>
      </div>
      <div className="flex items-center justify-end gap-1.5 px-3 py-2">
        <button
          type="button"
          onClick={dismiss}
          className="rounded px-2 py-1 text-[11px] text-text-muted hover:bg-panel hover:text-text"
        >
          Later
        </button>
        <button
          type="button"
          onClick={openRelease}
          className="rounded bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:brightness-110"
        >
          Download
        </button>
      </div>
    </div>
  )
}

function asUpdateInfo(value: unknown): AppUpdateInfo | null {
  if (!value || typeof value !== 'object') return null
  const info = value as Partial<AppUpdateInfo>
  if (
    typeof info.currentVersion !== 'string' ||
    typeof info.latestVersion !== 'string' ||
    typeof info.releaseUrl !== 'string'
  ) {
    return null
  }
  return {
    currentVersion: info.currentVersion,
    latestVersion: info.latestVersion,
    releaseName:
      typeof info.releaseName === 'string'
        ? info.releaseName
        : `v${info.latestVersion}`,
    releaseUrl: info.releaseUrl,
    publishedAt:
      typeof info.publishedAt === 'string' ? info.publishedAt : null,
  }
}
