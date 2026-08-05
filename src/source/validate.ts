// SPDX-License-Identifier: Apache-2.0

import {
  SOURCE_CAPTURE_LIMITS,
  type SourceCaptureManifestInput,
  type SourceManifestIssue,
  type SourceManifestIssueCode,
  type SourceManifestLimits,
  type SourceManifestValidationResult,
} from './types'
import {
  domSafetyIssue,
  inlineAssetSafetyIssue,
  isSafeLocalKey,
  isSafeProjectPath,
  isSafeRoutePath,
  remoteAssetUrlIssue,
  styleSafetyIssue,
} from './safety'

type ResolvedLimits = {
  [Key in keyof typeof SOURCE_CAPTURE_LIMITS]: number
}
type ObjectValue = Record<string, unknown>

export class SourceManifestValidationError extends Error {
  readonly issues: SourceManifestIssue[]

  constructor(issues: readonly SourceManifestIssue[]) {
    super(
      `Source capture manifest is invalid (${issues.length} issue${issues.length === 1 ? '' : 's'}).`,
    )
    this.name = 'SourceManifestValidationError'
    this.issues = [...issues]
  }
}

export function validateSourceCaptureManifest(
  input: unknown,
  limitsInput?: SourceManifestLimits,
): SourceManifestValidationResult {
  const limits = resolveSourceManifestLimits(limitsInput)
  const issues: SourceManifestIssue[] = []
  const add = (
    code: SourceManifestIssueCode,
    path: string,
    message: string,
  ): void => {
    issues.push({ code, path, message })
  }

  if (!isObject(input)) {
    add('invalid-type', '$', 'Manifest must be an object.')
    return { ok: false, issues }
  }
  if (input.version !== undefined && input.version !== 1) {
    add('unsupported-version', 'version', 'Only source manifest version 1 is supported.')
  }

  validateProvenance(input.provenance, 'provenance', limits, add)
  validateProject(input.project, 'project', limits, add)

  const assetKeys = validateAssets(input.assets, limits, add)
  const routes = asArray(input.routes)
  if (!routes) {
    add('required', 'routes', 'routes must be an array.')
    return { ok: false, issues }
  }
  if (routes.length > limits.routes) {
    add(
      'limit-exceeded',
      'routes',
      `At most ${limits.routes} routes may be captured.`,
    )
  }

  const routePaths = new Set<string>()
  const counters = {
    screens: 0,
    domNodes: 0,
    styles: 0,
    components: 0,
    interactions: 0,
  }
  routes.forEach((route, routeIndex) => {
    const routePath = `routes[${routeIndex}]`
    if (!isObject(route)) {
      add('invalid-type', routePath, 'Route must be an object.')
      return
    }
    const pathname = requiredString(route.path, `${routePath}.path`, limits, add)
    if (pathname) {
      if (!isSafeRoutePath(pathname)) {
        add(
          'invalid-route',
          `${routePath}.path`,
          'Route must be a safe pathname without a scheme, query, hash, or traversal.',
        )
      } else if (routePaths.has(pathname)) {
        add('duplicate-key', `${routePath}.path`, `Duplicate route "${pathname}".`)
      }
      routePaths.add(pathname)
    }
    optionalSafePath(route.sourcePath, `${routePath}.sourcePath`, limits, add)
    optionalString(route.label, `${routePath}.label`, limits, add)

    const screens = asArray(route.screens)
    if (!screens) {
      add('required', `${routePath}.screens`, 'screens must be an array.')
      return
    }
    counters.screens += screens.length
    const screenKeys = new Set<string>()
    screens.forEach((screen, screenIndex) => {
      const screenPath = `${routePath}.screens[${screenIndex}]`
      validateScreen(
        screen,
        screenPath,
        assetKeys,
        screenKeys,
        limits,
        counters,
        add,
      )
    })
  })

  validateGlobalLimit(counters.screens, limits.screens, 'screens', add)
  validateGlobalLimit(counters.domNodes, limits.domNodes, 'domNodes', add)
  validateGlobalLimit(counters.styles, limits.styles, 'styles', add)
  validateGlobalLimit(counters.components, limits.components, 'components', add)
  validateGlobalLimit(
    counters.interactions,
    limits.interactions,
    'interactions',
    add,
  )
  return { ok: issues.length === 0, issues }
}

