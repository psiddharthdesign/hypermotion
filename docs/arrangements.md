# Arrangements

Select visual layers and choose **Arrangement** beside Scene layers, or **Create arrangement** in the context menu. An Arrangement is its own native scene object. It does not paint or occupy an auto-layout slot. Its layers retain their hierarchy, editing controls, effects, and animation tracks.

With no layers selected, creating an arrangement adds nine editable blue squares in a 3×3 grid. Empty arrangements also offer **Add blue squares**. Selecting existing layers uses those layers instead.

Select the Arrangement in Layers to edit it. Drag its canvas handle to move the pattern. Its ordinary XYZ position, XYZ rotation, and XY scale can be animated.

## Patterns

- **Rectangular:** column count and horizontal/vertical center-to-center spacing.
- **Radial:** radius, angular spread, and Orbit. Orbit moves cards along the circumference in the ring’s local plane, keeping its XYZ tilt fixed. Animate `arrangement.orbit` from 0° to 360° for one lap, or beyond 360° for multiple laps. Card facing remains independent, including Face camera. A full circle has no duplicate endpoint.
- **Path:** ellipse, rectangle, polygon, star, or an editable cubic path. Adjust path width/height scale, polygon points, start/end trims, progress, and spread. Custom paths support XYZ anchors and handles, and use arc-length spacing. Path size sliders cover 0.1×–3× and progress covers 0–1; explicit numeric entries still support larger values and negative scale for mirroring. **Reset path layout** restores radius, size, trims, progress, and spread at the playhead, respecting existing tracks and Auto Key.
- **Spherical:** equal-area Fibonacci distribution, radius, pitch, and focus targeting. Focus 0 disables targeting; 1 targets the first member. Fractional member indices blend rotation over the shortest quaternion arc instead of stepping through intermediate members.

**3D arrangement rotation** exposes Rotate X, Rotate Y, and Rotate Z directly in the Arrangement panel. These rotate member positions around the arrangement center and each axis supports keyframes. Existing Z rotation tracks remain compatible. Sphere pitch remains an additional X offset.

**Card facing** is independent of the orbit: Face camera keeps cards aligned with the active camera even while the arrangement tilts and spins. Other orientations can follow the arrangement, face inward or outward, face the active camera, or follow a path. Each layer retains its own authored transform, so local animation remains independent of the pattern.

## Appearance and animation

Arrangement opacity multiplies each member's opacity. Front/back scale, linear or ripple scaling, direction, focus, and falloff control scale across the pattern. Non-spherical patterns also expose depth and depth anchor. Shuffle, random offset, and seed are deterministic during playback, seeking, and export.

The diamond beside each control creates a timeline track. Existing tracks and Auto Key update at the current composition-local playhead. Numeric parameters interpolate; pattern, orientation, shape, and scale mode switch at their keyframe times. Custom path geometry interpolates between matching anchor counts; a change in anchor count switches at the next keyframe. Individual squares retain independent transform, appearance, and size animation.

## Members

In Layers, each Arrangement is a collapsible group containing its members in pattern order. Selecting a card reveals its group. Drag cards into the group to add them, reorder them inside it, or drag them out to detach. This grouping preserves their layout parents and animation.

Choose a layer to add it. Drag a member row, or use its arrow buttons, to change pattern order without changing the scene's layer stack. Choose a replacement layer, then use Replace on the member row. Duplicate copies the arrangement, its members, and their tracks.

Detach keeps the selected layer at its current pose. Dissolve removes the Arrangement and retains all members at their current poses and opacity. Member animation tracks are retained. These operations are undoable. Locked members must be unlocked before detaching or dissolving.

## Scene files and agents

Saved `.hype` files store the object as `kind: 'arrangement'`, parented to the composition root. Its `arrangement` field contains `version: 1`, `mode`, ordered `memberIds`, numeric parameters, `orientation`, `scaleMode`, `shape`, and an optional custom `path`.

Members use the shared transform relationship schema: `transformParent: { nodeId: arrangementId, inverseBind }`. The inverse bind translates the member's captured world center to the arrangement's local origin. This preserves authored transforms and animation as independent offsets. Arrangement-specific slots are evaluated before this matrix.

Numeric track identifiers use `arrangement.<parameter>`, for example `arrangement.radius`, `arrangement.spacingX`, `arrangement.progress`, `arrangement.opacity`, and `arrangement.focusTarget`. JSON import, composition duplication, and scene transfer remap membership and relationship IDs together.

## Camera depth of field

Distance focus uses the cards’ final 3D positions, including arrangement tilt, orbit, and member keyframes. Sharpness depends on distance from the focus plane; the nearest card is not automatically the sharpest. In Camera → Depth of Field, **Focus nearest layer** sets Distance focus to the closest rendered layer in view at the current playhead, updating an existing focus-distance track or Auto Key. Use Object focus to follow one card as it orbits. Point focus instead creates a sharp screen area.
