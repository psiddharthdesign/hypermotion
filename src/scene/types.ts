// SPDX-License-Identifier: Apache-2.0

/**
 * Scene graph types.
 *
 * These are the plain TypeScript shapes. The on-disk format is Yjs and
 * lives in src/scene/doc.ts — conversion between Y.Map and these types
 * happens at the API boundary so UI code never sees a Y.Map.
 *
 * Discriminated union by `kind` so TS narrows cleanly in switch/case.
 * Every node carries a name, parent pointer, and children list for
 * tree navigation; kind-specific fields live on the narrowed subtypes.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type NodeId = string
export type TrackId = string
export type KeyframeId = string
export type ComponentId = NodeId

/** Size in canvas pixels, or an intrinsic-sizing token. */
export type SizeAxis = number | 'hug' | 'fill'

export interface Size {
  width: SizeAxis
  height: SizeAxis
}

export interface Padding {
  top: number
  right: number
  bottom: number
  left: number
}

/**
 * Transform is applied AFTER layout. Inside an auto-layout parent, x/y
 * are offsets from the slot the parent gave this node (so animating x/y
 * won't knock siblings around). Outside auto-layout, x/y are absolute.
 *
 * `z` is a 2D-faked depth on the camera's optical axis. Default 0
 * means "in the focal plane." Negative values sit behind the focal
 * plane, positive values in front. The unit is arbitrary but
 * interpretable — most scenes will use small integers (e.g.
 * foreground=10, focal=0, background=-10).
 *
 * `z` does NOT affect layout or paint order — it's purely a 3D
 * positional offset. Paint order still follows tree position.
 */
export interface Transform {
  x: number
  y: number
  /**
   * Z-axis rotation (the screen-plane spin). Kept as `rotation` rather
   * than `rotationZ` so existing data, presets, and the property
   * registry don't need a wholesale rename. Aliased semantically as
   * "Rotate Z" in the UI for cameras and any other 3D-aware node.
   * Degrees.
   */
  rotation: number
  scaleX: number
  scaleY: number
  /** Depth on the camera's optical axis. 0 = focal plane. */
  z: number
  /**
   * X-axis rotation: tilt up/down. Degrees. Used today by cameras to
   * pitch the view; for non-camera nodes the renderer applies it as
   * a CSS rotateX so any layer can become a 3D plane. Default 0.
   */
  rotationX: number
  /**
   * Y-axis rotation: pan left/right. Degrees. Used today by cameras
   * to yaw the view; for non-camera nodes the renderer applies it as
   * a CSS rotateY. Default 0.
   */
  rotationY: number
}

// ---------------------------------------------------------------------------
// Layout (Yoga-backed)
// ---------------------------------------------------------------------------

export type FlexDirection = 'row' | 'column'
export type FlexJustify = 'start' | 'center' | 'end' | 'space-between' | 'space-around'
export type FlexAlign = 'start' | 'center' | 'end' | 'stretch'

/**
 * Layout mode for a frame (or component / root).
 *
 *   - 'none'  — children are positioned freely by their own transform.
 *               Mirrors Figma's "no auto layout" state. Yoga still runs
 *               but children get positionType=absolute so they ignore
 *               flex and stay where transform.x/y puts them.
 *   - 'flex'  — canonical auto layout. direction / justify / align / gap
 *               / padding / wrap drive Yoga's flex solver. What Figma
 *               and Jitter both call "auto layout".
 *   - 'grid'  — row-major grid with a fixed column count. Implemented
 *               internally as flex-row with wrap=true and a uniform
 *               column gap; `columns` forces N-per-row via percentage
 *               width on children OR we map it to Yoga when we have a
 *               real grid pass. For MVP, flex-wrap approximation is
 *               what ships.
 */
export type LayoutMode = 'none' | 'flex' | 'grid'

