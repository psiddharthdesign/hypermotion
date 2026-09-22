# Beam layer effect

Select a layer, open **Properties → Effects**, add an effect, and choose **Beam**.
Beam decorates the layer's bounds without changing its layout or the opacity of
its children. It works on frames, shapes, text, images, shaders, and video.

The integration adapts [Border Beam](https://libraries.dev/beam)'s public MIT
library (1.4.0, commit `2015f0ba79a9faec351719c4a6d590a1e6bfa243`). Its palette data and pulse oscillators retain the original license
in `src/render/beam/LICENSE` and the shipped `NOTICE`.

## Controls

- **Style:** Border (`md`), Compact (`sm`), Bottom line (`line`), Pulse outside,
  and Pulse inside (`pulse-inner`). Compact is tuned for small controls.
- **Colors:** Colorful, Mono, Ocean, Sunset, Forest, Candy, Ice, and Gold.
  Enable **Custom colors** to edit a palette of 2–8 colors.
- **Theme:** Dark, Light, or Auto (default). Auto follows the layer's solid fill so the
  exported result is independent of the operating system theme; non-solid fills
  use Dark. Select Light/Dark explicitly for media or gradient backgrounds.
- **Active / visibility:** disable the effect while retaining its settings.
- **Strength:** 0–1. **Duration:** 0.1–120 seconds per cycle. Defaults are 1.96s
  for Border/Compact, 3.1s for Bottom line, and 2.3s for pulses.
- **Edge width:** 0.25–6×. The crisp edge and soft glow automatically scale to
  the layer dimensions, so large frames remain readable at reduced zoom. The
  glow works on light, dark, and colored fills without changing the layer fill.
- **Glow size:** 0–4, scaling the preset's glow widths. **Static colors** stops
  hue shifting while preserving movement. Mono stays monochromatic.
- **Color and timing:** preset or custom brightness/saturation (0–4), hue range
  (0–360 degrees), layer corners or a custom radius, start/end time, and entry/exit
  fades. Default entry/exit fades are 0.6s/0.5s. An omitted end keeps the effect
  active through the scene; set an end time to fade it out before that time.

Animation follows composition time, including scrubbing, repeated scenes,
scene splitting, and frame-by-frame exports. Beam settings persist in `.hype`
files, support undo/redo, and can be authored through CLI/MCP `appearance.effects`.
Numeric Beam controls are static settings; use the start/end/fade controls for
entry and exit, and layer transform/opacity tracks for additional animation.

```json
{
  "appearance": {
    "opacity": 1,
    "fill": { "kind": "solid", "color": "#ffffff" },
    "stroke": null,
    "cornerRadius": 16,
    "effects": [{
      "id": "card-beam",
      "kind": "border-beam",
      "size": "pulse-outside",
      "colorVariant": "ocean",
      "theme": "auto",
      "strength": 1,
      "duration": 2.3,
      "glowSize": 1,
      "staticColors": false,
      "startTime": 0,
      "endTime": 5,
      "fadeIn": 0.6,
      "fadeOut": 0.5
    }]
  }
}
```

## Rendering adaptation

The shared Canvas painter combines the library's palettes and pulse oscillators
with a continuous colored perimeter, travelling mask, and a separate broad glow.
Keeping the edge independent of blur prevents large glow settings from washing
out the border on light fills. DOM previews and WebGL/export textures use
this painter instead of CSS animations. Native video retains its decoder texture
and receives a separate transparent Beam plane with matching transforms,
clipping and depth of field. Animated text uses the canvas painter when Beam is
active. Pulse outside reserves texture padding; other styles remain inside the
layer outline. Parent clipping still applies.

This is a scene effect, so React wrapper attributes, injected CSS, browser hover
triggers, and lifecycle callbacks are represented by native layer styling and
explicit timeline controls rather than persisted executable CSS or JavaScript.
It does not include separately licensed Studio Pro recipes. Canvas blur and
compositing are an adaptation of the CSS implementation, not a promise of
pixel-identical output to a browser embedding of the React component.

## Browser regression fixture

With the development server running, open `/tests/fixtures/beam.html`. The fixture
checks all 80 style/palette/theme combinations for visible output, motion, and
identical pixels after out-of-order seeking, checks large white/dark/colored frames, custom palettes, and retained canvas
state, and displays all five styles on three fills.
