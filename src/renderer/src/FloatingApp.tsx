import { lazy, Suspense, useEffect, useState } from 'react'
import { Eye, EyeOff, Minus, X } from 'lucide-react'
import type { AppSettings, BookRecord, ReadingLocator } from '@shared/types'
import { DEFAULT_SETTINGS, upgradeLegacyThemeColors } from '@shared/types'
import { useFloatingWindowDrag } from './lib/floatingDrag'
import { createAppThemeStyle } from './lib/theme'

const ReaderView = lazy(() =>
  import('./components/ReaderView').then((module) => ({ default: module.ReaderView }))
)

export function FloatingApp(): React.JSX.Element {
  const [book, setBook] = useState<BookRecord | null>(null)
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [locator, setLocator] = useState<ReadingLocator | null>(null)
  const [error, setError] = useState('')
  const floatingDrag = useFloatingWindowDrag(true)

  useEffect(() => {
    const bookId = new URLSearchParams(window.location.search).get('bookId')
    if (!bookId) {
      setError('浮框缺少书籍信息')
      return
    }

    let active = true
    void Promise.all([
      window.readex.book.getRecord(bookId),
      window.readex.settings.get(),
      window.readex.reading.getState(bookId)
    ]).then(([record, storedSettings, readingState]) => {
      if (!active) return
      if (!record) {
        setError('书籍不存在或已被移除')
        return
      }
      setBook(record)
      setSettings({
        ...storedSettings,
        reader: upgradeLegacyThemeColors(storedSettings.reader)
      })
      setLocator(readingState?.locator ?? record.lastLocation ?? null)
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    return window.readex.windowControl.onFloatingReaderSync((value) => {
      setSettings(value.settings)
      setLocator(value.locator)
    })
  }, [])

  const stealth = settings.reader.floatingReaderStealth

  // 隐身开关同时更新设置并即时同步窗口阴影。
  const toggleStealth = (): void => {
    const next = !stealth
    setSettings((current) => {
      const nextSettings = {
        ...current,
        reader: { ...current.reader, floatingReaderStealth: next }
      }
      void window.readex.settings.update(nextSettings)
      return nextSettings
    })
    void window.readex.windowControl.setFloatingReaderShadow(!next)
  }

  return (
    <div
      className={`floating-reader-shell ${stealth ? 'floating-reader-stealth' : ''}`}
      data-app-theme={settings.reader.theme}
      style={createAppThemeStyle(settings.reader)}
      onPointerDownCapture={(event) => {
        const target = event.target
        if (target instanceof Element && target.closest('.reader-view')) return
        floatingDrag.onPointerDown(event.nativeEvent)
      }}
      onPointerMoveCapture={(event) => floatingDrag.onPointerMove(event.nativeEvent)}
      onPointerUpCapture={(event) => floatingDrag.onPointerUp(event.nativeEvent)}
      onPointerCancelCapture={(event) => floatingDrag.onPointerUp(event.nativeEvent)}
    >
      <div className="floating-reader-top-drag-region" aria-hidden="true" />
      {stealth && (
        <>
          <div className="floating-reader-edge-fade-left" aria-hidden="true" />
          <div className="floating-reader-edge-fade-right" aria-hidden="true" />
        </>
      )}
      <div className="floating-reader-window-actions">
        <button
          className={`floating-reader-stealth-toggle ${stealth ? 'active' : ''}`}
          type="button"
          title={stealth ? '退出隐身模式' : '隐身模式：隐藏边框与按钮，仅保留正文'}
          aria-label={stealth ? '退出隐身模式' : '进入隐身模式'}
          aria-pressed={stealth}
          onClick={toggleStealth}
        >
          {stealth ? <Eye size={15} strokeWidth={2} /> : <EyeOff size={15} strokeWidth={2} />}
        </button>
        <button
          className="floating-reader-minimize"
          type="button"
          title="最小化浮窗"
          aria-label="最小化浮窗"
          onClick={() => void window.readex.windowControl.minimizeFloatingReader()}
        >
          <Minus size={15} strokeWidth={2} />
        </button>
        <button
          className="floating-reader-close"
          type="button"
          title="关闭 Readex"
          aria-label="关闭 Readex"
          onClick={() => void window.readex.windowControl.quit()}
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>
      {error ? (
        <div className="floating-reader-error">{error}</div>
      ) : !book ? (
        <div className="floating-reader-loading">正在打开浮框阅读…</div>
      ) : (
        <Suspense fallback={<div className="floating-reader-loading">正在打开浮框阅读…</div>}>
          <ReaderView
            book={book}
            settings={settings.reader}
            initialLocator={locator}
            floatingWindow
            onBack={() => void window.readex.windowControl.closeFloatingReader()}
            onOpenSettings={() => undefined}
            onProgress={() => undefined}
            onChapterProgress={() => undefined}
            onAnnotationsChanged={() => undefined}
            onAutoScrollSpeedChange={(autoScrollSpeed) => {
              setSettings((current) => {
                const next = {
                  ...current,
                  reader: { ...current.reader, autoScrollSpeed }
                }
                void window.readex.settings.update(next)
                return next
              })
            }}
            onTtsSettingsChange={(patch) => {
              setSettings((current) => {
                const next = {
                  ...current,
                  reader: { ...current.reader, ...patch }
                }
                void window.readex.settings.update(next)
                return next
              })
            }}
            onComicTwoPageChange={(comicTwoPage) => {
              setSettings((current) => {
                const next = {
                  ...current,
                  reader: { ...current.reader, comicTwoPage }
                }
                void window.readex.settings.update(next)
                return next
              })
            }}
          />
        </Suspense>
      )}
    </div>
  )
}
