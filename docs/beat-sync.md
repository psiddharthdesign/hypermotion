# Beat sync exploration

## Outcome

Beat sync belongs in the existing **Audio** timeline mode. An imported audio
clip can be analysed locally, show musical markers in a dedicated ruler aligned
with the seconds timeline, accept bar-specific note subdivisions, and retime
selected keyframes onto the musical grid.

The implementation should keep three concepts separate:

1. **Audio evidence** — detected transients and tempo candidates.
2. **Musical intent** — explicitly applied BPM, optional lead-in, time
   signature, bar-specific note divisions, and swing.
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
  generation, and collision-safe nearest-point quantization for every surface
  to share.

## Proposed data model

Persist evidence on the analysed audio node:

```ts
interface AudioBeatAnalysis {
  algorithmVersion: 3
  status: 'ok' | 'ambiguous' | 'no-pulse'
  bpm: number
  confidence: number
  firstBeatTime: number       // source-relative seconds
  candidates: Array<{
    bpm: number
    confidence: number
    relationship?: 'direct' | '3:2' | '2:3'
    firstBeatTime?: number
  }>
  transients: Array<{ time: number; strength: number }>
  beatTransients: Array<{ time: number; strength: number }>
}
```

Persist editable musical intent on the analysed audio node:

```ts
interface AudioBeatGrid {
  version: 1
  bpm: number
  firstBeatTime: number       // source-relative; mapped through trim/start/rate
  beatsPerBar: number         // default 4
  beatUnit: 1 | 2 | 4 | 8 | 16 | 32
  swingPercent: number        // 50 straight; 66.7 approximates triplet swing
  subdivisions: Array<{
    id: string
    startBar: number          // inclusive, one-based
    endBar: number            // inclusive, one-based
    division: 1 | 2 | 4 | 8 | 16 | 32
  }>
}
```

Do not persist every predicted grid line. Derive them from `AudioBeatGrid`.
Persisting the compact definition avoids thousands of redundant Yjs objects and
makes changing BPM or the Bar 1 anchor instant. Detected transients stay attached to
the source audio because they are evidence from that particular file.

The timeline conversion from source to scene time is:

```text
sceneTime = audio.startTime + (sourceTime - audio.trimStart) / playbackRate
```

Looped clips repeat the derived grid inside the visible clip range.

## User flow

### Analyse

Selecting an audio clip reveals a compact Beat section in its Audio inspector:

- **Analyse beats** button with a clear in-progress state.
- Detected BPM with evidence strength, ambiguity status, and nearby candidates.
- A proposal-only detected tempo action plus an independently staged manual
  BPM field. Neither analysis nor typing changes the grid until Apply.
- An editable lead-in duration with Clear and an optional detected-start
  shortcut. Every tempo Apply starts Bar 1 with the audio on the timeline; a
  lead-in only appears after an explicit lead-in edit.
- Editable meter (`4/4` initially).
- Beat, subdivision, and bar markers in a dedicated musical ruler below the
  seconds/frame ruler. Timing markers do not overlay the audio clip waveform.

Analysis runs locally after renderer-side `AudioContext` decoding. The analysis
API is pure PCM, so moving the heavier pass into a Web Worker remains a
mechanical performance follow-up rather than a schema change.

The detector exposes the strongest directly observed pulse and nearby
candidates instead of treating one number as infallible. It also considers
`3:2` and `2:3` compound relationships. A compound candidate is promoted only
when additional quarter-grid evidence repeats across multiple analysis windows
and explains most of the detected onset strength. An isolated fill or a
persistent low-level subdivision is not enough. Ambiguous results remain
reviewable and the user can set BPM or bar one manually.

The musical ruler never stretches Bar 1 to cover audio before its anchor. An
explicit lead-in renders as a separate neutral region, while every measured bar
keeps the same duration. If the clip is trimmed into a later bar, the visible
partial region retains the number of the bar it actually intersects.

### Subdivide bars

Dragging across the musical ruler selects whole bars. A small popover offers:

- Quarter notes
- Eighth notes
- Sixteenth notes
- Custom division
- Clear override

An override can cover one bar or any contiguous bar range. Later overrides win
when regions overlap. The default grid remains one marker per beat.

### Add swing

Swing is part of the editable beat grid:

- `50%` is straight timing.
- `66.7%` approximates triplet swing.
- The UI and domain model clamp the control to `50–75%`.

Swing delays every second subdivision within a beat pair. Beat positions and bar
boundaries remain fixed, so changing swing does not move bar one. Swing affects
eighth- and sixteenth-note grid targets; quarter-note targets remain unchanged.

### Sync animation

With keyframes selected, **Sync to beat** uses this range precedence:

1. Selected musical bar range.
2. Isolated timeline section.
3. Work area.
4. Selected keyframes' current span.

The operation enumerates swung note boundaries from the selected range forward
and snaps each musical event to its nearest available point.

Coincident property keyframes remain one intentional event. Distinct events
never overlap: when a point is occupied, the later event cascades to the next
matching point, continuing forward when necessary. Keyframe values, easing,
grouping, and stagger membership do not change.