export function assertValidSourceCaptureManifest(
  input: unknown,
  limits?: SourceManifestLimits,
): asserts input is SourceCaptureManifestInput {
  const result = validateSourceCaptureManifest(input, limits)
  if (!result.ok) throw new SourceManifestValidationError(result.issues)
}

export function resolveSourceManifestLimits(
  input: SourceManifestLimits | undefined,
): ResolvedLimits {
  return {
    routes: boundedLimit(input?.routes, SOURCE_CAPTURE_LIMITS.routes),
    screens: boundedLimit(input?.screens, SOURCE_CAPTURE_LIMITS.screens),
    statesPerScreen: boundedLimit(
      input?.statesPerScreen,
      SOURCE_CAPTURE_LIMITS.statesPerScreen,
    ),
    domNodes: boundedLimit(input?.domNodes, SOURCE_CAPTURE_LIMITS.domNodes),
    domDepth: boundedLimit(input?.domDepth, SOURCE_CAPTURE_LIMITS.domDepth),
    attributesPerNode: boundedLimit(
      input?.attributesPerNode,
      SOURCE_CAPTURE_LIMITS.attributesPerNode,
    ),
    styles: boundedLimit(input?.styles, SOURCE_CAPTURE_LIMITS.styles),
    components: boundedLimit(input?.components, SOURCE_CAPTURE_LIMITS.components),
    interactions: boundedLimit(
      input?.interactions,
      SOURCE_CAPTURE_LIMITS.interactions,
    ),
    assets: boundedLimit(input?.assets, SOURCE_CAPTURE_LIMITS.assets),
    textLength: boundedLimit(input?.textLength, SOURCE_CAPTURE_LIMITS.textLength),
    valueLength: boundedLimit(
      input?.valueLength,
      SOURCE_CAPTURE_LIMITS.valueLength,
    ),
  }
}

function validateProject(
  value: unknown,
  path: string,
  limits: ResolvedLimits,
  add: AddIssue,
): void {
  if (!isObject(value)) {
    add('required', path, 'project must be an object.')
    return
  }
  requiredString(value.name, `${path}.name`, limits, add)
  optionalString(value.packageName, `${path}.packageName`, limits, add)
  if (value.rootPath !== undefined) {
    const rootPath = requiredString(
      value.rootPath,
      `${path}.rootPath`,
      limits,
      add,
    )
    if (rootPath && !isSafeProjectPath(rootPath, true)) {
      add(
        'unsafe-path',
        `${path}.rootPath`,
        'Project root must be "." or a repository-relative path without traversal.',
      )
    }
  }
  if (value.framework !== undefined && !isObject(value.framework)) {
    add('invalid-type', `${path}.framework`, 'framework must be an object.')
  } else if (isObject(value.framework)) {
    const kind = value.framework.kind
    if (!['nextjs', 'web', 'native', 'other'].includes(String(kind))) {
      add('invalid-type', `${path}.framework.kind`, 'Unsupported framework kind.')
    }
    if (kind === 'nextjs') {
      if (!['app', 'pages', 'mixed'].includes(String(value.framework.router))) {
        add(
          'invalid-type',
          `${path}.framework.router`,
          'Next.js router must be app, pages, or mixed.',
        )
      }
      for (const property of ['shadcn', 'tailwind', 'typescript']) {
        if (typeof value.framework[property] !== 'boolean') {
          add(
            'invalid-type',
            `${path}.framework.${property}`,
            `${property} must be a boolean.`,
          )
        }
      }
    }
  }
}

function validateProvenance(
  value: unknown,
  path: string,
  limits: ResolvedLimits,
  add: AddIssue,
): void {
  if (!isObject(value)) {
    add('required', path, 'provenance must be an object.')
    return
  }
  const origin = requiredString(value.origin, `${path}.origin`, limits, add)
  const origins = ['codebase', 'browser', 'design-tool', 'upload', 'mcp', 'manual']
  if (origin && !origins.includes(origin)) {
    add('invalid-provenance', `${path}.origin`, 'Unsupported provenance origin.')
  }
  requiredString(value.sourceId, `${path}.sourceId`, limits, add)
  const locator = requiredString(value.locator, `${path}.locator`, limits, add)
  if (
    locator &&
    origin === 'codebase' &&
    !isSafeProjectPath(locator, true)
  ) {
    add(
      'unsafe-path',
      `${path}.locator`,
      'Codebase provenance locator must be repository-relative.',
    )
  }
  optionalString(value.revision, `${path}.revision`, limits, add)
  optionalString(value.integrity, `${path}.integrity`, limits, add)
  if (value.capturedAt !== undefined) {
    const capturedAt = optionalString(
      value.capturedAt,
      `${path}.capturedAt`,
      limits,
      add,
    )
    if (capturedAt && !Number.isFinite(Date.parse(capturedAt))) {
      add(
        'invalid-provenance',
        `${path}.capturedAt`,
        'capturedAt must be an ISO-compatible date string.',
      )
    }
  }
}

