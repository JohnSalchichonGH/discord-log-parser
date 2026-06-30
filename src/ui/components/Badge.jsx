// Small status pill over the existing .badge styles (variants: base, dated, …).

export function Badge({ variant = 'base', class: cls = '', children }) {
  return <span class={`badge badge-${variant} ${cls}`.trim()}>{children}</span>;
}
