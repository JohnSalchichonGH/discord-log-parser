// The Configure step (panel2), rendered from the settings store. Each control
// reads its value from `settings` (via getSetting) and writes back with
// setSetting, so the store is the single source of truth — replacing the legacy
// DOM-snapshot in app.js. The control interdependencies (model preset ↔ max
// tokens, the low-activity reveal, real-names ↔ anonymize exclusion, accurate
// tokenizer) live here as plain component logic.
//
// The goal-picker "collapse AI settings" behavior is unchanged: app.js still
// reflects the `goal` signal onto #panel2[data-goal] and styles.css hides the
// `.ai-setting` cards — these cards keep that class.
//
// The user filter (UserFilter.jsx) is rendered inside the Filters card; it reads
// the same store signals the Upload step's files.js helpers populate.

import { Toggle } from '../components/index.js';
import { getSetting, setSetting } from '../settings.js';
import { UserFilter } from './UserFilter.jsx';
import {
  hasAccurate,
  enableAccurate,
  disableAccurate,
} from '../../core/token-config.js';

const Icon = ({ children }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
  >
    {children}
  </svg>
);

// Character-budget label derived from the token count (≈ 4 chars/token).
function charLabel(maxTokens) {
  const t = Math.max(1000, parseInt(maxTokens) || 1375000);
  const c = t * 4;
  return c >= 1e6 ? (c / 1e6).toFixed(1) + 'M' : (c / 1e3).toFixed(0) + 'K';
}

