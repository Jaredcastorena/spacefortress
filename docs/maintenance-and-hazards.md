# Equipment maintenance and surface debris

Implemented locally on September 16, 2026. These are initial interacting systems; balance values are provisional.

## Operating wear

Electrical equipment owns a maintenance record: accumulated operating seconds, last completed service time, and an optional automatic-service policy. Powered consumers count one operating second per tick, including time waiting for inputs. Pausing a machine stops its demand and wear. Solar arrays count sunlit operation. Banks count only ticks with an actual charge or discharge transfer; a full idle bank does not wear from the clock alone. UI refreshes never advance wear.

The first service interval is **1,200 operating seconds**. Equipment gives a due-service message at that point. Each additional 30 operating seconds removes one condition point. Damage reduces generation and battery rates, weakens life-support performance, and eventually stops equipment at zero condition. Production buffers and stored battery energy survive faults. Stopped/broken equipment accrues no further operating wear.

These counts describe use, not calendar age or a physical fatigue model. Cables currently have impact damage but no operating wear. Passive structures do not receive routine maintenance timers.

## Engineers and supplies

Inspect equipment to request **Service equipment** or enable **Automatic service**. Both service and ordinary structure repairs require one alloy, reserved and delivered through the existing construction logistics before engineering work begins. Finishing restores condition to 100 and resets the operating counter. Repairing a broken machine also resets its service record. No energy, process inputs or finished products are created by servicing.

Automatic service defaults off. It creates a service job when the interval expires, or a repair job when condition is 50 or lower. Existing work on the tile prevents duplicate orders. Life support and equipment at 50 condition or below receive urgent work priority. Other service jobs use normal priority. Missing supplies or unreachable work positions are reported; engineering labor permissions and crew recovery still apply.

Cancelling an automatically generated maintenance order turns off that equipment's automatic policy and returns supplies through normal cancellation handling. Turning off the policy directly prevents future jobs but leaves an existing order available to finish or cancel. Equipment may keep operating while supplies are delivered and work is performed; lockout procedures and tools are future work.

## Forecast debris

The initial surface debris interval is **1,200 seconds**. Ninety seconds before impact, a deterministic forecast selects a tile containing exposed wiring, an exterior array or a hull wall. The threatened tile receives an on-map marker and a countdown. The Colony drawer links to it so the player can inspect equipment and prepare alloy, engineers and redundant circuits.

An impact removes 35 condition from a structure and 60 from any cable at that coordinate. Damage is bounded at zero. If equipment was dismantled before impact, missing assets take no damage. Wiring beneath an impacted wall can also be damaged. A weakened cable can break entirely; an impacted wall leaks according to the existing atmosphere model. The next pass is scheduled 1,200 seconds later.

This is a stylized event, with an exact forecast tile and fixed damage. Terrain shielding, impact trajectories, armor, weather instruments, debris interception and damage to people/items are not simulated here. Orbital site hazards still use their earlier mission logic.

## Diagnostics and continuity

The hidden inspector shows service usage, automatic policy, blocked supply requests and the tile's last recorded damage. The Colony drawer lists up to six assets needing attention and the current forecast. Each site retains its last twelve damage records. Wear messages are limited to service due and condition thresholds (75, 50 and zero); impact damage is logged directly.

`src/maintenance.js` owns service policies, operating wear, damage history and forecasts. Power allocation returns the equipment that actually operated; wear is applied after that tick's power use and production. Service jobs use `engineering` labor and existing delivery, interruption and cancellation logic. Rendering and inspector helpers remain separate.

Current save schema **16** migrates versions 1–15; schema 7 introduced reliability state. A schema-6 colony receives fresh service counters and its first forecast 1,200 seconds after the saved tick; no supplies, energy or condition are granted. Current saves preserve wear, outstanding supply trips, damage records and the forecast target. Invalid timers, history and service state are rejected while existing failed-load protection remains intact.

## Evidence and remaining work

**252 tests pass**, including 13 maintenance/hazard cases: active-use counting, pause/full-bank behavior, overdue wear, breakage with batch preservation, delivered service supplies, optional automatic jobs, engineering permissions, missing resources, interruption/cancellation, bank repair without energy creation, forecast timing, cable outage/atmosphere recovery, hull leak repair, deterministic saves, schema-6 migration and malformed-state rejection.

JavaScript syntax checks and documentation links pass. The available UI automation inventory reported no browser surfaces, so the maintenance controls and forecast rendering still need visual/interaction verification. The preview remains stopped. This limitation also applies to the accumulated crew, production, construction, atmosphere and power UI changes.

Future depth includes machinery-specific parts and service procedures, maintenance tools, automatic cable/hull work, condition-sensitive production rates, heat, overloads and breakers, repair quality, imperfect forecasts, protective construction and broader mission hazards. The complete conversion inventory remains in scope.
