// Tab bar for the Review step. Switches which existing analytics card is shown
// (app.js reflects `exploreTab` onto panel3[data-explore-tab]; CSS reveals just
// the matching card). The cards themselves are still rendered by the legacy
// renderers — this only organizes them.

import { Tabs } from '../components/Tabs.jsx';
import { exploreTab } from '../store.js';

const TABS = [
  { id: 'summary', label: 'Summary' },
  { id: 'transcript', label: 'Transcript' },
  { id: 'insights', label: 'Insights' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'wrapped', label: 'Wrapped' },
  { id: 'technical', label: 'Technical' },
];

export function ExploreTabs() {
  return (
    <Tabs
      tabs={TABS}
      active={exploreTab.value}
      onSelect={(id) => (exploreTab.value = id)}
    />
  );
}