function validateAssets(
  value: unknown,
  limits: ResolvedLimits,
  add: AddIssue,
): Set<string> {
  if (value === undefined) return new Set()
  const assets = asArray(value)
  if (!assets) {
    add('invalid-type', 'assets', 'assets must be an array.')
    return new Set()
  }
  if (assets.length > limits.assets) {
    add('limit-exceeded', 'assets', `At most ${limits.assets} assets are allowed.`)
  }
  const keys = new Set<string>()
  assets.forEach((asset, index) => {
    const path = `assets[${index}]`
    if (!isObject(asset)) {
      add('invalid-type', path, 'Asset must be an object.')
      return
    }
    const key = validateLocalKey(asset.key, `${path}.key`, limits, add)
    if (key) {
      if (keys.has(key)) {
        add('duplicate-key', `${path}.key`, `Duplicate asset key "${key}".`)
      }
      keys.add(key)
    }
    const kind = requiredString(asset.kind, `${path}.kind`, limits, add)
    if (
      kind &&
      !['image', 'svg', 'icon', 'font', 'video', 'audio', 'logo'].includes(kind)
    ) {
      if (kind === 'script') {
        add('remote-script', `${path}.kind`, 'Script assets are never accepted.')
      } else {
        add('invalid-type', `${path}.kind`, 'Unsupported asset kind.')
      }
    }
    optionalString(asset.label, `${path}.label`, limits, add)
    validateOptionalDimension(asset.width, `${path}.width`, add)
    validateOptionalDimension(asset.height, `${path}.height`, add)
    validateAssetLocation(asset.location, `${path}.location`, limits, add)
  })
  return keys
}

function validateAssetLocation(
  value: unknown,
  path: string,
  limits: ResolvedLimits,
  add: AddIssue,
): void {
  if (!isObject(value)) {
    add('required', path, 'Asset location must be an object.')
    return
  }
  const kind = requiredString(value.kind, `${path}.kind`, limits, add)
  if (kind === 'project-file') {
    const filePath = requiredString(value.path, `${path}.path`, limits, add)
    if (filePath && !isSafeProjectPath(filePath)) {
      add(
        'unsafe-path',
        `${path}.path`,
        'Asset paths must be repository-relative and may not traverse directories.',
      )
    }
    return
  }
  if (kind === 'remote') {
    const url = requiredString(value.url, `${path}.url`, limits, add)
    const contentType = optionalString(
      value.contentType,
      `${path}.contentType`,
      limits,
      add,
    )
    if (url) {
      const issue = remoteAssetUrlIssue(url, contentType ?? undefined)
      if (issue) {
        add(
          issue,
          `${path}.url`,
          issue === 'remote-script'
            ? 'Remote scripts and script MIME types are not accepted.'
            : 'Remote assets must use credential-free public HTTPS URLs.',
        )
      }
    }
    return
  }
  if (kind === 'inline') {
    const mediaType = requiredString(
      value.mediaType,
      `${path}.mediaType`,
      limits,
      add,
    )
    const integrity = requiredString(
      value.integrity,
      `${path}.integrity`,
      limits,
      add,
    )
    if (integrity && !/^(?:sha256|sha384|sha512)-[a-zA-Z0-9+/=_-]+$/.test(integrity)) {
      add(
        'invalid-type',
        `${path}.integrity`,
        'Inline assets require an explicit sha256/sha384/sha512 integrity value.',
      )
    }
    if (
      typeof value.byteLength !== 'number' ||
      !Number.isInteger(value.byteLength) ||
      value.byteLength < 0
    ) {
      add(
        'invalid-type',
        `${path}.byteLength`,
        'Inline byteLength must be a non-negative integer.',
      )
    }
    const text = optionalString(value.text, `${path}.text`, limits, add, true)
    if (mediaType) {
      const issue = inlineAssetSafetyIssue(mediaType, text ?? undefined)
      if (issue) {
        add(
          issue,
          `${path}.text`,
          'Inline executable content, event handlers, and active embeds are not accepted.',
        )
      }
    }
    return
  }
  if (kind) add('invalid-type', `${path}.kind`, 'Unsupported asset location kind.')
}

