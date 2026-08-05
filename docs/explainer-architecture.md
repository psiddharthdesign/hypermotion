# Explainer sequences and multi-camera architecture

Hyper Motion treats an explainer as a project containing independently
authored composition scenes and an ordered master sequence. A scene is not a
timeline label: it owns a root, local duration, cameras, camera cuts, layers,
and animation tracks. The sequence maps those local timelines into one movie.

## End-to-end flow

```text
prompt / connected app / repository / capture manifest / audio
                              │
                              ▼
                     normalized brief
                              │
                              ▼
              deterministic explainer storyboard
       scenes · cues · beats · cameras · 3D directions · QC
                              │
                              ▼
                     scene materializer
          native layers · variants · tracks · cameras · cuts
                              │
                              ▼
             .hype project + ordered master sequence
                              │
                 ┌────────────┴────────────┐
                 ▼                         ▼
          Scene edit preview        Master sequence preview
                 └────────────┬────────────┘
                              ▼
              MP4 / GIF hidden-window render
       master→local evaluation · crossfade compositing · audio
```

External context is source-agnostic. Slack, a direct prompt, a local
repository, a URL, a design file, or another MCP client can all supply the
same brief. Hyper Motion does not make Slack or any single connector part of
its project model.

## Project model

The v2 sequence fields live in the existing Yjs `scene` document so old
`.hype` files still open:

- `compositionScenes`: map of independent compositions.
- `sequenceItems`: reusable occurrences referencing compositions.
- `sequenceOrder`: ordered sequence-item ids.
- `activeCompositionId`: composition projected into the existing editor.
- `sequenceSchemaVersion`: currently `2`.

A composition has:

```ts
interface CompositionScene {
  id: string
  name: string
  rootNodeId: string
  duration: number
  workArea?: {
    start: number
    end: number
  }
  workspaceNodeIds?: string[]
  cameraIds: string[]
  defaultCameraId: string | null
  cameraCuts: Record<string, {
    id: string
    cameraId: string
    time: number // composition-local seconds
  }>
}
```

A sequence item has:

```ts
interface SequenceItem {
  id: string
  sceneId: string
  masterAudioMuted?: boolean
  trimStart?: number
  duration?: number
  transitionOut?: {
    kind: 'cut' | 'crossfade'
    duration: number
  }
}
```

Node ids are project-global. A composition root scopes its visible layer tree;
its `cameraIds` scope scene-level cameras. `workspaceNodeIds` explicitly owns
parentless `workspaceOnly` assets such as generated component masters.
Unlisted pasteboard assets are project-level and survive scene deletion;
duplicated scenes can share an owned asset, which is removed only after its
last owning composition is deleted. Sequence items can reuse the same
composition without copying or offsetting its keyframes.

The work area is composition-owned and persisted. Its absence means the full
composition, including after later duration changes. Each sequence occurrence
uses the intersection of that work area and its own absolute `trimStart` /
`duration`, so occurrence edits can shorten a scene in Master without changing
the composition duration or exposing content outside the scene's work area.

Legacy documents migrate to one composition and one sequence item without
changing node, track, root, camera, or media ids. Binary `.hype` persistence
already carries the new Yjs maps. The JSON import/export path includes the
same optional fields and remaps roots, cameras, defaults, and cut targets.
Workspace ownership plus component/instance references are remapped with the
same project-global node-id table.

## Time and transitions

All authored animation remains composition-local. The sequence time mapper:

- quantizes trim, duration, and transition bounds to the project frame rate;
- intersects every occurrence trim with its composition-owned work area;
- maps master time to one scene, or two scenes during a crossfade;
- maps local time back to a sequence occurrence;
- clamps invalid collaborative state and reports structured issues;
- treats intervals as half-open, with a stable final-frame exception;
- limits overlap so at most two scenes render at once.

The Scene timeline edits local keyframes and camera cuts. The Master timeline
shows scene order, runtime, overlaps, transitions, and the master playhead.
Reordering scenes never rewrites keyframe times. Dragging a Master block's
trailing edge changes only that occurrence's source out-point; it does not
change the composition duration.

MP4/GIF export walks master frames. At each frame it resolves every active
sequence layer, activates its composition, seeks to local time, resolves the
program camera, captures the scene, and composites two captures for a true
crossfade before encoding. The result is one clubbed media file. Headless
rendering automatically chooses sequence export when the project has multiple
sequence items.

## Multi-camera contract

Every composition can own several scene-level camera nodes.

- `defaultCameraId` renders before the first camera cut.
- Camera cuts are scene-local hard edits and remain active until a later cut.
- Same-time cuts resolve deterministically by `(time, id)`.
- Missing or disabled targets fall back through an earlier valid cut, the
  default camera, an adapter fallback, the first enabled owned camera, then the
  identity view.
- The editor camera view is transient UI state. Looking through another camera
  never changes program output.
- Camera deletion removes orphan tracks, repairs the scene default, and prunes
  stale cuts. The final owned camera cannot be removed through editor actions.

The Layers panel exposes add, select, set-default, duplicate-with-animation,
and safe delete. The camera-cut bar exposes Default, editor-only View, current
Program, cut target, add/replace, seek, and delete.

