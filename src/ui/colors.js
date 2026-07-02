// Per-user colors, shared so a person shows the SAME color everywhere they
// appear (the calendar day-view avatars and the reply-network nodes). Chosen
// deterministically from the stable author id via a simple string hash into a
// fixed, pleasant, theme-independent set.

const AVATAR_COLORS = [
  '#6c9eff',
  '#5ccf7f',
  '#e09a5c',
  '#e06c6c',
  '#a78bfa',
  '#4ec9c9',
  '#e0709a',
  '#c9b34e',
];

export function authorColor(uid) {
  const s = String(uid);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
