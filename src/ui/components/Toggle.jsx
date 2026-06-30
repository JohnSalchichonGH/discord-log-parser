// Accessible switch. The legacy .toggle-row hides its checkbox with
// `display:none`, which drops it from the focus order. This uses a real
// <button role="switch"> — natively focusable and operable with Space/Enter —
// reusing the .toggle-switch visual via a data-on attribute for the checked
// state.

export function Toggle({
  checked = false,
  onChange,
  label,
  desc,
  disabled = false,
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked ? 'true' : 'false'}
      class="switch-row"
      disabled={disabled}
      onClick={() => onChange && onChange(!checked)}
    >
      <span class="toggle-switch" data-on={checked ? 'true' : 'false'} />
      <span class="switch-text">
        <span class="toggle-label">{label}</span>
        {desc != null && <span class="toggle-desc">{desc}</span>}
      </span>
    </button>
  );
}
