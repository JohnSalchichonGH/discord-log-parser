// Mounts the Preact-rendered parts of the shell. Grows as views migrate off the
// legacy app.js controller; for now it owns the header (+ theme toggle).

import { render } from 'preact';
import { Header } from './views/Header.jsx';
import { ParseSummary } from './views/ParseSummary.jsx';

const headerHost = document.getElementById('app-header');
if (headerHost) render(<Header />, headerHost);

const summaryHost = document.getElementById('parse-summary');
if (summaryHost) render(<ParseSummary />, summaryHost);
