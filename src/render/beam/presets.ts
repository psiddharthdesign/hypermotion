// SPDX-License-Identifier: MIT
// Border Beam 1.4.0, Copyright (c) 2026 Jakub Antalik. See LICENSE in this directory.
// Upstream commit: 2015f0ba79a9faec351719c4a6d590a1e6bfa243
// Palette and geometry data from packages/border-beam/src/styles.ts.

export const sizeThemePresets = {
  "sm": {
    "dark": { "strokeOpacity": 0.46, "innerOpacity": 0.24, "bloomOpacity": 0.38, "innerShadow": "rgba(255, 255, 255, 0.3)", "saturation": 1.2 },
    "light": { "strokeOpacity": 0.12, "innerOpacity": 0.3, "bloomOpacity": 0.16, "innerShadow": "rgba(0, 0, 0, 0.14)", "saturation": 1.8 }
  },
  "md": {
    "dark": { "strokeOpacity": 0.26, "innerOpacity": 0.42, "bloomOpacity": 0.24, "innerShadow": "rgba(255, 255, 255, 0.27)", "saturation": 1.2 },
    "light": { "strokeOpacity": 0.12, "innerOpacity": 0.26, "bloomOpacity": 0.34, "innerShadow": "rgba(0, 0, 0, 0.14)", "saturation": 1.5 }
  },
  "line": {
    "dark": { "strokeOpacity": 1.14, "innerOpacity": 0.7, "bloomOpacity": 0.8, "innerShadow": "rgba(255, 255, 255, 0.1)", "saturation": 1.2 },
    "light": { "strokeOpacity": 0.16, "innerOpacity": 0.32, "bloomOpacity": 0.3, "innerShadow": "rgba(0, 0, 0, 0.14)", "saturation": 1.95 }
  },
  "pulse-outside": {
    "dark": { "strokeOpacity": 0.94, "innerOpacity": 0.34, "bloomOpacity": 0.3, "innerShadow": "transparent", "saturation": 1.2, "brightness": 1.9, "hairlineOpacity": 0 },
    "light": { "strokeOpacity": 1.96, "innerOpacity": 1.04, "bloomOpacity": 0.42, "innerShadow": "transparent", "saturation": 0.6, "brightness": 1.7, "hairlineOpacity": 0 }
  },
  "pulse-inner": {
    "dark": { "strokeOpacity": 1.54, "innerOpacity": 0.44, "bloomOpacity": 0.66, "innerShadow": "transparent", "saturation": 1.2, "brightness": 0.75 },
    "light": { "strokeOpacity": 0.32, "innerOpacity": 0.4, "bloomOpacity": 0.8, "innerShadow": "transparent", "saturation": 0.75, "brightness": 1.3 }
  }
} as const