## Explainer planning

`src/explainer` separates creative planning from document mutation:

1. `ExplainerBrief` normalizes direction, script, brand, source references,
   and audio evidence.
2. `compileBriefToStoryboard` deterministically creates a 10–15 second plan
   by default.
3. The storyboard contains typed text, design, demo, and final-logo scenes,
   transitions, beat-snapped cues, demo steps, component variants, semantic
   camera programs, 3D layer directions, and QC issues.
4. `validateStoryboard` checks continuity, ordering, ids, references, final
   logo, beat claims, camera ownership, cuts, and 3D directions.
5. The materializer converts that semantic plan into editable Hyper Motion
   nodes, tracks, cameras, cuts, and sequence items.

The Explainer workbench in the desktop editor is the operator-facing entry
point. It accepts direction, pacing, target length, brand colors, an optional
audio file, and an optional normalized product-source manifest. The generated
sequence can be appended without disturbing authored scenes, or replace the
current scene set only after a successful build. Both paths finish in Master
preview with every generated scene still independently editable.

Sparse input remains executable with warnings. The compiler never depends on
React, Electron, Yjs, or a communication provider, and does not use clocks or
random ids for planning.

## Product-source capture

The source manifest represents:

- repository/framework metadata;
- routes and viewport-specific screens;
- deterministic interaction checkpoints such as default, filled, submitting,
  success, and error;
- DOM bounds, computed visual styles, text, accessibility names, and asset
  provenance;
- stable component boundaries and variant states.

For a Next.js/shadcn/Tailwind project, the preferred acquisition order is:

1. inspect the repository and route/component graph;
2. run the application with user-authorized test data;
3. capture deterministic checkpoints at one fixed viewport;
4. match stable elements across states;
5. reconstruct meaningful controls/components as native editable layers;
6. use a raster capture only where fidelity cannot be represented natively.

Secrets, personal data, remote script bodies, and unsafe paths are never
embedded in the manifest.

## Audio

The existing PCM beat detector, beat grid, bar subdivisions, waveform cache,
and keyframe beat-sync planner remain the timing engine. The explainer compiler
uses supplied beat/downbeat/energy evidence to snap scene boundaries, reveals,
demo actions, camera cuts, transitions, and the logo hit.

Parentless audio nodes are Master-owned soundtracks. Audio nodes parented under
a composition root are Scene-local overlays. A Scene occurrence borrows the
Master soundtrack window at:

```text
masterTime = occurrence.masterStart + sceneTime - occurrence.sourceStart
```

The Scene editor therefore hears the same soundtrack slice as Master preview
and Scene-only export. `masterAudioMuted` suppresses only that occurrence's
borrowed Master bed; Scene-local overlays remain audible. In a Master
crossfade, the same transition weights form the audio envelope, so a muted
boundary fades smoothly instead of cutting or doubling.

Master beat and bar markers are projected through the same time mapping into
the selected Scene occurrence. Their original bar numbers remain visible even
when the Scene begins mid-song, the visible marker range is clipped to the
occurrence window, and the projected note times feed the existing keyframe
snap targets. Muting the Master bed does not hide these timing guides.

Meaningful events are synchronized; every decorative keyframe is not.
Narration alignment should use word/phrase timestamps when available, with
musical beats reserved for visual accents.

## MCP and skills

The MCP surface is expected to expose:

- health and capability discovery;
- scene/project creation and validation;
- layer, track, camera, composition, and sequence inspection;
- safe patch operations;
- open and render;
- explainer/source/audio-specific tools only when their capability is actually
  registered.

The repository skills provide the creative operating procedure:

- `skills/hypermotion-explainer-director`
- `skills/hypermotion-brand-profile`

They are provider-independent and should capability-gate tools instead of
inventing unavailable operations.

## Current delivery boundary

The implemented core can immediately:

- create and edit independent ordered scenes;
- preview local scenes or the full master sequence;
- hear and inspect the exact Master soundtrack/bar window inside each Scene,
  mute that bed per occurrence, and layer Scene-local audio over it;
- reorder, duplicate, rename, delete, trim, and transition scenes;
- add several cameras per scene and author deterministic camera cuts;
- keep editor and program camera choices separate;
- compile structured explainer direction into a validated storyboard;
- build that storyboard from the in-app Explainer workbench in append or
  explicit replace-current mode;
- analyze an imported audio file and use its detected beat grid while
  materializing scene cues and camera cuts;
- normalize source manifests from repositories, MCP clients, browser captures,
  or design tools into editable component and variant evidence;
- persist sequence data in binary and JSON `.hype` workflows;
- export a multi-scene MP4/GIF as one file, including crossfades;
- export cut-only multi-scene WebM projects as one file;
- render a multi-scene saved project headlessly to a requested macOS path.

Repository/browser capture still requires an authorized running application or
prepared capture manifest. Authentication, test fixtures, and redaction remain
explicit inputs rather than guessed behavior.

Interactive Master preview uses one editor canvas and switches the live
composition at transition boundaries. Final MP4/GIF rendering uses the hidden
two-surface compositor for true crossfades. WebM export rejects projects that
contain crossfades instead of silently changing their transition semantics.
