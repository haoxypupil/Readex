import { useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Headphones,
  LoaderCircle,
  Minimize2,
  Pause,
  Play,
  Square,
  Volume2
} from 'lucide-react'
import { DEFAULT_READER_SETTINGS, type ReaderSettings } from '@shared/types'
import {
  TTS_MAX_RATE,
  TTS_MAX_VOLUME,
  TTS_MIN_RATE,
  TTS_MIN_VOLUME,
  TTS_VOICES,
  type SystemVoiceLike
} from '@shared/speech'
import type { SpeechPlaybackState } from '../lib/speech'
import {
  adjustAutoScrollSpeed,
  AUTO_SCROLL_MAX_SPEED,
  AUTO_SCROLL_MIN_SPEED,
  AUTO_SCROLL_SPEED_STEP
} from '../lib/autoScroll'

interface ReaderScrollControlsProps {
  onScroll: (delta: number) => void
  step: number
  autoScrollOn: boolean
  autoScrollSpeed: number
  onToggleAutoScroll: () => void
  onAutoScrollSpeedChange: (speed: number) => void
  speechState: SpeechPlaybackState
  speechVoice: string
  speechRate: number
  speechVolume: number
  ttsEngine: ReaderSettings['ttsEngine']
  systemTtsVoice: string
  onToggleSpeech: () => void
  onStopSpeech: () => void
  onTtsSettingsChange: (
    patch: Partial<
      Pick<
        ReaderSettings,
        'ttsVoice' | 'ttsRate' | 'ttsVolume' | 'ttsEngine' | 'systemTtsVoice'
      >
    >
  ) => void
  sleepMinutes: number | null
  onSleepMinutesChange: (minutes: number | null) => void
  showSpeech?: boolean
  paged?: boolean
  floating?: boolean
  onExitFloating?: () => void
}

