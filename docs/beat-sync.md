# Beat sync exploration

## Outcome

Beat sync belongs in the existing **Audio** timeline mode. An imported audio
clip can be analysed locally, show musical markers over its waveform, accept
bar-specific note subdivisions, and retime selected keyframes onto the active
note grid.

The implementation should keep three concepts separate:

1. **Audio evidence** — detected transients and tempo candidates.
2. **Musical intent** — chosen BPM, downbeat, time signature, and bar-specific
   note divisions.
3. **Animation action** — an explicit, undoable rewrite of selected keyframe
   times.

Analysis is a suggestion. Musical intent is editable source of truth. This is
important because half-time/double-time ambiguity cannot be solved reliably for
every song, and a user may deliberately animate in a different meter.

## Existing insertion points

- `src/ui/Timeline.tsx` already has separate Animated layers and Audio modes,
  audio clip rows, decoded waveform caching, section markers, and marker-aware
  keyframe snapping.
- `src/ui/importMedia.ts` already imports an audio file as a scene-level audio
  node and stores source duration and trim timing.
- `src/scene/types.ts` and `src/scene/doc.ts` already persist audio nodes,
  sections, and keyframes in the Yjs scene.
- `src/ui/keyframeDragPreviewStore.ts` already previews batched retiming before
  one undoable commit.
- `src/audio/beatSync.ts` now provides dependency-free PCM analysis, note-grid
  generation, and collision-safe keyframe spreading for every surface to share.

## Proposed data model

Persist evidence on the analysed audio node:

```ts
interface AudioBeatAnalysis {
  version: 1
  bpm: number
  confidence: number
  firstBeatTime: number       // source-relative seconds
  candidates: Array<{ bpm: number; confidence: number }>
  transients: Array<{ time: number; strength: number }>
  beatTransients: Array<{ time: number; strength: number }>
}
```

Persist musical intent once at scene level:

```ts
interface MusicTiming {
  sourceAudioNodeId: NodeId
  bpm: number
  firstBeatTime: number       // source-relative; mapped through trim/start/rate
  beatsPerBar: number         // default 4
  beatUnit: 1 | 2 | 4 | 8 | 16 | 32
  subdivisions: Array<{
    id: string
    startBar: number          // inclusive, one-based
    endBar: number            // inclusive, one-based
    division: 1 | 2 | 4 | 8 | 16 | 32
  }>
}
```

Do not persist every predicted grid line. Derive them from `MusicTiming`.
Persisting the compact definition avoids thousands of redundant Yjs objects and
makes changing BPM or downbeat instant. Detected transients stay attached to
the source audio because they are evidence from that particular file.

The timeline conversion from source to scene time is:

```text
sceneTime = audio.startTime + (sourceTime - audio.trimStart) / playbackRate
```

Looped clips repeat the derived grid inside the visible clip range.

## User flow

### Analyse

In the Audio tab, selecting an audio clip reveals a compact music strip:

- **Analyse beats** button, then progress/cancel.
- Detected BPM with confidence and nearby tempo candidates.
- Editable BPM, downbeat, and meter (`4/4` initially).
- Strong transient ticks over the waveform.
- Beat ticks and stronger bar lines on the shared ruler.

Analysis should run in a Web Worker. The current pure PCM API makes that move
mechanical; decoding remains in the renderer through `AudioContext`.

### Subdivide bars

Dragging across the musical ruler selects whole bars. A small popover offers:

- Quarter notes
- Eighth notes
- Sixteenth notes
- Custom division
- Clear override

An override can cover one bar or any contiguous bar range. Later overrides win
when regions overlap. The default grid remains one marker per beat.

### Sync animation

With keyframes selected, **Sync to beat** uses this range precedence:

1. Selected musical bar range.
2. Isolated timeline section.
3. Work area.
4. Selected keyframes' current span.

The operation enumerates note boundaries in the range and spreads keyframes in
stable time order across unique slots, including both range boundaries.
Keyframe values, easing, grouping, and stagger membership do not change. If
there are more keyframes than slots, the operation does not stack them; it
offers a finer subdivision.

Dragging keyframes should also snap to note markers. Holding Option/Alt keeps
the existing snap-bypass behavior.

## Agent and CLI surface

To make requests such as “analyse this audio, split bars 5–8 into sixteenths,
and sync these keyframes” deterministic, add three MCP tools after the scene
schema lands:

```text
analyze_audio(scene, audioNodeId)
set_beat_grid(scene, audioNodeId, bpm?, firstBeatTime?, meter?)
sync_keyframes_to_beat(scene, trackIds/keyframeIds, barRange, division?)
```

`analyze_audio` writes analysis suggestions and the initial music timing in one
undoable patch. `set_beat_grid` captures user corrections and subdivisions.
`sync_keyframes_to_beat` reports old/new times and refuses ambiguous targets.
The desktop UI should call the same domain functions, not a second algorithm.

## Implemented in this branch

- Versioned beat analysis and musical-grid data persist on audio nodes and
  survive desktop/CLI `.hype` round trips.
- The selected clip exposes Analyse, BPM, confidence, meter, downbeat, volume,
  bar subdivision, half/double-tempo correction, and Sync controls in a compact
  full-width Audio toolbar.
- Transients stay on the waveform. Beats, subdivisions, and bar boundaries
  render on the shared seconds ruler, with a slim lane reserved for selecting
  bar ranges.
- Low-confidence half-time and dotted-quarter ambiguities are resolved against
  strong double-time and 3:2 candidates; candidate evidence remains available
  for manual correction.
- Tempo scoring combines the full-band onset envelope with a bass-focused
  envelope so dense hats and five-accent figures do not outrank the underlying
  quarter-note pulse (for example, ~95 BPM over a true 75 BPM track).
- Bar clicks select one bar; Shift-click extends to a multi-bar range. Quarter,
  eighth, and sixteenth-note overrides can be applied immediately.
- Selected keyframes spread over unique note slots in one transaction, and
  ordinary keyframe dragging now snaps to the active musical grid. Concurrent
  property keyframes stay together as one musical event, and a full set of
  quarter/eighth/sixteenth events maps one-to-one to the note attacks inside
  the bar instead of stretching onto the next bar boundary.

## Delivery slices

1. **Complete** — analysis/grid/alignment engine and synthetic click-track
   tests.
2. **Complete** — desktop and CLI persistence for analysis and musical intent.
3. **Complete** — Audio timeline controls, markers, and clip volume.
4. **Complete** — bar-range subdivision editing.
5. **Complete** — selected-keyframe sync and beat snapping.
6. **Next** — first-class MCP analysis, grid editing, and sync commands.

## Trade-offs and growth path

- Browser-side onset autocorrelation is private, offline, and dependency-light,
  but complex music will need manual correction. A future optional Essentia or
  aubio WASM analyser can implement the same result contract.
- One constant tempo and time signature covers the first useful release.
  `MusicTiming` should migrate later to ordered tempo/meter segments for live
  recordings and songs with changes.
- Base64 audio keeps current scene portability but makes large analyses costly
  to decode. Content-addressed assets and cached analysis hashes should arrive
  with the broader asset-storage work.
- Full Logic-style audio editing is intentionally out of scope: this feature
  supplies musical timing for motion design, not destructive waveform editing.
