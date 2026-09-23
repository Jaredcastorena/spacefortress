import assert from 'node:assert/strict';
import { launch, step } from '../../src/simulation.js';
// Tests about flight/field work start only after real loading and boarding finish.
export function depart(s, site) {
  const result = launch(s, site);
  if (result.ok) {
    for (let i = 0; i < 400 && !s.mission; i++) step(s);
    assert.ok(s.mission, `Departure did not complete: ${s.departure?.status}`);
  }
  return result;
}
