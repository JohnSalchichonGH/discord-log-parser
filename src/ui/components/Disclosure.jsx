// Collapsible section with a real <button aria-expanded> header — the accessible
// replacement for the legacy click-a-div collapsibles (e.g. the user filter and
// the Advanced settings group).

import { useState } from 'preact/hooks';

export function Disclosure({ summary, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div class="disclosure" data-open={open ? 'true' : 'false'}>
      <button
        type="button"
        class="disclosure-head"
        aria-expanded={open ? 'true' : 'false'}
        onClick={() => setOpen(!open)}
      >
        <span class="disclosure-caret" aria-hidden="true" />
        {summary}
      </button>
      {open && <div class="disclosure-body">{children}</div>}
    </div>
  );
}