export const colorPalettes = {
  "colorful": {
    "border": [
      { "color": "rgb(255, 50, 100)", "pos": "33% -7.4%", "size": "70px 40px" },
      { "color": "rgb(40, 140, 255)", "pos": "12% -5%", "size": "60px 35px" },
      { "color": "rgb(50, 200, 80)", "pos": "2.1% 68.3%", "size": "40px 70px" },
      { "color": "rgb(30, 185, 170)", "pos": "2.1% 68.3%", "size": "20px 35px" },
      { "color": "rgb(100, 70, 255)", "pos": "74.4% 100%", "size": "180px 32px" },
      { "color": "rgb(40, 140, 255)", "pos": "55% 100%", "size": "85px 26px" },
      { "color": "rgb(255, 120, 40)", "pos": "93.9% 0%", "size": "74px 32px" },
      { "color": "rgb(240, 50, 180)", "pos": "100% 27.1%", "size": "26px 42px" },
      { "color": "rgb(180, 40, 240)", "pos": "100% 27.1%", "size": "52px 48px" }
    ]
  },
  "mono": {
    "border": [
      { "color": "rgb(180, 180, 180)", "pos": "33% -7.4%", "size": "70px 40px" },
      { "color": "rgb(140, 140, 140)", "pos": "12% -5%", "size": "60px 35px" },
      { "color": "rgb(160, 160, 160)", "pos": "2.1% 68.3%", "size": "40px 70px" },
      { "color": "rgb(130, 130, 130)", "pos": "2.1% 68.3%", "size": "20px 35px" },
      { "color": "rgb(170, 170, 170)", "pos": "74.4% 100%", "size": "180px 32px" },
      { "color": "rgb(150, 150, 150)", "pos": "55% 100%", "size": "85px 26px" },
      { "color": "rgb(190, 190, 190)", "pos": "93.9% 0%", "size": "74px 32px" },
      { "color": "rgb(145, 145, 145)", "pos": "100% 27.1%", "size": "26px 42px" },
      { "color": "rgb(165, 165, 165)", "pos": "100% 27.1%", "size": "52px 48px" }
    ]
  },
  "ocean": {
    "border": [
      { "color": "rgb(100, 80, 220)", "pos": "33% -7.4%", "size": "70px 40px" },
      { "color": "rgb(60, 120, 255)", "pos": "12% -5%", "size": "60px 35px" },
      { "color": "rgb(80, 100, 200)", "pos": "2.1% 68.3%", "size": "40px 70px" },
      { "color": "rgb(50, 140, 220)", "pos": "2.1% 68.3%", "size": "20px 35px" },
      { "color": "rgb(120, 80, 255)", "pos": "74.4% 100%", "size": "180px 32px" },
      { "color": "rgb(70, 130, 255)", "pos": "55% 100%", "size": "85px 26px" },
      { "color": "rgb(140, 100, 240)", "pos": "93.9% 0%", "size": "74px 32px" },
      { "color": "rgb(90, 110, 230)", "pos": "100% 27.1%", "size": "26px 42px" },
      { "color": "rgb(130, 70, 255)", "pos": "100% 27.1%", "size": "52px 48px" }
    ]
  },
  "sunset": {
    "border": [
      { "color": "rgb(255, 80, 50)", "pos": "33% -7.4%", "size": "70px 40px" },
      { "color": "rgb(255, 160, 40)", "pos": "12% -5%", "size": "60px 35px" },
      { "color": "rgb(255, 120, 60)", "pos": "2.1% 68.3%", "size": "40px 70px" },
      { "color": "rgb(255, 200, 50)", "pos": "2.1% 68.3%", "size": "20px 35px" },
      { "color": "rgb(255, 100, 80)", "pos": "74.4% 100%", "size": "180px 32px" },
      { "color": "rgb(255, 180, 60)", "pos": "55% 100%", "size": "85px 26px" },
      { "color": "rgb(255, 60, 60)", "pos": "93.9% 0%", "size": "74px 32px" },
      { "color": "rgb(255, 140, 50)", "pos": "100% 27.1%", "size": "26px 42px" },
      { "color": "rgb(255, 90, 70)", "pos": "100% 27.1%", "size": "52px 48px" }
    ]
  },
  "forest": {
    "border": [
      { "color": "rgb(46, 160, 90)", "pos": "33% -7.4%", "size": "70px 40px" },
      { "color": "rgb(30, 190, 120)", "pos": "12% -5%", "size": "60px 35px" },
      { "color": "rgb(70, 180, 70)", "pos": "2.1% 68.3%", "size": "40px 70px" },
      { "color": "rgb(20, 150, 130)", "pos": "2.1% 68.3%", "size": "20px 35px" },
      { "color": "rgb(90, 200, 80)", "pos": "74.4% 100%", "size": "180px 32px" },
      { "color": "rgb(40, 170, 110)", "pos": "55% 100%", "size": "85px 26px" },
      { "color": "rgb(120, 210, 70)", "pos": "93.9% 0%", "size": "74px 32px" },
      { "color": "rgb(35, 145, 100)", "pos": "100% 27.1%", "size": "26px 42px" },
      { "color": "rgb(60, 195, 140)", "pos": "100% 27.1%", "size": "52px 48px" }
    ]
  },
  "candy": {
    "border": [
      { "color": "rgb(240, 70, 170)", "pos": "33% -7.4%", "size": "70px 40px" },
      { "color": "rgb(255, 90, 140)", "pos": "12% -5%", "size": "60px 35px" },
      { "color": "rgb(215, 60, 200)", "pos": "2.1% 68.3%", "size": "40px 70px" },
      { "color": "rgb(255, 110, 180)", "pos": "2.1% 68.3%", "size": "20px 35px" },
      { "color": "rgb(200, 80, 240)", "pos": "74.4% 100%", "size": "180px 32px" },
      { "color": "rgb(250, 60, 150)", "pos": "55% 100%", "size": "85px 26px" },
      { "color": "rgb(230, 120, 220)", "pos": "93.9% 0%", "size": "74px 32px" },
      { "color": "rgb(245, 85, 165)", "pos": "100% 27.1%", "size": "26px 42px" },
      { "color": "rgb(210, 70, 230)", "pos": "100% 27.1%", "size": "52px 48px" }
    ]
  },
  "ice": {
    "border": [
      { "color": "rgb(90, 200, 240)", "pos": "33% -7.4%", "size": "70px 40px" },
      { "color": "rgb(60, 175, 230)", "pos": "12% -5%", "size": "60px 35px" },
      { "color": "rgb(130, 220, 250)", "pos": "2.1% 68.3%", "size": "40px 70px" },
      { "color": "rgb(70, 190, 215)", "pos": "2.1% 68.3%", "size": "20px 35px" },
      { "color": "rgb(110, 210, 255)", "pos": "74.4% 100%", "size": "180px 32px" },
      { "color": "rgb(50, 165, 220)", "pos": "55% 100%", "size": "85px 26px" },
      { "color": "rgb(150, 230, 250)", "pos": "93.9% 0%", "size": "74px 32px" },
      { "color": "rgb(85, 195, 235)", "pos": "100% 27.1%", "size": "26px 42px" },
      { "color": "rgb(65, 180, 245)", "pos": "100% 27.1%", "size": "52px 48px" }
    ]
  },
  "gold": {
    "border": [
      { "color": "rgb(240, 190, 60)", "pos": "33% -7.4%", "size": "70px 40px" },
      { "color": "rgb(255, 210, 90)", "pos": "12% -5%", "size": "60px 35px" },
      { "color": "rgb(225, 165, 40)", "pos": "2.1% 68.3%", "size": "40px 70px" },
      { "color": "rgb(250, 200, 70)", "pos": "2.1% 68.3%", "size": "20px 35px" },
      { "color": "rgb(255, 225, 120)", "pos": "74.4% 100%", "size": "180px 32px" },
      { "color": "rgb(230, 175, 50)", "pos": "55% 100%", "size": "85px 26px" },
      { "color": "rgb(245, 205, 85)", "pos": "93.9% 0%", "size": "74px 32px" },
      { "color": "rgb(215, 155, 35)", "pos": "100% 27.1%", "size": "26px 42px" },
      { "color": "rgb(255, 215, 100)", "pos": "100% 27.1%", "size": "52px 48px" }
    ]
  }
} as const