export interface Layout {
  /** How this container lays out its children. */
  mode: LayoutMode
  // flex fields — used when mode === 'flex'
  direction: FlexDirection
  justify: FlexJustify
  align: FlexAlign
  gap: number
  padding: Padding
  wrap: boolean
  // grid fields — used when mode === 'grid'
  /** Number of columns in the grid (minimum 1). */
  columns: number
  /** Vertical gap between grid rows. */
  rowGap: number
  /** Horizontal gap between grid columns. */
  columnGap: number
}

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

/** Color in the oklch string form used throughout the app. */
export type Color = string

/**
 * A single color stop along a gradient. `at` is a normalized 0..1
 * position (0 = first color, 1 = last color). Shared between linear and
 * radial fills because the stop editor in the Inspector works the same
 * way for both, and the renderer serializes the same shape into a CSS
 * gradient string for each.
 */
export interface GradientStop {
  at: number
  color: Color
}

/**
 * Fill styles a node's interior.
 *
 *   - 'solid'   — a single Color.
 *   - 'linear'  — colors interpolated along a straight line. `angle` is
 *                 in CSS degrees (0° points up, 90° points right,
 *                 increasing clockwise), matching `linear-gradient()`.
 *   - 'radial'  — colors interpolated outward from a center point.
 *                 `cx`/`cy` are 0..1 normalized coords within the node's
 *                 bounding box (0.5, 0.5 = center). `shape` is 'circle'
 *                 (isotropic falloff) or 'ellipse' (stretches with the
 *                 box's aspect ratio). Maps 1:1 onto CSS
 *                 `radial-gradient()`.
 *   - 'conic'   — colors swept around a center point. `angle` is the
 *                 starting angle in CSS degrees (0° = up). `cx`/`cy`
 *                 normalized 0..1. Maps onto CSS `conic-gradient()`.
 *   - 'image'   — bitmap fill. `src` is a URL or data: URL.
 *                 `fit` mirrors CSS `background-size` values: 'cover',
 *                 'contain', 'fill' (stretch to box), 'tile' (repeat
 *                 at native size).
 */
export type Fill =
  | { kind: 'solid'; color: Color }
  | { kind: 'linear'; stops: GradientStop[]; angle: number }
  | {
      kind: 'radial'
      stops: GradientStop[]
      cx: number
      cy: number
      shape: 'circle' | 'ellipse'
    }
  | {
      kind: 'conic'
      stops: GradientStop[]
      angle: number
      cx: number
      cy: number
    }
  | {
      kind: 'image'
      src: string
      fit: 'cover' | 'contain' | 'fill' | 'tile'
    }

/**
 * How the stroke line is drawn.
 *
 *   - 'solid'  — an unbroken line, rendered via box-shadow for zero-cost
 *                cooperation with border-radius. Matches what we had
 *                before the dashed option existed, so old documents
 *                default here on migration.
 *   - 'dashed' — a repeating on/off pattern. `dashLength` and `dashGap`
 *                control the segment and hole sizes in px. Rendered via
 *                an SVG overlay (box-shadow can't express dashes).
 *   - 'dotted' — a dense sequence of round dots. Internally the same
 *                SVG path as 'dashed' but with round line caps and a
 *                dash pattern of `[0, width * 2]`, which produces the
 *                crisp dot look that matches user expectation from CSS
 *                `border-style: dotted`.
 */
export type StrokeStyle = 'solid' | 'dashed' | 'dotted'

