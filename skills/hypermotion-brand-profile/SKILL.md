---
name: hypermotion-brand-profile
description: Gather brand information from direct prompts, connected apps, repositories, URLs, documents, design files, media, and approved examples, then capture, validate, and apply a reusable Hyper Motion brand profile covering visual identity, typography, color, voice, motion personality, accessibility, logo handling, and outro rules. Use when creating or updating brand-specific direction or ensuring an explainer, product demo, campaign video, title card, transition, or logo animation follows one consistent brand system.
---

# Hyper Motion Brand Profile

Create a compact, evidence-backed profile that other Hyper Motion skills can apply without rediscovering brand rules for every video.

## Establish evidence

Inspect relevant authorized sources available through the conversation, MCP clients, connected apps, repositories, URLs, supplied guidelines, product surfaces, marketing pages, design files, logo packages, font files, previous videos, writing examples, and explicit user direction.

Treat every source channel as optional. Never require Slack or any other single provider, and never imply that an unavailable source was inspected.

Do not infer target audience, use context, or brand personality from implementation code alone. Ask only for information that source material cannot establish.

Distinguish:

- `required`: explicit rules from the owner or official guidelines.
- `preferred`: consistent patterns observed across approved material.
- `allowed`: acceptable alternatives.
- `prohibited`: treatments that must not appear.
- `unknown`: decisions that require confirmation.

Record sources for consequential rules. Do not convert a single incidental screenshot choice into a permanent brand standard.

## Create the profile

Use the schema in [profile-schema.md](references/profile-schema.md). Keep the profile concise enough to load during every production.

Cover:

- Audience, use context, brand personality, and emotional objective.
- Logo assets, safe area, minimum size, backgrounds, and prohibited modifications.
- Primary and supporting palettes, neutral tint, contrast requirements, and color exclusions.
- Display and body typography, weights, casing, tracking, line length, and fallback fonts.
- Voice, terminology, headline behavior, and calls to action.
- Motion adjectives, tempo, easing families, duration ranges, camera behavior, depth, transitions, text animation, celebrations, and reduced-motion treatment.
- Preferred logo outro pattern and minimum final hold.
- Asset provenance, licensing notes, and replacement restrictions.

Store actual logos, fonts, audio stings, and templates in the profile skill’s `assets/` directory only when the user supplies them and permits repository storage. Never fabricate official assets.

## Derive a motion system

Translate brand personality into bounded motion choices rather than vague adjectives.

For example:

- `calm, exact, trustworthy` → restrained camera, clean opacity/transform reveals, longer holds, low overshoot, no decorative particles.
- `fast, optimistic, capable` → decisive cuts, short exponential entrances, purposeful staggers, crisp success accents.
- `playful, tactile, warm` → larger spatial arcs and characterful sequencing, while still avoiding uncontrolled bounce or elastic easing unless explicitly required by the brand.

Define:

- One signature motion behavior.
- Default entrance, exit, state-change, and scene-transition ranges.
- Maximum simultaneous focal motions.
- Camera and Z-depth limits.
- Beat-sync density.
- Text animation rules.
- Logo resolve and hold.

Read [application-rules.md](references/application-rules.md) when applying the profile to an explainer.

## Apply without erasing product truth

- Preserve product UI colors and typography when showing the real interface unless the brief explicitly asks for a branded reinterpretation.
- Apply campaign branding primarily to text scenes, backgrounds, callouts, transitions, cursor treatments, audio accents, and the outro.
- Keep logo geometry, proportions, and clear space intact.
- Prefer solid text colors; do not introduce decorative gradient text without an explicit brand rule.
- Use a limited accent color so emphasis remains meaningful.
- Keep narration and on-screen copy consistent with approved terminology.
- Respect contrast, readability, safe-area, and reduced-motion requirements.

Resolve conflicts in this order:

1. Explicit current user direction.
2. Required brand rules.
3. Accessibility and legal constraints.
4. Product fidelity.
5. Preferred brand patterns.
6. General motion taste.

Surface any unresolved conflict before producing a final render.

## Validate the application

Use [brand-review-checklist.md](references/brand-review-checklist.md) before delivery.

Check representative frames from every scene type, not only the logo outro. Confirm:

- Correct assets and logo variant.
- Accurate colors and typography.
- Consistent voice and terminology.
- Motion personality and pacing.
- Appropriate camera and 3D restraint.
- Accessible contrast and readable holds.
- Correct outro construction and final-frame duration.

Record intentional exceptions in the production brief so later revisions do not “correct” them back to the default profile.
