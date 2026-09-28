export const LIVE_SCHEDULE_VALUES = [
  "1m",
  "15m",
  "30m",
  "1h",
  "2h",
  "6h",
  "12h",
  "1d",
  "3d",
  "7d",
] as const;

const SCHEDULE_LABELS: Record<(typeof LIVE_SCHEDULE_VALUES)[number], string> = {
  "1m": "Every minute (test)",
  "15m": "Every 15 minutes",
  "30m": "Every 30 minutes",
  "1h": "Every hour",
  "2h": "Every 2 hours",
  "6h": "Every 6 hours",
  "12h": "Every 12 hours",
  "1d": "Every day",
  "3d": "Every 3 days",
  "7d": "Every week",
};

export const LIVE_SCHEDULE_OPTIONS = LIVE_SCHEDULE_VALUES.map((value) => ({
  value,
  label: SCHEDULE_LABELS[value],
}));