export interface Stroke {
  color: Color
  /**
   * Uniform stroke width. Used as the canonical width for all four
   * sides UNLESS `widths` is set, in which case `widths` overrides
   * per-side. Kept as a separate field rather than just storing
   * `widths.{t,r,b,l}` so old documents and the common "uniform
   * border" case stay one number, and the inspector's main Width
   * input has something to bind to.
   */
  width: number
  align: 'inside' | 'center' | 'outside'
  /** Line style; defaults to 'solid' on migration. */
  style: StrokeStyle
  /** Length of each painted segment when style is 'dashed'. */
  dashLength: number
  /** Space between segments when style is 'dashed'. */
  dashGap: number
  /**
   * Per-side stroke widths. When present (any side non-zero or
   * undefined), the renderer paints each side at its own thickness.
   * When undefined, every side uses `width`. Mirrors Figma's
   * `individualStrokeWeights` so designs with "1px bottom border only"
   * (tabs, dividers, list rows) round-trip faithfully.
   *
   * Per-side borders force the SVG-overlay render path because
   * `box-shadow` can't express different-width sides cleanly.
   */
  widths?: { top: number; right: number; bottom: number; left: number }
  /**
   * Optional paint override. When set, the stroke is painted with this
   * `Fill` instead of the flat `color` — enabling linear or radial
   * gradient strokes. Solid fills here collapse to the same visual as a
   * `color`-only stroke; the renderer still prefers `fill` so the
   * Inspector can keep one control for both.
   */
  fill?: Fill | null
}

/**
 * Layout guide — a Figma-style overlay placed on a frame to help
 * with composition. Three kinds, each with their own controls:
 *
 *   - 'grid'    — a pixel grid drawn at every `size` px, in `color`.
 *                 Lives on top of the frame's content and ignores
 *                 layout. Useful for icon work and any "stick to a
 *                 4/8/16 px rhythm" baseline.
 *   - 'columns' — vertical bands. `count` columns, painted across
 *                 the frame width. `type='stretch'` makes the bands
 *                 size from the available width; `type='fixed'` uses
 *                 `width` for each column; `type='center'` centers
 *                 a fixed-width column block within the frame.
 *                 `margin` is the inset on both sides; `gutter` is
 *                 the gap between columns.
 *   - 'rows'    — horizontal bands. Same fields as `columns`,
 *                 swapping width→height.
 *
 * Each guide carries `visible` so the user can toggle it without
 * losing its config (just like Figma's eye icon). They stack in
 * declaration order — multiple grids can co-exist on one frame
 * (e.g. a 10px pixel grid + 12-column layout).
 *
 * Stored as a flat array on `FrameNode.layoutGuides`. Default empty
 * for legacy nodes.
 */
export type LayoutGuide =
  | {
      kind: 'grid'
      visible: boolean
      /** Cell size in canvas pixels. */
      size: number
      /** Stroke color, oklch / hex / rgba — anything CSS accepts. */
      color: Color
      /** Opacity 0..1. Surfaced as a percent in the UI. */
      opacity: number
    }
  | {
      kind: 'columns'
      visible: boolean
      count: number
      color: Color
      opacity: number
      /**
       * 'stretch' — bands fill the frame width minus margin & gutters
       * 'fixed'   — bands are exactly `width` wide each, packed left
       * 'center'  — bands packed in the center, total = N × width + (N-1) × gutter
       */
      type: 'stretch' | 'fixed' | 'center'
      /** Used when type ≠ 'stretch'. Pixel width per band. */
      width: number
      /** Outer inset (left + right). */
      margin: number
      /** Gap between bands. */
      gutter: number
    }
  | {
      kind: 'rows'
      visible: boolean
      count: number
      color: Color
      opacity: number
      type: 'stretch' | 'fixed' | 'center'
      /** Used when type ≠ 'stretch'. Pixel height per band. */
      height: number
      margin: number
      gutter: number
    }

/**
 * Visual effect — extends Figma's "Effects" stack. Multiple entries are
 * composed in array order (later entries paint on top), exactly as
 * Figma does. Each entry has a `visible` flag so the user can disable
 * a row without losing its values, mirroring Figma's eye toggle.
 *
 * Drop and inner shadows carry the standard box-shadow tuple (color,
 * x/y offset, blur, spread). Blur is a layer blur applied to the whole
 * node — not a backdrop blur, which would need its own kind.
 *
 * `visible` and `spread` default to true / 0 when missing on legacy
 * effects, so older documents continue to render correctly.
 */
