// Composes the Review step's analytics cards into the #review-panels mount hole
// (panel3). The Explore tab bar (ExploreTabs) + the CSS data-explore-tab rules
// pick which one is visible; this just renders them all into the DOM:
//   - Summary / Technical   reactive Preact cards (re-render from the store)
//   - Insights / Calendar / Wrapped   static host skeletons for the imperative
//     chart renderers, driven by ui/analytics-host.js
//
// This composer reads no signals, so it renders once and never re-renders — which
// is what keeps the static host skeletons' renderer output from being wiped. The
// reactive children (Summary/Technical/Transcript) read their own signals and
// re-render independently, so they never touch the static skeletons.

import { Summary } from './Summary.jsx';
import { Technical } from './Technical.jsx';
import { Transcript } from './Transcript.jsx';
import { Insights } from './Insights.jsx';
import { Calendar } from './Calendar.jsx';
import { Wrapped } from './Wrapped.jsx';

export function ReviewPanels() {
  return (
    <>
      <Summary />
      <Transcript />
      <Insights />
      <Wrapped />
      <Calendar />
      <Technical />
    </>
  );
}
