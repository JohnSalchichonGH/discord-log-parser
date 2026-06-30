// Surface container over the existing .panel-card / .card-title / .card-desc
// styles. `title`/`desc`/`icon` are optional; children are the body.

export function Card({
  title,
  desc,
  icon,
  class: cls = '',
  children,
  ...rest
}) {
  return (
    <section class={`panel-card ${cls}`.trim()} {...rest}>
      {title != null && (
        <div class="card-title">
          {icon}
          {title}
        </div>
      )}
      {desc != null && <div class="card-desc">{desc}</div>}
      {children}
    </section>
  );
}