export type Effect =
  | {
      kind: 'shadow'
      color: Color
      offsetX: number
      offsetY: number
      blur: number
      spread?: number
      visible?: boolean
    }
  | {
      kind: 'inner-shadow'
      color: Color
      offsetX: number
      offsetY: number
      blur: number
      spread?: number
      visible?: boolean
    }
  | { kind: 'blur'; amount: number; visible?: boolean }

/**
 * Per-corner radii. Order is top-left, top-right, bottom-right,
 * bottom-left — matches Figma's `rectangleCornerRadii` and the CSS
 * `border-radius: tl tr br bl` shorthand.
 *
 * Optional. When undefined, every corner uses the uniform
 * `Appearance.cornerRadius`. When set, these four values OVERRIDE
 * the uniform value at render time, so users can keep a single
 * keyframable uniform value AND independently adjust corners by
 * promoting to per-corner mode.
 *
 * Animation: only the uniform `cornerRadius` is keyframable today.
 * Per-corner values are static. If the user wants to animate one
 * corner, they switch back to uniform first.
 */
export interface CornerRadii {
  tl: number
  tr: number
  br: number
  bl: number
}

export interface Appearance {
  opacity: number
  fill: Fill | null
  stroke: Stroke | null
  cornerRadius: number
  /** Per-corner override of `cornerRadius`. See {@link CornerRadii}. */
  cornerRadii?: CornerRadii
  effects: Effect[]
}

// ---------------------------------------------------------------------------
// Node base + variants
// ---------------------------------------------------------------------------

/**
 * Layout participation. Mirrors Figma's "Absolute position" toggle.
 *
 *   - 'flow'      — the default. Inside an auto-layout (flex/grid) parent
 *                   the child participates in the layout pass and Yoga
 *                   places it. Inside a mode='none' parent there's no
 *                   difference; the renderer composes transform.x/y on top.
 *   - 'absolute'  — the child opts OUT of its parent's auto layout. Yoga
 *                   pins it at the parent's content-box origin and the
 *                   renderer composes transform.x/y on top, so the element
 *                   stays where the user puts it even when siblings reflow.
 *                   This is what lets a designer drop a badge onto a
 *                   stack-laid-out card without disturbing the stack.
 */
export type Position = 'flow' | 'absolute'

interface NodeBase {
  id: NodeId
  name: string
  parent: NodeId | null
  children: NodeId[]
  transform: Transform
  appearance: Appearance
  visible: boolean
  locked: boolean
  /** Layout participation; 'flow' by default. See {@link Position}. */
  position: Position
  /**
   * When true, this node acts as a mask for the layer immediately
   * above it among its parent's children — Figma's mask convention,
   * where the bottom shape clips everything stacked above it within
   * the same parent. The mask shape itself does not paint normally;
   * its silhouette becomes the visible region of the masked layer(s).
   *
   * MVP scope: only the immediate next sibling is masked, and the
   * mask is treated as a clip-path on the masked layer. This covers
   * "rectangle reveal" / "circle avatar" / "rounded-frame container"
   * — the 90% of motion-graphics mask uses. Multi-layer masking
   * ("mask all upper siblings") and chained masks land later if
   * users ask for them.
   *
   * Default false. Toggle via Cmd+Opt+M (matches Figma).
   */
  isMask: boolean
}

export interface FrameNode extends NodeBase {
  kind: 'frame'
  size: Size
  layout: Layout
  clipsContent: boolean
  /**
   * Stack of layout guides to overlay on this frame in the canvas.
   * Renders in array order; later entries paint on top. Empty by
   * default. See {@link LayoutGuide} for the per-entry shape.
   */
  layoutGuides: LayoutGuide[]
}

export interface RectNode extends NodeBase {
  kind: 'rect'
  size: Size
}

export interface EllipseNode extends NodeBase {
  kind: 'ellipse'
  size: Size
}

