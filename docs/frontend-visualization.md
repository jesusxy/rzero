# Frontend and visualization contract

## Reference direction

**Layout target:** `references/rzero-layout-mockup.png` is the target layout for Story Mode. Match its structure: a header with brand, scenario, Story/Command toggle, a step counter with a segmented progress bar and Restart/Back/Play/Next; a left panel with the malware profile card, the step list and hosts grouped by segment; a center column with metric cards, the isometric map, a legend strip and a collapsed event log; and a right panel with step details. Its light palette (ink `#1F2328`, page `#EEF0F3`, map `#F4F5F7`, compromised `#B3341F`, blocked `#9A5B00`, current `#1D5FD1`) and IBM Plex Mono/Sans typography are the initial theme.

**Scenario picker and defense targets:** `references/rzero-picker.png` (the header's scenario picker, open), `references/rzero-defense-step.png` (the WannaCry office mid-replay with a defense applied, a route stopped by it) and `references/rzero-defense-results.png` (the same run at its results step). Together they set the scenario picker, the "Try a defense" card, the map's layout, routes, host labels and defense decorations, the "In the original run" box, the before → after metric cards and the results step.

**Style reference:** `references/protocol-explorer.png`, a step-by-step protocol walkthrough (numbered step list, "Step N of M" details panel, packet table under the diagram). Its pacing and step/detail structure, monospaced typography and restrained borders inform Story Mode; its dark palette does not. Keep palette values in tokens so another theme can be added without changing semantics. The image of the social post provides context for the concept; it is not an additional interface to reproduce.

## Specific design decisions

Use an isometric projection rather than a generic flat force-directed graph. Assets are small architectural forms on a grid; segments occupy labeled districts; directional routes join assets. Workstations, servers and controllers have consistent silhouette families. Building height is decorative within each family and must not imply risk, data volume or privilege. A legend explains silhouettes and colors.

Keep labels legible and asset IDs available on selection. Avoid overlapping labels through a stable layout, zoom thresholds and segment focus. Layout is presentation metadata excluded from simulation identity.

The layout is flow-ordered and segment-aware, and uses only the static network (never run results, never link access), so a run with and without a defense lays out identically:

- Hop distance comes from a breadth-first walk of the links from the initial asset (ties by ID). Hop distance runs along one iso axis and siblings along the other, on integer grid cells. The child that leads to the most further hosts stays in line with its parent; its siblings spread either side.
- Each segment is a district with a dashed outline and its label at the top corner. The starting host's district comes first; districts never overlap, and empty "streets" separate hop columns and districts.
- Routes run along the grid: out of the source along the hop axis into a street, along the street, then into the target, with at most two turns. Routes from one source share a trunk before splitting; each source has its own channel in a street. Routes are drawn under hosts, trimmed at the host's silhouette, with one small arrowhead sized in screen pixels.
- Host labels: the name in bold; one muted line only for meaningful markers (start, critical, a non-Windows platform); one coloured status word only when something happened (Compromised, Blocked, Unknown). Reasons are not tagged on the map; they live in the step panel.

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

An attempt has `pending`, `succeeded`, `blocked` or `indeterminate` replay state. Routes are solid lines only, one meaning per style: not tried is thin light grey (`#CDD2D9`); tried and stopped is grey (`#8F98A4`) up to a short amber (`#9A5B00`) tick where it stopped (at the target district's edge for a network block, else at the turn into the target), then thin light grey; outcome unknown is grey with a small purple "?" badge near the target; spread is a heavier red (`#B3341F`); the current step is blue (`#1D5FD1`) with the capability chip travelling along it. Only one route is ever blue; when its step ends it takes its outcome style. The host status word backs up every colour, so colour is never the only signal. A target with one blocked route may later turn compromised through another route.

Static absence of a route means no modeled link; do not draw an animated rejection across missing links.

### Scenario picker

The scenario name in the header is a listbox: each bundled scenario with its name and one line of facts (real malware or synthetic demo, host count, segment count). Command Mode adds "Open a scenario file…", which imports JSON or YAML through the same validation as the CLI; a file that fails shows its diagnostics. The app opens on the WannaCry small office. `?scenario=<key>` remains as a deep link, not as the way to choose.

### Try a defense

A scenario can have a companion `<scenario>.defenses.json`: an array of `{ id, label, description, kind, interventions }`, where `kind` is `segmentation`, `patch` or `link` and `interventions` are the standard objects from `docs/scenario-model.md`. The scenario contract does not change; tests check that every option compiles with its scenario and changes something.

The left panel keeps its order (malware card, steps) and adds a "Try a defense" card: a radio list of options (label and one muted line), "Apply and compare", and a hint about editing the map (not active yet). Applying compiles the scenario with the option's interventions, runs it, and restarts the replay; the card then shows the option as Applied with Remove, and the steps heading reads "Steps · with your defense". Remove restores the original run. There is no original/defended toggle; the comparison is told through the steps.

On the map the defense decorates only what it changes: a segmentation defense gives the protected district a solid amber outline, a light amber fill and an amber label with a lock, and blocked routes stop with their tick at that district's edge; a patch puts a shield on the host; a link defense puts a lock at the link's midpoint. The legend adds the matching entry and "saved by your defense" only while a defense is applied. No rule text appears on the map. On the results step, hosts the defense saved read SAVED in green.

The comparison uses `diffAnalyses` on the original and defended runs. A step whose attempt (same source, target and capability) ended differently in the original run gets an "In the original run" box. A check that fails because of the defense names it by its label ("Blocked by your defense: …"), never by intervention ID. The results step shows before → after metric cards (compromised, critical reached, unknown, blast radius with its percentage-point change) and a "what changed" list (Saved, Stopped by your defense, Still lost, Unchanged), a suggestion naming another option and what it would save, and Replay / Remove defense.

The step panel's evidence section reads "How {profile name} does this": the profile's optional `summary`, then a "Sources (N)" link that expands to the supporting source titles and links. Without a summary it shows the expandable sources only. Command Mode keeps the full claim summaries.

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
