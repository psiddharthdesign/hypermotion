// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Jakub Antalik. See LICENSE in this directory.
// Extracted from Border Beam 1.4.0; evaluated against scene time.
export function pulseParams(size: import('@/scene/borderBeam').BorderBeamStyle, theme: 'dark' | 'light', duration: number) {
  const isDark = theme === 'dark';
  const durScale = duration / 2.3;
  if (size === 'pulse-inner') {
    return {
      sp: 0.28,
      dr: isDark ? 33 : 40,
      op: isDark ? 0.48 : 0.45,
      gh: isDark ? 0.34 : 0.22,
      bs: (isDark ? 1.9 : 2.6) * durScale,
      ss: (isDark ? 2.6 : 4.6) * durScale,
      ghs: (isDark ? 2.4 : 5.5) * durScale,
      // Full hue revolution period (seconds) — colors continuously cycle.
      huePeriod: 16,
    };
  }
  return {
    sp: isDark ? 0.28 : 0.36,
    dr: isDark ? 14 : 19,
    op: isDark ? 0.46 : 0,
    gh: isDark ? 0.16 : 0.58,
    bs: (isDark ? 2.3 : 3.7) * durScale,
    ss: (isDark ? 6.4 : 4.6) * durScale,
    ghs: (isDark ? 2.4 : 3.8) * durScale,
    // Full hue revolution period (seconds) — colors continuously cycle.
    huePeriod: 14,
  };
}

/** Build the oscillator table for an instance (matches the former keyframes). */
export function pulseOscillatorDefs(id: string, p: ReturnType<typeof pulseParams>) {
  const { sp, dr, op, gh, bs, ss, ghs } = p;
  return [
    { prop: `--bw1-${id}`, a: 1 - sp, b: 1 + sp * 1.1, period: ss * 0.9, delay: 0, unit: '' },
    { prop: `--bh1-${id}`, a: 1 + sp * 0.9, b: 1 - sp * 0.85, period: ss * 1.26, delay: 0, unit: '' },
    { prop: `--bx1-${id}`, a: -dr, b: dr * 0.9, period: bs * 1.6, delay: 0, unit: 'px' },
    { prop: `--by1-${id}`, a: dr * 0.55, b: -dr * 0.7, period: bs * 1.6, delay: 0, unit: 'px' },
    { prop: `--bw2-${id}`, a: 1 + sp, b: 1 - sp * 0.85, period: ss * 1.1, delay: 0, unit: '' },
    { prop: `--bh2-${id}`, a: 1 - sp * 0.8, b: 1 + sp * 1.05, period: ss * 0.81, delay: 0, unit: '' },
    { prop: `--bx2-${id}`, a: dr * 0.8, b: -dr * 0.9, period: bs * 1.88, delay: 0, unit: 'px' },
    { prop: `--by2-${id}`, a: -dr, b: dr * 0.65, period: bs * 1.88, delay: 0, unit: 'px' },
    { prop: `--bw3-${id}`, a: 1 - sp * 0.6, b: 1 + sp * 1.15, period: ss * 0.98, delay: 0, unit: '' },
    { prop: `--bh3-${id}`, a: 1 + sp * 0.75, b: 1 - sp, period: ss * 1.4, delay: 0, unit: '' },
    { prop: `--bx3-${id}`, a: -dr * 0.6, b: dr, period: bs * 1.45, delay: 0, unit: 'px' },
    { prop: `--by3-${id}`, a: -dr * 0.85, b: dr * 0.45, period: bs * 1.45, delay: 0, unit: 'px' },
    { prop: `--bgh-${id}`, a: 1 - gh, b: 1 + gh, period: ghs, delay: 0, unit: '' },
    { prop: `--bop-tl-${id}`, a: 1 - op, b: 1, period: bs, delay: 0, unit: '' },
    { prop: `--bop-tr-${id}`, a: 1 - op, b: 1, period: bs * 1.32, delay: bs * 0.28, unit: '' },
    { prop: `--bop-bl-${id}`, a: 1 - op, b: 1, period: bs * 0.84, delay: bs * 0.55, unit: '' },
    { prop: `--bop-br-${id}`, a: 1 - op, b: 1, period: bs * 1.58, delay: bs * 0.83, unit: '' },
  ];
}

