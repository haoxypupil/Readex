import type { ReadingStats } from '@shared/types'

export interface DailyReading {
  date: string
  label: string
  seconds: number
}

/** 与主进程一致，按本地日期聚合。 */
export function localDateKey(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function lastReadingDays(
  stats: ReadingStats,
  days = 7,
  today: Date = new Date()
): DailyReading[] {
  const weekday = ['日', '一', '二', '三', '四', '五', '六']
  const result: DailyReading[] = []
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset)
    const key = localDateKey(date)
    result.push({
      date: key,
      label: offset === 0 ? '今天' : `周${weekday[date.getDay()]}`,
      seconds: Math.max(0, stats.days[key] ?? 0)
    })
  }
  return result
}

export function sumReadingSeconds(days: DailyReading[]): number {
  return days.reduce((total, day) => total + day.seconds, 0)
}

export interface ReadingPeriodTotal {
  seconds: number
  activeDays: number
}

/** 统计某个前缀（如 YYYY-MM 或 YYYY）内的阅读时长和阅读天数。 */
export function readingPeriodTotal(
  stats: ReadingStats,
  prefix: string
): ReadingPeriodTotal {
  let seconds = 0
  let activeDays = 0
  for (const [date, value] of Object.entries(stats.days)) {
    if (!date.startsWith(prefix) || value <= 0) continue
    seconds += value
    activeDays += 1
  }
  return { seconds, activeDays }
}

export function monthReadingTotal(
  stats: ReadingStats,
  date: Date = new Date()
): ReadingPeriodTotal {
  return readingPeriodTotal(stats, localDateKey(date).slice(0, 7))
}

export function yearReadingTotal(
  stats: ReadingStats,
  date: Date = new Date()
): ReadingPeriodTotal {
  return readingPeriodTotal(stats, String(date.getFullYear()))
}

export interface MonthlyReading {
  month: number
  label: string
  seconds: number
  activeDays: number
}

/** 指定年份的 12 个月汇总，缺失月份补 0。 */
export function monthlyReading(
  stats: ReadingStats,
  year = new Date().getFullYear()
): MonthlyReading[] {
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1
    const total = readingPeriodTotal(stats, `${year}-${String(month).padStart(2, '0')}`)
    return { month, label: `${month}月`, seconds: total.seconds, activeDays: total.activeDays }
  })
}

/** 历史最长连续阅读天数，不要求延续到今天。 */
export function longestReadingStreak(stats: ReadingStats): number {
  const dates = Object.entries(stats.days)
    .filter(([, seconds]) => seconds > 0)
    .map(([date]) => date)
    .sort()
  let longest = 0
  let current = 0
  let previous: Date | null = null
  for (const key of dates) {
    const [year, month, day] = key.split('-').map(Number)
    const date = new Date(year, month - 1, day)
    if (previous) {
      const next = new Date(previous)
      next.setDate(next.getDate() + 1)
      current = localDateKey(next) === key ? current + 1 : 1
    } else {
      current = 1
    }
    longest = Math.max(longest, current)
    previous = date
  }
  return longest
}

/** 今天有阅读就从今天算，否则从昨天算；两天都没有则为 0。 */
export function readingStreak(stats: ReadingStats, today: Date = new Date()): number {
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  if (!(stats.days[localDateKey(cursor)] > 0)) {
    cursor.setDate(cursor.getDate() - 1)
  }
  let streak = 0
  while ((stats.days[localDateKey(cursor)] ?? 0) > 0) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

export function formatReadingDuration(seconds: number): string {
  const value = Math.max(0, Math.round(seconds))
  if (value < 60) return `${value} 秒`
  if (value < 3600) return `${Math.round(value / 60)} 分钟`
  const hours = Math.floor(value / 3600)
  const minutes = Math.round((value % 3600) / 60)
  return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`
}
