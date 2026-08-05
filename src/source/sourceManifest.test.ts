// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  SourceManifestValidationError,
  adaptSourceManifestForExplainer,
  normalizeSourceCaptureManifest,
  validateSourceCaptureManifest,
  type SourceCaptureManifestInput,
  type SourceDomNodeInput,
  type SourceInteractionStateKind,
  type SourceScreenStateInput,
} from './index'

describe('source capture manifest', () => {
  it('normalizes a Next.js/shadcn/Tailwind capture deterministically', () => {
    const input = createCheckoutManifest()
    const first = normalizeSourceCaptureManifest(input)
    const second = normalizeSourceCaptureManifest(structuredClone(input))

    expect(second).toEqual(first)
    expect(first.project.framework).toEqual({
      kind: 'nextjs',
      router: 'app',
      shadcn: true,
      tailwind: true,
      typescript: true,
    })
    expect(first.routes[0]?.screens[0]?.states.map((state) => state.kind)).toEqual([
      'default',
      'loading',
      'success',
    ])
    expect(first.stats).toMatchObject({
      routes: 1,
      screens: 1,
      states: 3,
      componentOccurrences: 6,
      reusableComponents: 2,
      interactions: 3,
      assets: 1,
    })
    expect(first.id).toMatch(/^manifest-checkout-demo-[a-z0-9]+$/)
    expect(first.routes[0]?.sourcePath).toBe('app/checkout/page.tsx')
  })

  it('infers reusable component boundaries and state variants', () => {
    const manifest = normalizeSourceCaptureManifest(createCheckoutManifest())
    const form = manifest.components.find(
      (component) => component.reuseKey === 'key:checkout-form',
    )
    const button = manifest.components.find(
      (component) => component.reuseKey === 'key:submit-button',
    )

    expect(form).toBeDefined()
    expect(form?.reusable).toBe(true)
    expect(form?.sourcePath).toBe('components/checkout-form.tsx')
    expect(form?.variants.map((variant) => variant.name)).toEqual([
      'Default',
      'Loading',
      'Success',
    ])
    expect(form?.occurrences.map((occurrence) => occurrence.stateKind)).toEqual([
      'default',
      'loading',
      'success',
    ])
    expect(new Set(form?.occurrences.map((item) => item.signature)).size).toBe(3)
    expect(button?.variants.map((variant) => variant.name)).toEqual([
      'Idle',
      'Pending',
      'Complete',
    ])

    const states = manifest.routes[0]?.screens[0]?.states ?? []
    expect(states.every((state) => state.componentOccurrenceIds.length === 2)).toBe(
      true,
    )
  })

  it('adapts captures into explainer source refs and executable demo guidance', () => {
    const manifest = normalizeSourceCaptureManifest(createCheckoutManifest())
    const adapted = adaptSourceManifestForExplainer(manifest)
    const guidance = adapted.demoGuidance[0]

    expect(
      adapted.sourceRefs.find((ref) => ref.kind === 'codebase')?.metadata,
    ).toMatchObject({
      framework: 'nextjs',
      nextRouter: 'app',
      shadcn: true,
      tailwind: true,
      typescript: true,
    })
    expect(adapted.sourceRefs.filter((ref) => ref.kind === 'component')).toHaveLength(
      2,
    )
    expect(guidance).toMatchObject({
      initialState: 'default',
      terminalStates: ['success'],
    })
    expect(guidance?.steps.map((step) => step.action)).toEqual([
      'type',
      'submit',
      'success',
    ])
    expect(guidance?.steps.map((step) => step.toState)).toEqual([
      null,
      'loading',
      'success',
    ])
    expect(
      guidance?.steps.every((step) =>
        adapted.sourceRefs.some((ref) => ref.id === step.targetSourceRefId),
      ),
    ).toBe(true)
    expect(adapted.scriptBeats[0]).toMatchObject({
      sceneType: 'demo',
    })
  })

  it('rejects traversal, absolute paths, scripts, event handlers, and active CSS', () => {
    const input = createCheckoutManifest() as unknown as Record<string, unknown>
    const route = (input.routes as Record<string, unknown>[])[0]!
    route.sourcePath = '../secrets/page.tsx'
    const assets = input.assets as Record<string, unknown>[]
    assets.push({
      key: 'remote-code',
      kind: 'image',
      location: {
        kind: 'remote',
        url: 'https://cdn.example.com/runtime.js',
        contentType: 'text/javascript',
      },
    })
    const state = (
      (route.screens as Record<string, unknown>[])[0]!
        .states as Record<string, unknown>[]
    )[0]!
    const dom = state.dom as Record<string, unknown>
    dom.children = [
      ...(dom.children as unknown[]),
      {
        key: 'bad-script',
        tag: 'script',
        attributes: { src: 'https://cdn.example.com/app.js' },
      },
      {
        key: 'bad-handler',
        tag: 'button',
        attributes: { onClick: 'steal()', style: '@import "https://evil.test/x"' },
      },
    ]

    const result = validateSourceCaptureManifest(input)
    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'unsafe-path',
        'remote-script',
        'unsafe-dom',
      ]),
    )
    expect(() =>
      normalizeSourceCaptureManifest(input as unknown as SourceCaptureManifestInput),
    ).toThrow(SourceManifestValidationError)
  })

  it('rejects private remote URLs, unsafe inline SVG, and captures over limits', () => {
    const input = createCheckoutManifest() as unknown as Record<string, unknown>
    const assets = input.assets as Record<string, unknown>[]
    assets.push(
      {
        key: 'private-image',
        kind: 'image',
        location: {
          kind: 'remote',
          url: 'https://127.0.0.1/admin.png',
          contentType: 'image/png',
        },
      },
      {
        key: 'unsafe-svg',
        kind: 'svg',
        location: {
          kind: 'inline',
          mediaType: 'image/svg+xml',
          byteLength: 64,
          integrity: 'sha256-ZmFrZQ==',
          text: '<svg><image onload="run()" /></svg>',
        },
      },
    )

    const result = validateSourceCaptureManifest(input, { domNodes: 2 })
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'unsafe-url',
        'remote-script',
        'limit-exceeded',
      ]),
    )
  })
})

