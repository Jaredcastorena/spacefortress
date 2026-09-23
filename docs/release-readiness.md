# First public repository — release readiness

**Status: published and verified.** Updated 2026-09-23 UTC. The first public source release is at [Jaredcastorena/spacefortress](https://github.com/Jaredcastorena/spacefortress). This checklist describes an early playable build, not completion of SPACEFORTRESS.

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
