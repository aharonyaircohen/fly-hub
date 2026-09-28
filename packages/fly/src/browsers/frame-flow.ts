export interface LatestFrameBuffer<T> {
  push(frame: T): T | null;
  acknowledge(): T | null;
}

/**
 * Keeps a slow remote viewer at most one frame behind the browser.
 * Intermediate frames are replaceable visual state, so retaining only the
 * newest frame avoids latency and memory growth without affecting controls.
 */
export function createLatestFrameBuffer<T>(): LatestFrameBuffer<T> {
  let awaitingAcknowledgement = false;
  let pending: T | null = null;

  return {
    push(frame) {
      if (awaitingAcknowledgement) {
        pending = frame;
        return null;
      }
      awaitingAcknowledgement = true;
      return frame;
    },
    acknowledge() {
      if (pending !== null) {
        const next = pending;
        pending = null;
        return next;
      }
      awaitingAcknowledgement = false;
      return null;
    },
  };
}
