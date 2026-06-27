// Time parsing & formatting.
// Extracted verbatim from the legacy index.html (no behavior change) so the
// test suite can pin current behavior before Phase 1 hardening (snowflake-based
// timestamps, locale-independent parsing) changes it.

export const ABSOLUTE_TIME_THRESHOLD = 60 * 60 * 1000; // 60 min
export const SESSION_BREAK_THRESHOLD = 4 * 60 * 60 * 1000; // 4 hours

// Parse a timestamp string. First tries the native Date parser (covers the
// locale-dependent HTML "f" title format on a best-effort basis), then falls
// back to the en-US "M/D/YYYY H:MM AM/PM" shape used by DCE's TXT export.
// Returns a Date, or null if unparseable.
export function parseTimestamp(tsString) {
  let d = new Date(tsString);
  if (!isNaN(d)) return d;
  const m = tsString.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP]M)$/i,
  );
  if (m) {
    let hours = parseInt(m[4], 10);
    const mins = parseInt(m[5], 10);
    const ampm = m[6].toUpperCase();
    if (ampm === 'AM' && hours === 12) hours = 0;
    if (ampm === 'PM' && hours !== 12) hours += 12;
    d = new Date(
      parseInt(m[3]),
      parseInt(m[1]) - 1,
      parseInt(m[2]),
      hours,
      mins,
      0,
      0,
    );
    return isNaN(d) ? null : d;
  }
  return null;
}

// Create a Date in local time from a "YYYY-MM-DD" string.
// If endOfDay is true, set to 23:59:59.999.
export function localDate(ymd, endOfDay) {
  const [y, m, d] = ymd.split('-').map(Number);
  if (endOfDay) return new Date(y, m - 1, d, 23, 59, 59, 999);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

export function formatTimeDelta(diffMs) {
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `[+${s}s]`;
  if (s < 3600) return `[+${Math.floor(s / 60)}m]`;
  return `[+${Math.floor(s / 3600)}h]`;
}

export function formatLongDuration(diffMs) {
  const s = Math.floor(diffMs / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function formatAMPM(date) {
  let h = date.getHours();
  const m = date.getMinutes();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m < 10 ? '0' + m : m} ${ap}`;
}
