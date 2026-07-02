import { describe, it, expect } from 'vitest';
import { buildNetwork } from '../src/ui/insights.js';

// A small conversation exercising the reply-network edge weighting:
//   - Ecks <-> Eff: an exclusive two-way pair (each replies only to the other)
//   - Bee  <-> Cee: a strong two-way bond, but each also replies to Popular
//   - Popular: high raw reply volume, spread thin across everyone
//   - Fan -> Popular: one-way (Popular never replies back)
//   - Bee -> Eff: a 2-reply blip that must fall below the noise floor (>= 3)
const stats = {
  users: [
    { id: 'U1', name: 'Popular', count: 100 },
    { id: 'U2', name: 'Bee', count: 50 },
    { id: 'U3', name: 'Cee', count: 50 },
    { id: 'U4', name: 'Fan', count: 30 },
    { id: 'U5', name: 'Ecks', count: 40 },
    { id: 'U6', name: 'Eff', count: 40 },
  ],
  replyEdges: [
    { from: 'U1', to: 'U2', count: 5 },
    { from: 'U1', to: 'U3', count: 5 },
    { from: 'U1', to: 'U5', count: 5 },
    { from: 'U1', to: 'U6', count: 5 },
    { from: 'U2', to: 'U3', count: 20 },
    { from: 'U3', to: 'U2', count: 18 },
    { from: 'U2', to: 'U1', count: 4 },
    { from: 'U3', to: 'U1', count: 4 },
    { from: 'U4', to: 'U1', count: 10 },
    { from: 'U5', to: 'U6', count: 6 },
    { from: 'U6', to: 'U5', count: 6 },
    { from: 'U2', to: 'U6', count: 2 }, // below the >= 3 floor
  ],
};

describe('buildNetwork — reciprocal reply-affinity weighting', () => {
  const net = buildNetwork(stats);
  const pair = (x, y) =>
    net.edges.find((e) => (e.a === x && e.b === y) || (e.a === y && e.b === x));

  it('rewards an exclusive two-way pair over a high-volume hub', () => {
    // Ecks<->Eff reply only to each other → max affinity (normalized weight 1)…
    expect(pair('U5', 'U6').w).toBeCloseTo(1, 5);
    // …and it outweighs Popular's busiest edge, despite Popular's higher volume.
    expect(pair('U5', 'U6').w).toBeGreaterThan(pair('U1', 'U2').w);
    // A strong two-way bond also beats the volume-driven hub edge.
    expect(pair('U2', 'U3').w).toBeGreaterThan(pair('U1', 'U2').w);
  });

  it('floors one-way ("fan") edges to zero weight but still shows them', () => {
    expect(pair('U4', 'U1')).toBeTruthy(); // drawn (faint)…
    expect(pair('U4', 'U1').w).toBe(0); // …but exerts no pull
  });

  it('drops pairs below the noise floor (< 3 replies)', () => {
    expect(pair('U2', 'U6')).toBeUndefined(); // the 2-reply blip
  });

  it('collapses directional edges into undirected pairs with a raw total', () => {
    const bc = pair('U2', 'U3');
    expect(bc.raw).toBe(38); // 20 + 18
    expect(bc.ab + bc.ba).toBe(38);
  });
});
