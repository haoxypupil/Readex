import { describe, expect, it } from 'vitest'
import { createAppThemeStyle, createTitleBarTheme } from '../../src/renderer/src/lib/theme'
import {
  DEFAULT_READER_SETTINGS,
  THEME_PRESETS,
  upgradeLegacyThemeColors
} from '../../src/shared/types'

describe('application theme', () => {
  it('derives the complete light shell from the selected reader theme', () => {
    const style = createAppThemeStyle({
      ...DEFAULT_READER_SETTINGS,
      theme: 'light',
      backgroundColor: '#ffffff',
      textColor: '#242424',
      accentColor: '#4b82bd'
    }) as Record<string, string>

    expect(style['--bg']).toBe('#ffffff')
    expect(style['--text']).toBe('#242424')
    expect(style['--accent']).toBe('#4b82bd')
    expect(style.colorScheme).toBe('light')
    expect(style['--surface']).not.toBe(style['--bg'])
    expect(style['--border']).not.toBe(style['--bg'])
  })

  it('supports custom colors without falling back to the dark shell', () => {
    const style = createAppThemeStyle({
      ...DEFAULT_READER_SETTINGS,
      theme: 'custom',
      backgroundColor: '#f3ead8',
      textColor: '#3e3427',
      accentColor: '#9a5b2d'
    }) as Record<string, string>

    expect(style['--bg']).toBe('#f3ead8')
    expect(style['--text']).toBe('#3e3427')
    expect(style['--accent']).toBe('#9a5b2d')
    expect(style.colorScheme).toBe('light')
  })

  it('uses the same computed surface color for the native title bar controls', () => {
    const settings = {
      ...DEFAULT_READER_SETTINGS,
      theme: 'light' as const,
      backgroundColor: '#ffffff',
      textColor: '#242424'
    }
    const style = createAppThemeStyle(settings) as Record<string, string>
    const titleBar = createTitleBarTheme(settings)

    expect(titleBar.color).toBe(style['--surface'])
    expect(titleBar.symbolColor).toBe(style['--text'])
  })

  it('dims native title bar controls together with a modal backdrop', () => {
    const settings = {
      ...DEFAULT_READER_SETTINGS,
      theme: 'light' as const,
      backgroundColor: '#ffffff',
      textColor: '#242424'
    }

    expect(createTitleBarTheme(settings, 0.18)).toEqual({
      color: '#cbcbcb',
      symbolColor: '#1e1e1e'
    })
  })

  it('derives the Codex-style neutral light shell from the light preset', () => {
    const style = createAppThemeStyle({
      ...DEFAULT_READER_SETTINGS,
      theme: 'light',
      ...THEME_PRESETS.light
    }) as Record<string, string>

    expect(style['--bg']).toBe('#ffffff')
    expect(style['--text']).toBe('#0d0d0d')
    expect(style['--surface']).toBe('#f7f7f7')
    expect(style['--border']).toBe('#e4e4e4')
    expect(style['--text-soft']).toBe('#3d3d3d')
    expect(style.colorScheme).toBe('light')
  })

  it('keeps primary button labels readable on the blue accents', () => {
    const light = createAppThemeStyle({
      ...DEFAULT_READER_SETTINGS,
      theme: 'light',
      ...THEME_PRESETS.light
    }) as Record<string, string>
    const dark = createAppThemeStyle({
      ...DEFAULT_READER_SETTINGS,
      theme: 'dark',
      ...THEME_PRESETS.dark
    }) as Record<string, string>

    expect(light['--accent']).toBe('#2563eb')
    expect(light['--accent-contrast']).toBe('#ffffff')
    expect(dark['--accent']).toBe('#5b9cf6')
    expect(dark['--accent-contrast']).toBe('#ffffff')
  })

  it('derives a warm secondary accent per shell', () => {
    const dark = createAppThemeStyle({
      ...DEFAULT_READER_SETTINGS,
      theme: 'dark',
      ...THEME_PRESETS.dark
    }) as Record<string, string>
    const light = createAppThemeStyle({
      ...DEFAULT_READER_SETTINGS,
      theme: 'light',
      ...THEME_PRESETS.light
    }) as Record<string, string>

    expect(dark['--accent-warm']).toBe('#e09a52')
    expect(light['--accent-warm']).toBe('#c2691f')
  })
})

describe('theme preset migration', () => {
  it('upgrades the warm presets of the first release to the Codex palette', () => {
    const upgraded = upgradeLegacyThemeColors({
      ...DEFAULT_READER_SETTINGS,
      theme: 'light',
      backgroundColor: '#f7f4ef',
      textColor: '#37312a',
      accentColor: '#b95c33'
    })

    expect(upgraded).toMatchObject(THEME_PRESETS.light)
    expect(upgraded.fontSize).toBe(DEFAULT_READER_SETTINGS.fontSize)
  })

  it('upgrades the previous near-white accent palette to the blue presets', () => {
    const upgraded = upgradeLegacyThemeColors({
      ...DEFAULT_READER_SETTINGS,
      theme: 'dark',
      backgroundColor: '#212121',
      textColor: '#ececec',
      accentColor: '#f5f5f5'
    })

    expect(upgraded).toMatchObject(THEME_PRESETS.dark)
  })

  it('upgrades the pre-refresh dark preset in one step', () => {
    const upgraded = upgradeLegacyThemeColors({
      ...DEFAULT_READER_SETTINGS,
      theme: 'dark',
      backgroundColor: '#171717',
      textColor: '#e8e8e8',
      accentColor: '#60a5fa'
    })

    expect(upgraded).toMatchObject(THEME_PRESETS.dark)
  })

  it('leaves genuinely custom colors untouched', () => {
    const custom = {
      ...DEFAULT_READER_SETTINGS,
      theme: 'custom' as const,
      backgroundColor: '#101418',
      textColor: '#d7e3f4',
      accentColor: '#7dd3fc'
    }

    expect(upgradeLegacyThemeColors(custom)).toEqual(custom)
  })
})