export function ReaderScrollControls({
  onScroll,
  step,
  autoScrollOn,
  autoScrollSpeed,
  onToggleAutoScroll,
  onAutoScrollSpeedChange,
  speechState,
  speechVoice,
  speechRate,
  speechVolume,
  ttsEngine,
  systemTtsVoice,
  onToggleSpeech,
  onStopSpeech,
  onTtsSettingsChange,
  sleepMinutes,
  onSleepMinutesChange,
  showSpeech = true,
  paged = false,
  floating = false,
  onExitFloating
}: ReaderScrollControlsProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const speedButtonRef = useRef<HTMLButtonElement>(null)
  const speedPopoverRef = useRef<HTMLDivElement>(null)
  const speechButtonRef = useRef<HTMLButtonElement>(null)
  const speechPopoverRef = useRef<HTMLDivElement>(null)
  const [speedOpen, setSpeedOpen] = useState(false)
  const [speechOpen, setSpeechOpen] = useState(false)
  const [systemVoices, setSystemVoices] = useState<SystemVoiceLike[]>([])

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const load = (): void => {
      setSystemVoices(
        window.speechSynthesis.getVoices().map((voice) => ({
          name: voice.name,
          lang: voice.lang
        }))
      )
    }
    load()
    window.speechSynthesis.addEventListener('voiceschanged', load)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load)
  }, [])

  useEffect(() => {
    if (!speedOpen && !speechOpen) return
    const closeOutside = (event: PointerEvent): void => {
      if (rootRef.current?.contains(event.target as Node)) return
      setSpeedOpen(false)
      setSpeechOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setSpeedOpen(false)
      setSpeechOpen(false)
      ;(speedOpen ? speedButtonRef : speechButtonRef).current?.focus()
    }
    window.addEventListener('pointerdown', closeOutside, true)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOutside, true)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [speechOpen, speedOpen])

  useEffect(() => {
    if (!paged) return
    setSpeedOpen(false)
    setSpeechOpen(false)
  }, [paged])

  useEffect(() => {
    const root = rootRef.current
    const speedButton = speedButtonRef.current
    const speechButton = speechButtonRef.current
    if (!root || !speedButton) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (speechButton?.contains(event.target as Node)) {
        adjustSpeechRate(event.deltaY < 0 ? 0.1 : -0.1)
        return
      }
      if (!speedButton.contains(event.target as Node)) return
      adjustSpeed(event.deltaY < 0 ? AUTO_SCROLL_SPEED_STEP : -AUTO_SCROLL_SPEED_STEP)
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => root.removeEventListener('wheel', onWheel)
  })

  const setSpeed = (speed: number): void => {
    onAutoScrollSpeedChange(adjustAutoScrollSpeed(speed, 0))
  }

  const adjustSpeed = (delta: number): void => {
    onAutoScrollSpeedChange(adjustAutoScrollSpeed(autoScrollSpeed, delta))
  }

  const speedLabel = String(Math.round(autoScrollSpeed))
  const speechRateLabel = `${speechRate.toFixed(1)}×`

  const adjustSpeechRate = (delta: number): void => {
    const next = Math.max(
      TTS_MIN_RATE,
      Math.min(TTS_MAX_RATE, Math.round((speechRate + delta) * 10) / 10)
    )
    onTtsSettingsChange({ ttsRate: next })
  }

  return (
    <>
      {(speedOpen || speechOpen) && (
        <div
          className="auto-scroll-dismiss-layer"
          aria-hidden="true"
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
            setSpeedOpen(false)
            setSpeechOpen(false)
          }}
        />
      )}
      <div
        className="reader-scroll-controls"
        aria-label="精细滚动"
        ref={rootRef}
        data-floating-no-drag=""
        onPointerDown={(event) => {
          event.stopPropagation()
          if (!speedOpen && !speechOpen) return
          const target = event.target as Node
          if (
            speedButtonRef.current?.contains(target) ||
            speedPopoverRef.current?.contains(target) ||
            speechButtonRef.current?.contains(target) ||
            speechPopoverRef.current?.contains(target)
          ) {
            return
          }
          setSpeedOpen(false)
          setSpeechOpen(false)
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        {showSpeech && (
          <>
            <div
              className="speech-control"
              onContextMenu={(event) => {
                event.preventDefault()
                setSpeechOpen(true)
              }}
            >
              <button
                className={`speech-toggle ${speechState !== 'idle' ? 'active' : ''}`}
                type="button"
                title={
                  speechState === 'playing'
                    ? '暂停听书'
                    : speechState === 'paused'
                      ? '继续听书'
                      : speechState === 'loading'
                        ? '取消听书'
                        : '从本页第一句开始朗读'
                }
                aria-pressed={speechState !== 'idle'}
                onClick={onToggleSpeech}
              >
                {speechState === 'loading' ? (
                  <LoaderCircle className="spin" size={15} />
                ) : speechState === 'playing' ? (
                  <Pause size={15} />
                ) : speechState === 'paused' ? (
                  <Play size={15} />
                ) : (
                  <Headphones size={15} />
                )}
              </button>
              {!floating && (
                <>
                  <span className="auto-scroll-control-divider" />
                  <button
                    className={`speech-rate-button ${speechOpen ? 'active' : ''}`}
                    type="button"
                    ref={speechButtonRef}
                    title={`听书语速 ${speechRateLabel}；点击调节，滚轮可微调`}
                    aria-label={`调整听书语速，当前 ${speechRateLabel}`}
                    aria-expanded={speechOpen}
                    aria-controls="tts-settings-panel"
                    onClick={() => setSpeechOpen((value) => !value)}
                  >
                    {speechRateLabel}
                  </button>
                  {speechState !== 'idle' && (
                    <>
                      <span className="auto-scroll-control-divider" />
                      <button type="button" title="停止听书" onClick={onStopSpeech}>
                        <Square size={13} />
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
            <span />
          </>
        )}
        {!paged && (
          <>
        <div
          className="auto-scroll-control"
          onContextMenu={(event) => {
            event.preventDefault()
            setSpeedOpen(true)
          }}
        >
          <button
            className={`auto-scroll-toggle ${autoScrollOn ? 'active' : ''}`}
            type="button"
            title={autoScrollOn ? '暂停自动滚动' : '开始自动滚动'}
            aria-pressed={autoScrollOn}
            onClick={onToggleAutoScroll}
          >
            {autoScrollOn ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <span className="auto-scroll-control-divider" />
          <button
            className={`auto-scroll-speed-button ${speedOpen ? 'active' : ''}`}
            type="button"
            ref={speedButtonRef}
            title={`自动滚动速度 ${speedLabel}/100；点击调节，滚轮可微调`}
            aria-label={`调整自动滚动速度，当前 ${speedLabel}/100`}
            aria-expanded={speedOpen}
            aria-controls="auto-scroll-speed-panel"
            onKeyDown={(event) => {
              const amount = event.shiftKey ? 5 : AUTO_SCROLL_SPEED_STEP
              if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
                event.preventDefault()
                event.stopPropagation()
                adjustSpeed(amount)
              } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
                event.preventDefault()
                event.stopPropagation()
                adjustSpeed(-amount)
              } else if (event.key === 'Home') {
                event.preventDefault()
                setSpeed(AUTO_SCROLL_MIN_SPEED)
              } else if (event.key === 'End') {
                event.preventDefault()
                setSpeed(AUTO_SCROLL_MAX_SPEED)
              }
            }}
            onClick={() => setSpeedOpen((value) => !value)}
          >
            {speedLabel}
          </button>
        </div>
        <span />
          </>
        )}
        <button
          type="button"
          title={paged ? '上一页' : `向上移动 ${step} 像素`}
          onClick={() => onScroll(-step)}
        >
          <ChevronUp size={16} />
        </button>
        <span />
        <button
          type="button"
          title={paged ? '下一页' : `向下移动 ${step} 像素`}
          onClick={() => onScroll(step)}
        >
          <ChevronDown size={16} />
        </button>
        {floating && onExitFloating && (
          <>
            <span />
            <button type="button" title="返回主界面" onClick={onExitFloating}>
              <Minimize2 size={15} />
            </button>
          </>
        )}

        {speedOpen && (
          <div
            className="auto-scroll-speed-popover"
            id="auto-scroll-speed-panel"
            role="group"
            aria-label="自动滚动速度"
            ref={speedPopoverRef}
          >
            <div className="auto-scroll-speed-heading">
              <span>自动滚动速度</span>
              <strong>{speedLabel}/100</strong>
            </div>
            <div className="auto-scroll-speed-stepper">
              <button
                type="button"
                title="减速 1 级"
                onClick={() => adjustSpeed(-AUTO_SCROLL_SPEED_STEP)}
              >
                −
              </button>
              <output>{speedLabel}</output>
              <button
                type="button"
                title="加速 1 级"
                onClick={() => adjustSpeed(AUTO_SCROLL_SPEED_STEP)}
              >
                +
              </button>
            </div>
            <input
              type="range"
              min={AUTO_SCROLL_MIN_SPEED}
              max={AUTO_SCROLL_MAX_SPEED}
              step={AUTO_SCROLL_SPEED_STEP}
              value={autoScrollSpeed}
              aria-label="自动滚动速度"
              onChange={(event) => setSpeed(Number(event.target.value))}
            />
            <div className="auto-scroll-speed-presets" aria-label="常用速度">
              {[10, 25, 50, 75].map((speed) => (
                <button
                  className={Math.round(autoScrollSpeed) === speed ? 'active' : ''}
                  type="button"
                  key={speed}
                  onClick={() => setSpeed(speed)}
                >
                  {speed}
                </button>
              ))}
            </div>
            <button
              className="auto-scroll-speed-reset"
              type="button"
              onClick={() => setSpeed(DEFAULT_READER_SETTINGS.autoScrollSpeed)}
            >
              恢复默认速度
            </button>
          </div>
        )}

        {showSpeech && speechOpen && (
          <div
            className="tts-settings-popover"
            id="tts-settings-panel"
            role="group"
            aria-label="听书设置"
            ref={speechPopoverRef}
          >
            <div className="tts-settings-heading">
              <Headphones size={14} />
              <span>听书设置</span>
            </div>
            {speechState !== 'idle' && (
              <button
                className="tts-stop-button"
                type="button"
                onClick={() => {
                  onStopSpeech()
                  setSpeechOpen(false)
                }}
              >
                <Square size={13} />
                停止听书
              </button>
            )}
            <label className="tts-setting-row">
              <span>引擎</span>
              <select
                value={ttsEngine}
                onChange={(event) =>
                  onTtsSettingsChange({
                    ttsEngine: event.target.value as ReaderSettings['ttsEngine']
                  })
                }
              >
                <option value="online">在线神经语音</option>
                <option value="system">系统离线语音</option>
              </select>
            </label>
            {ttsEngine === 'system' ? (
              <label className="tts-setting-row">
                <span>系统音色</span>
                <select
                  value={systemTtsVoice}
                  onChange={(event) =>
                    onTtsSettingsChange({ systemTtsVoice: event.target.value })
                  }
                >
                  <option value="">自动选择中文语音</option>
                  {systemVoices.map((voice) => (
                    <option key={voice.name} value={voice.name}>
                      {voice.name} · {voice.lang}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="tts-setting-row">
                <span>音色</span>
                <select
                  value={speechVoice}
                  onChange={(event) =>
                    onTtsSettingsChange({ ttsVoice: event.target.value })
                  }
                >
                  {TTS_VOICES.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="tts-setting-hint">
              {ttsEngine === 'system'
                ? systemVoices.length
                  ? '离线朗读使用 Windows 已安装的语音，不消耗网络。'
                  : '未检测到系统语音，请在 Windows 设置中安装中文语音包。'
                : '在线听书依赖网络，单句会发送给 Microsoft Edge 语音服务。'}
            </p>
            <label className="tts-setting-row">
              <span>语速</span>
              <strong>{speechRateLabel}</strong>
            </label>
            <input
              type="range"
              min={TTS_MIN_RATE}
              max={TTS_MAX_RATE}
              step={0.1}
              value={speechRate}
              aria-label="听书语速"
              onChange={(event) =>
                onTtsSettingsChange({ ttsRate: Number(event.target.value) })
              }
            />
            <div className="tts-rate-presets" aria-label="常用语速">
              {[0.8, 1, 1.2, 1.5].map((rate) => (
                <button
                  className={Math.abs(speechRate - rate) < 0.01 ? 'active' : ''}
                  type="button"
                  key={rate}
                  onClick={() => onTtsSettingsChange({ ttsRate: rate })}
                >
                  {rate.toFixed(1)}×
                </button>
              ))}
            </div>
            <label className="tts-setting-row">
              <span>
                <Volume2 size={13} />
                音量
              </span>
              <strong>{Math.round(speechVolume * 100)}%</strong>
            </label>
            <input
              type="range"
              min={TTS_MIN_VOLUME}
              max={TTS_MAX_VOLUME}
              step={0.05}
              value={speechVolume}
              aria-label="听书音量"
              onChange={(event) =>
                onTtsSettingsChange({ ttsVolume: Number(event.target.value) })
              }
            />
            <label className="tts-setting-row">
              <span>定时停止</span>
              <strong>{sleepMinutes ? `${sleepMinutes} 分钟后` : '关闭'}</strong>
            </label>
            <div className="tts-rate-presets" aria-label="定时停止">
              {[0, 15, 30, 60].map((minutes) => {
                const checked = minutes === 0 ? sleepMinutes === null : sleepMinutes === minutes
                return (
                  <button
                    className={checked ? 'active' : ''}
                    type="button"
                    key={minutes}
                    onClick={() => onSleepMinutesChange(minutes === 0 ? null : minutes)}
                  >
                    {minutes === 0 ? '关闭' : `${minutes}分`}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
