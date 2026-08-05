# Audio timing

## Timing hierarchy

1. Align meaning to narration phrases.
2. Align scene structure to musical bars or major transients.
3. Align action accents to nearby beats or subdivisions.
4. Leave supporting interpolation unsnapped when it reads more naturally.

## Music

- Use detected tempo only when confidence is sufficient.
- Keep tempo analysis as evidence until the grid is explicitly applied.
- Prefer downbeats for scene changes and strong product outcomes.
- Use subdivisions sparingly for short staggers and click feedback.
- Keep concurrent property keyframes that form one visual event together.

## Narration

- Prefer word- or phrase-level timestamps.
- Show the subject slightly before or as it is named.
- Let the visual consequence follow the spoken action.
- Do not cut away before the phrase resolves.
- Use a supplied transcript when automatic transcription is unavailable or uncertain.

## Mixed audio

Map semantic actions to narration, then choose the nearest non-conflicting musical accent. Do not move a semantic action far enough to misrepresent the narration merely to hit a beat.

## Master soundtrack and Scene windows

- Keep the continuous score or narration as parentless, Master-owned audio.
- Add scene-specific voiceover, clicks, impacts, or sound design as audio parented under that Scene root.
- For a selected occurrence, translate Scene time to Master time with
  `masterStart + sceneTime - sourceStart`.
- Preview and export the same translated Master slice; do not restart the score at zero when entering a Scene.
- Project Master bar numbers, beats, subdivisions, and snap points into the Scene-local timeline. Preserve the original bar number when a Scene starts mid-song and clip guides to the occurrence's visible source range.
- Keep projected timing guides visible when the occurrence's Master bed is muted.
- Use the occurrence mute only for the borrowed Master bed. Scene-local overlays remain audible and editable.
- When a Scene composition is reused, resolve timing from the selected occurrence id rather than guessing from the composition id.

## Holds

- Establish unfamiliar product screens before zooming.
- Hold benefit text long enough to read aloud once.
- Keep the final logo legible for at least a brief intentional hold; extend it when the call to action carries detail.
