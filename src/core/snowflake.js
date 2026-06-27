// Discord snowflake helpers.
//
// A Discord snowflake encodes its creation time in the high bits: the first 42
// bits are milliseconds since the Discord epoch (2015-01-01T00:00:00Z). This
// lets us recover an exact UTC instant for a message WITHOUT parsing the
// locale-dependent date text DCE renders (fixes bugs A1/A8 for HTML exports,
// where every message container carries a clean `data-message-id`).

export const DISCORD_EPOCH = 1420070400000;

// True for strings that look like a real Discord snowflake (17–20 digits).
// The lower bound avoids mis-decoding tiny synthetic ids.
export function isSnowflake(value) {
  return typeof value === 'string' && /^\d{15,20}$/.test(value);
}

// Convert a snowflake to its creation Date (UTC), or null if not a snowflake.
export function snowflakeToDate(value) {
  if (!isSnowflake(value)) return null;
  const ms = Number(BigInt(value) >> 22n) + DISCORD_EPOCH;
  const d = new Date(ms);
  return isNaN(d.getTime()) ? null : d;
}

// Inverse, for building realistic test fixtures: the smallest snowflake created
// at the given instant (millisecond precision; low 22 bits zeroed).
export function dateToSnowflake(date) {
  const ms = date instanceof Date ? date.getTime() : new Date(date).getTime();
  return ((BigInt(ms) - BigInt(DISCORD_EPOCH)) << 22n).toString();
}
