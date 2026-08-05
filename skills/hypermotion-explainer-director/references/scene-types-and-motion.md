# Scene types and motion grammar

## Text

Use for hooks, bridges, benefits, and calls to action. Keep one primary thought. Prefer one signature reveal such as word stagger, mask reveal, or spatial settle. Avoid combining letter animation, camera movement, background motion, and decorative particles at equal strength.

## Product demo

Establish the full screen, focus the action target, show cause, transition state, and confirm the result. Preserve enough context that the viewer understands where the feature lives.

## Feature callout

Use a highlight, crop, magnifier, label, focus plane, or semantic 3D separation. Maintain one unmistakable focal subject. Keep callout lines and text stable while the product surface moves.

## Comparison

Hold camera and scale consistent across both states. Change only what supports the claim. Use split, wipe, matched cut, or variant transition based on the relationship.

## Logo outro

Use the approved logo asset and profile. Resolve cleanly, avoid arbitrary deformation, and hold the final mark. Keep the outro short unless it also contains a call to action.

## Timing ranges

Treat these as starting ranges, not fixed rules:

- Immediate feedback: 0.10–0.18 seconds.
- UI state change: 0.18–0.35 seconds.
- Camera focus or layout reveal: 0.35–0.80 seconds.
- Text scene entrance: 0.35–0.75 seconds.
- Scene transition: 0.20–0.50 seconds.

Use faster exits, usually about 70–80% of the matching entrance. Prefer natural exponential deceleration. Avoid bounce and elastic easing unless an approved brand profile explicitly requires them.

## 3D rules

- Create depth to explain hierarchy or causality.
- Keep the focused surface nearest the camera and readable.
- Preserve parent/child depth with `group3d` only when needed.
- Use shallow rotations first; increase perspective only when it clarifies structure.
- Return exploded layers to a coherent screen before leaving the scene unless the transition intentionally carries them forward.