export function Configure() {
  // Subscribe to the store so the form re-renders on any change.
  const maxTokens = getSetting('maxTokens');
  const modelPreset = getSetting('modelPreset');
  const filterLowActivity = getSetting('filterLowActivity');
  const useRealNames = getSetting('useRealNames');
  const redactNames = getSetting('redactNames');

  // Model preset ↔ max tokens: picking a preset sets the token count; "Custom…"
  // leaves it editable (a manual token edit does not flip the preset, matching
  // the legacy behavior).
  const onPreset = (e) => {
    const v = e.currentTarget.value;
    setSetting('modelPreset', v);
    if (v !== 'custom') setSetting('maxTokens', v);
  };

  const onAccurate = (on) => {
    setSetting('useAccurateTokens', on);
    // Start (or cancel) loading the BPE tokenizer early so the counter is ready
    // by preview time.
    if (on) enableAccurate();
    else disableAccurate();
  };

  return (
    <div class="configure-form">
      {/* Token Budget & Model */}
      <div class="panel-card ai-setting">
        <div class="card-title">
          <Icon>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </Icon>
          Token Budget &amp; Model
        </div>
        <div class="cols-2">
          <div class="form-group">
            <label class="form-label" for="modelPreset">
              Model preset
            </label>
            <select id="modelPreset" value={modelPreset} onChange={onPreset}>
              <option value="1375000">Claude (1M+ context)</option>
              <option value="200000">Claude (200K)</option>
              <option value="128000">GPT-4 (128K)</option>
              <option value="1000000">Gemini (1M)</option>
              <option value="2000000">Gemini (2M)</option>
              <option value="custom">Custom…</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="maxTokens">
              Max tokens
            </label>
            <input
              type="number"
              id="maxTokens"
              value={maxTokens}
              min="1000"
              step="1000"
              onInput={(e) => setSetting('maxTokens', e.currentTarget.value)}
            />
            <div class="form-hint">
              ≈ <span id="maxCharsLabel">{charLabel(maxTokens)}</span>{' '}
              characters
            </div>
          </div>
        </div>

        {hasAccurate() && (
          <Toggle
            checked={getSetting('useAccurateTokens')}
            onChange={onAccurate}
            label="Accurate token counting"
            desc="Use a real BPE tokenizer instead of the 1 token ≈ 4 chars estimate"
          />
        )}
      </div>

      {/* Date Range */}
      <div class="panel-card">
        <div class="card-title">
          <Icon>
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </Icon>
          Date Range
        </div>
        <div class="card-desc">
          Restrict output to a specific time period. Leave blank for all dates.
        </div>
        <div class="cols-2">
          <div class="form-group">
            <label class="form-label" for="dateFrom">
              From
            </label>
            <input
              type="date"
              id="dateFrom"
              style="cursor: pointer"
              value={getSetting('dateFrom')}
              onInput={(e) => setSetting('dateFrom', e.currentTarget.value)}
            />
          </div>
          <div class="form-group">
            <label class="form-label" for="dateTo">
              To
            </label>
            <input
              type="date"
              id="dateTo"
              style="cursor: pointer"
              value={getSetting('dateTo')}
              onInput={(e) => setSetting('dateTo', e.currentTarget.value)}
            />
          </div>
        </div>
      </div>

      {/* Filters */}
      <div class="panel-card">
        <div class="card-title">
          <Icon>
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </Icon>
          Filters
        </div>

        <Toggle
          checked={filterLowActivity}
          onChange={(on) => setSetting('filterLowActivity', on)}
          label="Exclude low-activity users"
          desc="Remove users below a message threshold (after trim)"
        />
        {filterLowActivity && (
          <div style="margin: 8px 0 14px 48px">
            <label class="form-label" for="minMessages">
              Minimum messages
            </label>
            <input
              type="number"
              id="minMessages"
              value={getSetting('minMessages')}
              min="1"
              max="9999"
              class="inline-num"
              onInput={(e) => setSetting('minMessages', e.currentTarget.value)}
            />
          </div>
        )}

        <Toggle
          checked={getSetting('filterBots')}
          onChange={(on) => setSetting('filterBots', on)}
          label="Exclude bot messages"
          desc="Remove messages from users you tag as bots"
        />
        <Toggle
          checked={getSetting('filterSystem')}
          onChange={(on) => setSetting('filterSystem', on)}
          label="Exclude system notifications"
          desc="Join/leave/pin/boost messages"
        />
        <Toggle
          checked={getSetting('filterMediaOnly')}
          onChange={(on) => setSetting('filterMediaOnly', on)}
          label="Exclude media-only messages"
          desc="Messages with only images/stickers and no text"
        />

        {/* User filter — populated from the uploaded files (ui/files.js). */}
        <UserFilter />
      </div>

      {/* Keyword Priority */}
      <div class="panel-card ai-setting">
        <div class="card-title">
          <Icon>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </Icon>
          Keyword Priority
        </div>
        <div class="card-desc">
          Messages containing these terms are always kept, even if they'd be
          trimmed for age. One term per line. Supports regex if wrapped in{' '}
          <code>/pattern/</code>.
        </div>
        <textarea
          id="keywordInput"
          placeholder={'deployment\nbug\nmeeting\n/release\\s*v\\d+/'}
          value={getSetting('keywords')}
          onInput={(e) => setSetting('keywords', e.currentTarget.value)}
        />
      </div>

      {/* Privacy & Redaction */}
      <div class="panel-card">
        <div class="card-title">
          <Icon>
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </Icon>
          Privacy &amp; Redaction
        </div>

        <Toggle
          checked={useRealNames}
          disabled={redactNames}
          onChange={(on) => {
            setSetting('useRealNames', on);
            if (on) setSetting('redactNames', false);
          }}
          label="Use real usernames"
          desc="Show actual names instead of U1, U2, U3…"
        />
        <Toggle
          checked={redactNames}
          disabled={useRealNames}
          onChange={(on) => {
            setSetting('redactNames', on);
            if (on) setSetting('useRealNames', false);
          }}
          label="Anonymize header"
          desc="Remove real usernames from the participant legend"
        />
        <Toggle
          checked={getSetting('redactUrls')}
          onChange={(on) => setSetting('redactUrls', on)}
          label="Strip URLs"
          desc="Replace http(s) links with [URL]"
        />
        <Toggle
          checked={getSetting('redactEmails')}
          onChange={(on) => setSetting('redactEmails', on)}
          label="Strip emails & phone numbers"
          desc="Replace with [EMAIL] / [PHONE]"
        />
      </div>

      {/* Custom Preamble */}
      <div class="panel-card ai-setting">
        <div class="card-title">
          <Icon>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </Icon>
          Custom Preamble
        </div>
        <div class="card-desc">
          Prepended to the output file. Useful for LLM system instructions.
        </div>
        <textarea
          id="customPreamble"
          placeholder="You are analyzing a Discord server about game development. Focus on technical discussions and decisions made by the team."
          value={getSetting('preamble')}
          onInput={(e) => setSetting('preamble', e.currentTarget.value)}
        />
      </div>
    </div>
  );
}
