// SPDX-License-Identifier: Apache-2.0

let activeExport: Promise<void> | null = null

/** Join rapid duplicate starts to the current export instead of opening a
 * second worker and replacing the first worker's progress with an error. */
export function runExportSingleFlight(
  start: () => Promise<void>,
): Promise<void> {
  if (activeExport) return activeExport

  let run: Promise<void>
  try {
    run = start()
  } catch (error) {
    run = Promise.reject(error)
  }
  const tracked = run.finally(() => {
    if (activeExport === tracked) activeExport = null
  })
  activeExport = tracked
  return tracked
}

export function isExportSingleFlightActive(): boolean {
  return activeExport !== null
}