export const smallColorPalettes = {
  "colorful": {
    "border": [
      { "color": "rgb(50, 200, 80)", "pos": "2% 68%", "size": "9px 18px" },
      { "color": "rgb(30, 185, 170)", "pos": "2% 68%", "size": "4px 8px" },
      { "color": "rgb(255, 120, 40)", "pos": "72% -3%", "size": "59px 9px" },
      { "color": "rgb(100, 70, 255)", "pos": "74% 100%", "size": "42px 7px" },
      { "color": "rgb(240, 50, 180)", "pos": "100% 27%", "size": "10px 17px" },
      { "color": "rgb(180, 40, 240)", "pos": "100% 27%", "size": "10px 18px" },
      { "color": "rgb(40, 140, 255)", "pos": "100% 27%", "size": "5px 10px" },
      { "color": "rgb(255, 50, 100)", "pos": "100% 27%", "size": "11px 12px" }
    ]
  },
  "mono": {
    "border": [
      { "color": "rgb(160, 160, 160)", "pos": "2% 68%", "size": "9px 18px" },
      { "color": "rgb(140, 140, 140)", "pos": "2% 68%", "size": "4px 8px" },
      { "color": "rgb(180, 180, 180)", "pos": "72% -3%", "size": "59px 9px" },
      { "color": "rgb(150, 150, 150)", "pos": "74% 100%", "size": "42px 7px" },
      { "color": "rgb(170, 170, 170)", "pos": "100% 27%", "size": "10px 17px" },
      { "color": "rgb(155, 155, 155)", "pos": "100% 27%", "size": "10px 18px" },
      { "color": "rgb(145, 145, 145)", "pos": "100% 27%", "size": "5px 10px" },
      { "color": "rgb(165, 165, 165)", "pos": "100% 27%", "size": "11px 12px" }
    ]
  },
  "ocean": {
    "border": [
      { "color": "rgb(60, 140, 200)", "pos": "2% 68%", "size": "9px 18px" },
      { "color": "rgb(50, 120, 180)", "pos": "2% 68%", "size": "4px 8px" },
      { "color": "rgb(100, 80, 220)", "pos": "72% -3%", "size": "59px 9px" },
      { "color": "rgb(80, 100, 255)", "pos": "74% 100%", "size": "42px 7px" },
      { "color": "rgb(120, 70, 240)", "pos": "100% 27%", "size": "10px 17px" },
      { "color": "rgb(90, 80, 220)", "pos": "100% 27%", "size": "10px 18px" },
      { "color": "rgb(70, 110, 255)", "pos": "100% 27%", "size": "5px 10px" },
      { "color": "rgb(110, 90, 230)", "pos": "100% 27%", "size": "11px 12px" }
    ]
  },
  "sunset": {
    "border": [
      { "color": "rgb(255, 180, 50)", "pos": "2% 68%", "size": "9px 18px" },
      { "color": "rgb(255, 150, 40)", "pos": "2% 68%", "size": "4px 8px" },
      { "color": "rgb(255, 80, 60)", "pos": "72% -3%", "size": "59px 9px" },
      { "color": "rgb(255, 100, 80)", "pos": "74% 100%", "size": "42px 7px" },
      { "color": "rgb(255, 60, 80)", "pos": "100% 27%", "size": "10px 17px" },
      { "color": "rgb(255, 120, 60)", "pos": "100% 27%", "size": "10px 18px" },
      { "color": "rgb(255, 200, 50)", "pos": "100% 27%", "size": "5px 10px" },
      { "color": "rgb(255, 90, 70)", "pos": "100% 27%", "size": "11px 12px" }
    ]
  },
  "forest": {
    "border": [
      { "color": "rgb(46, 160, 90)", "pos": "2% 68%", "size": "9px 18px" },
      { "color": "rgb(30, 190, 120)", "pos": "2% 68%", "size": "4px 8px" },
      { "color": "rgb(70, 180, 70)", "pos": "72% -3%", "size": "59px 9px" },
      { "color": "rgb(20, 150, 130)", "pos": "74% 100%", "size": "42px 7px" },
      { "color": "rgb(90, 200, 80)", "pos": "100% 27%", "size": "10px 17px" },
      { "color": "rgb(40, 170, 110)", "pos": "100% 27%", "size": "10px 18px" },
      { "color": "rgb(120, 210, 70)", "pos": "100% 27%", "size": "5px 10px" },
      { "color": "rgb(35, 145, 100)", "pos": "100% 27%", "size": "11px 12px" }
    ]
  },
  "candy": {
    "border": [
      { "color": "rgb(240, 70, 170)", "pos": "2% 68%", "size": "9px 18px" },
      { "color": "rgb(255, 90, 140)", "pos": "2% 68%", "size": "4px 8px" },
      { "color": "rgb(215, 60, 200)", "pos": "72% -3%", "size": "59px 9px" },
      { "color": "rgb(255, 110, 180)", "pos": "74% 100%", "size": "42px 7px" },
      { "color": "rgb(200, 80, 240)", "pos": "100% 27%", "size": "10px 17px" },
      { "color": "rgb(250, 60, 150)", "pos": "100% 27%", "size": "10px 18px" },
      { "color": "rgb(230, 120, 220)", "pos": "100% 27%", "size": "5px 10px" },
      { "color": "rgb(245, 85, 165)", "pos": "100% 27%", "size": "11px 12px" }
    ]
  },
  "ice": {
    "border": [
      { "color": "rgb(90, 200, 240)", "pos": "2% 68%", "size": "9px 18px" },
      { "color": "rgb(60, 175, 230)", "pos": "2% 68%", "size": "4px 8px" },
      { "color": "rgb(130, 220, 250)", "pos": "72% -3%", "size": "59px 9px" },
      { "color": "rgb(70, 190, 215)", "pos": "74% 100%", "size": "42px 7px" },
      { "color": "rgb(110, 210, 255)", "pos": "100% 27%", "size": "10px 17px" },
      { "color": "rgb(50, 165, 220)", "pos": "100% 27%", "size": "10px 18px" },
      { "color": "rgb(150, 230, 250)", "pos": "100% 27%", "size": "5px 10px" },
      { "color": "rgb(85, 195, 235)", "pos": "100% 27%", "size": "11px 12px" }
    ]
  },
  "gold": {
    "border": [
      { "color": "rgb(240, 190, 60)", "pos": "2% 68%", "size": "9px 18px" },
      { "color": "rgb(255, 210, 90)", "pos": "2% 68%", "size": "4px 8px" },
      { "color": "rgb(225, 165, 40)", "pos": "72% -3%", "size": "59px 9px" },
      { "color": "rgb(250, 200, 70)", "pos": "74% 100%", "size": "42px 7px" },
      { "color": "rgb(255, 225, 120)", "pos": "100% 27%", "size": "10px 17px" },
      { "color": "rgb(230, 175, 50)", "pos": "100% 27%", "size": "10px 18px" },
      { "color": "rgb(245, 205, 85)", "pos": "100% 27%", "size": "5px 10px" },
      { "color": "rgb(215, 155, 35)", "pos": "100% 27%", "size": "11px 12px" }
    ]
  }
} as const

