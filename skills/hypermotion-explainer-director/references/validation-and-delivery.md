# Validation and delivery

## Structural checks

- Scene validates with no missing parents, children, camera, track targets, or invalid keyframe properties.
- Composition scenes and sequence items are ordered, every item references a
  live composition, transitions fit their neighboring durations, and the
  resolved master duration matches the intended video.
- Each composition owns only live cameras, has a valid enabled default, and
  every camera cut targets an owned camera within scene-local duration.
- Scene groups are hidden outside their intervals.
- Audio begins, trims, loops, and ends as intended.
- Render duration matches the brief.

## Visual checks

Review at least:

- First visible frame.
- Midpoint and hero moment of every scene.
- Both sides of every transition.
- Product click, loading, success, and error states used.
- Final logo frame.

Check for empty frames, clipped text, unreadable scale, stale state, raster blur, unintended overlaps, sudden camera jumps, excessive depth, and background flashes.

## Timing checks

- Each scene communicates one idea.
- Narration refers to what is visible.
- Beat accents do not distort semantic timing.
- Text has sufficient reading time.
- The final frame has an intentional hold.

## Delivery

Return:

- Editable `.hype` scene path.
- Final media path and format.
- Canvas, duration, frame rate, and quality.
- Any raster fallbacks, missing optional capabilities, or intentional brand exceptions.
