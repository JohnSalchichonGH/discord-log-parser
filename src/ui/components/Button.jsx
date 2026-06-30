// Native <button> wrapper over the existing .btn styles. Always a real button
// (keyboard- and screen-reader-operable), unlike the legacy clickable <div>s.

export function Button({
  variant = 'secondary',
  type = 'button',
  class: cls = '',
  children,
  ...rest
}) {
  return (
    <button type={type} class={`btn btn-${variant} ${cls}`.trim()} {...rest}>
      {children}
    </button>
  );
}