function createCheckoutManifest(): SourceCaptureManifestInput {
  return {
    version: 1,
    id: 'checkout-demo',
    provenance: {
      origin: 'codebase',
      sourceId: 'acme-web',
      locator: '.',
      revision: 'abc1234',
      capturedAt: '2026-07-25T08:00:00.000Z',
    },
    project: {
      name: 'Acme Checkout',
      rootPath: '.',
      packageName: '@acme/web',
      framework: {
        kind: 'nextjs',
        router: 'app',
        shadcn: true,
        tailwind: true,
        typescript: true,
      },
    },
    routes: [
      {
        path: '/checkout',
        label: 'Checkout',
        sourcePath: 'app/checkout/page.tsx',
        screens: [
          {
            key: 'checkout-desktop',
            name: 'Checkout form',
            sourcePath: 'app/checkout/page.tsx',
            viewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
            states: [
              state('Success', 'success', 'Complete'),
              state('Default', 'default', 'Idle'),
              state('Loading', 'loading', 'Pending'),
            ],
          },
        ],
      },
    ],
    assets: [
      {
        key: 'brand-logo',
        kind: 'logo',
        label: 'Acme logo',
        location: {
          kind: 'project-file',
          path: 'public/brand/logo.svg',
        },
        width: 160,
        height: 40,
      },
    ],
  }
}

function state(
  name: string,
  kind: SourceScreenStateInput['kind'],
  buttonVariant: string,
): SourceScreenStateInput {
  const dom = domForState(kind)
  const interactions =
    kind === 'default'
      ? [
          {
            order: 0,
            action: 'type' as const,
            targetNodeKey: 'email',
            label: 'Enter an email address',
            inputHint: 'name@example.com',
          },
          {
            order: 1,
            action: 'submit' as const,
            targetNodeKey: 'submit',
            label: 'Submit the form',
            resultingState: 'Loading',
          },
        ]
      : kind === 'loading'
        ? [
            {
              order: 0,
              action: 'wait' as const,
              targetNodeKey: 'submit',
              label: 'Resolve the request',
              resultingState: 'Success',
            },
          ]
        : []
  return {
    name,
    kind,
    dom,
    styles: [
      {
        nodeKey: 'form',
        computed: {
          'background-color': '#ffffff',
          display: 'flex',
          gap: '16px',
        },
        tokens: {
          '--radius': '8px',
        },
      },
    ],
    components: [
      {
        key: 'checkout-form',
        reuseKey: 'checkout-form',
        name: 'CheckoutForm',
        rootNodeKey: 'form',
        sourcePath: 'components/checkout-form.tsx',
        exportName: 'CheckoutForm',
        variant: name,
        props: {
          pending: kind === 'loading',
          complete: kind === 'success',
        },
      },
      {
        key: 'submit-button',
        reuseKey: 'submit-button',
        name: 'Button',
        rootNodeKey: 'submit',
        sourcePath: 'components/ui/button.tsx',
        exportName: 'Button',
        variant: buttonVariant,
        props: {
          disabled: kind !== 'default',
        },
      },
    ],
    interactions,
  }
}

function domForState(kind: SourceInteractionStateKind): SourceDomNodeInput {
  const status =
    kind === 'success'
      ? [
          {
            key: 'success-message',
            tag: 'p',
            role: 'status',
            text: 'Payment method saved',
          },
        ]
      : []
  return {
    key: 'page',
    tag: 'main',
    children: [
      {
        key: 'form',
        tag: 'form',
        role: 'form',
        classNames: ['rounded-lg', 'p-6', 'space-y-4'],
        children: [
          {
            key: 'email',
            tag: 'input',
            role: 'textbox',
            attributes: {
              name: 'email',
              type: 'email',
            },
          },
          {
            key: 'submit',
            tag: 'button',
            role: 'button',
            text:
              kind === 'loading'
                ? 'Saving…'
                : kind === 'success'
                  ? 'Saved'
                  : 'Save payment method',
            attributes:
              kind === 'default'
                ? { type: 'submit' }
                : { type: 'submit', disabled: 'true' },
          },
          ...status,
        ],
      },
    ],
  }
}