Re-snapping an already aligned selection is an explicit spacing operation. If
the chosen bar range would spread events farther apart or compress them closer
together, the editor previews the current and proposed average gap in a
confirmation dialog. Cancel keeps every keyframe in place. Confirm distributes
events by musical note-slot ordinal, preserves coincident property events, and
uses the same forward collision rule; a dense result may therefore continue
past the selected bar rather than overlap keyframes or silently change the
subdivision.

Dragging keyframes also snaps to the active beat markers. Holding Option/Alt
keeps the existing snap-bypass behavior.

## Agent and CLI surface

To make requests such as “analyse this audio, split bars 5–8 into sixteenths,
and sync these keyframes” deterministic, add three MCP tools after the scene
schema lands:

```text
analyze_audio(scene, audioNodeId)
set_beat_grid(scene, audioNodeId, bpm?, firstBeatTime?, meter?, swingPercent?)
sync_keyframes_to_beat(
  scene,
  trackIds/keyframeIds,
  barRange,
  division?,
)
```

`analyze_audio` writes evidence and tempo suggestions without changing the
applied musical grid. `set_beat_grid` is the explicit commit surface for tempo,
lead-in/Bar 1 anchor, meter, swing, and subdivisions.
`sync_keyframes_to_beat` reports old/new times and refuses ambiguous targets.
The desktop UI should call the same domain functions, not a second algorithm.

## Implemented in this branch

- Versioned beat analysis and musical-grid data persist on audio nodes and
  survive desktop/CLI `.hype` round trips, including compound-tempo
  relationships and swing.
- The selected clip exposes Analyze, proposal-only BPM evidence, an explicit
  manual Apply action, meter, independently editable lead-in, volume,
  half/double-tempo correction, and swing in the Audio inspector.
  Bar subdivisions and keyframe sync stay in a compact timeline action row
  beside their range.
- The seconds/frame ruler remains strictly absolute time. Beats, subdivisions,
  bar boundaries, and bar-range selection render in a separate musical ruler
  directly beneath it instead of overlaying the waveform.
- Analysis reports `no-pulse` for silence/noise and `ambiguous` when competing
  tempo peaks are too close to apply safely. Nearby local-maxima candidates
  remain available for manual correction. Repeated exclusive quarter-grid
  evidence that also explains most onset strength can conservatively recover a
  `3:2` tempo (for example, 135 BPM from a dominant 90 BPM pulse), while
  isolated fills and persistent low-level subdivisions do not trigger
  promotion.
- Tempo evidence combines full-band and bass-focused onset envelopes, uses
  mean-centred autocorrelation and multi-segment consensus, and preserves
  stereo energy without cancelling antiphase channels.
- Bar clicks select one bar; Shift-click extends to a multi-bar range. Quarter,
  eighth, and sixteenth-note overrides can be applied immediately.
- Selected keyframe events snap to their nearest unique note slots in one
  transaction, and ordinary keyframe dragging now snaps to the active musical
  beat markers. Concurrent property keyframes stay together as one musical
  event.
  Collisions push later events forward, including into following bars, instead
  of stacking keyframes or forcing a finer subdivision.
- Beat-grid sync supports `50–75%` swing.
- Already-snapped events prompt before a changed bar range increases, decreases,
  or redistributes their spacing. The proposal is revalidated before commit and
  cancellation preserves the active layer, track, and keyframe selection.
- Switching between Properties and Animate—and then using Animate controls—
  preserves timeline selections. Dragging the visible playhead from the track
  area scrubs without creating a marquee, and timeline drags no longer create
  native browser text highlights over chapter
  or musical-ruler labels.

## Delivery slices

1. **Complete** — analysis/grid/alignment engine and synthetic click-track
   tests.
2. **Complete** — desktop and CLI persistence for analysis and musical intent.
3. **Complete** — Audio timeline controls, markers, and clip volume.
4. **Complete** — bar-range subdivision editing.
5. **Complete** — selected-keyframe sync and beat snapping.
6. **Complete** — compound-tempo recovery and swing-aware grid sync.
7. **Next** — first-class MCP analysis, grid editing, and sync commands.

## Trade-offs and growth path

- Browser-side onset autocorrelation is private, offline, and dependency-light,
  but complex music still needs review and manual correction. `status` and
  candidate evidence are part of the contract so the UI never has to present
  an ambiguous estimate as ground truth. A future model-backed analyser can
  implement the same result contract.
- Instrument-specific sync is deferred. The experimental frequency-band
  heuristic was removed because it could not reliably identify instruments in
  mixed music. Kick, snare, and hi-hat targeting should return only after a
  validated transcription or source-separation pipeline meets an explicit
  accuracy benchmark on representative tracks.
- One constant tempo and time signature covers the first useful release.
  `AudioBeatGrid` should migrate later to ordered tempo/meter segments for live
  recordings and songs with changes.
- Base64 audio keeps current scene portability but makes large analyses costly
  to decode. Content-addressed assets and cached analysis hashes should arrive
  with the broader asset-storage work.
- Full Logic-style audio editing is intentionally out of scope: this feature
  supplies musical timing for motion design, not destructive waveform editing.