export const lineColorPalettes = {
  "colorful": {
    "dark": [
      { "color": "rgb(255, 50, 100)", "sizeW": 36, "sizeH": 36, "offsetX": 0, "offsetY": 2 },
      { "color": "rgb(40, 180, 220)", "sizeW": 30, "sizeH": 32, "offsetX": 39, "offsetY": 0 },
      { "color": "rgb(50, 200, 80)", "sizeW": 33, "sizeH": 28, "offsetX": -36, "offsetY": 2 },
      { "color": "rgb(180, 40, 240)", "sizeW": 29, "sizeH": 34, "offsetX": -54, "offsetY": 0 },
      { "color": "rgb(255, 160, 30)", "sizeW": 27, "sizeH": 30, "offsetX": 51, "offsetY": -1 },
      { "color": "rgb(100, 70, 255)", "sizeW": 36, "sizeH": 24, "offsetX": 21, "offsetY": 1 },
      { "color": "rgb(40, 140, 255)", "sizeW": 30, "sizeH": 22, "offsetX": -21, "offsetY": 0 },
      { "color": "rgb(240, 50, 180)", "sizeW": 25, "sizeH": 28, "offsetX": 66, "offsetY": 1 },
      { "color": "rgb(30, 185, 170)", "sizeW": 23, "sizeH": 30, "offsetX": -66, "offsetY": -1 }
    ],
    "light": [
      { "color": "rgb(255, 50, 100)", "sizeW": 45, "sizeH": 36, "offsetX": 0, "offsetY": 2 },
      { "color": "rgb(40, 140, 255)", "sizeW": 35, "sizeH": 32, "offsetX": 65, "offsetY": 0 },
      { "color": "rgb(50, 200, 80)", "sizeW": 40, "sizeH": 28, "offsetX": -60, "offsetY": 2 },
      { "color": "rgb(180, 40, 240)", "sizeW": 35, "sizeH": 34, "offsetX": -90, "offsetY": 0 },
      { "color": "rgb(30, 185, 170)", "sizeW": 38, "sizeH": 30, "offsetX": 85, "offsetY": -1 },
      { "color": "rgb(100, 70, 255)", "sizeW": 50, "sizeH": 24, "offsetX": 35, "offsetY": 1 },
      { "color": "rgb(40, 140, 255)", "sizeW": 40, "sizeH": 22, "offsetX": -35, "offsetY": 0 },
      { "color": "rgb(255, 120, 40)", "sizeW": 35, "sizeH": 28, "offsetX": 110, "offsetY": 1 },
      { "color": "rgb(240, 50, 180)", "sizeW": 30, "sizeH": 30, "offsetX": -110, "offsetY": -1 }
    ]
  },
  "mono": {
    "dark": [
      { "color": "rgb(200, 200, 200)", "sizeW": 36, "sizeH": 36, "offsetX": 0, "offsetY": 2 },
      { "color": "rgb(170, 170, 170)", "sizeW": 30, "sizeH": 32, "offsetX": 39, "offsetY": 0 },
      { "color": "rgb(155, 155, 155)", "sizeW": 33, "sizeH": 28, "offsetX": -36, "offsetY": 2 },
      { "color": "rgb(185, 185, 185)", "sizeW": 29, "sizeH": 34, "offsetX": -54, "offsetY": 0 },
      { "color": "rgb(165, 165, 165)", "sizeW": 27, "sizeH": 30, "offsetX": 51, "offsetY": -1 },
      { "color": "rgb(180, 180, 180)", "sizeW": 36, "sizeH": 24, "offsetX": 21, "offsetY": 1 },
      { "color": "rgb(160, 160, 160)", "sizeW": 30, "sizeH": 22, "offsetX": -21, "offsetY": 0 },
      { "color": "rgb(175, 175, 175)", "sizeW": 25, "sizeH": 28, "offsetX": 66, "offsetY": 1 },
      { "color": "rgb(190, 190, 190)", "sizeW": 23, "sizeH": 30, "offsetX": -66, "offsetY": -1 }
    ],
    "light": [
      { "color": "rgb(100, 100, 100)", "sizeW": 45, "sizeH": 36, "offsetX": 0, "offsetY": 2 },
      { "color": "rgb(80, 80, 80)", "sizeW": 35, "sizeH": 32, "offsetX": 65, "offsetY": 0 },
      { "color": "rgb(90, 90, 90)", "sizeW": 40, "sizeH": 28, "offsetX": -60, "offsetY": 2 },
      { "color": "rgb(70, 70, 70)", "sizeW": 35, "sizeH": 34, "offsetX": -90, "offsetY": 0 },
      { "color": "rgb(85, 85, 85)", "sizeW": 38, "sizeH": 30, "offsetX": 85, "offsetY": -1 },
      { "color": "rgb(95, 95, 95)", "sizeW": 50, "sizeH": 24, "offsetX": 35, "offsetY": 1 },
      { "color": "rgb(75, 75, 75)", "sizeW": 40, "sizeH": 22, "offsetX": -35, "offsetY": 0 },
      { "color": "rgb(105, 105, 105)", "sizeW": 35, "sizeH": 28, "offsetX": 110, "offsetY": 1 },
      { "color": "rgb(65, 65, 65)", "sizeW": 30, "sizeH": 30, "offsetX": -110, "offsetY": -1 }
    ]
  },
  "ocean": {
    "dark": [
      { "color": "rgb(100, 80, 220)", "sizeW": 36, "sizeH": 36, "offsetX": 0, "offsetY": 2 },
      { "color": "rgb(60, 120, 255)", "sizeW": 30, "sizeH": 32, "offsetX": 39, "offsetY": 0 },
      { "color": "rgb(80, 100, 200)", "sizeW": 33, "sizeH": 28, "offsetX": -36, "offsetY": 2 },
      { "color": "rgb(130, 70, 255)", "sizeW": 29, "sizeH": 34, "offsetX": -54, "offsetY": 0 },
      { "color": "rgb(70, 130, 255)", "sizeW": 27, "sizeH": 30, "offsetX": 51, "offsetY": -1 },
      { "color": "rgb(120, 80, 255)", "sizeW": 36, "sizeH": 24, "offsetX": 21, "offsetY": 1 },
      { "color": "rgb(90, 110, 230)", "sizeW": 30, "sizeH": 22, "offsetX": -21, "offsetY": 0 },
      { "color": "rgb(110, 90, 240)", "sizeW": 25, "sizeH": 28, "offsetX": 66, "offsetY": 1 },
      { "color": "rgb(140, 100, 255)", "sizeW": 23, "sizeH": 30, "offsetX": -66, "offsetY": -1 }
    ],
    "light": [
      { "color": "rgb(80, 60, 200)", "sizeW": 45, "sizeH": 36, "offsetX": 0, "offsetY": 2 },
      { "color": "rgb(50, 100, 220)", "sizeW": 35, "sizeH": 32, "offsetX": 65, "offsetY": 0 },
      { "color": "rgb(70, 90, 190)", "sizeW": 40, "sizeH": 28, "offsetX": -60, "offsetY": 2 },
      { "color": "rgb(110, 60, 220)", "sizeW": 35, "sizeH": 34, "offsetX": -90, "offsetY": 0 },
      { "color": "rgb(60, 110, 230)", "sizeW": 38, "sizeH": 30, "offsetX": 85, "offsetY": -1 },
      { "color": "rgb(100, 70, 240)", "sizeW": 50, "sizeH": 24, "offsetX": 35, "offsetY": 1 },
      { "color": "rgb(80, 100, 210)", "sizeW": 40, "sizeH": 22, "offsetX": -35, "offsetY": 0 },
      { "color": "rgb(90, 80, 225)", "sizeW": 35, "sizeH": 28, "offsetX": 110, "offsetY": 1 },
      { "color": "rgb(120, 90, 245)", "sizeW": 30, "sizeH": 30, "offsetX": -110, "offsetY": -1 }
    ]
  },
  "sunset": {
    "dark": [
      { "color": "rgb(255, 100, 60)", "sizeW": 36, "sizeH": 36, "offsetX": 0, "offsetY": 2 },
      { "color": "rgb(255, 180, 50)", "sizeW": 30, "sizeH": 32, "offsetX": 39, "offsetY": 0 },
      { "color": "rgb(255, 140, 70)", "sizeW": 33, "sizeH": 28, "offsetX": -36, "offsetY": 2 },
      { "color": "rgb(255, 80, 80)", "sizeW": 29, "sizeH": 34, "offsetX": -54, "offsetY": 0 },
      { "color": "rgb(255, 200, 60)", "sizeW": 27, "sizeH": 30, "offsetX": 51, "offsetY": -1 },
      { "color": "rgb(255, 120, 50)", "sizeW": 36, "sizeH": 24, "offsetX": 21, "offsetY": 1 },
      { "color": "rgb(255, 160, 80)", "sizeW": 30, "sizeH": 22, "offsetX": -21, "offsetY": 0 },
      { "color": "rgb(255, 90, 60)", "sizeW": 25, "sizeH": 28, "offsetX": 66, "offsetY": 1 },
      { "color": "rgb(255, 70, 70)", "sizeW": 23, "sizeH": 30, "offsetX": -66, "offsetY": -1 }
    ],
    "light": [
      { "color": "rgb(220, 80, 40)", "sizeW": 45, "sizeH": 36, "offsetX": 0, "offsetY": 2 },
      { "color": "rgb(230, 150, 30)", "sizeW": 35, "sizeH": 32, "offsetX": 65, "offsetY": 0 },
      { "color": "rgb(210, 110, 50)", "sizeW": 40, "sizeH": 28, "offsetX": -60, "offsetY": 2 },
      { "color": "rgb(200, 60, 60)", "sizeW": 35, "sizeH": 34, "offsetX": -90, "offsetY": 0 },
      { "color": "rgb(220, 170, 40)", "sizeW": 38, "sizeH": 30, "offsetX": 85, "offsetY": -1 },
      { "color": "rgb(210, 100, 30)", "sizeW": 50, "sizeH": 24, "offsetX": 35, "offsetY": 1 },
      { "color": "rgb(230, 130, 60)", "sizeW": 40, "sizeH": 22, "offsetX": -35, "offsetY": 0 },
      { "color": "rgb(190, 70, 50)", "sizeW": 35, "sizeH": 28, "offsetX": 110, "offsetY": 1 },
      { "color": "rgb(180, 50, 50)", "sizeW": 30, "sizeH": 30, "offsetX": -110, "offsetY": -1 }
    ]
  },
  "forest": {
    "dark": [
      { "color": "rgb(46, 160, 90)", "sizeW": 36, "sizeH": 36, "offsetX": 0, "offsetY": 2 },
      { "color": "rgb(30, 190, 120)", "sizeW": 30, "sizeH": 32, "offsetX": 39, "offsetY": 0 },
      { "color": "rgb(70, 180, 70)", "sizeW": 33, "sizeH": 28, "offsetX": -36, "offsetY": 2 },
      { "color": "rgb(20, 150, 130)", "sizeW": 29, "sizeH": 34, "offsetX": -54, "offsetY": 0 },
      { "color": "rgb(90, 200, 80)", "sizeW": 27, "sizeH": 30, "offsetX": 51, "offsetY": -1 },
      { "color": "rgb(40, 170, 110)", "sizeW": 36, "sizeH": 24, "offsetX": 21, "offsetY": 1 },
      { "color": "rgb(120, 210, 70)", "sizeW": 30, "sizeH": 22, "offsetX": -21, "offsetY": 0 },
      { "color": "rgb(35, 145, 100)", "sizeW": 25, "sizeH": 28, "offsetX": 66, "offsetY": 1 },
      { "color": "rgb(60, 195, 140)", "sizeW": 23, "sizeH": 30, "offsetX": -66, "offsetY": -1 }
    ],
    "light": [
      { "color": "rgb(33, 115, 65)", "sizeW": 45, "sizeH": 36, "offsetX": 0, "offsetY": 2 },
      { "color": "rgb(22, 137, 86)", "sizeW": 35, "sizeH": 32, "offsetX": 65, "offsetY": 0 },
      { "color": "rgb(50, 130, 50)", "sizeW": 40, "sizeH": 28, "offsetX": -60, "offsetY": 2 },
      { "color": "rgb(14, 108, 94)", "sizeW": 35, "sizeH": 34, "offsetX": -90, "offsetY": 0 },
      { "color": "rgb(65, 144, 58)", "sizeW": 38, "sizeH": 30, "offsetX": 85, "offsetY": -1 },
      { "color": "rgb(29, 122, 79)", "sizeW": 50, "sizeH": 24, "offsetX": 35, "offsetY": 1 },
      { "color": "rgb(86, 151, 50)", "sizeW": 40, "sizeH": 22, "offsetX": -35, "offsetY": 0 },
      { "color": "rgb(25, 104, 72)", "sizeW": 35, "sizeH": 28, "offsetX": 110, "offsetY": 1 },
      { "color": "rgb(43, 140, 101)", "sizeW": 30, "sizeH": 30, "offsetX": -110, "offsetY": -1 }
    ]
  },
  "candy": {
    "dark": [
      { "color": "rgb(240, 70, 170)", "sizeW": 36, "sizeH": 36, "offsetX": 0, "offsetY": 2 },
      { "color": "rgb(255, 90, 140)", "sizeW": 30, "sizeH": 32, "offsetX": 39, "offsetY": 0 },
      { "color": "rgb(215, 60, 200)", "sizeW": 33, "sizeH": 28, "offsetX": -36, "offsetY": 2 },
      { "color": "rgb(255, 110, 180)", "sizeW": 29, "sizeH": 34, "offsetX": -54, "offsetY": 0 },
      { "color": "rgb(200, 80, 240)", "sizeW": 27, "sizeH": 30, "offsetX": 51, "offsetY": -1 },
      { "color": "rgb(250, 60, 150)", "sizeW": 36, "sizeH": 24, "offsetX": 21, "offsetY": 1 },
      { "color": "rgb(230, 120, 220)", "sizeW": 30, "sizeH": 22, "offsetX": -21, "offsetY": 0 },
      { "color": "rgb(245, 85, 165)", "sizeW": 25, "sizeH": 28, "offsetX": 66, "offsetY": 1 },
      { "color": "rgb(210, 70, 230)", "sizeW": 23, "sizeH": 30, "offsetX": -66, "offsetY": -1 }
    ],
    "light": [
      { "color": "rgb(173, 50, 122)", "sizeW": 45, "sizeH": 36, "offsetX": 0, "offsetY": 2 },
      { "color": "rgb(184, 65, 101)", "sizeW": 35, "sizeH": 32, "offsetX": 65, "offsetY": 0 },
      { "color": "rgb(155, 43, 144)", "sizeW": 40, "sizeH": 28, "offsetX": -60, "offsetY": 2 },
      { "color": "rgb(184, 79, 130)", "sizeW": 35, "sizeH": 34, "offsetX": -90, "offsetY": 0 },
      { "color": "rgb(144, 58, 173)", "sizeW": 38, "sizeH": 30, "offsetX": 85, "offsetY": -1 },
      { "color": "rgb(180, 43, 108)", "sizeW": 50, "sizeH": 24, "offsetX": 35, "offsetY": 1 },
      { "color": "rgb(166, 86, 158)", "sizeW": 40, "sizeH": 22, "offsetX": -35, "offsetY": 0 },
      { "color": "rgb(176, 61, 119)", "sizeW": 35, "sizeH": 28, "offsetX": 110, "offsetY": 1 },
      { "color": "rgb(151, 50, 166)", "sizeW": 30, "sizeH": 30, "offsetX": -110, "offsetY": -1 }
    ]
  },
  "ice": {
    "dark": [
      { "color": "rgb(90, 200, 240)", "sizeW": 36, "sizeH": 36, "offsetX": 0, "offsetY": 2 },
      { "color": "rgb(60, 175, 230)", "sizeW": 30, "sizeH": 32, "offsetX": 39, "offsetY": 0 },
      { "color": "rgb(130, 220, 250)", "sizeW": 33, "sizeH": 28, "offsetX": -36, "offsetY": 2 },
      { "color": "rgb(70, 190, 215)", "sizeW": 29, "sizeH": 34, "offsetX": -54, "offsetY": 0 },
      { "color": "rgb(110, 210, 255)", "sizeW": 27, "sizeH": 30, "offsetX": 51, "offsetY": -1 },
      { "color": "rgb(50, 165, 220)", "sizeW": 36, "sizeH": 24, "offsetX": 21, "offsetY": 1 },
      { "color": "rgb(150, 230, 250)", "sizeW": 30, "sizeH": 22, "offsetX": -21, "offsetY": 0 },
      { "color": "rgb(85, 195, 235)", "sizeW": 25, "sizeH": 28, "offsetX": 66, "offsetY": 1 },
      { "color": "rgb(65, 180, 245)", "sizeW": 23, "sizeH": 30, "offsetX": -66, "offsetY": -1 }
    ],
    "light": [
      { "color": "rgb(65, 144, 173)", "sizeW": 45, "sizeH": 36, "offsetX": 0, "offsetY": 2 },
      { "color": "rgb(43, 126, 166)", "sizeW": 35, "sizeH": 32, "offsetX": 65, "offsetY": 0 },
      { "color": "rgb(94, 158, 180)", "sizeW": 40, "sizeH": 28, "offsetX": -60, "offsetY": 2 },
      { "color": "rgb(50, 137, 155)", "sizeW": 35, "sizeH": 34, "offsetX": -90, "offsetY": 0 },
      { "color": "rgb(79, 151, 184)", "sizeW": 38, "sizeH": 30, "offsetX": 85, "offsetY": -1 },
      { "color": "rgb(36, 119, 158)", "sizeW": 50, "sizeH": 24, "offsetX": 35, "offsetY": 1 },
      { "color": "rgb(108, 166, 180)", "sizeW": 40, "sizeH": 22, "offsetX": -35, "offsetY": 0 },
      { "color": "rgb(61, 140, 169)", "sizeW": 35, "sizeH": 28, "offsetX": 110, "offsetY": 1 },
      { "color": "rgb(47, 130, 176)", "sizeW": 30, "sizeH": 30, "offsetX": -110, "offsetY": -1 }
    ]
  },
  "gold": {
    "dark": [
      { "color": "rgb(240, 190, 60)", "sizeW": 36, "sizeH": 36, "offsetX": 0, "offsetY": 2 },
      { "color": "rgb(255, 210, 90)", "sizeW": 30, "sizeH": 32, "offsetX": 39, "offsetY": 0 },
      { "color": "rgb(225, 165, 40)", "sizeW": 33, "sizeH": 28, "offsetX": -36, "offsetY": 2 },
      { "color": "rgb(250, 200, 70)", "sizeW": 29, "sizeH": 34, "offsetX": -54, "offsetY": 0 },
      { "color": "rgb(255, 225, 120)", "sizeW": 27, "sizeH": 30, "offsetX": 51, "offsetY": -1 },
      { "color": "rgb(230, 175, 50)", "sizeW": 36, "sizeH": 24, "offsetX": 21, "offsetY": 1 },
      { "color": "rgb(245, 205, 85)", "sizeW": 30, "sizeH": 22, "offsetX": -21, "offsetY": 0 },
      { "color": "rgb(215, 155, 35)", "sizeW": 25, "sizeH": 28, "offsetX": 66, "offsetY": 1 },
      { "color": "rgb(255, 215, 100)", "sizeW": 23, "sizeH": 30, "offsetX": -66, "offsetY": -1 }
    ],
    "light": [
      { "color": "rgb(173, 137, 43)", "sizeW": 45, "sizeH": 36, "offsetX": 0, "offsetY": 2 },
      { "color": "rgb(184, 151, 65)", "sizeW": 35, "sizeH": 32, "offsetX": 65, "offsetY": 0 },
      { "color": "rgb(162, 119, 29)", "sizeW": 40, "sizeH": 28, "offsetX": -60, "offsetY": 2 },
      { "color": "rgb(180, 144, 50)", "sizeW": 35, "sizeH": 34, "offsetX": -90, "offsetY": 0 },
      { "color": "rgb(184, 162, 86)", "sizeW": 38, "sizeH": 30, "offsetX": 85, "offsetY": -1 },
      { "color": "rgb(166, 126, 36)", "sizeW": 50, "sizeH": 24, "offsetX": 35, "offsetY": 1 },
      { "color": "rgb(176, 148, 61)", "sizeW": 40, "sizeH": 22, "offsetX": -35, "offsetY": 0 },
      { "color": "rgb(155, 112, 25)", "sizeW": 35, "sizeH": 28, "offsetX": 110, "offsetY": 1 },
      { "color": "rgb(184, 155, 72)", "sizeW": 30, "sizeH": 30, "offsetX": -110, "offsetY": -1 }
    ]
  }
} as const

