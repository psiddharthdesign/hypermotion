// SPDX-License-Identifier: Apache-2.0

import {
  AlertTriangle,
  Check,
  Clapperboard,
  FileJson,
  Music2,
  Sparkles,
  X,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { analyzeBeatPcm, type BeatAnalysis } from '@/audio/beatSync'
import { loadAudioBuffer } from '@/audio/audioBuffer'
import {
  compileBriefToStoryboard,
  materializeStoryboard,
  type ExplainerBrief,
  type ExplainerScriptBeat,
  type ExplainerSourceRef,
} from '@/explainer'
import { toExplainerAudioAnalysis } from '@/explainer/audioAnalysis'
import { useProjectAPI } from '@/project'
import { useSceneAPI } from '@/scene'
import {
  adaptSourceManifestForExplainer,
  assertValidSourceCaptureManifest,
  normalizeSourceCaptureManifest,
  type ExplainerSourcePackage,
} from '@/source'
import { useUI } from '@/state/ui'
import {
  readMediaFileAsDataUrl,
  isAudioFile,
} from '@/ui/importMedia'
import { useToast } from '@/ui/toastStore'
import { TimeField } from '@/ui/fields'

type Tone = 'minimal' | 'playful' | 'cinematic' | 'technical' | 'bold'
type Pacing = 'calm' | 'balanced' | 'fast'
type CameraStyle = 'subtle' | 'dynamic' | 'cinematic'
type SequencePlacement = 'append' | 'replace'

interface GenerationSummary {
  scenes: number
  cameras: number
  tracks: number
  beatCues: number
  warnings: string[]
}

export interface ExplainerStudioProps {
  onClose: () => void
}

const AUDIO_SOURCE_ID = 'explainer-audio'
const DEFAULT_DIRECTION =
  'Introduce the feature, reveal the interface in separated 3D layers, demonstrate the primary interaction and success state, then finish on the brand.'

/**
 * Modeless authoring workbench for short, assembled feature explainers.
 *
 * It prepares and validates every input before mutating the Y.Doc. Append mode
 * preserves authored content (while still replacing a truly empty starter);
 * explicit replacement first builds a valid sequence, then removes the prior
 * compositions so a failed generation cannot destroy the user's edit.
 */
export function ExplainerStudio({ onClose }: ExplainerStudioProps) {
  const api = useSceneAPI()
  const project = useProjectAPI()
  const showToast = useToast((state) => state.show)
  const setSelectedSequenceItem = useUI(
    (state) => state.setSelectedSequenceItem,
  )
  const setTimelineScope = useUI((state) => state.setTimelineScope)
  const setPreviewScope = useUI((state) => state.setPreviewScope)
  const setPlayhead = useUI((state) => state.setPlayhead)
  const setPlaying = useUI((state) => state.setPlaying)
  const panels = useUI((state) => state.panels)
  const togglePanel = useUI((state) => state.togglePanel)

  const initialName = api.getMeta().name?.trim() || 'Feature explainer'
  const [title, setTitle] = useState(initialName)
  const [direction, setDirection] = useState(DEFAULT_DIRECTION)
  const [script, setScript] = useState('')
  const [duration, setDuration] = useState(12)
  const [tone, setTone] = useState<Tone>('cinematic')
  const [pacing, setPacing] = useState<Pacing>('fast')
  const [cameraStyle, setCameraStyle] =
    useState<CameraStyle>('cinematic')
  const [use3dLayers, setUse3dLayers] = useState(true)
  const [reducedSpatialMotion, setReducedSpatialMotion] = useState(false)
  const [placement, setPlacement] =
    useState<SequencePlacement>('append')

  const [brandName, setBrandName] = useState(initialName)
  const [tagline, setTagline] = useState('')
  const [primaryColor, setPrimaryColor] = useState('#3f5bf6')
  const [accentColor, setAccentColor] = useState('#8ba3ff')
  const [backgroundColor, setBackgroundColor] = useState('#111113')

  const [sourceManifestText, setSourceManifestText] = useState('')
  const [sourceFileName, setSourceFileName] = useState('')
  const [audioFileName, setAudioFileName] = useState('')
  const [audioSrc, setAudioSrc] = useState<string | null>(null)
  const [audioDuration, setAudioDuration] = useState(0)
  const [beatAnalysis, setBeatAnalysis] = useState<BeatAnalysis | null>(null)
  const [audioStatus, setAudioStatus] = useState<
    'idle' | 'analyzing' | 'ready' | 'error'
  >('idle')
  const [audioError, setAudioError] = useState('')

  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState<GenerationSummary | null>(null)
  const directionRef = useRef<HTMLTextAreaElement>(null)
  const sourceInputRef = useRef<HTMLInputElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    directionRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const audioWindowSeconds = Math.min(audioDuration, duration)
  const explainerAudio = useMemo(
    () =>
      beatAnalysis
        ? toExplainerAudioAnalysis(beatAnalysis, audioWindowSeconds, {
            sourceRefId: AUDIO_SOURCE_ID,
          })
        : undefined,
    [audioWindowSeconds, beatAnalysis],
  )

  const prepareAudio = async (file: File) => {
    if (!isAudioFile(file)) {
      setAudioStatus('error')
      setAudioError('Choose an audio file such as MP3, WAV, M4A, or OGG.')
      return
    }
    setAudioFileName(file.name)
    setAudioStatus('analyzing')
    setAudioError('')
    setAudioSrc(null)
    setBeatAnalysis(null)
    setSummary(null)
    try {
      const src = await readMediaFileAsDataUrl(file)
      const buffer = await loadAudioBuffer(src)
      // Let the file chooser paint its selected state before the synchronous
      // PCM pass begins. This keeps the compact desktop UI responsive.
      await new Promise<void>((resolve) =>
        window.requestAnimationFrame(() => resolve()),
      )
      const analysis = analyzeBeatPcm({
        sampleRate: buffer.sampleRate,
        channels: Array.from(
          { length: buffer.numberOfChannels },
          (_, index) => buffer.getChannelData(index),
        ),
      })
      setAudioSrc(src)
      setAudioDuration(buffer.duration)
      setBeatAnalysis(analysis)
      setAudioStatus('ready')
    } catch (caught) {
      setAudioStatus('error')
      setAudioError(errorMessage(caught, 'Audio analysis failed.'))
    }
  }

  const loadSourceManifest = async (file: File) => {
    setSourceFileName(file.name)
    setSummary(null)
    setError('')
    try {
      setSourceManifestText(await file.text())
    } catch (caught) {
      setError(errorMessage(caught, 'Could not read the source manifest.'))
    }
  }

  const generate = async () => {
    if (working) return
    setWorking(true)
    setError('')
    setSummary(null)
    showToast({
      tone: 'loading',
      title: 'Building explainer',
      description: 'Planning scenes, beats, 3D layers, and camera cuts…',
    })

    try {
      const sourcePackage = parseSourcePackage(sourceManifestText)
      const sourceRefs = [...(sourcePackage?.sourceRefs ?? [])]
      if (audioSrc) {
        sourceRefs.push({
          id: AUDIO_SOURCE_ID,
          kind: 'audio',
          label: audioFileName || 'Explainer audio',
          metadata: {
            durationSeconds: round(audioWindowSeconds),
            ...(beatAnalysis
              ? {
                  beatStatus: beatAnalysis.status ?? 'ambiguous',
                  confidence: round(beatAnalysis.confidence),
                }
              : {}),
          },
        })
      }

      const cleanTitle = title.trim() || 'Feature explainer'
      const cleanBrand = brandName.trim() || cleanTitle
      const cleanDirection = direction.trim() || DEFAULT_DIRECTION
      const logoSourceRefId =
        sourceRefs.find((source) => source.kind === 'logo')?.id

      const brief: ExplainerBrief = {
        title: cleanTitle,
        targetDurationSeconds: duration,
        direction: {
          summary: cleanDirection,
          tone,
          pacing,
          sceneOrder: ['text', 'design', 'demo'],
          use3dLayers,
          cameraStyle,
        },
        script: {
          hook: script.trim() || cleanTitle,
          beats: authoringBeats(
            cleanDirection,
            cleanTitle,
            sourcePackage,
            sourceRefs,
          ),
          close: tagline.trim() || cleanBrand,
        },
        brand: {
          name: cleanBrand,
          ...(tagline.trim() ? { tagline: tagline.trim() } : {}),
          ...(logoSourceRefId ? { logoSourceRefId } : {}),
          primaryColor,
          accentColor,
          backgroundColor,
        },
        sourceRefs,
        ...(explainerAudio ? { audioAnalysis: explainerAudio } : {}),
      }
      const storyboard = compileBriefToStoryboard(brief, {
        durationSeconds: duration,
        frameRate: api.getMeta().frameRate,
        canvas: api.getMeta().canvas,
      })
      const storyboardErrors = storyboard.qc.filter(
        (issue) => issue.severity === 'error',
      )
      if (storyboardErrors.length > 0) {
        throw new Error(
          storyboardErrors
            .slice(0, 3)
            .map((issue) => issue.message)
            .join(' '),
        )
      }

      const previousSceneIds = project.getScenes().map((scene) => scene.id)
      const result = materializeStoryboard({
        storyboard,
        project,
        mode: placement === 'replace' ? 'append' : 'replace-empty',
        ...(audioSrc ? { audioSrc } : {}),
        reducedMotion: reducedSpatialMotion,
      })
      const materializeErrors = result.issues.filter(
        (issue) => issue.severity === 'error',
      )
      if (result.scenes.length === 0) {
        throw new Error(
          materializeErrors[0]?.message ??
            'No scenes were created from the storyboard.',
        )
      }

      const replacementWarnings: string[] = []
      if (placement === 'replace') {
        for (const sceneId of previousSceneIds) {
          const deletion = project.deleteScene(sceneId)
          if (!deletion.deleted) {
            replacementWarnings.push(
              `Could not remove prior scene ${sceneId} (${deletion.reason ?? 'unknown reason'}).`,
            )
          }
        }
      }

      const first = result.scenes[0]!
      project.activateScene(first.compositionSceneId)
      setSelectedSequenceItem(
        first.sequenceItemId,
        first.compositionSceneId,
      )
      setPlaying(false)
      setTimelineScope('sequence')
      setPreviewScope('sequence')
      setPlayhead(0)
      if (!panels.scenes) togglePanel('scenes')
      if (!panels.timeline) togglePanel('timeline')

      const warnings = [
        ...storyboard.qc
          .filter((issue) => issue.severity === 'warning')
          .map((issue) => issue.message),
        ...result.issues
          .filter((issue) => issue.severity === 'warning')
          .map((issue) => issue.message),
        ...materializeErrors.map((issue) => issue.message),
        ...replacementWarnings,
      ]
      const nextSummary: GenerationSummary = {
        scenes: result.scenes.length,
        cameras: result.scenes.reduce(
          (count, scene) => count + scene.cameraIds.length,
          0,
        ),
        tracks: result.scenes.reduce(
          (count, scene) => count + scene.trackIds.length,
          0,
        ),
        beatCues: storyboard.beatPlan.cues.filter(
          (cue) => cue.beatSnapped,
        ).length,
        warnings,
      }
      setSummary(nextSummary)
      showToast({
        tone: 'success',
        title: 'Explainer ready',
        description: `${nextSummary.scenes} scenes and ${nextSummary.cameras} cameras are open in Master preview.`,
      })
    } catch (caught) {
      const message = errorMessage(caught, 'Explainer generation failed.')
      setError(message)
      showToast({
        tone: 'error',
        title: 'Could not build explainer',
        description: message,
      })
    } finally {
      setWorking(false)
    }
  }

  return createPortal(
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby="explainer-studio-title"
      className="fixed bottom-3 right-3 top-[60px] z-[360] flex w-[420px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl border border-border-strong bg-panel shadow-2xl motion-safe:animate-[hm-explainer-in_180ms_cubic-bezier(0.16,1,0.3,1)]"
    >
      <header className="flex shrink-0 items-start gap-3 border-b border-border px-4 py-3.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-white">
          <Sparkles size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <h2
            id="explainer-studio-title"
            className="text-[13px] font-semibold text-text"
          >
            Explainer
          </h2>
          <p className="mt-0.5 text-[10px] leading-4 text-text-muted">
            Build an editable, beat-synced master sequence.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-panel-raised hover:text-text"
          aria-label="Close Explainer"
        >
          <X size={14} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-5">
          <StudioSection
            icon={<Clapperboard size={13} />}
            title="Direction"
            caption="The story Hyper Motion should tell"
          >
            <Field label="Project title">
              <TextInput value={title} onChange={setTitle} />
            </Field>
            <Field label="Creative direction">
              <textarea
                ref={directionRef}
                value={direction}
                onChange={(event) => setDirection(event.target.value)}
                rows={4}
                className={textareaClass}
                placeholder="What should the viewer notice, in what order?"
              />
            </Field>
            <Field
              label="Opening line"
              hint="Optional. The project title is used when blank."
            >
              <textarea
                value={script}
                onChange={(event) => setScript(event.target.value)}
                rows={2}
                className={textareaClass}
                placeholder="A sharper way to ship product updates."
              />
            </Field>

            <div className="grid grid-cols-[1fr_92px] gap-2">
              <Field label="Pacing">
                <Select
                  value={pacing}
                  onChange={(value) => setPacing(value as Pacing)}
                  options={['calm', 'balanced', 'fast']}
                />
              </Field>
              <Field label="Length">
                <TimeField
                  value={duration}
                  onCommit={(next) => setDuration(clamp(next, 10, 15))}
                  min={10}
                  max={15}
                  step={0.5}
                  suffix="sec"
                  ariaLabel="Explainer length"
                  width="w-full"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Tone">
                <Select
                  value={tone}
                  onChange={(value) => setTone(value as Tone)}
                  options={[
                    'minimal',
                    'playful',
                    'cinematic',
                    'technical',
                    'bold',
                  ]}
                />
              </Field>
              <Field label="Camera">
                <Select
                  value={cameraStyle}
                  onChange={(value) =>
                    setCameraStyle(value as CameraStyle)
                  }
                  options={['subtle', 'dynamic', 'cinematic']}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Toggle
                checked={use3dLayers}
                onChange={setUse3dLayers}
                label="3D layer reveal"
              />
              <Toggle
                checked={reducedSpatialMotion}
                onChange={setReducedSpatialMotion}
                label="Reduced spatial motion"
              />
            </div>

            <Field
              label="Sequence placement"
              hint={
                placement === 'replace'
                  ? 'Current scene compositions are removed after a successful build.'
                  : 'Existing scenes stay before the generated sequence.'
              }
            >
              <div className="grid grid-cols-2 gap-1 rounded-md bg-app-bg p-0.5">
                <PlacementButton
                  active={placement === 'append'}
                  label="Append"
                  onClick={() => setPlacement('append')}
                />
                <PlacementButton
                  active={placement === 'replace'}
                  label="Replace current"
                  onClick={() => setPlacement('replace')}
                />
              </div>
            </Field>
          </StudioSection>

          <StudioSection
            icon={<Music2 size={13} />}
            title="Audio"
            caption="Optional music or narration"
          >
            <input
              ref={audioInputRef}
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void prepareAudio(file)
                event.currentTarget.value = ''
              }}
            />
            <FileWell
              icon={<Music2 size={15} />}
              title={audioFileName || 'Choose an audio file'}
              detail={audioDetail(
                audioStatus,
                beatAnalysis,
                audioWindowSeconds,
                audioError,
              )}
              tone={audioStatus === 'error' ? 'error' : 'default'}
              busy={audioStatus === 'analyzing'}
              onClick={() => audioInputRef.current?.click()}
            />
          </StudioSection>

          <StudioSection
            icon={<FileJson size={13} />}
            title="Product source"
            caption="Optional normalized capture from MCP, code, browser, or design"
          >
            <input
              ref={sourceInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void loadSourceManifest(file)
                event.currentTarget.value = ''
              }}
            />
            <FileWell
              icon={<FileJson size={15} />}
              title={sourceFileName || 'Load source manifest'}
              detail={
                sourceManifestText.trim()
                  ? `${sourceManifestText.length.toLocaleString()} characters ready`
                  : 'Next.js, shadcn, Tailwind, browser capture, or any compatible source'
              }
              onClick={() => sourceInputRef.current?.click()}
            />
            <details className="group">
              <summary className="cursor-pointer select-none text-[10px] font-medium text-text-muted hover:text-text">
                Paste manifest JSON
              </summary>
              <textarea
                value={sourceManifestText}
                onChange={(event) => {
                  setSourceManifestText(event.target.value)
                  setSourceFileName('')
                }}
                rows={5}
                spellCheck={false}
                className={`${textareaClass} mt-2 font-mono text-[9px]`}
                placeholder='{"version":1,"provenance":{...},"project":{...},"routes":[...]}'
              />
            </details>
          </StudioSection>

          <StudioSection
            icon={<Sparkles size={13} />}
            title="Brand"
            caption="Final lockup and generated scene palette"
          >
            <div className="grid grid-cols-2 gap-2">
              <Field label="Brand name">
                <TextInput value={brandName} onChange={setBrandName} />
              </Field>
              <Field label="Tagline">
                <TextInput
                  value={tagline}
                  onChange={setTagline}
                  placeholder="Optional"
                />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <ColorField
                label="Primary"
                value={primaryColor}
                onChange={setPrimaryColor}
              />
              <ColorField
                label="Accent"
                value={accentColor}
                onChange={setAccentColor}
              />
              <ColorField
                label="Canvas"
                value={backgroundColor}
                onChange={setBackgroundColor}
              />
            </div>
          </StudioSection>

          {error ? (
            <StatusBox tone="error" title="Generation stopped">
              {error}
            </StatusBox>
          ) : null}

          {summary ? (
            <StatusBox tone="success" title="Editable sequence created">
              <div className="mt-2 grid grid-cols-4 gap-1">
                <Metric value={summary.scenes} label="Scenes" />
                <Metric value={summary.cameras} label="Cameras" />
                <Metric value={summary.tracks} label="Tracks" />
                <Metric value={summary.beatCues} label="Beat cues" />
              </div>
              {summary.warnings.length > 0 ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[9px] font-medium text-text-muted">
                    {summary.warnings.length} note
                    {summary.warnings.length === 1 ? '' : 's'}
                  </summary>
                  <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-[9px] leading-3.5 text-text-muted">
                    {summary.warnings.slice(0, 6).map((warning, index) => (
                      <li key={`${warning}-${index}`}>{warning}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </StatusBox>
          ) : null}
        </div>
      </div>

      <footer className="flex shrink-0 items-center gap-3 border-t border-border bg-panel-raised/70 px-4 py-3">
        <div className="min-w-0 flex-1 text-[9px] leading-3.5 text-text-dim">
          {placement === 'replace'
            ? 'Creates a clean text, design, demo, and logo sequence after generation succeeds.'
            : 'Creates text, design, demo, and logo scenes. Existing authored scenes are preserved.'}
        </div>
        <button
          type="button"
          onClick={() => void generate()}
          disabled={working || audioStatus === 'analyzing'}
          className="flex h-8 shrink-0 items-center gap-2 rounded-md bg-accent px-3 text-[11px] font-semibold text-white shadow-sm transition-[filter,transform] duration-150 hover:brightness-110 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
        >
          <Sparkles
            size={13}
            className={working ? 'animate-pulse' : undefined}
          />
          {working ? 'Building…' : 'Build explainer'}
        </button>
      </footer>
    </section>,
    document.body,
  )
}

function StudioSection({
  icon,
  title,
  caption,
  children,
}: {
  icon: ReactNode
  title: string
  caption: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-accent">{icon}</span>
        <div>
          <h3 className="text-[11px] font-semibold text-text">{title}</h3>
          <p className="mt-0.5 text-[9px] leading-3.5 text-text-dim">
            {caption}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2.5 pl-5">{children}</div>
    </section>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="flex items-center justify-between gap-2">
        <span className="text-[9px] font-medium uppercase tracking-[0.06em] text-text-dim">
          {label}
        </span>
        {hint ? (
          <span className="truncate text-[8px] text-text-dim">{hint}</span>
        ) : null}
      </span>
      {children}
    </label>
  )
}

function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="h-8 rounded-md border border-border bg-app-bg px-2.5 text-[11px] text-text outline-none transition-colors focus:border-accent motion-reduce:transition-none"
    />
  )
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (value: string) => void
  options: string[]
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 rounded-md border border-border bg-app-bg px-2 text-[10px] capitalize text-text outline-none focus:border-accent"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  )
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <label className="flex h-8 cursor-pointer items-center gap-2 rounded-md border border-border bg-app-bg px-2.5 text-[9px] text-text-muted hover:text-text">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="sr-only"
      />
      <span
        aria-hidden
        className={[
          'flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200 motion-reduce:transition-none',
          checked ? 'bg-accent' : 'bg-border-strong',
        ].join(' ')}
      >
        <span
          className={[
            'h-3 w-3 rounded-full bg-white transition-transform duration-200 motion-reduce:transition-none',
            checked ? 'translate-x-3' : 'translate-x-0',
          ].join(' ')}
        />
      </span>
      <span className="truncate">{label}</span>
    </label>
  )
}

