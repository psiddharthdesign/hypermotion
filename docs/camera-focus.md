# Camera focus

Enable **Camera → Depth of Field** to control sharpness.

- **Distance:** layers at the focus distance stay sharp; nearer and farther layers blur. Use **Pick focus point** to click a rendered surface and set the focus plane to the depth under the pointer. An empty click leaves picking active. This captures a fixed distance rather than following the layer.
- **Object:** focus follows the chosen layer as it moves in depth.
- **Point:** keeps a screen area sharp instead of choosing a 3D depth plane.

**Focus nearest layer** sets Distance focus to the closest painted layer in view at the current playhead. It ignores hidden, transparent empty, and offscreen planes. Both distance picking and nearest-layer focus update an existing focus-distance keyframe or create one when Auto Key is enabled.

Foreground layers are not automatically sharper: sharpness depends on their distance from the focus plane. Use Object focus to keep one moving subject sharp.

Canvas layers include transparent padding around their textures so bokeh can extend beyond their edges without clipped rectangular bands. Padding accounts for perspective, tilt, scale, and aperture stretch. It does not change the layer's authored bounds or increase the lens sample count.
