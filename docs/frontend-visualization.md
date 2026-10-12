# Frontend and visualization contract

## Reference direction

The uploaded references show an isometric system map framed by a compact top status strip, a categorized left inventory and a right explanation panel. One uses a charcoal palette with blue active routes; the other uses a warm paper background, black linework and small red moving marks. Both use monospaced typography, restrained borders, building-like nodes and trace/pause/reset controls.

Adopt that visual language for Rzero. Use the dark reference as the initial theme; preserve palette tokens so a paper theme can be added later without changing semantics. The image of the social post provides context for the concept; it is not an additional interface to reproduce. Original UI reference images are included in `references/`.

## Specific design decisions

Use an isometric projection rather than a generic flat force-directed graph. Assets are small architectural forms on a grid; segments occupy labeled districts; directional routes join assets. Workstations, servers and controllers have consistent silhouette families. Building height is decorative within each family and must not imply risk, data volume or privilege. A legend explains silhouettes and colors.

Keep labels legible and asset IDs available on selection. Avoid overlapping labels through a stable layout, zoom thresholds and segment focus. Use fixed segment blocks with asset positions sorted by ID; topology edits should not cause the whole city to move. Layout is presentation metadata excluded from simulation identity.

The pushback on the references is practical: faint linework and dense tiny text look attractive but can hide the reasons Rzero exists to show. Selected routes, current attempts, state labels and check results need clear contrast. A graph is not useful if only the animation can be seen.

## Surface mapping

| Reference element | Rzero behavior |
| --- | --- |
| Top repository/status strip | Scenario, threat profile/version, total assets, compromised count, logical hop and playback controls |
| Left system inventory | Segments and searchable asset list; filter by kind/critical/compromised/indeterminate |
| Center topology/city | Full modeled network, patient zero marker, movement routes and selected path |
| Right explanation panel | Tabs: Asset, Attempt, Evidence; selection persists until changed |
| Pause / trace one step / reset | Pause playback, advance one event, return replay cursor to start |
| Moving payload marks | Presentation of attempted propagation; resolve using recorded engine outcome |
| Footer legend | Asset state, attempt outcome and supported interaction hints |

Expose load/import, threat selection, initial asset selection and run before replay. Keep these setup actions distinct from reset-view (camera only) and restart-replay (cursor only). Editing a scenario produces a new run and cannot change an archived result.

## Asset and attempt visual state

Persistent asset state is `modeled`, `discovered` or `compromised`. The seed is compromised from the initial event. A critical marker and isolation marker are independent attributes. Discovery changes outline emphasis; compromise changes fill/accent plus a visible status label.

An attempt has `pending`, `succeeded`, `blocked` or `indeterminate` replay state. Use blue for active movement, red for compromise, a stopped-line symbol plus text for blocked, and a dashed line/question badge for indeterminate. Do not rely on color alone. A target with one blocked route may later turn compromised through another route.

Denied links can be shown as muted dashed routes before playback. Static absence of a route means no modeled link; do not draw an animated rejection across missing links.

## Inspector content

Asset tab: ID/label, kind/platform/segment, services, vulnerability facts, symbolic credential availability, critical/isolation attributes, current replay status and first-compromise path when reached.

Attempt tab: source/target, service, mechanism, all check results in fixed order, primary reason, intervention IDs and event sequence/hop. Clearly distinguish unknown from fail.

Evidence tab: profile scope and revision, capability claim, source links, confidence, assumptions and unsupported behavior. This explains why the capability is modeled, while Attempt explains why it succeeded in this environment.

Hover provides a short tooltip; click pins an asset or route; keyboard selection does the same. No essential content may be hover-only. Use actual service names and host labels, not unexplained two-letter node abbreviations alone.

## Replay and comparison

The frontend receives the validated scenario, events and completed result. A pure reducer reconstructs state at a cursor. Run the engine independently of animation, preferably in a worker; throttle progress delivery instead of rerendering per engine operation.

Controls include play/pause, step one event, restart replay, speed, scrub, pan/zoom and reset camera. One step updates the inspector even when the event has no dramatic animation. Reduced-motion mode uses instant state changes with all explanations intact. Pause consumes no animation loop while idle.

Comparison uses a baseline/modified toggle with a shared camera and identical asset positions. Show counts and the changed control next to it. Add a difference overlay for assets no longer/newly compromised. Compare completed results, not mismatched replay cursors. V1 needs neither synchronized dual 3D canvases nor an automated recommendation panel.

## Accessibility and responsive behavior

Use readable text (roughly 13–14 px minimum for primary inspector content), adequate contrast, visible focus, labeled buttons and keyboard-accessible asset/attempt lists. Provide a list/table alternative to the map with identical selection and explanation behavior. Screen-reader output comes from semantic DOM, not from canvas pixels.

At smaller widths, collapse the inventory and inspector into selectable drawers; never squeeze all three panes onto a phone. Preserve run, step and attempt inspection. Pan/zoom must support touch. Do not hijack page scrolling when the map is not actively manipulated. No sound, flashing effects or decorative continuous motion is required.

## Performance goals and validation

Use SVG paths and projected faces without a continuously running physics layout. Animate only active marks; cap visible concurrent animated marks at 20 and batch playback visually without dropping events. Virtualize long event lists and keep lookup indexes outside rendering state.

Initial targets, to be measured rather than claimed: responsive pause/selection on a 250-asset, 2,000-link fixture; no idle animation work; no remote font requirement; and a compressed initial app payload below roughly 300 KiB excluding optional research/examples. Lazy-load larger fixtures and later intelligence integrations. Record the test browser/hardware and revise targets based on measurements.

Visual acceptance: the five-node scenario can be followed from seed to B to D; A → C visibly stops; D → E explains the absent vulnerability; a focused district stays readable; and a stopped attempt never makes an unaffected host appear guaranteed safe. Test both normal and reduced-motion playback, keyboard operation and narrow layouts.