function PlacementButton({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={[
        'h-7 rounded text-[9px] font-medium transition-colors motion-reduce:transition-none',
        active
          ? 'bg-panel-raised text-text shadow-sm'
          : 'text-text-dim hover:text-text-muted',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

function FileWell({
  icon,
  title,
  detail,
  tone = 'default',
  busy = false,
  onClick,
}: {
  icon: ReactNode
  title: string
  detail: string
  tone?: 'default' | 'error'
  busy?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={[
        'flex min-h-14 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors motion-reduce:transition-none',
        tone === 'error'
          ? 'border-[oklch(0.62_0.18_28)] bg-[oklch(0.62_0.18_28/0.08)]'
          : 'border-border bg-app-bg hover:border-border-strong hover:bg-panel-raised',
      ].join(' ')}
    >
      <span
        className={[
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
          tone === 'error'
            ? 'bg-[oklch(0.62_0.18_28/0.14)] text-[oklch(0.68_0.18_28)]'
            : 'bg-panel-raised text-accent',
          busy ? 'animate-pulse' : '',
        ].join(' ')}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[10px] font-medium text-text">
          {title}
        </span>
        <span className="mt-0.5 block text-[9px] leading-3.5 text-text-dim">
          {detail}
        </span>
      </span>
    </button>
  )
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Field label={label}>
      <label className="flex h-8 items-center gap-2 rounded-md border border-border bg-app-bg px-2">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-4 w-4 cursor-pointer appearance-none overflow-hidden rounded border-0 bg-transparent p-0"
          aria-label={`${label} color`}
        />
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent font-mono text-[9px] text-text outline-none"
          aria-label={`${label} color value`}
        />
      </label>
    </Field>
  )
}

function StatusBox({
  tone,
  title,
  children,
}: {
  tone: 'success' | 'error'
  title: string
  children: ReactNode
}) {
  const success = tone === 'success'
  return (
    <section
      className={[
        'rounded-lg border p-3',
        success
          ? 'border-[oklch(0.62_0.14_150/0.45)] bg-[oklch(0.62_0.14_150/0.07)]'
          : 'border-[oklch(0.62_0.18_28/0.45)] bg-[oklch(0.62_0.18_28/0.07)]',
      ].join(' ')}
    >
      <div className="flex items-center gap-2">
        {success ? (
          <Check size={13} className="text-[oklch(0.67_0.15_150)]" />
        ) : (
          <AlertTriangle
            size={13}
            className="text-[oklch(0.68_0.18_28)]"
          />
        )}
        <h3 className="text-[10px] font-semibold text-text">{title}</h3>
      </div>
      <div className="mt-1 text-[9px] leading-4 text-text-muted">
        {children}
      </div>
    </section>
  )
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-md bg-app-bg px-2 py-1.5 text-center">
      <div className="font-mono text-[11px] font-semibold tabular-nums text-text">
        {value}
      </div>
      <div className="mt-0.5 text-[7px] uppercase tracking-[0.05em] text-text-dim">
        {label}
      </div>
    </div>
  )
}

function parseSourcePackage(
  value: string,
): ExplainerSourcePackage | null {
  if (!value.trim()) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch (caught) {
    throw new Error(
      `Source manifest is not valid JSON: ${errorMessage(caught, 'parse failed')}`,
    )
  }
  assertValidSourceCaptureManifest(parsed)
  const normalized = normalizeSourceCaptureManifest(parsed)
  return adaptSourceManifestForExplainer(normalized)
}

function authoringBeats(
  direction: string,
  title: string,
  sourcePackage: ExplainerSourcePackage | null,
  sourceRefs: ExplainerSourceRef[],
): ExplainerScriptBeat[] {
  const designRefIds = sourceRefs
    .filter((source) =>
      ['screen', 'component', 'route', 'codebase', 'asset'].includes(
        source.kind,
      ),
    )
    .slice(0, 6)
    .map((source) => source.id)
  const demoRefIds = sourceRefs
    .filter((source) =>
      ['screen', 'component', 'route', 'codebase'].includes(source.kind),
    )
    .slice(0, 6)
    .map((source) => source.id)
  const demoBeats =
    sourcePackage && sourcePackage.scriptBeats.length > 0
      ? sourcePackage.scriptBeats.slice(0, 1)
      : [
          {
            id: 'authoring-demo',
            text: `Watch ${title} in action`,
            sceneType: 'demo' as const,
            sourceRefIds: demoRefIds,
            action: direction,
          },
        ]
  return [
    {
      id: 'authoring-design',
      text: `See ${title} come together`,
      sceneType: 'design',
      sourceRefIds: designRefIds,
    },
    ...demoBeats,
  ]
}

function audioDetail(
  status: 'idle' | 'analyzing' | 'ready' | 'error',
  analysis: BeatAnalysis | null,
  durationSeconds: number,
  error: string,
): string {
  if (status === 'analyzing') return 'Detecting tempo and energy peaks…'
  if (status === 'error') return error
  if (status !== 'ready' || !analysis) {
    return 'Beats drive scene boundaries, reveals, camera cuts, and the logo hit'
  }
  if (analysis.status === 'no-pulse') {
    return `${durationSeconds.toFixed(1)}s available · no reliable pulse, timing remains authored`
  }
  return `${durationSeconds.toFixed(1)}s available · ${analysis.bpm.toFixed(1)} BPM · ${Math.round(analysis.confidence * 100)}% confidence`
}

function errorMessage(value: unknown, fallback: string): string {
  return value instanceof Error && value.message.trim()
    ? value.message
    : fallback
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

const textareaClass =
  'w-full resize-y rounded-md border border-border bg-app-bg px-2.5 py-2 text-[10px] leading-4 text-text outline-none transition-colors focus:border-accent motion-reduce:transition-none'
