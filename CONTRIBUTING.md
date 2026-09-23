# Contributing to SPACEFORTRESS

SPACEFORTRESS is an early playable colony simulation. Contributions that deepen interacting simulation systems, fix defects, improve accessibility, or make the local setup clearer are welcome.

## Before starting

- Search existing issues before opening a new one.
- Open an issue before a large change so the design and scope can be discussed.
- Keep changes focused. Avoid unrelated formatting or refactors.
- Discuss new dependencies before adding them. The project intentionally uses a small, local toolchain.

## Local setup

You need Python 3 and a current Node.js release. The game has no package install or build step.

```sh
python3 tools/serve.py
```

Open <http://127.0.0.1:8420>. Run the test suite with:

```sh
npm test
```

## Project conventions

- Use JavaScript ES modules and follow the style of nearby files.
- Keep simulation state separate from Canvas and interface rendering.
- Route colony player and agent commands through `src/controls.js`.
- Add stable action and entity IDs, structured telemetry, and semantic events when extending simulation interactions.
- Preserve deterministic behavior: recording and telemetry must not alter RNG, saves, or simulation results.
- Add focused tests for simulation rules, persistence migrations, conservation, and control or telemetry changes.
- Use original or appropriately licensed assets. Record the source and license for every third-party asset.

## Pull requests

In the pull request, explain the player-visible change, the simulation rules affected, and how you verified it. Include screenshots for visible interface changes and call out save-schema changes or known limitations.

By contributing, you agree that your contribution is licensed under the repository's license.
