# Brand profile schema

Use YAML or JSON. Omit unknown optional fields rather than inventing them.

```yaml
version: 1
brand:
  name: ""
  audience: ""
  use_context: ""
  personality: []
  emotional_goal: ""
sources: []
logo:
  preferred_asset: ""
  alternatives: []
  safe_area: ""
  minimum_size: ""
  allowed_backgrounds: []
  prohibited_treatments: []
color:
  primary: []
  supporting: []
  neutrals: []
  accent_policy: ""
  prohibited: []
  minimum_contrast: ""
typography:
  display: []
  body: []
  fallbacks: []
  casing: ""
  tracking: ""
voice:
  traits: []
  terminology: {}
  prohibited_phrases: []
motion:
  traits: []
  signature_behavior: ""
  entrance_seconds: []
  exit_seconds: []
  state_change_seconds: []
  scene_transition_seconds: []
  easing: []
  camera: ""
  depth: ""
  beat_sync_density: ""
  text_animation: ""
  reduced_motion: ""
outro:
  pattern: ""
  audio_sting: ""
  minimum_hold_seconds: 0
constraints:
  required: []
  preferred: []
  allowed: []
  prohibited: []
  unknown: []
```

For each consequential rule, include a source reference or mark it as explicit user direction.
