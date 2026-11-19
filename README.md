# rzero

rzero is a defensive threat propagation simulator. It models how malware
behavior interacts with network topology so teams can reason about blast
radius, segmentation, and containment.

## Local development

```bash
bun install
bun dev
```

The app runs on the Vite development server, usually at
`http://localhost:5173`.

```bash
bun run test        # domain core unit tests
bun run build       # type-check app, core and tests, then build
bun run rzero validate fixtures/scenarios/001-five-node-baseline.json
bun run rzero run      fixtures/scenarios/001-five-node-baseline.json   # run the engine, print events
bun run rzero story    fixtures/scenarios/001-five-node-baseline.json   # narrate the run step by step
```

## Layout

- `src/core/` — UI-independent domain core: native types, JSON Schemas,
  JSON/restricted-YAML import, validation, scenario compilation, the
  deterministic propagation engine, and result analysis, one-change
  comparison, the replay reducer and replay steps (`groupSteps`). Import it
  only through `src/core/index.ts`.
- `src/app/narration/` — plain-English step narration (`narrate`): display
  prose derived from event codes and facts, kept out of the core.
- `src/components/`, `src/App.tsx`, `src/app/` — Solid UI: Story Mode walkthrough
  (step list, isometric map, step details, autoplay) and Command Mode. Layout
  target: `references/rzero-layout-mockup.png`. Open `?scenario=002` for the
  segmented counterfactual.
- `src/domain/`, `src/data/` — prototype UI mock types and data; illustrative
  only, see `docs/core-integration.md`.
- `fixtures/scenarios/` — canonical synthetic scenarios (JSON and YAML).
- `docs/` — design contract; start with `docs/architecture.md`.

## Current direction

- Solid + TypeScript for the UI shell
- Bun for package management and scripts
- Story Mode as the first-run learning experience
- Command Mode as the technical operator view
- A renderer-agnostic simulation engine underneath the UI
