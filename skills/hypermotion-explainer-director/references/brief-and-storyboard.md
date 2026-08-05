# Brief and storyboard contracts

## Normalized brief

Use this conceptual shape; adapt fields to the available tool schema.

```ts
interface ExplainerBrief {
  objective: string
  audience?: string
  keyMessages: string[]
  callToAction?: string
  durationSeconds?: number
  canvas?: { width: number; height: number }
  frameRate?: number
  product?: {
    repository?: string
    baseUrl?: string
    startCommand?: string
    flow?: FlowStep[]
  }
  audio?: {
    path: string
    kind: "music" | "narration" | "mixed"
    transcript?: string
  }
  brandProfile?: string
  logoPath?: string
  outputScene: string
  outputMedia: string
  constraints?: string[]
  sources?: BriefSource[]
  openQuestions?: string[]
}
```

Never place credentials or secret values in the brief. Refer to an existing authenticated browser session or documented test fixture.

## Source normalization

Represent every material input with its provenance:

```ts
interface BriefSource {
  kind:
    | "prompt"
    | "connected-app"
    | "repository"
    | "url"
    | "document"
    | "design"
    | "media"
    | "existing-scene"
  locator?: string
  summary: string
  inspected: boolean
  authority: "explicit-direction" | "official" | "approved-example" | "reference"
}
```

- Use explicit current direction over older or inferred material.
- Prefer official product and brand sources over informal references.
- Record conflicting claims instead of silently choosing one.
- Mark uninspected links or unavailable attachments as unverified.
- Carry only information relevant to the requested production into the normalized brief.

## Storyboard

```ts
interface StoryboardScene {
  id: string
  type:
    | "text"
    | "product-demo"
    | "feature-callout"
    | "comparison"
    | "media"
    | "logo-outro"
  purpose: string
  message?: string
  productStates?: string[]
  duration: number
  focalSubject: string
  entry: string
  heroAction: string
  exit: string
  timingAnchors: TimingAnchor[]
  transitionOut?: string
}
```

Check that:

- Scene durations sum to the requested total.
- Every scene advances the story.
- On-screen text can be read at normal playback speed.
- Product states exist or can be captured reproducibly.
- The sequence ends with the intended benefit, action, or brand memory.
- Transitions consume no more than roughly 10–15% of a short video unless they are themselves the subject.
