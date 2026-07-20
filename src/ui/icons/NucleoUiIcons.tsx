// SPDX-License-Identifier: Apache-2.0

import type { SVGProps } from 'react'

/**
 * Small, local subset of Nucleo UI Essential Outline 18 icons.
 * Source: https://nucleoapp.com/free-ui-icons
 * License: https://nucleoapp.com/license
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
