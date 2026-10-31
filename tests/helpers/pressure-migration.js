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
