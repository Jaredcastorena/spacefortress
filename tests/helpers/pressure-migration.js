import assert from 'node:assert/strict';
// Expected schema75 readings and explicit synthetic old-schema caches. These
// copies change only derived pressure/air; all physical quantities stay exact.
function withReadings(state, temperatureAware) {
  const expected = structuredClone(state);
  for (const site of Object.values(expected.sites)) {
    for (const room of site.rooms) {
      const amount = room.gas.oxygen + room.gas.inert + room.gas.co2;
      const factor = temperatureAware ? (room.heat / (room.volume * 20)) / 293.15 : 1;
      const oxygenPressure = room.gas.oxygen / (room.volume * 10) * factor;
      const co2Fraction = amount ? room.gas.co2 / amount : 0;
      room.pressure = amount / (room.volume * 10) * 100 * factor;
      room.air = Math.max(0, Math.min(100, room.pressure, oxygenPressure / .21 * 100, (1 - co2Fraction / .04) * 100));
      if ((room.smoke || 0) / room.volume >= .04 || room.pressure > 150 || oxygenPressure > .3) room.air = 0;
    }
    const volume = site.rooms.reduce((n, room) => n + room.volume, 0);
    site.air = volume ? Math.round(site.rooms.reduce((n, room) => n + room.air * room.volume, 0) / volume) : 0;
  }
  return expected;
}

export const withTemperaturePressureReadings = state => withReadings(state, true);
export const withLegacyDensityReadings = state => withReadings(state, false);

// Gas-energy migration recomputes structural heat and temperature-derived
// readings. Normalize only machine roundoff; every other physical field still
// participates in the caller's exact comparison against the original fixture.
export function withThermalRoundoff(actual,expected){
 const copy=structuredClone(actual);
 for(const [id,site] of Object.entries(copy.sites))for(let i=0;i<site.rooms.length;i++)for(const field of ['heat','pressure','air']){
  const before=expected.sites[id].rooms[i][field],value=site.rooms[i][field];
  if(before===undefined&&value===undefined)continue;
  assert.ok(Number.isFinite(before)&&Number.isFinite(value)&&Math.abs(value-before)<=8*Number.EPSILON*Math.max(1,Math.abs(before)),`migration ${id} room${i} ${field} changed beyond roundoff`);
  site.rooms[i][field]=before;
 }
 return copy;
}
