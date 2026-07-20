// SPDX-License-Identifier: Apache-2.0

import type { SVGProps } from 'react'

/**
 * Small, local subset of Nucleo UI Essential Outline 18 icons.
 * Source: https://nucleoapp.com/free-ui-icons
 * License: https://nucleoapp.com/license
 * Package reference: nucleo-ui-essential-outline-18@1.1.7
 */
type NucleoIconProps = SVGProps<SVGSVGElement> & {
  size?: number
  strokeWidth?: number
}

function NucleoIcon({
  size = 18,
  children,
  ...props
}: NucleoIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

export function NucleoPlugIcon({
  strokeWidth = 1.5,
  ...props
}: NucleoIconProps) {
  return (
    <NucleoIcon {...props}>
      <path
        d="M5.104,8.714l4.182,4.182c.391,.391,.391,1.024,0,1.414l-.28,.28c-1.545,1.545-4.051,1.545-5.596,0s-1.545-4.051,0-5.596l.28-.28c.391-.391,1.024-.391,1.414,0Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <line
        x1="1.75"
        y1="16.25"
        x2="3.409"
        y2="14.591"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <line
        x1="5.945"
        y1="9.555"
        x2="7.5"
        y2="8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <line
        x1="8.445"
        y1="12.055"
        x2="10"
        y2="10.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <path
        d="M8.714,5.104l4.182,4.182c.391,.391,1.024,.391,1.414,0l.28-.28c1.545-1.545,1.545-4.051,0-5.596s-4.051-1.545-5.596,0l-.28,.28c-.391,.391-.391,1.024,0,1.414Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <line
        x1="16.25"
        y1="1.75"
        x2="14.591"
        y2="3.409"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
    </NucleoIcon>
  )
}

export function NucleoPuzzlePieceIcon({
  strokeWidth = 1.5,
  ...props
}: NucleoIconProps) {
  return (
    <NucleoIcon {...props}>
      <path
        d="M14.75,8.25c.372,0,.716,.118,1,.317v-2.317c0-1.104-.895-2-2-2h-2.317c.198-.284,.317-.627,.317-1,0-.967-.784-1.75-1.75-1.75s-1.75,.783-1.75,1.75c0,.373,.118,.716,.317,1h-2.317c-1.105,0-2,.896-2,2v2.317c-.284-.198-.628-.317-1-.317-.966,0-1.75,.783-1.75,1.75s.784,1.75,1.75,1.75c.372,0,.716-.118,1-.317v2.317c0,1.104,.895,2,2,2h2.317c-.198-.284-.317-.627-.317-1,0-.967,.784-1.75,1.75-1.75s1.75,.783,1.75,1.75c0,.373-.118,.716-.317,1h2.317c1.105,0,2-.896,2-2v-2.317c-.284,.198-.628,.317-1,.317-.966,0-1.75-.783-1.75-1.75s.784-1.75,1.75-1.75Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
    </NucleoIcon>
  )
}

export function NucleoFolderOpenIcon({
  strokeWidth = 1.5,
  ...props
}: NucleoIconProps) {
  return (
    <NucleoIcon {...props}>
      <path
        d="M2.25,7.75v-3c0-1.105,.895-2,2-2h1.951c.607,0,1.18,.275,1.56,.748l.603,.752h5.386c1.105,0,2,.895,2,2v1.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <path
        d="M2.702,7.75H15.298c.986,0,1.703,.934,1.449,1.886l-1.101,4.129c-.233,.876-1.026,1.485-1.932,1.485H4.287c-.906,0-1.699-.609-1.932-1.485l-1.101-4.129c-.254-.952,.464-1.886,1.449-1.886Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
    </NucleoIcon>
  )
}

export function NucleoFilesIcon({
  strokeWidth = 1.5,
  ...props
}: NucleoIconProps) {
  return (
    <NucleoIcon {...props}>
      <path
        d="M6.25,10.75H3.25c-.552,0-1-.448-1-1V2.75c0-.552,.448-1,1-1H7.25l2,2v1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <polyline
        points="6.75 1.75 6.75 3.75 8.75 3.75"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <path
        d="M15.75,9.25v6c0,.552-.448,1-1,1h-5c-.552,0-1-.448-1-1v-7c0-.552,.448-1,1-1h4l2,2Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <polyline
        points="13.75 7.25 13.75 9.25 15.75 9.25"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
    </NucleoIcon>
  )
}

export function NucleoKeyboardIcon({
  strokeWidth = 1.5,
  ...props
}: NucleoIconProps) {
  return (
    <NucleoIcon {...props}>
      <rect
        x=".75"
        y="4.75"
        width="16.5"
        height="8.5"
        rx="2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <line
        x1="11.75"
        y1="10.25"
        x2="6.25"
        y2="10.25"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      {[
        [3, 7],
        [3, 9.5],
        [5.5, 7],
        [8.25, 7],
        [11, 7],
        [13.5, 7],
        [13.5, 9.5],
      ].map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1.5" height="1.5" rx=".5" fill="currentColor" />
      ))}
    </NucleoIcon>
  )
}

