import { useSyncExternalStore } from "react";

/**
 * A shared 30-second clock for expiry countdowns. Implemented as an external
 * store so render stays pure (no Date.now() during render) and every
 * countdown on the page ticks together.
 */
const BUCKET_MS = 30_000;
const POLL_MS = 5_000;

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let last = 0;

function snapshot(): number {
  return Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    last = snapshot();
    timer = setInterval(() => {
      const next = snapshot();
      if (next !== last) {
        last = next;
        for (const l of listeners) l();
      }
    }, POLL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
