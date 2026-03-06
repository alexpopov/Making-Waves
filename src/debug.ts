/**
 * Debug logging gated behind a runtime flag.
 *
 * Toggle from the browser console:
 *   DEBUG()      — enable
 *   DEBUG(false) — disable
 */

let enabled = false;

export function debug(...args: unknown[]): void {
  if (enabled) console.log('[making-waves]', ...args);
}

export function setDebug(on: boolean): void {
  enabled = on;
}

// Expose toggle on window for quick console access
(window as unknown as Record<string, unknown>).DEBUG = (on = true) => {
  setDebug(on);
  console.log(`[making-waves] Debug ${on ? 'ON' : 'OFF'}`);
};
