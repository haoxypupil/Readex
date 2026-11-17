import { describe, expect, it } from 'vitest'
import {
  normalizeSpeechText,
  parseSpeechCues,
  speechRatePercent,
  speechVolumePercent
} from '../../src/main/speech'
import { selectSystemVoice } from '../../src/shared/speech'

describe('speech synthesis parameters', () => {
  it('normalizes whitespace and converts rate to Edge TTS percentages', () => {
    expect(normalizeSpeechText('  第一行\n\n  第二行  ')).toBe('第一行 第二行')
    expect(speechRatePercent(1)).toBe('+0%')
    expect(speechRatePercent(1.25)).toBe('+25%')
    expect(speechRatePercent(0.8)).toBe('-20%')
  })

  it('converts volume and clamps unsupported values', () => {
    expect(speechVolumePercent(1)).toBe('+0%')
    expect(speechVolumePercent(0.5)).toBe('-50%')
    expect(speechVolumePercent(2)).toBe('+0%')
    expect(speechRatePercent(0.1)).toBe('-40%')
  })
})

describe('speech cue parsing', () => {
  it('keeps valid word timing entries and drops malformed entries', () => {
    expect(
      parseSpeechCues(
        JSON.stringify([
          { part: '你好', start: 0, end: 400 },
          { part: '', start: 400, end: 500 },
          { part: '世界', start: 400, end: 900 },
          { part: '错误', start: 900, end: 800 }
        ])
      )
    ).toEqual([
      { part: '你好', start: 0, end: 400 },
      { part: '世界', start: 400, end: 900 }
    ])
  })

  it('returns an empty list for invalid JSON', () => {
    expect(parseSpeechCues('{broken')).toEqual([])
  })
})

describe('system voice selection', () => {
  const voices = [
    { name: 'English', lang: 'en-US' },
    { name: 'Huihui', lang: 'zh-CN' },
    { name: 'Kangkang', lang: 'zh-TW' }
  ]

  it('prefers the configured system voice', () => {
    expect(selectSystemVoice(voices, 'Kangkang')).toEqual({
      name: 'Kangkang',
      lang: 'zh-TW'
    })
  })

  it('falls back to a Chinese voice and then the first available voice', () => {
    expect(selectSystemVoice(voices)).toEqual({ name: 'Huihui', lang: 'zh-CN' })
    expect(selectSystemVoice([{ name: 'English', lang: 'en-US' }])).toEqual({
      name: 'English',
      lang: 'en-US'
    })
    expect(selectSystemVoice([])).toBeNull()
  })
})
