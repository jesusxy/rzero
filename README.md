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

## Current direction

- Solid + TypeScript for the UI shell
- Bun for package management and scripts
- Story Mode as the first-run learning experience
- Command Mode as the technical operator view
- A renderer-agnostic simulation engine underneath the UI
