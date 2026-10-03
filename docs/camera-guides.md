# Camera composition guides

Select a camera and open **Properties → Composition guides → Grid overlay**.
Choose **Off** to hide the guide, or one of these patterns:

| Guide | Use |
| --- | --- |
| Rule of thirds | Place subjects at the thirds or their intersections. |
| Center cross | Align a subject or a symmetrical composition with the centre. |
| Diagonals | Frame movement or arrange objects along corner-to-corner lines. |
| Diamond | Compose around a central diamond joining the frame's edge midpoints. |
| Diamond grid | Align a repeated diagonal arrangement. |
| Isometric grid | Align assets to the 30° diagonals and vertical axis of an isometric view. |
| Golden ratio | Use divisions at roughly 38.2% and 61.8% of the frame. |
| Grid (6 × 6) | Compare spacing and alignment across the frame. |
| Safe areas | Check action inside the outer 90% frame and titles inside the inner 80% frame. |

Guides stay fixed to the camera frame while the camera or scene animates.
They do not intercept selection or dragging, and their line thickness stays
consistent as you zoom the workspace. Each camera stores its own choice with
the project. New cameras and older scenes default to **Off**.

These are editor guides: they never appear in exported videos, GIFs, or still images and do
not affect depth of field, scene layout, or rendering. They are independent
of the focus-plane guide and frame layout guides.

Scene authoring uses the camera's static `compositionGuide` field:
`none`, `thirds`, `center`, `diagonals`, `diamond`, `diamond-grid`,
`isometric`, `golden-ratio`, `grid`, or `safe-areas`. Unknown values resolve to `none`.

## Isometric camera views

Select a camera, then choose **Properties → Camera view → Isometric view**.
The preset switches that camera to orthographic projection and sets an equal-axis
view above the XY ground plane. Height rises along negative Z; positive Z extends
behind the top surface. Choose another preset or use **Alt/Option+1** (Front left),
**Alt/Option+2** (Front right), **Alt/Option+3** (Back left), or
**Alt/Option+4** (Back right). Shortcuts affect the camera currently shown in
the viewport and do not run while typing in fields. View changes support undo.

Zoom and pan stay unchanged when switching views. Use **Zoom** or the scroll
wheel to change size, Shift-scroll to pan, and Option-drag to orbit freely.
Choose a preset again to restore its exact isometric angle. Auto Key records
view angles and navigation; existing rotation tracks are updated at the playhead.
The zoom diamond records one uniform zoom track (`transform.scaleX`) for both
view axes. Legacy camera `scaleY` values are retained in saved files but do not
stretch the view or affect zoom animation. Rotate X tilts the view, Rotate Y
orbits sideways, and Rotate Z rolls it. Free rotation retains orthographic
projection; choose an isometric preset to restore its exact angles.

Animated layers, motion paths, stagger, camera cuts, and exports all use the
camera projection. Orthographic depth changes position and occlusion without
perspective shrinking. Switch **Projection** back to **Perspective** for a
perspective lens. The grid can be changed independently under **Composition
guides**; applying the first preset adds an isometric grid if guides were Off.