export const PULSE_RING_MAP = [
  { "region": 1, "quad": "tl" },
  { "region": 2, "quad": "tl" },
  { "region": 3, "quad": "bl" },
  { "region": 1, "quad": "bl" },
  { "region": 2, "quad": "br" },
  { "region": 3, "quad": "br" },
  { "region": 1, "quad": "tr" },
  { "region": 2, "quad": "tr" },
  { "region": 3, "quad": "tr" }
] as const

export const PULSE_INNER_SIZES = [
  [
    65,
    35
  ],
  [
    55,
    30
  ],
  [
    35,
    65
  ],
  [
    15,
    30
  ],
  [
    173,
    28
  ],
  [
    80,
    22
  ],
  [
    69,
    28
  ],
  [
    22,
    38
  ],
  [
    47,
    44
  ]
] as const

export const PULSE_INNER_BLOOM = [
  { "ci": 0, "region": 1, "quad": "tl", "w": 84, "h": 48 },
  { "ci": 1, "region": 2, "quad": "tl", "w": 72, "h": 42 },
  { "ci": 2, "region": 3, "quad": "bl", "w": 48, "h": 84 },
  { "ci": 4, "region": 2, "quad": "br", "w": 216, "h": 38 },
  { "ci": 5, "region": 3, "quad": "br", "w": 102, "h": 31 },
  { "ci": 6, "region": 1, "quad": "tr", "w": 89, "h": 38 },
  { "ci": 8, "region": 3, "quad": "tr", "w": 62, "h": 58 }
] as const