function validateScreen(
  value: unknown,
  path: string,
  assetKeys: ReadonlySet<string>,
  siblingKeys: Set<string>,
  limits: ResolvedLimits,
  counters: Counters,
  add: AddIssue,
): void {
  if (!isObject(value)) {
    add('invalid-type', path, 'Screen must be an object.')
    return
  }
  const name = requiredString(value.name, `${path}.name`, limits, add)
  const key =
    value.key === undefined
      ? name
      : validateLocalKey(value.key, `${path}.key`, limits, add)
  if (key) {
    if (siblingKeys.has(key)) {
      add('duplicate-key', `${path}.key`, `Duplicate screen key "${key}".`)
    }
    siblingKeys.add(key)
  }
  optionalSafePath(value.sourcePath, `${path}.sourcePath`, limits, add)
  validateViewport(value.viewport, `${path}.viewport`, add)

  const states = asArray(value.states)
  if (!states) {
    add('required', `${path}.states`, 'states must be an array.')
    return
  }
  if (states.length > limits.statesPerScreen) {
    add(
      'limit-exceeded',
      `${path}.states`,
      `At most ${limits.statesPerScreen} states may be captured per screen.`,
    )
  }
  const stateNames = new Set<string>()
  const stateKinds = new Set<string>()
  states.forEach((state) => {
    if (!isObject(state)) return
    if (typeof state.name === 'string') stateNames.add(state.name.trim())
    if (typeof state.kind === 'string') stateKinds.add(state.kind)
  })
  if (!stateKinds.has('default')) {
    add(
      'invalid-state',
      `${path}.states`,
      'Every screen must include a default state.',
    )
  }
  const seenStateNames = new Set<string>()
  states.forEach((state, stateIndex) => {
    validateState(
      state,
      `${path}.states[${stateIndex}]`,
      assetKeys,
      stateNames,
      seenStateNames,
      limits,
      counters,
      add,
    )
  })
}

function validateState(
  value: unknown,
  path: string,
  assetKeys: ReadonlySet<string>,
  stateNames: ReadonlySet<string>,
  seenStateNames: Set<string>,
  limits: ResolvedLimits,
  counters: Counters,
  add: AddIssue,
): void {
  if (!isObject(value)) {
    add('invalid-type', path, 'Screen state must be an object.')
    return
  }
  const name = requiredString(value.name, `${path}.name`, limits, add)
  if (name) {
    if (seenStateNames.has(name)) {
      add('duplicate-key', `${path}.name`, `Duplicate state name "${name}".`)
    }
    seenStateNames.add(name)
  }
  const kind = requiredString(value.kind, `${path}.kind`, limits, add)
  const kinds = ['default', 'loading', 'error', 'success', 'empty', 'disabled', 'custom']
  if (kind && !kinds.includes(kind)) {
    add('invalid-state', `${path}.kind`, 'Unsupported interaction state kind.')
  }

  const domKeys = new Set<string>()
  const domCount = validateDomNode(
    value.dom,
    `${path}.dom`,
    1,
    domKeys,
    assetKeys,
    limits,
    add,
  )
  counters.domNodes += domCount

  const styles = value.styles === undefined ? [] : asArray(value.styles)
  if (!styles) {
    add('invalid-type', `${path}.styles`, 'styles must be an array.')
  } else {
    counters.styles += styles.length
    styles.forEach((style, styleIndex) => {
      validateStyle(
        style,
        `${path}.styles[${styleIndex}]`,
        domKeys,
        limits,
        add,
      )
    })
  }

  const components =
    value.components === undefined ? [] : asArray(value.components)
  if (!components) {
    add('invalid-type', `${path}.components`, 'components must be an array.')
  } else {
    counters.components += components.length
    const componentKeys = new Set<string>()
    components.forEach((component, componentIndex) => {
      validateComponent(
        component,
        `${path}.components[${componentIndex}]`,
        domKeys,
        componentKeys,
        limits,
        add,
      )
    })
  }

  const interactions =
    value.interactions === undefined ? [] : asArray(value.interactions)
  if (!interactions) {
    add('invalid-type', `${path}.interactions`, 'interactions must be an array.')
  } else {
    counters.interactions += interactions.length
    interactions.forEach((interaction, interactionIndex) => {
      validateInteraction(
        interaction,
        `${path}.interactions[${interactionIndex}]`,
        domKeys,
        stateNames,
        limits,
        add,
      )
    })
  }
}

