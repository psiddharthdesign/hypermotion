// SPDX-License-Identifier: Apache-2.0

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Ray3 {
  origin: Vec3
  direction: Vec3
}

export interface CameraBasis {
  right: Vec3
  up: Vec3
  forward: Vec3
}

export const VEC3_ZERO: Vec3 = { x: 0, y: 0, z: 0 }

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

export function add3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

export function sub3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

export function mul3(v: Vec3, scalar: number): Vec3 {
  return { x: v.x * scalar, y: v.y * scalar, z: v.z * scalar }
}

export function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

export function cross3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

export function len3(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z)
}

export function norm3(v: Vec3): Vec3 {
  const length = len3(v)
  return length > 0.000001 ? mul3(v, 1 / length) : { ...VEC3_ZERO }
}

export function rotateX(v: Vec3, deg: number): Vec3 {
  const r = degToRad(deg)
  const c = Math.cos(r)
  const s = Math.sin(r)
  return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c }
}

export function rotateY(v: Vec3, deg: number): Vec3 {
  const r = degToRad(deg)
  const c = Math.cos(r)
  const s = Math.sin(r)
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c }
}

export function rotateZ(v: Vec3, deg: number): Vec3 {
  const r = degToRad(deg)
  const c = Math.cos(r)
  const s = Math.sin(r)
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c, z: v.z }
}

export function rotateEuler(v: Vec3, rotX: number, rotY: number, rotZ: number): Vec3 {
  return rotateZ(rotateY(rotateX(v, rotX), rotY), rotZ)
}

export function inverseRotateEuler(v: Vec3, rotX: number, rotY: number, rotZ: number): Vec3 {
  return rotateX(rotateY(rotateZ(v, -rotZ), -rotY), -rotX)
}

export function basisFromEuler(rotX: number, rotY: number, rotZ: number): CameraBasis {
  return {
    right: norm3(rotateEuler({ x: 1, y: 0, z: 0 }, rotX, rotY, rotZ)),
    up: norm3(rotateEuler({ x: 0, y: 1, z: 0 }, rotX, rotY, rotZ)),
    forward: norm3(rotateEuler({ x: 0, y: 0, z: 1 }, rotX, rotY, rotZ)),
  }
}

export function fovToFocalLength(fovDeg: number, viewportHeight: number): number {
  const fov = Math.max(1, Math.min(175, fovDeg))
  return (viewportHeight / 2) / Math.tan(degToRad(fov) / 2)
}

export function focalLengthToFov(focalLength: number, viewportHeight: number): number {
  const focal = Math.max(1, focalLength)
  return (Math.atan((viewportHeight / 2) / focal) * 2 * 180) / Math.PI
}