export const PULSE_OUTER_CORE = [
  { "ci": 0, "region": 1, "quad": "tl", "w": 80, "h": 19, "x": "27%", "y": "0%" },
  { "ci": 6, "region": 2, "quad": "tr", "w": 74, "h": 11, "x": "73%", "y": "-1%" },
  { "ci": 7, "region": 3, "quad": "tr", "w": 15, "h": 44, "x": "100%", "y": "33%" },
  { "ci": 8, "region": 1, "quad": "br", "w": 19, "h": 38, "x": "101%", "y": "72%" },
  { "ci": 4, "region": 2, "quad": "br", "w": 84, "h": 13, "x": "67%", "y": "100%" },
  { "ci": 1, "region": 3, "quad": "bl", "w": 60, "h": 21, "x": "24%", "y": "101%" },
  { "ci": 2, "region": 1, "quad": "bl", "w": 17, "h": 40, "x": "0%", "y": "60%" },
  { "ci": 3, "region": 2, "quad": "tl", "w": 13, "h": 32, "x": "-1%", "y": "28%" }
] as const

export const PULSE_OUTER_BLOOM = [
  { "ci": 0, "region": 1, "quad": "tl", "w": 110, "h": 30, "x": "27%", "y": "3%" },
  { "ci": 6, "region": 2, "quad": "tr", "w": 100, "h": 20, "x": "73%", "y": "1%" },
  { "ci": 7, "region": 3, "quad": "tr", "w": 26, "h": 62, "x": "100%", "y": "33%" },
  { "ci": 8, "region": 1, "quad": "br", "w": 30, "h": 56, "x": "101%", "y": "72%" },
  { "ci": 4, "region": 2, "quad": "br", "w": 120, "h": 22, "x": "67%", "y": "99%" },
  { "ci": 1, "region": 3, "quad": "bl", "w": 88, "h": 32, "x": "24%", "y": "99%" },
  { "ci": 2, "region": 1, "quad": "bl", "w": 28, "h": 58, "x": "0%", "y": "60%" }
] as const
