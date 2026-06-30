// App header + theme toggle, the first piece of the shell rendered by Preact.
// Reframes the product (merge/clean/export/explore, not just "LLM text") and
// surfaces the local-only privacy promise that previously lived only in docs.
// Theme is owned by the store.

import { theme, toggleTheme } from '../store.js';

function ThemeIcon({ dark }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      {dark ? (
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      ) : (
        <>
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </>
      )}
    </svg>
  );
}

export function Header() {
  const dark = theme.value === 'dark';
  return (
    <>
      <button
        class="theme-toggle"
        type="button"
        title="Toggle theme"
        aria-label="Toggle light or dark theme"
        onClick={toggleTheme}
      >
        <ThemeIcon dark={dark} />
      </button>

      <header class="app-header">
        <div class="app-logo">
          <svg
            width="36"
            height="36"
            viewBox="0 0 36 36"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect width="36" height="36" rx="10" fill="url(#logoGrad)" />
            <path
              d="M11 14.5C11 14.5 13.5 12 18 12C22.5 12 25 14.5 25 14.5"
              stroke="white"
              stroke-width="2"
              stroke-linecap="round"
            />
            <circle cx="14" cy="18" r="2" fill="white" />
            <circle cx="22" cy="18" r="2" fill="white" />
            <path
              d="M13 22.5C13 22.5 15 24 18 24C21 24 23 22.5 23 22.5"
              stroke="white"
              stroke-width="2"
              stroke-linecap="round"
            />
            <defs>
              <linearGradient id="logoGrad" x1="0" y1="0" x2="36" y2="36">
                <stop stop-color="#6c9eff" />
                <stop offset="1" stop-color="#a78bfa" />
              </linearGradient>
            </defs>
          </svg>
          <span class="app-title">Discord Log Parser</span>
        </div>
        <div class="app-subtitle">
          Merge, clean, export, and explore Discord conversations.
        </div>
        <div
          class="privacy-badge"
          title="The built app makes zero network requests — your files never leave this browser."
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          Runs locally · No uploads · No network
        </div>
      </header>
    </>
  );
}
