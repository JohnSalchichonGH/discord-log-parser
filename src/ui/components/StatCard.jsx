// A single headline metric over the existing .stat-card styles. `accent` tints
// the value (e.g. a participant color).

export function StatCard({ value, label, accent }) {
  return (
    <div class="stat-card">
      <div class="stat-value" style={accent ? `color:${accent}` : undefined}>
        {value}
      </div>
      <div class="stat-label">{label}</div>
    </div>
  );
}
