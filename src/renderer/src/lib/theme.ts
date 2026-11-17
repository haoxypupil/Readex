import type { CSSProperties } from 'react'
import type { ReaderSettings } from '@shared/types'
import { mix, normalizeHex, readableOn, relativeLuminance, rgba } from '@shared/theme'

export { createTitleBarTheme, isLightColor } from '@shared/theme'

export function createAppThemeStyle(settings: ReaderSettings): CSSProperties {
  const background = normalizeHex(settings.backgroundColor)
  const text = normalizeHex(settings.textColor)
  const accent = normalizeHex(settings.accentColor)
  const light = relativeLuminance(background) > 0.55
  // 暖色辅助色用于格式徽章、连续阅读等点缀，让界面不只有一种强调色。
  const warm =
    settings.theme === 'sepia' ? '#bf6f2f' : light ? '#c2691f' : '#e09a52'

  return {
    '--bg': background,
    '--surface': mix(background, text, 0.035),
    '--surface-2': mix(background, text, 0.068),
    '--surface-3': mix(background, text, 0.1),
    '--surface-hover': mix(background, text, light ? 0.055 : 0.13),
    '--surface-selected': mix(background, text, light ? 0.085 : 0.105),
    '--surface-raised': light ? mix(background, '#ffffff', 0.55) : mix(background, text, 0.09),
    '--border': mix(background, text, light ? 0.11 : 0.14),
    '--border-soft': mix(background, text, light ? 0.065 : 0.08),
    '--text': text,
    '--text-strong': light ? mix(text, '#000000', 0.12) : mix(text, '#ffffff', 0.08),
    '--text-soft': mix(text, background, 0.2),
    '--text-muted': mix(text, background, 0.45),
    '--text-faint': mix(text, background, 0.62),
    '--accent': accent,
    '--accent-strong': mix(accent, text, light ? 0.18 : 0.2),
    '--accent-soft': rgba(accent, light ? 0.12 : 0.16),
    '--accent-contrast': readableOn(accent),
    '--accent-warm': warm,
    '--accent-warm-soft': rgba(warm, light ? 0.12 : 0.16),
    '--danger': light ? '#c44747' : '#e16b6b',
    '--danger-soft': rgba(light ? '#c44747' : '#e16b6b', 0.12),
    '--warning': light ? '#a26921' : '#d9a85e',
    '--radius-sm': '7px',
    '--radius': '10px',
    '--radius-lg': '14px',
    '--shadow':
      light
        ? '0 6px 16px rgba(15, 15, 15, 0.07), 0 24px 60px rgba(15, 15, 15, 0.12)'
        : '0 18px 52px rgba(0, 0, 0, 0.36)',
    '--shadow-soft':
      light
        ? '0 1px 2px rgba(15, 15, 15, 0.05), 0 6px 20px rgba(15, 15, 15, 0.08)'
        : '0 8px 26px rgba(0, 0, 0, 0.32)',
    '--overlay': rgba(background, light ? 0.78 : 0.82),
    '--scrollbar': mix(background, text, light ? 0.2 : 0.16),
    '--scrollbar-hover': mix(background, text, light ? 0.32 : 0.28),
    '--cover-bg': mix(background, accent, light ? 0.18 : 0.22),
    '--cover-border': mix(background, accent, light ? 0.32 : 0.38),
    '--cover-text': light ? mix(text, accent, 0.22) : mix(text, accent, 0.16),
    colorScheme: light ? 'light' : 'dark'
  } as CSSProperties
}
