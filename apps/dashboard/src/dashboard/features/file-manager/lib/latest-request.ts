export interface LatestRequestGuard {
  next: () => number;
  invalidate: () => void;
  isCurrent: (requestId: number) => boolean;
}

export function createLatestRequestGuard(): LatestRequestGuard {
  let currentRequestId = 0;

  return {
    next: () => {
      currentRequestId += 1;
      return currentRequestId;
    },
    invalidate: () => {
      currentRequestId += 1;
    },
    isCurrent: (requestId) => requestId === currentRequestId,
  };
}
