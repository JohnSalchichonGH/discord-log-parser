// Accessible tablist. `tabs` is [{ id, label }]; controlled via `active` +
// `onSelect`. Roving tabindex + arrow-key navigation follow the WAI-ARIA tabs
// pattern. Render the matching panel yourself with role="tabpanel".

export function Tabs({ tabs, active, onSelect, class: cls = '' }) {
  const onKeyDown = (e) => {
    const i = tabs.findIndex((t) => t.id === active);
    let next = null;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next != null) {
      e.preventDefault();
      onSelect(tabs[next].id);
    }
  };
  return (
    <div class={`tabs ${cls}`.trim()} role="tablist" onKeyDown={onKeyDown}>
      {tabs.map((t) => (
        <button
          key={t.id}
          id={`tab-${t.id}`}
          type="button"
          role="tab"
          aria-selected={active === t.id ? 'true' : 'false'}
          aria-controls={`panel-${t.id}`}
          tabindex={active === t.id ? 0 : -1}
          class="tab"
          data-active={active === t.id ? 'true' : 'false'}
          onClick={() => onSelect(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