export interface TextNode extends NodeBase {
  kind: 'text'
  /**
   * Sizing for the text box. 'hug' on both axes mirrors Figma's
   * "Auto width" — the box tracks the content. A fixed width with
   * 'hug' height is "Auto height" (wraps inside a fixed width, grows
   * down). Both fixed is "Fixed size" — content overflows and is
   * clipped unless `clipsContent`-like behavior is added later.
   */
  size: Size
  text: string
  fontFamily: string
  fontSize: number
  fontWeight: number
  lineHeight: number
  letterSpacing: number
  textAlign: 'start' | 'center' | 'end'
  color: Color
}

export interface ImageNode extends NodeBase {
  kind: 'image'
  size: Size
  src: string
  fit: 'cover' | 'contain' | 'fill' | 'none'
}

/**
 * Video node. Visual layer backed by an HTMLVideoElement. The source
 * media is stored as a data URL on `src` for MVP (same strategy as
 * ImageNode — keeps the Yjs doc self-contained, heavy but simple).
 * Playback is slaved to the scene playhead: the renderer sets the
 * video element's `currentTime` to `max(0, playhead - startTime +
 * trimStart)` and pauses when outside `[startTime, startTime + clipLen]`.
 *
 * Audio from the file is muted by default — motion tools are primarily
 * visual, and unmuted autoplay surprises people. Users can flip `muted`
 * in the inspector if they want a narrated video track.
 */
export interface VideoNode extends NodeBase {
  kind: 'video'
  size: Size
  src: string
  fit: 'cover' | 'contain' | 'fill' | 'none'
  /** Length of the source media in seconds (decoded on import). */
  duration: number
  /** 0..1 volume multiplier for the video's audio track. */
  volume: number
  /** Whether the video's audio is muted. Default true. */
  muted: boolean
  /** When in the scene timeline playback begins, in seconds. */
  startTime: number
  /** Offset into the source media at `startTime`, in seconds. */
  trimStart: number
  /** Where in the source media playback ends, in seconds. */
  trimEnd: number
  /** Loop the clip for the full scene duration (from trimStart..trimEnd). */
  loop: boolean
}

/**
 * Audio node. Non-visual layer — it doesn't paint pixels on the
 * artboard. Represented on the Canvas as a compact speaker chip so
 * the user still has something to click/drag/keyframe, and represented
 * in the Layers panel like any other node. Playback is slaved to the
 * scene playhead via the same `startTime` / trim fields as VideoNode.
 */
export interface AudioNode extends NodeBase {
  kind: 'audio'
  /** Fixed chip footprint on the artboard so selection/drag still works. */
  size: Size
  src: string
  duration: number
  volume: number
  startTime: number
  trimStart: number
  trimEnd: number
  loop: boolean
}

/**
 * Camera node. A scene-level node that defines the viewpoint used to
 * render the artboard. There is always at least one camera per scene,
 * referenced by {@link Scene.activeCameraId}. Additional cameras can
 * exist and be switched between, but only one is active at a time in
 * MVP.
 *
 * Position in the tree: cameras have `parent: null` — they are
 * siblings of the artboard root at the document level, not descendants
 * of it. This keeps the layout tree pure (Yoga never sees the camera)
 * and also means camera transforms compose OVER the artboard from the
 * outside, which is the mental model users expect.
 *
 * Animation: the existing transform properties are reused verbatim
 * — `transform.x` / `transform.y` pan, `transform.rotation` rotates,
 * `transform.scaleX`/`transform.scaleY` zoom. The renderer applies the
 * INVERSE of the camera's transform to the artboard content (a camera
 * moved right = world moves left), so animating the camera's x from
 * 0 → 100 pans the view to the right.
 *
 * Future-proofing for 3D: `projection` is discriminated so a future
 * 'perspective' variant can carry `fov` + `near` / `far` without
 * breaking existing '2d' cameras.
 */
