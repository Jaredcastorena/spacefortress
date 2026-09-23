# First public repository — release readiness

**Status: publication preparation in progress.** Updated 2026-09-23 UTC. This checklist describes the first public source release of an early playable build, not completion of SPACEFORTRESS. Record the publication URL and account identity only after root verifies them.

`Verified` means the stated scoped check has evidence. `Pending` means the release check has not yet been accepted. Historical results do not substitute for current release verification.

## Setup and player-facing documentation

| Check | Status | Evidence / remaining work |
| --- | --- | --- |
| Accurate early-build scope | Verified — source/doc review | README describes one colony floor, fixed destinations and unfinished outposts/vertical decks/generated universe. Source remains schema 36; outposts are proposed. |
| Local start command | Verified — source review | `python3 tools/serve.py` uses Python's standard library, binds `127.0.0.1`, defaults to 8420 and accepts `--port`. Clean-copy execution is a separate gate below. |
| Test command | Verified — source review | `node --test tests` uses portable directory discovery verified by the portability audit. Observed Linux tools: Python 3.12.3, Node 20.20.2. No project install/build step. |
| Controls and saves | Verified — source review | README matches app/HTML/persistence: click/drag/pan/zoom/orders, browser-local key, 30-tick autosave, JSON import/export and unreadable-save protection. Browser interaction is a separate gate. |
| Offline runtime | Verified — source review | Entry points load local scripts/styles; no external fetch/WebSocket/CDN dependency found in scoped source inspection. No exact browser-version or cross-platform claim. |
| README links and screenshot | Verified | All 31 README links and 2 checklist links resolve locally. The approved, visually reviewed colony PNG is copied byte-for-byte into `docs/images/spacefortress-colony.png`; QA profiles/logs are excluded. Recheck after publication edits. |

## Release gates

| Check | Status | Evidence / remaining work |
| --- | --- | --- |
| Current full test suite | Pending | Historical expedition acceptance: 775/775 passed 2026-09-16; three later pre-outpost fixture tests passed separately. Record a full current release run. |
| Clean-copy/clone start and playability | Pending | Verify README commands from intended release files, without local QA helpers/profiles/preexisting saves. Keep `tests/fixtures/*.json.gz`. |
| Browser smoke and player flow | Verified — worker report; final-tree acceptance pending | Release UI worker tested fresh colony/lab, new colony, save/export/download/import/reload with no scoped app errors; all 165 recorded page requests were local. Root reviews final-tree acceptance. Historical journey evidence remains in [verification status](verification-status.md). |
| Server safety/portability | Pending | Root is coordinating a server allowlist fix; verify it and the published commands before acceptance. Windows/macOS execution remains unverified. |
| Secrets/privacy/generated files | Pending | Inspect candidate tracked files; exclude profiles, personal saves, QA output, logs, credentials and private machine/account details. |
| Asset/source provenance | Verified — audit, packaging pending | Conservation audit found project code-native Canvas/CSS artwork, geometric inline favicon and system fonts; no bundled image/font/audio/model packs or vendored libraries. Twelve compressed fixture files are project save data. Final tree review remains required. |
| License and attribution | Verified — files reviewed | `LICENSE` is MIT, copyright 2026 Jared Castorena, using root-confirmed holder. README links the actual file. Public account/remote verification remains separate. |
| Contribution/security/community files | Verified — files present; publication channels pending | CONTRIBUTING, CODE_OF_CONDUCT, SECURITY and issue/PR templates landed. Root must verify public reporting channels after remote creation. |
| CI configuration | Pending | Review workflow dependencies/pinning and commands; local checks do not establish a remote CI pass. |
| Final publication tree/documentation | Pending | Root reviews included files, links, status claims and a clean checkout of the final commit. |
| Public remote and identity | Pending | Root verifies authenticated owner, commits/pushes reviewed files and records actual public URL/commit. No public repository is claimed yet. |
| Post-publication check | Pending | Confirm public access and clean clone/run instructions; record remote CI separately if available. |

## Limits that remain after publication

- Fixed sites, one local floor per site and one expedition at a time. Staffed outposts, generated worlds/history/factions and real connected z levels remain unfinished.
- Environmental/production rules are game abstractions. The elements lab is a separate sandbox.
- Desktop browser coverage, sustained performance and every older UI interaction are not established by focused historical checks.
- Saves live in a browser profile/origin; JSON export is the portable backup path. Publication adds no cloud saves or multiplayer service.
- Local recordings contain observations/actions, not training rewards or proven causality. No model download or training integration is included.

## Evidence ownership and handoff

Root owns publication, identity/license decisions, Git/remote changes and final status. Workers provide scoped evidence; update rows only from actual results. Keep detailed logs, browser profiles and local test saves outside the publication tree. [Verification status](verification-status.md) retains historical feature evidence.
