# Public releases — readiness

**Historical v0.1.0 status: published and verified.** Updated 2026-09-23 UTC. The first public source release is at [Jaredcastorena/spacefortress](https://github.com/Jaredcastorena/spacefortress). The checklist below records the v0.1.0 source release and its historical schema 36 checks. Historical and current scoped evidence is in [verification status](verification-status.md).

`Verified` means the stated scoped check has evidence. `Pending` means the release check has not yet been accepted. Historical results do not substitute for current release verification.

## v0.1.4 — air diagnostics and paused import

Updated October 9, 2026. This patch release explains the first failed breathing limit, distinguishes oxygen concentration from oxygen at the room's pressure, and preserves the actual selected speed when importing a save. The warning uses the existing hidden inspector; local-agent observations expose the same derived status. Save schema 46, gas quantities, thresholds and breathing behavior are unchanged.

| Release check | Status | Evidence / remaining work |
| --- | --- | --- |
| Local behavior and integration | Verified — scoped | Core 25 and seven initial panel checks passed. One full local Node run passed **1,282 checks, zero failures and one intentional historical skip**, with 242 held inputs stable (`a4ea5b39`). The later presentation-only change passed seven affected panel checks (`1984284b`); the full suite was not repeated for that change. |
| Paused import and warning | Verified — bounded local browser | Importing the original tick-144 checkpoint while paused retained its 02:24 clock. The inspector showed 20.7% concentration, 15.85% oxygen at current pressure and the shared low-oxygen reason in a readable full-width explanation. Browser `31a67d6b`, screenshot `05ba8827`. |
| Finite recovery | Verified — bounded only | Earlier tick-144 unsafe-home and tick-384 recovery-budget stops are preserved. The reviewed 384→460 continuation used 76 ticks/three commands, produced 40 air from four water and reached 12 consecutive breathable ticks. All seven crew/five animals stayed fully healthy; three reloads were exact. |
| Remaining reserves and gameplay | Pending — endurance | Room oxygen ended at exactly its 56-unit minimum, suits at 76.79–78.49%, with the next paid processor batch preserved. Durable room/suit reserves, sustained exterior work, paid airlock commissioning/parcel travel and the complete ordinary livestock/kitchen chain remain unverified. |
| Save and dependency scope | Unchanged | Schema 46 remains current; the patch adds no saved gas/resources, new gameplay action, dependency or runtime service. Square schemas 1–39 still require a matching older build, with original bytes protected for export. |
| Source commit, website package, CI and live checks | Release record | The [v0.1.4 release record](https://github.com/Jaredcastorena/spacefortress/releases/tag/v0.1.4) tracks the final commit/tag, artifact/privacy review, mandatory CI/Pages and live version/module checks recorded after verification. Local results here do not assert these publication outcomes. The [live manifest](https://jaredcastorena.github.io/spacefortress/version.json) identifies the deployed build. |

This patch does not complete the wider game. Detailed physical and historical scopes remain in [verification status](verification-status.md) and [atmosphere](atmosphere.md).

## v0.1.3 — local acceptance and release record

Updated October 8, 2026. Version 0.1.3 collects seventeen development commits since v0.1.2 plus physical bodies, butchery and two meat meals. It includes hex construction, finite air recovery, expanded food chains, native plants, cultivation, veterinary care and inherited traits. Exact hosted verification belongs to the [v0.1.3 release record](https://github.com/Jaredcastorena/spacefortress/releases/tag/v0.1.3); local checks below do not establish deployment success.

| Release check | Status | Evidence / remaining work |
| --- | --- | --- |
| Current mechanics and scope | Verified — scoped review | Public guides describe physical body ownership/age/disposal, fixed yields and two meals. The [butchery guide](butchery.md) records conditions and limits; no broader ecosystem or complete ordinary-chain claim follows. |
| Focused and local regression checks | Verified — combined evidence | Food/body/interface/integration: 8/49/9/77 distinct passes. Local regression: **1,264 distinct passes and one intentional historical skip**. First full run: 1,263 passes and one stale recipe-option fixture failure; exact repaired check: one pass, no full rerun. Detailed repair/migration scopes are in [verification status](verification-status.md). |
| Ordinary livestock/kitchen journey | Measured stop — full chain pending | Continued the ordinary tick-66 colony to 144: 78 ticks/three commands. Paid posts completed at 85, two care deliveries, target trust 80. Stopped on unbreathable home air; all seven crew/five animals remained healthy. No slaughter/body/meat/new meal. Complete recording, matched accounting and three exact reloads; no retry. |
| Player controls and local browser | Verified — bounded | Fresh save/reopen, actual migrated file import, ten recipes, applying/preserving Bristlecap braise selection and readable 390-pixel layout; captured warnings/errors empty. No corpse-handling/rendering or cooked-meat browser acceptance. |
| Save compatibility | Verified — scoped migration | Schema 46 supports explicit migrations from hex schemas 40–45. Actual previous schema-45 state projections and six current reloads are preserved; historical deaths grant no body/food. Square schemas 1–39 cannot load into the hex build; original bytes remain protected for export and use with their matching version. |
| Version and website artifact | Release metadata | Source version is 0.1.3 with 95 runtime source files listed. Exact final artifact completeness, privacy exclusions, release SHA and deployment outcomes belong to the release record below. |
| Source commit, CI, Pages and hosted checks | Release record | See [v0.1.3](https://github.com/Jaredcastorena/spacefortress/releases/tag/v0.1.3) for the final commit/tag, required CI/Pages results and live manifest/entrypoint checks recorded after verification. The [live manifest](https://jaredcastorena.github.io/spacefortress/version.json) identifies the deployed build. |

Next work is habitat/exterior-work air and the complete ordinary livestock/kitchen journey. Paid airlock construction/commissioning and a parcel roundtrip, long-term food balance, outpost endurance/resupply, connected decks and a generated universe remain unfinished. Publication does not change those limits.

## v0.1.1 publication and hosted play

Published v0.1.1 contains the verified schema 37 outpost foundations, corrected physical shuttle drawing and save-export recovery. The [changelog](../CHANGELOG.md) describes the changes; the [roadmap](../ROADMAP.md) orders the remaining gameplay work. That release did not include staffed-outpost or player freight controls.

Publication uses GitHub Pages at [the game](https://jaredcastorena.github.io/spacefortress/) and [the separate elements lab](https://jaredcastorena.github.io/spacefortress/elements.html). The deployment packages an explicit set of game assets with the MIT license and a version manifest. Private continuity, saves, recordings, tests, fixtures and operator tools are outside that artifact.

The Pages job runs only for main-branch publication after the same commit passes the Tests job. Pull requests run checks without publishing. Official deployment actions are pinned to full commit IDs, and publishing permissions are limited to the deployment job. [GitHub Actions](https://github.com/Jaredcastorena/spacefortress/actions) records both test and deployment outcomes.

Release acceptance requires the published manifest to match the release commit, both entrypoints and their module assets to load from the project path, and a fresh browser to pass colony save/reload and lab-isolation checks. Hosted saves stay in the browser; transfer an existing local colony with JSON export/import.

## Historical v0.1.2 — freight and wreck settlement preview

This is the verification snapshot from v0.1.2 preparation. Pending entries describe that time; the current release record is linked above.

The user requested wrapping this round and publishing the latest tested build. Schema38 exposes physical freight, supplied local construction/readiness, residence/return controls, site-local care and conditional single-pilot pickup. This release is a development preview: full fresh-colony endurance, delayed resupply, ordinary remote care and final pickup remain unfinished. Automatic pressure-cycling airlocks remain proposed.

| Release check | Status | Evidence |
| --- | --- | --- |
| Current source | Verified | Node959 checks:958 pass,0 fail,1 intentional historical skip,64.33s. Python15/15 and JavaScript163/163. Detailed scopes in [verification status](verification-status.md). |
| Player controls | Verified — bounded | Real freight and named-resident/default/narrow controls, exact saves, alerts and lab isolation passed. Full resident endurance/resupply/pickup remains pending. |
| Finite publication artifact | Verified — candidate |88files/all81 runtime modules reachable; no private continuity/saves/tests/fixtures/QA or external runtime dependencies. Rebuild with final release metadata before publication. |
| GitHub publication and live deployment | Release record | Exact commit, CI and live checks are recorded on the [v0.1.2 release](https://github.com/Jaredcastorena/spacefortress/releases/tag/v0.1.2). The [live version manifest](https://jaredcastorena.github.io/spacefortress/version.json) identifies the deployed commit. |

## Historical v0.1.0 setup and player-facing documentation

| Check | Status | Evidence / remaining work |
| --- | --- | --- |
| Accurate early-build scope | Verified — source/doc review | README describes one colony floor, fixed destinations and unfinished outposts/vertical decks/generated universe. Source remains schema 36; outposts are proposed. |
| Local start command | Verified — source review | `python3 tools/serve.py` uses Python's standard library, binds `127.0.0.1`, defaults to 8420 and accepts `--port`. Clean-copy execution is a separate gate below. |
| Test command | Verified — source review | `node --test tests` uses portable directory discovery verified by the portability audit. Observed Linux tools: Python 3.12.3, Node 20.20.2. No project install/build step. |
| Controls and saves | Verified — source review | README matches app/HTML/persistence: click/drag/pan/zoom/orders, browser-local key, 30-tick autosave, JSON import/export and unreadable-save protection. Browser interaction is a separate gate. |
| Offline runtime | Verified — source review | Entry points load local scripts/styles; no external fetch/WebSocket/CDN dependency found in scoped source inspection. No exact browser-version or cross-platform claim. |
| README links and screenshot | Verified | All 31 README links and 2 checklist links resolve locally. The approved, visually reviewed colony PNG is copied byte-for-byte into `docs/images/spacefortress-colony.png`; QA profiles/logs are excluded. Recheck after publication edits. |

## Historical v0.1.0 release gates

| Check | Status | Evidence / remaining work |
| --- | --- | --- |
| Current full test suite | Verified | Final local release gate: Node simulation tests **778/778**, Python server tests **7/7**, and JavaScript syntax **137/137**, all with zero failures. The published GitHub Actions run below repeated the automated gates. |
| Clean-copy/clone start and playability | Verified | A fresh clone of published commit `06d5260` contained 223 tracked files, retained all 17 fixture files, discovered all 778 Node tests, passed 7 Python tests, served both entrypoints/modules with correct MIME types and denied sensitive/traversal paths. |
| Browser smoke and player flow | Verified | Fresh isolated Firefox tested colony/lab, hidden drawers, new colony, save/export/download/import/reload and independent lab stepping with no scoped app errors; all 165 recorded requests were local. The schema 36 save roundtrip was byte-identical. Historical journey evidence remains in [verification status](verification-status.md). |
| Server safety/portability | Verified on Linux | The centralized GET/HEAD allowlist rejects literal/encoded traversal, private files, directories and symlinks; 7 focused regressions and clean-clone HTTP probes pass. The server binds to loopback. Windows/macOS execution remains unverified. |
| Secrets/privacy/generated files | Verified | Final 223-file tree and decompressed fixtures had no credential/private-key/token hits or personal home paths. Browser profiles, private continuity/handoffs, saves, recordings, logs, env/key files, caches, dependencies and coverage output are ignored. |
| Asset/source provenance | Verified | Audit found project code-native Canvas/CSS artwork, geometric inline favicon and system fonts; no bundled image/font/audio/model packs or vendored libraries. The README screenshot is a reviewed capture of the game; compressed fixtures are project save data. [Asset sources](../ASSET_SOURCES.md) records the scope. |
| License and attribution | Verified — files reviewed | `LICENSE` is MIT, copyright 2026 Jared Castorena, using root-confirmed holder. README links the actual file. Public account/remote verification remains separate. |
| Contribution/security/community files | Verified | CONTRIBUTING, CODE_OF_CONDUCT, SECURITY and issue/PR templates are public; private vulnerability reporting is enabled on the repository. |
| CI configuration | Verified | Official checkout/setup-node actions are pinned to full commit SHAs with read-only contents permission. [Published run 35802686651](https://github.com/Jaredcastorena/spacefortress/actions/runs/35802686651) passed syntax, 778 Node tests, 7 Python tests and HTTP smoke. |
| Final publication tree/documentation | Verified | Independent review approved 223 files / 2,417,893 bytes; 359 local public links resolved. The original screenshot contains only normal PNG chunks. No ignored private/runtime artifact is tracked. |
| Public remote and identity | Verified | Public repository owner is `Jaredcastorena`; MIT holder and commit author are Jared Castorena. Initial playable commit: `06d5260378dbee840151c4c41838f9fc0a3f701c`. |
| Post-publication check | Verified | An unauthenticated GitHub API request reported public visibility/default branch `main`, and unauthenticated `git ls-remote` returned the published commit for both `HEAD` and `refs/heads/main`. |

## Limits that remain after publication

- Fixed sites, one local floor per site and one expedition at a time. Staffed outposts, generated worlds/history/factions and real connected z levels remain unfinished.
- Environmental/production rules are game abstractions. The elements lab is a separate sandbox.
- Desktop browser coverage, sustained performance and every older UI interaction are not established by focused historical checks.
- Saves live in a browser profile/origin; JSON export is the portable backup path. Publication adds no cloud saves or multiplayer service.
- Local recordings contain observations/actions, not training rewards or proven causality. No model download or training integration is included.

## Maintaining this record

Update rows only from actual results. Keep detailed logs, browser profiles and local test saves outside the publication tree. [Verification status](verification-status.md) retains historical feature evidence.