function validateDomNode(
  value: unknown,
  path: string,
  depth: number,
  keys: Set<string>,
  assetKeys: ReadonlySet<string>,
  limits: ResolvedLimits,
  add: AddIssue,
): number {
  if (!isObject(value)) {
    add('required', path, 'DOM snapshot root must be an object.')
    return 0
  }
  if (depth > limits.domDepth) {
    add(
      'limit-exceeded',
      path,
      `DOM depth may not exceed ${limits.domDepth}.`,
    )
    return 0
  }
  const key = validateLocalKey(value.key, `${path}.key`, limits, add)
  if (key) {
    if (keys.has(key)) {
      add('duplicate-key', `${path}.key`, `Duplicate DOM node key "${key}".`)
    }
    keys.add(key)
  }
  const tag = requiredString(value.tag, `${path}.tag`, limits, add)
  optionalString(value.role, `${path}.role`, limits, add)
  const text = optionalString(value.text, `${path}.text`, limits, add, true)
  const attributes = validateStringRecord(
    value.attributes,
    `${path}.attributes`,
    limits,
    add,
    limits.attributesPerNode,
  )
  if (tag) {
    const issue = domSafetyIssue(tag, attributes, text ?? undefined)
    if (issue) {
      add(
        issue,
        path,
        issue === 'remote-script'
          ? 'Script nodes, script URLs, and executable text are not accepted.'
          : issue === 'unsafe-style'
            ? 'Inline style contains active or remote CSS.'
            : 'DOM snapshot contains an active element, event handler, or unsafe URI.',
      )
    }
  }
  validateStringArray(value.classNames, `${path}.classNames`, limits, add)
  const referencedAssets = validateStringArray(
    value.assetKeys,
    `${path}.assetKeys`,
    limits,
    add,
  )
  referencedAssets.forEach((assetKey, assetIndex) => {
    if (!assetKeys.has(assetKey)) {
      add(
        'missing-reference',
        `${path}.assetKeys[${assetIndex}]`,
        `Unknown asset key "${assetKey}".`,
      )
    }
  })

  const children = value.children === undefined ? [] : asArray(value.children)
  if (!children) {
    add('invalid-type', `${path}.children`, 'children must be an array.')
    return 1
  }
  let count = 1
  children.forEach((child, index) => {
    count += validateDomNode(
      child,
      `${path}.children[${index}]`,
      depth + 1,
      keys,
      assetKeys,
      limits,
      add,
    )
  })
  return count
}

function validateStyle(
  value: unknown,
  path: string,
  domKeys: ReadonlySet<string>,
  limits: ResolvedLimits,
  add: AddIssue,
): void {
  if (!isObject(value)) {
    add('invalid-type', path, 'Style snapshot must be an object.')
    return
  }
  const nodeKey = validateLocalKey(value.nodeKey, `${path}.nodeKey`, limits, add)
  if (nodeKey && !domKeys.has(nodeKey)) {
    add(
      'missing-reference',
      `${path}.nodeKey`,
      `Style references unknown DOM node "${nodeKey}".`,
    )
  }
  optionalString(value.pseudo, `${path}.pseudo`, limits, add)
  const computed = validateStringRecord(
    value.computed,
    `${path}.computed`,
    limits,
    add,
  )
  const tokens = validateStringRecord(
    value.tokens,
    `${path}.tokens`,
    limits,
    add,
  )
  for (const [property, propertyValue] of [
    ...Object.entries(computed),
    ...Object.entries(tokens),
  ]) {
    if (styleSafetyIssue(property, propertyValue)) {
      add(
        'unsafe-style',
        path,
        `Style property "${property}" contains active or remote CSS.`,
      )
    }
  }
}

