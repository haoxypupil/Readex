import { describe, expect, it } from 'vitest'
import type { ReadingStats } from '../../src/shared/types'
import {
  formatReadingDuration,
  lastReadingDays,
  localDateKey,
  longestReadingStreak,
  monthReadingTotal,
  monthlyReading,
  readingStreak,
  sumReadingSeconds,
  yearReadingTotal
} from '../../src/renderer/src/lib/stats'

const today = new Date(2026, 10, 16)

function statsWith(days: Record<string, number>): ReadingStats {
  return { schemaVersion: 1, totalSeconds: 0, days, books: {} }
}

describe('reading stats helpers', () => {
  it('builds the last seven local days with labels', () => {
    const days = lastReadingDays(statsWith({ '2026-11-16': 600 }), 7, today)

    expect(days).toHaveLength(7)
    expect(days[6]).toMatchObject({ date: '2026-11-16', label: '今天', seconds: 600 })
    expect(days[0].date).toBe('2026-11-10')
    expect(sumReadingSeconds(days)).toBe(600)
  })

  it('counts a streak including today', () => {
    const stats = statsWith({
      '2026-11-16': 60,
      '2026-11-15': 60,
      '2026-11-14': 60,
      '2026-11-12': 60
    })

    expect(readingStreak(stats, today)).toBe(3)
  })

  it('keeps yesterday streak while today is still empty', () => {
    const stats = statsWith({ '2026-11-15': 60, '2026-11-14': 60 })
    expect(readingStreak(stats, today)).toBe(2)
  })

  it('formats durations for short and long sessions', () => {
    expect(formatReadingDuration(20)).toBe('20 秒')
    expect(formatReadingDuration(600)).toBe('10 分钟')
    expect(formatReadingDuration(5400)).toBe('1 小时 30 分钟')
    expect(formatReadingDuration(7200)).toBe('2 小时')
  })

  it('uses local date keys with zero padding', () => {
    expect(localDateKey(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('totals the current month and year', () => {
    const stats = statsWith({
      '2026-11-16': 600,
      '2026-11-02': 300,
      '2026-10-31': 900,
      '2025-11-16': 1200
    })

    expect(monthReadingTotal(stats, today)).toEqual({ seconds: 900, activeDays: 2 })
    expect(yearReadingTotal(stats, today)).toEqual({ seconds: 1800, activeDays: 3 })
  })

  it('builds monthly totals for a year', () => {
    const stats = statsWith({
      '2026-01-03': 60,
      '2026-01-04': 120,
      '2026-11-16': 600
    })
    const months = monthlyReading(stats, 2026)

    expect(months).toHaveLength(12)
    expect(months[0]).toMatchObject({ month: 1, seconds: 180, activeDays: 2 })
    expect(months[10]).toMatchObject({ month: 11, seconds: 600, activeDays: 1 })
    expect(months[5].seconds).toBe(0)
  })

  it('finds the longest historical streak across months', () => {
    const stats = statsWith({
      '2026-01-30': 60,
      '2026-01-31': 60,
      '2026-02-01': 60,
      '2026-02-02': 60,
      '2026-02-05': 60
    })
    expect(longestReadingStreak(stats)).toBe(4)
    expect(longestReadingStreak(statsWith({}))).toBe(0)
  })
})
