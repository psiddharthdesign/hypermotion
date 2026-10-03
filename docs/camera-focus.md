# Camera focus

Enable **Camera → Depth of Field** to control sharpness.

- **Distance:** layers at the focus distance stay sharp; nearer and farther layers blur. Use **Pick focus point** to click a rendered surface and set the focus plane to the depth under the pointer. An empty click leaves picking active. This captures a fixed distance rather than following the layer.
- **Object:** focus follows the chosen layer as it moves in depth.
- **Point:** keeps a screen area sharp instead of choosing a 3D depth plane.
- **Focus plane:** move and tilt an independent plane anywhere in 3D. Surfaces become sharp where they cross it. Position X/Y/Z, Tilt X/Y, and Rotate Z work in perspective and isometric views and support keyframes.

**Focus nearest layer** sets Distance focus to the closest painted layer in view at the current playhead. It ignores hidden, transparent empty, and offscreen planes. Both distance picking and nearest-layer focus update an existing focus-distance keyframe or create one when Auto Key is enabled.

Foreground layers are not automatically sharper: sharpness depends on their distance from the focus plane. Use Object focus to keep one moving subject sharp.

Canvas layers include transparent padding around their textures so bokeh can extend beyond their edges without clipped rectangular bands. Padding accounts for perspective, tilt, scale, and aperture stretch. It does not change the layer's authored bounds or increase the lens sample count.

## Move a focus plane

Choose **Focus plane** under **Focus mode**. Enable **Show focus plane** to reveal its in-view and depth handles. **Distance from camera** moves the plane along the view direction; hold Shift while dragging or using arrow keys for 10× steps. **Align plane with camera** makes the plane parallel to the camera. Focus position and tilt remain independent of the camera view preset.

Use a low F-Stop for a narrower sharp region, then adjust the plane distance or tilt until the desired surfaces cross it. Objects closer to the camera are not automatically in focus. A tilted plane can keep a diagonal row sharp or isolate a strip across a flat surface.

Focus-plane rendering evaluates depth across flat layer surfaces, including tilted text and images. Extruded solids currently retain sharp body edges even when their painted front face blurs; full solid-silhouette depth of field is not yet supported.