export function NucleoCheckIcon({
  strokeWidth = 1.5,
  ...props
}: NucleoIconProps) {
  return (
    <NucleoIcon {...props}>
      <polyline
        points="2.75 9.25 6.75 14.25 15.25 3.75"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
    </NucleoIcon>
  )
}

export function NucleoWarningIcon({
  strokeWidth = 1.5,
  ...props
}: NucleoIconProps) {
  return (
    <NucleoIcon {...props}>
      <path
        d="M7.638 3.49 2.213 12.89c-.605 1.05.151 2.36 1.362 2.36h10.85c1.211 0 1.967-1.31 1.362-2.36l-5.425-9.4c-.605-1.04-2.119-1.04-2.724 0Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <path
        d="M9 6.75v3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <circle cx="9" cy="12.5" r="1" fill="currentColor" />
    </NucleoIcon>
  )
}

export function NucleoDownloadIcon({
  strokeWidth = 1.5,
  ...props
}: NucleoIconProps) {
  return (
    <NucleoIcon {...props}>
      <polyline
        points="11.5 5.75 9 8.25 6.5 5.75"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <line
        x1="9"
        y1="8.25"
        x2="9"
        y2="2.75"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <path
        d="M16.214,9.75H11.75v1c0,.552-.448,1-1,1h-3.5c-.552,0-1-.448-1-1v-1H1.787"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <path
        d="M12,2.75h.137c.822,0,1.561,.503,1.862,1.269l2.113,5.379c.092,.233,.138,.481,.138,.731v3.121c0,1.105-.895,2-2,2H3.75c-1.105,0-2-.895-2-2v-3.121c0-.25,.047-.498,.138-.731l2.113-5.379c.301-.765,1.039-1.269,1.862-1.269H6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
    </NucleoIcon>
  )
}

export function NucleoPointerIcon({
  strokeWidth = 1.5,
  ...props
}: NucleoIconProps) {
  return (
    <NucleoIcon {...props}>
      <path
        d="M3.474,2.784 14.897,6.958c.481,.176,.467,.861-.021,1.018L9.648,9.649l-1.673,5.228c-.156,.488-.842,.502-1.018,.021L2.784,3.474c-.157-.43,.26-.847,.69-.69Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
    </NucleoIcon>
  )
}

export function NucleoHandIcon({
  strokeWidth = 1.5,
  ...props
}: NucleoIconProps) {
  return (
    <NucleoIcon {...props}>
      <path
        d="M10.75,8.25V2.5c0-.69-.564-1.25-1.25-1.25s-1.25,.56-1.25,1.25v5.75"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <path
        d="M13.25,8.25V3.25c0-.69-.564-1.25-1.25-1.25s-1.25,.56-1.25,1.25v5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <path
        d="M8.25,8.25V3.25c0-.69-.564-1.25-1.25-1.25s-1.25,.56-1.25,1.25V12.053"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <path
        d="m5.75,11.215-1.768-2.252c-.426-.543-1.215-.635-1.755-.211s-.604,1.131-.211,1.755l2.551,3.924c.738,1.135,2,1.82,3.354,1.82h3.83c2.209,0,4-1.791,4-4V4c0-.69-.564-1.25-1.25-1.25s-1.25,.56-1.25,1.25v4.25"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
    </NucleoIcon>
  )
}

export function NucleoFrameIcon({
  strokeWidth = 1.5,
  ...props
}: NucleoIconProps) {
  return (
    <NucleoIcon {...props}>
      <rect
        x="2.75"
        y="2.75"
        width="12.5"
        height="12.5"
        rx="2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <polyline
        points="12.25 8.75 12.25 5.75 9.25 5.75"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <polyline
        points="8.75 12.25 5.75 12.25 5.75 9.25"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
    </NucleoIcon>
  )
}

export function NucleoRectangleIcon({
  strokeWidth = 1.5,
  ...props
}: NucleoIconProps) {
  return (
    <NucleoIcon {...props}>
      <rect
        x="2.25"
        y="3.75"
        width="13.5"
        height="10.5"
        rx="1.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
    </NucleoIcon>
  )
}

export function NucleoEllipseIcon({
  strokeWidth = 1.5,
  ...props
}: NucleoIconProps) {
  return (
    <NucleoIcon {...props}>
      <ellipse
        cx="9"
        cy="9"
        rx="7.25"
        ry="5.75"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
    </NucleoIcon>
  )
}