export interface CameraNode extends NodeBase {
  kind: 'camera'
  /** Camera lens model. MVP ships '2d'; '3d'-style will slot in later. */
  projection: '2d'
  /**
   * Whether the camera is enabled. Only the scene's active camera is
   * actually used for rendering; this flag lets users temporarily
   * bypass a camera (falling back to an identity view) without
   * losing its tracks or position. In MVP the camera is always
   * active; the flag is reserved for later.
   */
  enabled: boolean
  /**
   * Background fill that paints across the entire camera viewport,
   * BEHIND the artboard and any scene content. Useful when the camera
   * pans / zooms beyond the artboard edges — without this fill, the
   * area outside the artboard but inside the camera's visible region
   * would just show the workspace chrome. Solid color, gradient, or
   * image are all supported (mirrors the regular `Fill` shape).
   *
   * Lives on the camera (not the scene) because each camera in a
   * multi-camera scene can have its own backdrop — useful for cuts
   * between e.g. a "studio" camera and a "void" camera.
   *
   * Default null on legacy data; the renderer falls back to the
   * workspace panel color when null.
   */
  background: Fill | null
  /**
   * Focal length in canvas-pixel units. Used both for the CSS
   * `perspective` value (foreshortening at non-zero rotateX / rotateY)
   * AND for the Z-driven apparent scale (`FL / (FL - z)`). Larger =
   * more telephoto: rotations look subtler, dolly per unit of Z is
   * smaller. Smaller = wide-angle: rotations distort dramatically,
   * dolly per unit of Z is bigger. Default 1000 matches the historical
   * hardcoded value so existing scenes render identically.
   */
  focalLength: number
  /**
   * The point the camera rotates AROUND, in semantic terms — center
   * of the artboard, or one of the four edge midpoints. Mirrors
   * Figma's rotation-anchor affordance but for the scene-level camera:
   * picking 'left' makes the right side of the scene swing in/out of
   * depth while the left edge stays roughly fixed.
   *
   * Implemented as a transform-pivot offset, NOT by moving the camera
   * position (camera.transform.x/y still names "where the camera
   * looks"). Default 'center' = original behavior.
   */
  rotationOrigin: 'center' | 'top' | 'right' | 'bottom' | 'left'
}

/**
 * Component: a reusable definition. Behaves like a frame structurally.
 * Variants describe the axes of variation and per-variant overrides.
 *
 * Runtime NOTE: variants are not wired up yet. These types are defined
 * so keyframe descriptors can treat `variant` as a first-class animatable
 * property from day one.
 */
export interface ComponentNode extends NodeBase {
  kind: 'component'
  size: Size
  layout: Layout
  variants: VariantAxis[]
  defaultSelection: VariantSelection
  variantOverrides: VariantOverride[]
}

/** A use of a component. Has its own variant selection and property overrides. */
export interface InstanceNode extends NodeBase {
  kind: 'instance'
  componentId: ComponentId
  selection: VariantSelection
  /** Per-inner-node overrides, keyed by the inner node id inside the component. */
  overrides: Record<NodeId, Record<string, unknown>>
}

export type Node =
  | FrameNode
  | RectNode
  | EllipseNode
  | TextNode
  | ImageNode
  | VideoNode
  | AudioNode
  | ComponentNode
  | InstanceNode
  | CameraNode

export type NodeKind = Node['kind']

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

export interface VariantAxis {
  name: string
  values: string[]
}

/** One concrete pick per axis: `{ "Size": "large", "State": "hover" }`. */
export type VariantSelection = Record<string, string>

export interface VariantOverride {
  /** The variant combination this override applies to. */
  match: VariantSelection
  /** Overrides keyed by inner-node id, each a partial props bag. */
  overrides: Record<NodeId, Record<string, unknown>>
}

// ---------------------------------------------------------------------------
// Animation: tracks, keyframes, property descriptors
// ---------------------------------------------------------------------------