function validateComponent(
  value: unknown,
  path: string,
  domKeys: ReadonlySet<string>,
  siblingKeys: Set<string>,
  limits: ResolvedLimits,
  add: AddIssue,
): void {
  if (!isObject(value)) {
    add('invalid-type', path, 'Component boundary must be an object.')
    return
  }
  const key = validateLocalKey(value.key, `${path}.key`, limits, add)
  if (key) {
    if (siblingKeys.has(key)) {
      add('duplicate-key', `${path}.key`, `Duplicate component key "${key}".`)
    }
    siblingKeys.add(key)
  }
  requiredString(value.name, `${path}.name`, limits, add)
  const rootNodeKey = validateLocalKey(
    value.rootNodeKey,
    `${path}.rootNodeKey`,
    limits,
    add,
  )
  if (rootNodeKey && !domKeys.has(rootNodeKey)) {
    add(
      'missing-reference',
      `${path}.rootNodeKey`,
      `Component references unknown DOM node "${rootNodeKey}".`,
    )
  }
  if (value.reuseKey !== undefined) {
    validateLocalKey(value.reuseKey, `${path}.reuseKey`, limits, add)
  }
  optionalSafePath(value.sourcePath, `${path}.sourcePath`, limits, add)
  optionalString(value.exportName, `${path}.exportName`, limits, add)
  optionalString(value.variant, `${path}.variant`, limits, add)
  if (value.props !== undefined) {
    if (!isObject(value.props)) {
      add('invalid-type', `${path}.props`, 'props must be a flat primitive record.')
    } else {
      for (const [keyName, propValue] of Object.entries(value.props)) {
        if (
          !['string', 'number', 'boolean'].includes(typeof propValue) &&
          propValue !== null
        ) {
          add(
            'invalid-type',
            `${path}.props.${keyName}`,
            'Captured props may only contain string, number, boolean, or null values.',
          )
        }
      }
    }
  }
}

function validateInteraction(
  value: unknown,
  path: string,
  domKeys: ReadonlySet<string>,
  stateNames: ReadonlySet<string>,
  limits: ResolvedLimits,
  add: AddIssue,
): void {
  if (!isObject(value)) {
    add('invalid-type', path, 'Interaction must be an object.')
    return
  }
  const action = requiredString(value.action, `${path}.action`, limits, add)
  if (
    action &&
    !['focus', 'click', 'type', 'submit', 'navigate', 'wait', 'state-change'].includes(
      action,
    )
  ) {
    add('invalid-type', `${path}.action`, 'Unsupported interaction action.')
  }
  const target = validateLocalKey(
    value.targetNodeKey,
    `${path}.targetNodeKey`,
    limits,
    add,
  )
  if (target && !domKeys.has(target)) {
    add(
      'missing-reference',
      `${path}.targetNodeKey`,
      `Interaction references unknown DOM node "${target}".`,
    )
  }
  optionalString(value.label, `${path}.label`, limits, add)
  optionalString(value.inputHint, `${path}.inputHint`, limits, add)
  const resultingState = optionalString(
    value.resultingState,
    `${path}.resultingState`,
    limits,
    add,
  )
  if (resultingState && !stateNames.has(resultingState)) {
    add(
      'missing-reference',
      `${path}.resultingState`,
      `Interaction references unknown state "${resultingState}".`,
    )
  }
  if (
    value.order !== undefined &&
    (typeof value.order !== 'number' ||
      !Number.isInteger(value.order) ||
      value.order < 0)
  ) {
    add('invalid-type', `${path}.order`, 'Interaction order must be a non-negative integer.')
  }
}

function validateViewport(
  value: unknown,
  path: string,
  add: AddIssue,
): void {
  if (!isObject(value)) {
    add('required', path, 'viewport must be an object.')
    return
  }
  for (const property of ['width', 'height']) {
    const dimension = value[property]
    if (
      typeof dimension !== 'number' ||
      !Number.isFinite(dimension) ||
      dimension <= 0 ||
      dimension > 16_384
    ) {
      add(
        'invalid-viewport',
        `${path}.${property}`,
        `${property} must be between 1 and 16384.`,
      )
    }
  }
  if (
    value.deviceScaleFactor !== undefined &&
    (typeof value.deviceScaleFactor !== 'number' ||
      !Number.isFinite(value.deviceScaleFactor) ||
      value.deviceScaleFactor <= 0 ||
      value.deviceScaleFactor > 8)
  ) {
    add(
      'invalid-viewport',
      `${path}.deviceScaleFactor`,
      'deviceScaleFactor must be between 0 and 8.',
    )
  }
}

