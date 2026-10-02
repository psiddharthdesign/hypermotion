# Isometric assets — first version

Build editable solid assets, pull their faces, and attach animated flow lines
using the existing layer and keyframe workflow.

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

## Pull a face and resize a cylinder

Select an asset group or one of its solid parts, then choose **Edit 3D faces**
in Properties or Assets. Hover a visible face to highlight it and see its size.

- Pull a front or back cap to change depth. The opposite cap stays fixed.
- Pull a block side to change width or height.
- Pull a cylinder side to change both diameters while keeping its proportions.
  Pull its cap to change its height. For exact elliptical dimensions, select its
  body and use **Size → Diameter X / Diameter Y** and **3D depth → Height**.
- Hold **Shift** during a drag for 10× movement. **Escape** cancels; each completed
  drag is one undo. **Finish editing faces** returns to normal selection.

Face edits support Auto Key and existing tracks for dimensions, depth, and any
position compensation that keeps the opposite face fixed. Changing tools,
selection, or starting playback leaves the editing gesture safely.

## Focus controls in isometric view

Select the camera, enable **Depth of field**, then choose **Focus plane** under
**Focus mode**. Position X/Y/Z, Tilt X/Y, Rotate Z, Distance from camera, and
Align plane with camera are available in both perspective and orthographic
views. Show focus plane enables the in-view and depth drag handles. Hold Shift
for 10× steps. These fields retain keyframes and saved project values.

Isometric presets change the camera angle and projection; they do not remove
focus modes. Existing flat layers can use depth focus. Full blur around the
silhouette of extruded bodies remains a limitation described below.

## Snap and protect individual assets

In **Assets**, enable **Snap to grid** and choose 16, 32, 64, or 128 px spacing.
The editor shows a matching world-space ground grid. Moving a solid or asset
group snaps its footprint center; pulling a face snaps the edited dimension.
The grid follows the camera, and is hidden during playback and export.

Select an asset and enable **Properties → Prevent overlap** when it should stay
separate. This setting is saved on that asset. A protected group includes all its
solid parts; its own parts may intersect. A child shows inherited protection
from its group. Two unprotected assets can overlap freely. If either asset is
protected, dragging either one stops at contact. Touching and stacking are
allowed, and existing intersecting assets can move out without getting trapped.

Protection applies to canvas movement, face extension, and single-selection
Position X/Y/Z fields. Typed positions retain exact precision rather than
snapping. Contact takes priority when it falls between grid cells. Hold
**Option/Alt** during a canvas drag to bypass both constraints temporarily.
These are authoring aids, not a physics simulation: playback, multi-selection
numeric edits, numeric dimensions, rotations, and scale are not collision-resolved.
Rounded boxes use conservative box bounds; cylinders use a close polygonal bound.

## Connect assets and animate flow

Select two separate, visible, unlocked assets, then choose
**Assets → Connect selected assets**. A native connection layer appears in Layers.
It attaches near the asset bases and recomputes its endpoints as they move,
rotate, resize, or animate. Click the line or its Layers row to edit it.

In **Properties → Connection** choose **Elbow** or **Straight**, line color and
width. **Animated flow** adds moving pulses; adjust color, speed, spacing, and
size. The first selected asset is the source. Swap source and target to reverse
which end leads, or use negative speed to reverse flow.

Line width, flow speed, and phase have keyframe diamonds. For a controlled loop,
set speed to zero and animate **Flow phase** from 0% to 100% over the cycle. Flow
uses scene time, so playback, seeking, and exports agree. Hidden or missing
endpoints hide the connection without deleting it. Undoing endpoint deletion
restores the line.

Elbow routing automatically joins the endpoints along world axes; it does not
find paths around other assets. Connections use opaque colored tubes and pulses;
vector drawing, per-layer paint effects, and solid-silhouette depth-of-field are
not applied to this geometry. Camera-wide post effects still apply.

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
- Painted ground planes, drawing new regions on faces, custom meshes, cast
  shadows, reusable user templates, and automatic
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
patching preserve these settings. Add `preventOverlap: true` to a solid or its
asset group for placement protection; omit it or set false to disable it. This
flag is an editing preference, not a keyframeable property.


Connections are vector layers with an optional `connection` object:

```json
{
  "connection": {
    "version": 1,
    "sourceId": "server",
    "targetId": "platform",
    "routing": "elbow",
    "color": "#2563eb",
    "width": 4,
    "flowEnabled": true,
    "flowColor": "#93c5fd",
    "flowSpeed": 120,
    "flowSpacing": 120,
    "flowSize": 12,
    "flowPhase": 0
  }
}
```

Author these layers under the composition root. Their transform and storage size
are not the line's geometry: the endpoint assets define it. Animate
`connection.width`, `connection.flowSpeed`, and `connection.flowPhase`.
