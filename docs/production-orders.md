# Staffed production and work orders

Implemented in `src/production.js`, with hauling in `src/industry.js` and crew assignment in `src/simulation.js`.

## Staffing

Refineries, farms, fabricators, atmosphere processors and medical synthesizers now require a crew member assigned to **Production**. Life support remains an automatic continuous service.

An operation is scheduled when a machine has ingredients (or an unfinished batch), output space, power and its required atmosphere. The operator walks to an adjacent work position before starting. Inputs move into the machine's batch only when actual work begins. Skill, morale, health and energy affect the work rate, and operators gain experience while processing. Recipe durations are work units, rather than a promise of the same elapsed time regardless of staffing.

The Botanist and Technician founders begin with level 3 Production, the Engineer with level 2, and other founders at level 0. All have the duty enabled initially. Existing work routines, medical needs, meals, rest and air recovery take precedence. A replacement operator continues the same batch and fractional progress. Workers are released when power, atmosphere, input/output conditions, a pause or other work prevents production.

Repairs, engineering service and dismantling can interrupt an occupied workstation. Automatic maintenance can also schedule service while an operation exists. The unfinished raw batch remains in the machine; removing the machine spills it through the existing inventory system.

## Work orders

Every staffed machine has an order, initially **Continuous / Low priority**:

- **Continuous:** repeat while supplied and staffed.
- **Fixed batches:** complete the requested number of batches, then stop. The number includes an already active batch when the order changes.
- **Stock target:** produce until this site's available product plus promised batch output reaches the target. Consumption or new reservations can restart production.

Counts and targets accept whole numbers from 0 to 1000. Changing an order preserves a started batch, which finishes even if the new target is already met or the new batch count is zero. Use **Pause production** to stop work immediately. Cancelling an operation through the job API also pauses the machine. Neither action deletes its ingredients or progress.

Production priorities use the existing Low/Normal/Urgent assignment system. Changing priority preserves remaining batch counts and applies to the current operation and future batches. Priority affects the next free worker; it does not forcibly interrupt another active job.

Machines request up to two input batches, reduced to what a finite order still needs. Already delivered or carried ingredients remain physical supplies when the order changes. Output remains in the machine until hauled away. Stock targets can exceed the 12-unit output buffer, so hauling is still necessary.

## Stock accounting

Targets count site depots, loose piles, machine output and cargo travelling to storage. They also count output promised by unfinished batches and queued operations, so two machines do not both start an unnecessary batch for the same target. The current machine's pending operation is excluded when checking whether that operation itself is still needed.

Inputs committed inside machines, reserved construction costs, job shipments and shuttle cargo/service stores are excluded from available stock. A target concerns usable product, not the total mass of that material in every future purpose. Output granularity can exceed a target by less than one batch; already started batches finish even if another source delivers enough stock meanwhile. Queued operations retain their promised output while waiting for staff.

## Controls and persistence

Select the workstation to open its existing inspector. It shows operator, status, inputs, batch, fractional work, output, completed count, order mode/amount, priority and pause/resume. The editor keeps its values and focus during UI refresh. Submitting applies the order; switching selection replaces the old editor. No new always-visible panel was added.

Schema **16** supports versions 1–15. Version-12 migration adds enabled Production duties, founder skill defaults, continuous orders and zero completion counters. It preserves existing ingredients, output, progress, health and work. Current saves retain work orders, assigned operators, fractional progress and batch counts. Operation jobs own no extra supplies: the machine already owns its input/batch/output. Validation checks order values, completion counters, unique machine assignments and agreement between operation work and machine progress.

## Evidence and limits

**252 tests pass**, including 16 staffing/order tests. They cover local operators and permissions, skill/training, interrupted work and replacement, exact finite batches, bounded deliveries, stock replenishment, shared targets, committed/transit inventory, revised orders, pause/cancel, engineering interruption, priorities, automatic life support, deterministic saves, migration and malformed state. Existing tests were updated where they assumed fixed-time automatic processing, zero background jobs or an idle crew member immediately after recovery; their recovery, material and interruption checks remain.

An isolated headless Firefox check verified the production inspector, an edit surviving periodic refresh, fixed/stock orders, priorities, pause/resume, saved values and the Production duty toggle. Screenshots were inspected and the scoped browser log had no runtime errors. The temporary server/browser were stopped; artifacts are in ignored `.runtime-qa/production-*`.

Hydroponics and medical synthesis now have temperature limits that preserve interrupted batches; see [temperature and climate](temperature-and-climate.md). This remains one recipe per machine. Recipe queues, tools, quality, waste/byproducts, specialized industrial occupations and richer farming remain unfinished. Enabled idle machines still draw their rated power and accrue the existing powered-operation wear; explicit pause releases that load. Depot capacity, filters and hauling priorities now constrain output collection; see [depot storage](depot-storage.md). The wider conversion inventory is still active.
