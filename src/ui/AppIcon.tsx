// SPDX-License-Identifier: Apache-2.0

import type { SVGProps } from 'react'

export type AppIconName =
  | 'align-bottom'
  | 'align-center-x'
  | 'align-center-y'
  | 'align-left'
  | 'align-right'
  | 'align-top'
  | 'audio'
  | 'camera'
  | 'check'
  | 'circle'
  | 'copy'
  | 'distribute-x'
  | 'distribute-y'
  | 'frame'
  | 'grid'
  | 'image'
  | 'layers'
  | 'nodes'
  | 'plus'
  | 'sparkle'
  | 'square'
  | 'stack-x'
  | 'stack-y'
  | 'text'
  | 'trash'
  | 'vector'
  | 'video'

const ICONS: Record<AppIconName, string> = {
  'align-bottom': `
    <line x1="1.75" y1="15.25" x2="16.25" y2="15.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <rect x="3.75" y="2.75" width="3.5" height="9.5" rx="1" ry="1" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <rect x="10.75" y="6.75" width="3.5" height="5.5" rx="1" ry="1" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />`,
  'align-center-x': `
    <line x1="9" y1="16.25" x2="9" y2="14.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <line x1="9" y1="10.75" x2="9" y2="7.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <line x1="9" y1="3.75" x2="9" y2="1.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <rect x="7.25" y="7.25" width="3.5" height="10.5" rx="1" ry="1" transform="translate(-3.5 21.5) rotate(-90)" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <rect x="7.25" y="2.25" width="3.5" height="6.5" rx="1" ry="1" transform="translate(3.5 14.5) rotate(-90)" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />`,
  'align-center-y': `
    <line x1="1.75" y1="9" x2="3.75" y2="9" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <line x1="7.25" y1="9" x2="10.75" y2="9" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <line x1="14.25" y1="9" x2="16.25" y2="9" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <rect x="3.75" y="3.75" width="3.5" height="10.5" rx="1" ry="1" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <rect x="10.75" y="5.75" width="3.5" height="6.5" rx="1" ry="1" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />`,
  'align-left': `
    <line x1="2.75" y1="1.75" x2="2.75" y2="16.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <rect x="8.75" y=".75" width="3.5" height="9.5" rx="1" ry="1" transform="translate(16 -5) rotate(90)" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <rect x="6.75" y="9.75" width="3.5" height="5.5" rx="1" ry="1" transform="translate(21 4) rotate(90)" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />`,
  'align-right': `
    <line x1="15.25" y1="1.75" x2="15.25" y2="16.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <rect x="5.75" y=".75" width="3.5" height="9.5" rx="1" ry="1" transform="translate(13 -2) rotate(90)" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <rect x="7.75" y="9.75" width="3.5" height="5.5" rx="1" ry="1" transform="translate(22 3) rotate(90)" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />`,
  'align-top': `
    <line x1="1.75" y1="2.75" x2="16.25" y2="2.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <rect x="3.75" y="5.75" width="3.5" height="9.5" rx="1" ry="1" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <rect x="10.75" y="5.75" width="3.5" height="5.5" rx="1" ry="1" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />`,
  audio: `
    <line x1="8.75" y1="6.25" x2="8.75" y2="13.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <circle cx="6" cy="13.5" r="2.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <path d="M9.615,2.382l3.5-.477c.6-.082,1.135,.385,1.135,.991v1.731c0,.5-.369,.923-.865,.991l-4.635,.632V3.373c0-.5,.369-.923,.865-.991Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />`,
  camera: `
    <path d="M14.25,3.75h-2.25l-.507-1.351c-.146-.39-.519-.649-.936-.649h-3.114c-.417,0-.79,.259-.936,.649l-.507,1.351H3.75c-1.105,0-2,.895-2,2v6.5c0,1.105,.895,2,2,2H14.25c1.105,0,2-.895,2-2V5.75c0-1.105-.895-2-2-2Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <circle cx="9" cy="9" r="2.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <circle cx="4.25" cy="6.25" r=".75" fill="currentColor" />`,
  check: `<polyline points="3.25 9.25 7.25 13.25 14.75 5.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />`,
  circle: `<circle cx="9" cy="9" r="7.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />`,
  copy: `
    <rect x="6.25" y="6.25" width="9" height="9" rx="2" ry="2" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <path d="M12.25 6.25v-1.5c0-1.105-.895-2-2-2h-5.5c-1.105 0-2 .895-2 2v5.5c0 1.105.895 2 2 2h1.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />`,
  'distribute-x': `
    <line x1="2.75" y1="1.75" x2="2.75" y2="16.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <line x1="15.25" y1="1.75" x2="15.25" y2="16.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <rect x="7.25" y="3.75" width="3.5" height="10.5" rx="1" ry="1" transform="translate(18 18) rotate(-180)" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />`,
  'distribute-y': `
    <line x1="1.75" y1="15.25" x2="16.25" y2="15.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <line x1="1.75" y1="2.75" x2="16.25" y2="2.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <rect x="7.25" y="3.75" width="3.5" height="10.5" rx="1" ry="1" transform="translate(18 0) rotate(90)" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />`,
  frame: `
    <line x1="4.75" y1="2.25" x2="4.75" y2=".75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <line x1="13.25" y1="2.25" x2="13.25" y2=".75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <line x1="4.75" y1="17.25" x2="4.75" y2="15.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <line x1="13.25" y1="17.25" x2="13.25" y2="15.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <line x1="15.75" y1="4.75" x2="17.25" y2="4.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <line x1="15.75" y1="13.25" x2="17.25" y2="13.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <line x1=".75" y1="4.75" x2="2.25" y2="4.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <line x1=".75" y1="13.25" x2="2.25" y2="13.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <rect x="4.75" y="4.75" width="8.5" height="8.5" rx="2" ry="2" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />`,
  grid: `
    <rect x="2.75" y="2.75" width="4.5" height="4.5" rx="1" ry="1" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <rect x="10.75" y="2.75" width="4.5" height="4.5" rx="1" ry="1" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <rect x="2.75" y="10.75" width="4.5" height="4.5" rx="1" ry="1" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <rect x="10.75" y="10.75" width="4.5" height="4.5" rx="1" ry="1" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />`,
  image: `
    <path d="M3.762,14.989l6.074-6.075c.781-.781,2.047-.781,2.828,0l2.586,2.586" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <rect x="2.75" y="2.75" width="12.5" height="12.5" rx="2" ry="2" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <circle cx="6.25" cy="7.25" r="1.25" fill="currentColor" />`,
  layers: `
    <path d="M2.58,6.149L8.385,1.949c.367-.266,.864-.266,1.231,0l5.805,4.2c.579,.419,.579,1.282,0,1.701l-5.805,4.2c-.367,.266-.864,.266-1.231,0L2.58,7.851c-.579-.419-.579-1.282,0-1.701Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <path d="M15.746,10.533c.217,.439,.109,1.003-.326,1.317l-5.805,4.2c-.184,.133-.4,.199-.615,.199-.216,0-.432-.066-.615-.199L2.58,11.851c-.434-.314-.543-.878-.326-1.317" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />`,
  nodes: `
    <path d="M10.998 3.826c1.862.628 3.332 2.11 3.943 3.98M2.871 10.981a6.23 6.23 0 011.475-5.404M13.131 14.443a6.23 6.23 0 01-5.421 1.425" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <circle cx="9" cy="3.75" r="2" fill="none" stroke="currentColor" stroke-width="1.5" />
    <circle cx="3.804" cy="12.75" r="2" fill="none" stroke="currentColor" stroke-width="1.5" />
    <circle cx="14.196" cy="12.75" r="2" fill="none" stroke="currentColor" stroke-width="1.5" />`,
  plus: `
    <line x1="9" y1="3" x2="9" y2="15" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <line x1="3" y1="9" x2="15" y2="9" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />`,
  sparkle: `
    <path d="M6.658 4.026l-1.263-.421-.421-1.263c-.137-.408-.812-.408-.949 0l-.421 1.263-1.263.421a.5.5 0 000 .948l1.263.421.421 1.263a.5.5 0 00.95 0l.42-1.263 1.264-.421a.5.5 0 000-.948ZM15.658 13.026l-1.263-.421-.421-1.263c-.137-.408-.812-.408-.949 0l-.421 1.263-1.263.421a.5.5 0 000 .948l1.263.421.421 1.263a.5.5 0 00.95 0l.42-1.263 1.264-.421a.5.5 0 000-.948Z" fill="currentColor" />
    <path d="M6 8.75l.671 2.579L9.25 12l-2.579.671L6 15.25l-.671-2.579L2.75 12l2.579-.671L6 8.75ZM12 2.75l.671 2.579L15.25 6l-2.579.671L12 9.25l-.671-2.579L8.75 6l2.579-.671L12 2.75Z" fill="currentColor" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />`,
  square: `<rect x="2.75" y="2.75" width="12.5" height="12.5" rx="2" ry="2" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />`,
  'stack-x': `
    <path d="M6.25 14.25h5.5c1.105 0 2-.9 2-2v-6.5c0-1.1-.895-2-2-2h-5.5c-1.105 0-2 .9-2 2v6.5c0 1.1.895 2 2 2Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <path d="M1.25 4.25v9.5M16.75 4.25v9.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />`,
  'stack-y': `
    <path d="M3.75 6.25v5.5c0 1.1.895 2 2 2h6.5c1.105 0 2-.9 2-2v-5.5c0-1.1-.895-2-2-2h-6.5c-1.105 0-2 .9-2 2Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <path d="M13.75 1.25h-9.5M13.75 16.75h-9.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />`,
  text: `
    <line x1="9" y1="2.75" x2="9" y2="15.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <line x1="14.25" y1="2.75" x2="3.75" y2="2.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />`,
  trash: `
    <line x1="3" y1="5.25" x2="15" y2="5.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <line x1="6.5" y1="2.75" x2="11.5" y2="2.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <path d="M5.25 5.25l.75 10h6l.75-10" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />`,
  vector: `<path d="M12.397 2.947l.223 3.387 3.861.605c.538.085.705.634.273.905l-4.641 2.918-1.222 4.368a.699.699 0 01-1.028.286l-3.058-1.978-4.385 1.703c-.554.216-1.132-.26-.845-.698l2.46-3.778-1.938-3.069c-.197-.312.047-.688.48-.738l5.051-.585 3.63-3.619c.368-.368 1.108-.178 1.139.292Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />`,
  video: `
    <path d="M12.25 8l4.259-2.342a.5.5 0 01.741.438v5.809a.5.5 0 01-.741.438L12.25 10" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <rect x="1.75" y="3.75" width="10.5" height="10.5" rx="2" ry="2" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
    <circle cx="4.75" cy="6.75" r=".75" fill="currentColor" />`,
}

export function AppIcon({
  name,
  size = 18,
  ...props
}: { name: AppIconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg
      {...props}
      data-app-icon={name}
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  )
}