function validateStringRecord(
  value: unknown,
  path: string,
  limits: ResolvedLimits,
  add: AddIssue,
  maxEntries = 512,
): Record<string, string> {
  if (value === undefined) return {}
  if (!isObject(value)) {
    add('invalid-type', path, 'Value must be a string record.')
    return {}
  }
  const entries = Object.entries(value)
  if (entries.length > maxEntries) {
    add(
      'limit-exceeded',
      path,
      `Record may contain at most ${maxEntries} entries.`,
    )
  }
  const result: Record<string, string> = {}
  entries.forEach(([key, entryValue]) => {
    if (typeof entryValue !== 'string') {
      add('invalid-type', `${path}.${key}`, 'Value must be a string.')
      return
    }
    if (key.length > limits.valueLength || entryValue.length > limits.valueLength) {
      add(
        'limit-exceeded',
        `${path}.${key}`,
        `Key and value must not exceed ${limits.valueLength} characters.`,
      )
      return
    }
    result[key] = entryValue
  })
  return result
}

function validateStringArray(
  value: unknown,
  path: string,
  limits: ResolvedLimits,
  add: AddIssue,
): string[] {
  if (value === undefined) return []
  const array = asArray(value)
  if (!array) {
    add('invalid-type', path, 'Value must be a string array.')
    return []
  }
  const result: string[] = []
  array.forEach((entry, index) => {
    const normalized = requiredString(entry, `${path}[${index}]`, limits, add)
    if (normalized) result.push(normalized)
  })
  return result
}

function optionalSafePath(
  value: unknown,
  path: string,
  limits: ResolvedLimits,
  add: AddIssue,
): void {
  const normalized = optionalString(value, path, limits, add)
  if (normalized && !isSafeProjectPath(normalized)) {
    add(
      'unsafe-path',
      path,
      'Source paths must be repository-relative and may not traverse directories.',
    )
  }
}

function validateLocalKey(
  value: unknown,
  path: string,
  limits: ResolvedLimits,
  add: AddIssue,
): string | null {
  const key = requiredString(value, path, limits, add)
  if (key && !isSafeLocalKey(key)) {
    add(
      'invalid-type',
      path,
      'Key must contain only letters, numbers, dot, underscore, colon, or hyphen.',
    )
  }
  return key
}

function requiredString(
  value: unknown,
  path: string,
  limits: ResolvedLimits,
  add: AddIssue,
  allowLongText = false,
): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    add('required', path, 'A non-empty string is required.')
    return null
  }
  const max = allowLongText ? limits.textLength : limits.valueLength
  if (value.length > max) {
    add('limit-exceeded', path, `String must not exceed ${max} characters.`)
  }
  if (value.includes('\0')) {
    add('invalid-type', path, 'Strings may not contain null bytes.')
  }
  return value.trim()
}

function optionalString(
  value: unknown,
  path: string,
  limits: ResolvedLimits,
  add: AddIssue,
  allowLongText = false,
): string | null {
  if (value === undefined) return null
  return requiredString(value, path, limits, add, allowLongText)
}

function validateOptionalDimension(
  value: unknown,
  path: string,
  add: AddIssue,
): void {
  if (
    value !== undefined &&
    (typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value <= 0 ||
      value > 32_768)
  ) {
    add('invalid-type', path, 'Dimension must be between 1 and 32768.')
  }
}

function validateGlobalLimit(
  value: number,
  limit: number,
  name: string,
  add: AddIssue,
): void {
  if (value > limit) {
    add(
      'limit-exceeded',
      name,
      `Capture contains ${value} ${name}; the maximum is ${limit}.`,
    )
  }
}

function boundedLimit(value: number | undefined, hardMaximum: number): number {
  if (!Number.isInteger(value) || value === undefined || value < 1) {
    return hardMaximum
  }
  return Math.min(value, hardMaximum)
}

function asArray(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? value : null
}

function isObject(value: unknown): value is ObjectValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type AddIssue = (
  code: SourceManifestIssueCode,
  path: string,
  message: string,
) => void

interface Counters {
  screens: number
  domNodes: number
  styles: number
  components: number
  interactions: number
}
