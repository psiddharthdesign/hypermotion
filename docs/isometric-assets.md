# Isometric assets — first version

This first version adds editable solid shapes and a small asset kit to the
existing layer and keyframe workflow. It is the foundation for a larger 3D
creation workspace, not a mesh-modeling editor.

## Create a scene

1. Open **Assets**, then **View in isometric**. The current camera changes to
   orthographic projection; existing zoom and position stay intact.
2. Add a **Block**, **Platform**, or **Server stack**. Each asset is an ordinary
   group of editable layers. Expand it in Layers to select its parts.
3. Select a rectangle or complete ellipse. In **Properties → 3D depth**, enable
   depth and change **Depth** or **Side color**. The body extends behind its front
   face; width, height, front fill, transforms, and opacity use the normal controls.
4. Switch among the four camera views with **Option/Alt + 1–4**, or choose a view
   near the top of camera Properties. Rotate X, Y, and Z for other orthographic
   angles. Choose a preset again to restore an exact isometric angle.
5. Choose a camera composition guide from its dropdown. These overlays are fixed
   to the output frame and are not exported. They do not snap or define a drawing
   plane. See [camera guides](camera-guides.md).

Front faces retain the layer's painted appearance. Sides and backs use one color
with restrained face shading. Visible body sides can be clicked to select the
layer. Opaque solids use depth to overlap; ordinary flat layers keep their
existing layer ordering.

## Animate and loop

Depth has a keyframe diamond and supports Auto Key, scrubbing, undo, and saved
projects. Move, rotate, scale, or animate asset groups using existing controls.
The same scene data drives editor and export rendering.

In **Assets → Motion loop**, select a group or layer, choose **Float** or **Spin**,
an axis, and a duration. The cycle starts at the playhead. Float returns to its
starting position; Spin makes one full turn. Both create normal editable
keyframes. The default duration reaches the scene end. For a continuously
looping export, start at zero and use the full scene duration. A shorter cycle
holds its end pose afterward; this is not an automatic repeat modifier.

If the chosen property already has keyframes, nothing changes until you use the
explicit replacement button. Replacement affects that property only and can be
undone as one edit. Selecting a group and its children animates only the group.

## Supported shapes and current limits

- Rectangles with square or uniform round corners, and complete ellipses. Rings,
  arcs, independent corners, and smoothed corners render flat until their shape
  settings are compatible; saved depth values and animation are retained.
- Front-face paint effects remain available. Sides are plain shaded surfaces;
  front effects are not wrapped around the body.
- Full depth-of-field blur for solid silhouettes is not implemented. A camera's
  existing focus blur can affect a front face while its body edges remain sharp.
  Keep depth of field off for consistent solid silhouettes in this first version.
- Translucent intersecting solids do not have order-independent transparency.
- Ground planes, world-space grids, snapping, face drawing/push-pull, custom
  meshes, connectors, cast shadows, reusable user templates, and automatic
  repeating motion are follow-up work.

## Scene authoring

Rectangles and ellipses accept:

```json
{ "extrusion": { "depth": 96, "sideColor": "#3787EF" } }
```

Omitting or clearing `extrusion` leaves the original flat layer. Depth is clamped
from 0 to 100000 composition pixels. An enabled setting with depth 0 remains a
depth-tested front surface, useful for details placed on a solid. Animate depth
with the semantic property `extrusion.depth`. Scene files, CLI creation and
patching preserve these settings.