/**
 * PropertyId identifies what a keyframe targets. A stable, exhaustive
 * enum of known animatable properties — new additions must also be
 * registered in src/scene/props.ts so the anim engine and inspector
 * stay in sync.
 */
export type PropertyId =
  // transform group — post-layout, cheap
  | 'transform.x'
  | 'transform.y'
  | 'transform.z'
  | 'transform.rotation'
  | 'transform.rotationX'
  | 'transform.rotationY'
  | 'transform.scaleX'
  | 'transform.scaleY'
  // appearance group — post-layout, cheap
  | 'appearance.opacity'
  | 'appearance.cornerRadius'
  | 'appearance.fill'
  // layout group — triggers relayout + FLIP
  | 'layout.gap'
  | 'layout.padding.top'
  | 'layout.padding.right'
  | 'layout.padding.bottom'
  | 'layout.padding.left'
  | 'layout.direction'
  | 'size.width'
  | 'size.height'
  // semantic — triggers relayout + FLIP
  | 'variant'

export type EasingKind =
  | 'linear'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | { bezier: [number, number, number, number] }
  | { spring: { stiffness: number; damping: number; mass: number } }

/**
 * Keyframe values are typed dynamically — the shape depends on the
 * track's PropertyId. Validated at the anim-engine boundary.
 */
export type KeyframeValue = number | string | VariantSelection | FlexDirection

export interface Keyframe {
  id: KeyframeId
  time: number // seconds from scene start
  value: KeyframeValue
  /** Curve leaving this keyframe. Defaults to the track's global easing. */
  easingOut?: EasingKind
  /**
   * Which kind of preset produced this keyframe, if any. Set by
   * `applyPreset` so "apply another IN preset" can cleanly replace the
   * old IN-origin keyframes without stomping hand-authored ones. Absent
   * on any keyframe the user stamped manually (via the Inspector button
   * or dragging into the timeline), which is the correct default —
   * those are never candidates for preset-replacement cleanup.
   */
  presetOrigin?: 'in' | 'out'
}

export interface Track {
  id: TrackId
  nodeId: NodeId
  propertyId: PropertyId
  /** Sorted by time, ascending. The anim engine depends on this invariant. */
  keyframes: Keyframe[]
  /** Fallback easing if a keyframe doesn't specify its own easingOut. */
  defaultEasing: EasingKind
}

// ---------------------------------------------------------------------------
// Scene meta
// ---------------------------------------------------------------------------

/**
 * A timeline section — a named, length-bearing region of the comp.
 * Rendered as a colored pill in a strip above the ruler. Users can
 * drag the pill body to move the section, drag its edges to resize
 * either bound, and isolate one section at a time to clamp the
 * editor's focus to its time range.
 *
 * Sections are scene-level data (they're part of the document, not
 * an editor preference) so they sync, persist, and undo with the
 * rest of the doc. Sections may overlap, abut, or have gaps between
 * them — the user controls bounds explicitly.
 */
export interface Section {
  id: string
  /** User-facing label — defaults to "Section" on creation. */
  name: string
  /** Pill color, oklch / hex — anything CSS accepts. */
  color: Color
  /** Section start in seconds. */
  start: number
  /** Section end in seconds. End >= start enforced on write. */
  end: number
}

export interface SceneMeta {
  id: string
  name: string
  /** Total scene duration in seconds. */
  duration: number
  /** Target frame rate for preview and export. */
  frameRate: number
  /** Scene canvas size. */
  canvas: { width: number; height: number }
}

export interface Scene {
  meta: SceneMeta
  root: NodeId
  /**
   * The scene's active camera. Always points at an existing CameraNode
   * in `nodes`. New documents seed a default camera and set it active;
   * old documents without this field get one filled in on load.
   */
  activeCameraId: NodeId
  nodes: Record<NodeId, Node>
  tracks: Record<TrackId, Track>
  /** Named, length-bearing regions along the timeline. */
  sections: Record<string, Section>
}