export function NucleoTextToolIcon({
  strokeWidth = 1.5,
  ...props
}: NucleoIconProps) {
  return (
    <NucleoIcon {...props}>
      <path
        d="M16.25,12v.75c0,1.105-.895,2-2,2H3.75c-1.105,0-2-.895-2-2V12M1.75,6v-.75c0-1.105,.895-2,2-2h10.5c1.105,0,2,.895,2,2V6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <polyline
        points="11.798 12.25 9.068 5.75 8.932 5.75 6.202 12.25"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <line
        x1="6.832"
        y1="10.75"
        x2="11.168"
        y2="10.75"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <circle cx="1.75" cy="9" r=".75" fill="currentColor" />
      <circle cx="16.25" cy="9" r=".75" fill="currentColor" />
    </NucleoIcon>
  )
}

export function NucleoImageIcon({
  strokeWidth = 1.5,
  ...props
}: NucleoIconProps) {
  return (
    <NucleoIcon {...props}>
      <path
        d="m16.329,12.658-4.273-5.812c-.4-.543-1.212-.543-1.611,0l-3.319,4.514-1.444-1.964c-.4-.544-1.212-.544-1.611,0l-2.398,3.262c-.486,.66-.014,1.592,.806,1.592h13.044c.82,0,1.291-.932,.806-1.592Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <circle
        cx="5.5"
        cy="4"
        r="1.75"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
    </NucleoIcon>
  )
}

export function NucleoVideoIcon({
  strokeWidth = 1.5,
  ...props
}: NucleoIconProps) {
  return (
    <NucleoIcon {...props}>
      <path
        d="m12.25,8 4.259-2.342c.333-.183,.741,.058,.741,.438v5.809c0,.38-.408,.621-.741,.438L12.25,10"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <rect
        x="1.75"
        y="3.75"
        width="10.5"
        height="10.5"
        rx="2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <circle cx="4.75" cy="6.75" r=".75" fill="currentColor" />
    </NucleoIcon>
  )
}

export function NucleoWindowPointerIcon({
  strokeWidth = 1.5,
  ...props
}: NucleoIconProps) {
  return (
    <NucleoIcon {...props}>
      <path
        d="M4.25 6C4.664 6 5 5.66 5 5.25C5 4.84 4.664 4.5 4.25 4.5C3.836 4.5 3.5 4.84 3.5 5.25C3.5 5.66 3.836 6 4.25 6Z"
        fill="currentColor"
      />
      <path
        d="M6.75 6C7.164 6 7.5 5.66 7.5 5.25C7.5 4.84 7.164 4.5 6.75 4.5C6.336 4.5 6 4.84 6 5.25C6 5.66 6.336 6 6.75 6Z"
        fill="currentColor"
      />
      <path
        d="M1.75 7.75H16.25M16.25 9.448V4.75c0-1.1-.895-2-2-2H3.75c-1.105 0-2 .9-2 2v8.5c0 1.1.895 2 2 2h5.328"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M11.126 10.77l5.94 2.17c.25.09.243.45-.011.53l-2.719.87-.87 2.72c-.081.25-.438.26-.529.01l-2.17-5.94c-.082-.23.135-.44.359-.36Z"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </NucleoIcon>
  )
}

export function NucleoFileContentIcon({
  strokeWidth = 1.5,
  ...props
}: NucleoIconProps) {
  return (
    <NucleoIcon {...props}>
      <path
        d="M5.75 6.75h2M5.75 9.75h6.5M5.75 12.75h6.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <path
        d="M2.75 14.25V3.75c0-1.105.895-2 2-2h5.586c.265 0 .52.105.707.293l3.914 3.914c.188.188.293.442.293.707v7.586c0 1.105-.895 2-2 2h-8.5c-1.105 0-2-.895-2-2Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <path
        d="M15.16 6.25h-3.41c-.552 0-1-.448-1-1V1.852"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
    </NucleoIcon>
  )
}

export function NucleoClipboardCheckIcon({
  strokeWidth = 1.5,
  ...props
}: NucleoIconProps) {
  return (
    <NucleoIcon {...props}>
      <path
        d="M6.25 2.75h-1c-1.105 0-2 .895-2 2v9.5c0 1.105.895 2 2 2h7.5c1.105 0 2-.895 2-2v-9.5c0-1.105-.895-2-2-2h-1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <rect
        x="6.25"
        y="1.25"
        width="5.5"
        height="3"
        rx="1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <polyline
        points="6.25 10.25 8 12.25 11.75 7.25"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
    </NucleoIcon>
  )
}

export function NucleoCloseIcon({
  strokeWidth = 1.5,
  ...props
}: NucleoIconProps) {
  return (
    <NucleoIcon {...props}>
      <line
        x1="14"
        y1="4"
        x2="4"
        y2="14"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <line
        x1="4"
        y1="4"
        x2="14"
        y2="14"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
    </NucleoIcon>
  )
}
