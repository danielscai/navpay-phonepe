type DateParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function partsInTz(ms: number, timeZone: string): DateParts {
  const d = new Date(ms);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

// Returns (tzTimeAsUtcMs - actualUtcMs) for a given instant.
function tzOffsetMs(ms: number, timeZone: string): number {
  const p = partsInTz(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - ms;
}

export function dayRangeMsInTz(opts: { nowMs: number; timeZone: string }): { startMs: number; endMs: number } {
  // Compute "today" in the requested timezone, then return UTC ms range covering that local day.
  const p = partsInTz(opts.nowMs, opts.timeZone);
  // Start-of-day local time (00:00:00).
  const startGuessUtc = Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0);
  const startOffset = tzOffsetMs(startGuessUtc, opts.timeZone);
  const startMs = startGuessUtc - startOffset;

  // Next day start.
  const endGuessUtc = Date.UTC(p.year, p.month - 1, p.day + 1, 0, 0, 0);
  const endOffset = tzOffsetMs(endGuessUtc, opts.timeZone);
  const endMs = endGuessUtc - endOffset;

  return { startMs, endMs };
}

