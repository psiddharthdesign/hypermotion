# Web product capture

## Capture order

1. Run the application using its documented command.
2. Set the exact target viewport and stable test data.
3. Navigate to the feature entry point.
4. Capture the initial checkpoint.
5. Perform one declared action.
6. Wait for the declared state, network completion, or accessible text.
7. Capture the next checkpoint.
8. Repeat until the outcome is visible.

## Checkpoint data

Capture when tooling permits:

- Route, viewport, device scale, theme, and timestamp.
- Screenshot and transparent element images where available.
- DOM hierarchy, layout bounds, computed styles, text, SVG, and image sources.
- Accessible roles/names and stable selectors.
- React component or `data-slot` hints, without relying on them as the only identity.
- Scroll position, focused element, pointer target, and action that produced the state.

## Mapping to Hyper Motion

- Map text, simple fills, borders, vectors, and images to native layers.
- Map coherent DOM/React groups to frames or components.
- Map repeated structures to component definitions and instances.
- Map idle, hover, pressed, loading, success, and error checkpoints to variant axes when stable identity exists.
- Use a raster fallback for unsupported CSS, canvas, WebGL, browser-native controls, or effects that cannot be reproduced faithfully.
- Group layers semantically for 3D explanation: page shell, navigation, main panel, focal control, feedback/result. Do not create a separate plane for every DOM leaf.

## Safety

Never capture real customer data, secrets, browser password prompts, notifications, unrelated tabs, or developer overlays. Prefer dedicated demo accounts and deterministic fixtures.
