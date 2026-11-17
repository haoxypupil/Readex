import { describe, expect, it } from 'vitest'
import { migrateReaderSettings, parseCoverDataUrl } from '../../src/main/storage'
import { DEFAULT_READER_SETTINGS } from '../../src/shared/types'

describe('reader settings migration', () => {
  it('defaults floating reader width to the existing content width', () => {
    const settings = migrateReaderSettings({
      ...DEFAULT_READER_SETTINGS,
      contentWidth: 940,
      floatingReaderWidth: undefined,
      floatingReaderHeight: undefined
    })

    expect(settings.floatingReaderWidth).toBe(940)
    expect(settings.floatingReaderHeight).toBe(200)
  })

  it('keeps an explicitly configured floating reader size', () => {
    const settings = migrateReaderSettings({
      ...DEFAULT_READER_SETTINGS,
      contentWidth: 940,
      floatingReaderWidth: 620,
      floatingReaderHeight: 280
    })

    expect(settings.floatingReaderWidth).toBe(620)
    expect(settings.floatingReaderHeight).toBe(280)
  })

  it('migrates legacy 1-10 speed levels to quieter 1-100 levels', () => {
    expect(
      migrateReaderSettings({ ...DEFAULT_READER_SETTINGS, autoScrollSpeed: 4 }).autoScrollSpeed
    ).toBe(25)
    expect(
      migrateReaderSettings({ ...DEFAULT_READER_SETTINGS, autoScrollSpeed: 2.1 })
        .autoScrollSpeed
    ).toBe(14)
    expect(
      migrateReaderSettings({ ...DEFAULT_READER_SETTINGS, autoScrollSpeed: 48 })
        .autoScrollSpeed
    ).toBe(48)
  })

  it('parses legacy cover data URLs for file migration', () => {
    const png = parseCoverDataUrl(
      `data:image/png;base64,${Buffer.from('cover-bytes').toString('base64')}`
    )
    expect(png?.extension).toBe('png')
    expect(png?.bytes.toString()).toBe('cover-bytes')

    const jpeg = parseCoverDataUrl('data:image/jpeg;base64,/9j/4AAQSkZJRg==')
    expect(jpeg?.extension).toBe('jpg')

    expect(parseCoverDataUrl('not-a-data-url')).toBeNull()
    expect(parseCoverDataUrl('data:image/png;base64,')).toBeNull()
  })

  it('normalizes reading layout and daily goal settings', () => {
    expect(
      migrateReaderSettings({
        ...DEFAULT_READER_SETTINGS,
        readingLayout: 'paginated',
        pageColumns: 2,
        dailyReadingGoalMinutes: 30,
        pdfTwoPage: true,
        comicTwoPage: true
      })
    ).toMatchObject({
      readingLayout: 'paginated',
      pageColumns: 2,
      dailyReadingGoalMinutes: 30,
      pdfTwoPage: true,
      comicTwoPage: true
    })
    expect(migrateReaderSettings({ ...DEFAULT_READER_SETTINGS }).comicTwoPage).toBe(false)
    expect(
      migrateReaderSettings({
        ...DEFAULT_READER_SETTINGS,
        pageColumns: 3 as never,
        dailyReadingGoalMinutes: 9999
      })
    ).toMatchObject({ pageColumns: 1, dailyReadingGoalMinutes: 600 })
    expect(
      migrateReaderSettings({
        ...DEFAULT_READER_SETTINGS,
        readingLayout: 'unknown' as never,
        dailyReadingGoalMinutes: -5
      })
    ).toMatchObject({ readingLayout: 'scroll', dailyReadingGoalMinutes: 0 })
  })

  it('normalizes the TTS engine and system voice', () => {
    expect(
      migrateReaderSettings({
        ...DEFAULT_READER_SETTINGS,
        ttsEngine: 'system',
        systemTtsVoice: '  Huihui  '
      })
    ).toMatchObject({ ttsEngine: 'system', systemTtsVoice: 'Huihui' })
    expect(
      migrateReaderSettings({
        ...DEFAULT_READER_SETTINGS,
        ttsEngine: 'invalid' as never
      }).ttsEngine
    ).toBe('online')
  })
})
