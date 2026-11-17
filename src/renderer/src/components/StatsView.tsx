import type { BookRecord, ReadingStats } from '@shared/types'
import { CalendarDays, Clock3, Flame, TrendingUp } from 'lucide-react'
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
} from '../lib/stats'

interface StatsViewProps {
  stats: ReadingStats | null
  books: BookRecord[]
  loading: boolean
  goalMinutes: number
}

export function StatsView({
  stats,
  books,
  loading,
  goalMinutes
}: StatsViewProps): React.JSX.Element {
  const current = stats ?? { schemaVersion: 1 as const, totalSeconds: 0, days: {}, books: {} }
  const todayKey = localDateKey()
  const todaySeconds = current.days[todayKey] ?? 0
  const goalSeconds = goalMinutes * 60
  const goalPercent = goalSeconds > 0 ? Math.min(1, todaySeconds / goalSeconds) : 0
  const days = lastReadingDays(current, 7)
  const last30 = lastReadingDays(current, 30)
  const weekSeconds = sumReadingSeconds(days)
  const maxDay = Math.max(1, ...days.map((day) => day.seconds))
  const max30 = Math.max(1, ...last30.map((day) => day.seconds))
  const streak = readingStreak(current)
  const month = monthReadingTotal(current)
  const year = yearReadingTotal(current)
  const currentYear = new Date().getFullYear()
  const months = monthlyReading(current, currentYear)
  const maxMonth = Math.max(1, ...months.map((item) => item.seconds))
  const longest = longestReadingStreak(current)
  const finished = books.filter((book) => book.progress >= 0.98).length
  const ranking = Object.entries(current.books)
    .flatMap(([bookId, seconds]) => {
      const book = books.find((item) => item.id === bookId)
      return book ? [{ book, seconds }] : []
    })
    .sort((left, right) => right.seconds - left.seconds)
    .slice(0, 6)
  const maxBook = Math.max(1, ...ranking.map((entry) => entry.seconds))

  return (
    <main className="notes-dashboard stats-view">
      <header>
        <p className="eyebrow">本地阅读记录</p>
        <h1>阅读统计</h1>
        <p>只统计 Readex 窗口处于前台时的阅读时长，数据保存在 personal 目录。</p>
      </header>

      {loading ? (
        <section className="empty-notes">
          <Clock3 size={30} />
          <h2>正在读取阅读记录</h2>
        </section>
      ) : (
        <>
          <section className="stats-cards">
            <article>
              <Clock3 size={17} />
              <span>今日阅读</span>
              <strong>{formatReadingDuration(todaySeconds)}</strong>
            </article>
            <article>
              <CalendarDays size={17} />
              <span>最近 7 天</span>
              <strong>{formatReadingDuration(weekSeconds)}</strong>
            </article>
            <article>
              <TrendingUp size={17} />
              <span>累计阅读</span>
              <strong>{formatReadingDuration(current.totalSeconds)}</strong>
            </article>
            <article className="warm">
              <Flame size={17} />
              <span>连续阅读</span>
              <strong>{streak} 天</strong>
            </article>
            <article>
              <CalendarDays size={17} />
              <span>本月阅读</span>
              <strong>{formatReadingDuration(month.seconds)}</strong>
            </article>
            <article>
              <TrendingUp size={17} />
              <span>今年阅读</span>
              <strong>{formatReadingDuration(year.seconds)}</strong>
            </article>
          </section>

          {goalMinutes > 0 && (
            <section className="stats-section stats-goal">
              <div className="stats-section-heading">
                <h2>今日目标</h2>
                <span>
                  {formatReadingDuration(todaySeconds)} / {goalMinutes} 分钟
                </span>
              </div>
              <div className="stats-goal-track">
                <span style={{ width: `${goalPercent * 100}%` }} />
              </div>
              <p className="stats-goal-note">
                {goalPercent >= 1
                  ? '今日目标已完成。'
                  : `还差 ${formatReadingDuration(Math.max(0, goalSeconds - todaySeconds))}。`}
              </p>
            </section>
          )}

          <section className="stats-section">
            <div className="stats-section-heading">
              <h2>最近 30 天</h2>
              <span>
                本月 {month.activeDays} 天有阅读 · {formatReadingDuration(month.seconds)}
              </span>
            </div>
            <div className="stats-heatmap">
              {last30.map((day) => {
                const level =
                  day.seconds <= 0
                    ? 0
                    : 1 + Math.min(3, Math.floor((day.seconds / max30) * 3))
                return (
                  <span
                    className={`level-${level}${day.date === todayKey ? ' today' : ''}`}
                    key={day.date}
                    title={`${day.date} · ${formatReadingDuration(day.seconds)}`}
                  />
                )
              })}
            </div>
          </section>

          <section className="stats-section">
            <div className="stats-section-heading">
              <h2>最近 7 天</h2>
              <span>合计 {formatReadingDuration(weekSeconds)}</span>
            </div>
            <div className="stats-chart">
              {days.map((day) => (
                <div className="stats-bar" key={day.date}>
                  <div className="stats-bar-track">
                    <span
                      className={day.date === todayKey ? 'today' : undefined}
                      style={{
                        height: `${day.seconds > 0 ? Math.max(6, (day.seconds / maxDay) * 100) : 2}%`
                      }}
                      title={`${day.date} · ${formatReadingDuration(day.seconds)}`}
                    />
                  </div>
                  <small>{day.label}</small>
                </div>
              ))}
            </div>
          </section>

          <section className="stats-section">
            <div className="stats-section-heading">
              <h2>{currentYear} 年度回顾</h2>
              <span>
                {year.activeDays} 天有阅读 · 最长连续 {longest} 天
              </span>
            </div>
            <div className="stats-month-chart">
              {months.map((item) => (
                <div className="stats-bar" key={item.month}>
                  <div className="stats-bar-track">
                    <span
                      style={{
                        height: `${item.seconds > 0 ? Math.max(6, (item.seconds / maxMonth) * 100) : 2}%`
                      }}
                      title={`${item.label} · ${formatReadingDuration(item.seconds)}`}
                    />
                  </div>
                  <small>{item.month}</small>
                </div>
              ))}
            </div>
            <div className="stats-year-summary">
              <span>
                今年阅读 <strong>{formatReadingDuration(year.seconds)}</strong>
              </span>
              <span>
                阅读天数 <strong>{year.activeDays}</strong>
              </span>
              <span>
                最长连续 <strong>{longest} 天</strong>
              </span>
              <span>
                已读完全书 <strong>{finished} 本</strong>
              </span>
            </div>
          </section>

          <section className="stats-section">
            <div className="stats-section-heading">
              <h2>按书籍统计</h2>
              <span>
                {finished} 本已读完 · 时长前 6 本
              </span>
            </div>
            {ranking.length === 0 ? (
              <p className="stats-empty">开始阅读后，这里会显示每本书的累计阅读时长。</p>
            ) : (
              <div className="stats-book-list">
                {ranking.map(({ book, seconds }) => (
                  <article key={book.id}>
                    <div className="stats-book-copy">
                      <strong>{book.title}</strong>
                      <span>{book.author || '未知作者'}</span>
                    </div>
                    <div className="stats-book-bar">
                      <span style={{ width: `${(seconds / maxBook) * 100}%` }} />
                    </div>
                    <time>{formatReadingDuration(seconds)}</time>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  )
}
