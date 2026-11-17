import type { ReaderSettings } from '@shared/types'
import { selectSystemVoice, type TtsSynthesisResult } from '@shared/speech'
import type {
  ReaderHandle,
  ReaderSpeechSegment,
  ReaderSpeechSnapshot
} from '../readers/types'
import { collectScrollSegments } from './autoScroll'
import { smoothScrollBy } from './smoothScroll'

export type SpeechPlaybackState = 'idle' | 'loading' | 'playing' | 'paused'

interface SpeechPlaybackDelegate {
  getReader: () => ReaderHandle | null
  getSettings: () => ReaderSettings
  synthesize: (request: {
    text: string
    voice: string
    rate: number
    volume: number
  }) => Promise<TtsSynthesisResult>
  onStateChange: (state: SpeechPlaybackState) => void
  onMessage: (message: string) => void
}

interface PrefetchedAudio {
  key: string
  promise: Promise<TtsSynthesisResult | null>
}

const HIGHLIGHT_NAME = 'readex-speech'
let highlightedDocument: Document | null = null

export function buildSpeechSnapshot(
  roots: Array<{
    id: string
    element: HTMLElement
    mapY: (viewportY: number) => number
  }>,
  scrollTop: number
): ReaderSpeechSnapshot | null {
  const segments: ReaderSpeechSegment[] = []
  for (const root of roots) {
    const rootSegments = collectScrollSegments(root.element, root.mapY)
    rootSegments.forEach((segment, index) => {
      segments.push({
        id: `${root.id}:${index}`,
        text: segment.text,
        top: segment.top,
        bottom: segment.bottom,
        range: segment.range
      })
    })
  }
  if (!segments.length) return null

  return {
    segments,
    startIndex: findSpeechStartIndex(segments, scrollTop)
  }
}

export function findSpeechStartIndex(
  segments: ReaderSpeechSegment[],
  scrollTop: number
): number {
  if (!segments.length) return 0
  const firstVisible = segments.findIndex((segment) => segment.bottom > scrollTop + 1)
  if (firstVisible >= 0) return firstVisible
  return segments.length - 1
}

export function scrollRangeToReadingPosition(
  range: Range,
  container: HTMLElement,
  smooth: boolean,
  ratio = 0.2
): void {
  const rangeRect = range.getBoundingClientRect()
  if (!rangeRect.height) return
  const frame = range.startContainer.ownerDocument?.defaultView?.frameElement
  const frameRect = frame?.getBoundingClientRect()
  const viewportTop = (frameRect?.top ?? 0) + rangeRect.top
  const containerRect = container.getBoundingClientRect()
  const target = container.scrollTop + viewportTop - containerRect.top - container.clientHeight * ratio
  smoothScrollBy(container, target - container.scrollTop, smooth)
}

export function setSpeechHighlight(range: Range | null, color = '#f5c542'): void {
  removeSpeechHighlight()
  if (!range) return

  const ownerDocument = range.startContainer.ownerDocument
  if (!ownerDocument) return
  const ownerWindow = ownerDocument.defaultView as
    | (Window & {
        CSS?: { highlights?: Map<string, unknown> }
        Highlight?: new (...ranges: Range[]) => unknown
      })
    | null
  const registry = ownerWindow?.CSS?.highlights
  const HighlightConstructor = ownerWindow?.Highlight
  if (!registry || !HighlightConstructor) return

  const style = ownerDocument.createElement('style')
  style.dataset.readexSpeechHighlight = ''
  style.textContent = `::highlight(${HIGHLIGHT_NAME}) {
    background-color: ${highlightBackground(color)};
    text-decoration: underline 2px ${color};
  }`
  ownerDocument.head.append(style)
  registry.set(HIGHLIGHT_NAME, new HighlightConstructor(range))
  highlightedDocument = ownerDocument
}

export function removeSpeechHighlight(): void {
  if (!highlightedDocument) return
  const ownerWindow = highlightedDocument.defaultView as
    | (Window & { CSS?: { highlights?: Map<string, unknown> } })
    | null
  ownerWindow?.CSS?.highlights?.delete(HIGHLIGHT_NAME)
  highlightedDocument
    .querySelectorAll('style[data-readex-speech-highlight]')
    .forEach((node) => node.remove())
  highlightedDocument = null
}

export class SpeechPlaybackController {
  private state: SpeechPlaybackState = 'idle'
  private session = 0
  private snapshot: ReaderSpeechSnapshot | null = null
  private segmentIndex = 0
  private chunkIndex = 0
  private audio: HTMLAudioElement | null = null
  private objectUrl: string | null = null
  private utterance: SpeechSynthesisUtterance | null = null
  private prefetched: PrefetchedAudio | null = null
  private disposed = false

  constructor(private readonly delegate: SpeechPlaybackDelegate) {}

  getState(): SpeechPlaybackState {
    return this.state
  }

  async toggle(startText?: string): Promise<void> {
    if (this.state === 'playing') {
      this.pause()
      return
    }
    if (this.state === 'paused') {
      await this.resume()
      return
    }
    if (this.state === 'loading') {
      this.stop()
      return
    }
    await this.start(startText)
  }

  async start(startText?: string): Promise<void> {
    const reader = this.delegate.getReader()
    if (!reader) {
      this.delegate.onMessage('阅读内容尚未准备好')
      return
    }
    const snapshot = reader.getSpeechSnapshot()
    if (!snapshot?.segments.length) {
      this.delegate.onMessage('当前书籍暂不支持听书')
      return
    }

    this.session += 1
    this.snapshot = snapshot
    this.segmentIndex = findSelectionStartIndex(snapshot, startText) ?? snapshot.startIndex
    this.chunkIndex = 0
    await this.playCurrent()
  }

  pause(): void {
    if (this.state !== 'playing') return
    if (this.utterance) {
      window.speechSynthesis.pause()
      this.setState('paused')
      return
    }
    if (!this.audio) return
    this.audio.pause()
    this.setState('paused')
  }

  async resume(): Promise<void> {
    if (this.state !== 'paused') return
    if (this.utterance) {
      window.speechSynthesis.resume()
      this.setState('playing')
      return
    }
    if (!this.audio) return
    try {
      await this.audio.play()
      this.setState('playing')
    } catch {
      this.fail('无法继续播放听书音频')
    }
  }

  stop(): void {
    this.session += 1
    this.pauseAudio()
    this.snapshot = null
    this.segmentIndex = 0
    this.chunkIndex = 0
    this.prefetched = null
    this.delegate.getReader()?.setSpeechSegmentHighlight(null)
    removeSpeechHighlight()
    this.setState('idle')
  }

  destroy(): void {
    this.disposed = true
    this.stop()
  }

  private async playCurrent(): Promise<void> {
    if (this.disposed) return
    const session = this.session
    let snapshot = this.snapshot
    const reader = this.delegate.getReader()
    if (!snapshot || !reader) return

    if (this.segmentIndex >= snapshot.segments.length) {
      const advanced = await reader.advanceSpeechSection()
      if (session !== this.session || this.disposed) return
      const nextSnapshot = advanced ? reader.getSpeechSnapshot() : null
      if (!nextSnapshot?.segments.length) {
        this.finish()
        return
      }
      snapshot = nextSnapshot
      this.snapshot = nextSnapshot
      this.segmentIndex = nextSnapshot.startIndex
      this.chunkIndex = 0
    }

    const segment = snapshot.segments[this.segmentIndex]
    if (!segment) {
      this.finish()
      return
    }
    const chunks = splitSpeechText(segment.text)
    const text = chunks[this.chunkIndex]
    if (!text) {
      this.segmentIndex += 1
      this.chunkIndex = 0
      await this.playCurrent()
      return
    }

    this.setState('loading')
    reader.setSpeechSegmentHighlight(segment.id)
    reader.scrollToSpeechSegment(segment.id)

    if (this.delegate.getSettings().ttsEngine === 'system') {
      try {
        await this.playSystemText(text, () => {
          if (session !== this.session || this.disposed) return
          if (this.chunkIndex + 1 < chunks.length) {
            this.chunkIndex += 1
          } else {
            this.chunkIndex = 0
            this.segmentIndex += 1
          }
          void this.playCurrent()
        })
      } catch (error) {
        if (session !== this.session || this.disposed) return
        this.fail(error instanceof Error ? error.message : '离线朗读失败')
      }
      return
    }

    try {
      const result = await this.synthesizeText(text)
      if (session !== this.session || this.disposed) return
      this.prefetchNext(snapshot, this.segmentIndex, this.chunkIndex + 1)
      await this.playAudio(result, () => {
        if (session !== this.session || this.disposed) return
        if (this.chunkIndex + 1 < chunks.length) {
          this.chunkIndex += 1
        } else {
          this.chunkIndex = 0
          this.segmentIndex += 1
        }
        void this.playCurrent()
      })
    } catch (error) {
      if (session !== this.session || this.disposed) return
      this.fail(error instanceof Error ? error.message : '听书播放失败')
    }
  }

  private async synthesizeText(text: string): Promise<TtsSynthesisResult> {
    const settings = this.delegate.getSettings()
    const key = speechCacheKey(text, settings)
    if (this.prefetched?.key === key) {
      const prefetched = await this.prefetched.promise
      this.prefetched = null
      if (prefetched) return prefetched
    }
    return this.delegate.synthesize({
      text,
      voice: settings.ttsVoice,
      rate: settings.ttsRate,
      volume: settings.ttsVolume
    })
  }

  private prefetchNext(
    snapshot: ReaderSpeechSnapshot,
    segmentIndex: number,
    chunkIndex: number
  ): void {
    const text = speechUnitAt(snapshot, segmentIndex, chunkIndex)
    if (!text) return
    const settings = this.delegate.getSettings()
    const key = speechCacheKey(text, settings)
    if (this.prefetched?.key === key) return
    this.prefetched = {
      key,
      promise: this.delegate
        .synthesize({
          text,
          voice: settings.ttsVoice,
          rate: settings.ttsRate,
          volume: settings.ttsVolume
        })
        .catch(() => null)
    }
  }

  private async playAudio(
    result: TtsSynthesisResult,
    onEnded: () => void
  ): Promise<void> {
    this.releaseAudio()
    const audioBytes = new Uint8Array(result.audio.byteLength)
    audioBytes.set(result.audio)
    const blob = new Blob([audioBytes.buffer], { type: 'audio/mpeg' })
    this.objectUrl = URL.createObjectURL(blob)
    const audio = new Audio(this.objectUrl)
    audio.volume = Math.max(0, Math.min(1, this.delegate.getSettings().ttsVolume))
    this.audio = audio
    audio.onended = onEnded
    audio.onerror = () => this.fail('听书音频播放失败')
    await audio.play()
    this.setState('playing')
  }

  private playSystemText(text: string, onEnded: () => void): Promise<void> {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : null
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
      return Promise.reject(new Error('当前系统不支持离线朗读'))
    }
    this.pauseAudio()

    const settings = this.delegate.getSettings()
    const utterance = new SpeechSynthesisUtterance(text)
    const voices = synth
      .getVoices()
      .map((voice) => ({ name: voice.name, lang: voice.lang, voice }))
    const selected = selectSystemVoice(
      voices.map(({ name, lang }) => ({ name, lang })),
      settings.systemTtsVoice
    )
    if (selected) {
      const voice = voices.find((item) => item.name === selected.name)?.voice
      if (voice) utterance.voice = voice
      utterance.lang = voice?.lang ?? selected.lang
    } else {
      utterance.lang = 'zh-CN'
    }
    utterance.rate = Math.max(0.5, Math.min(2, settings.ttsRate))
    utterance.volume = Math.max(0, Math.min(1, settings.ttsVolume))
    utterance.onend = () => {
      if (this.utterance !== utterance) return
      this.utterance = null
      onEnded()
    }
    utterance.onerror = (event) => {
      if (this.utterance !== utterance) return
      this.utterance = null
      if (event.error !== 'interrupted' && event.error !== 'canceled') {
        this.fail('离线朗读失败')
      }
    }
    this.utterance = utterance
    synth.speak(utterance)
    this.setState('playing')
    return Promise.resolve()
  }

  private fail(message: string): void {
    this.pauseAudio()
    this.delegate.getReader()?.setSpeechSegmentHighlight(null)
    removeSpeechHighlight()
    this.setState('idle')
    this.delegate.onMessage(message)
  }

  private finish(): void {
    this.pauseAudio()
    this.delegate.getReader()?.setSpeechSegmentHighlight(null)
    removeSpeechHighlight()
    this.setState('idle')
    this.delegate.onMessage('已经读到当前内容的结尾')
  }

  private pauseAudio(): void {
    this.cancelSystemSpeech()
    if (this.audio) {
      this.audio.onended = null
      this.audio.onerror = null
      this.audio.pause()
    }
    this.releaseAudio()
  }

  private cancelSystemSpeech(): void {
    this.utterance = null
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
  }

  private releaseAudio(): void {
    this.audio = null
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl)
      this.objectUrl = null
    }
  }

  private setState(state: SpeechPlaybackState): void {
    if (this.state === state) return
    this.state = state
    this.delegate.onStateChange(state)
  }
}

function findSelectionStartIndex(
  snapshot: ReaderSpeechSnapshot,
  startText?: string
): number | null {
  const selected = startText?.replace(/\s+/g, '') ?? ''
  if (!selected) return null
  const probe = selected.slice(0, 24)
  const index = snapshot.segments.findIndex((segment) =>
    segment.text.replace(/\s+/g, '').includes(probe)
  )
  return index >= 0 ? index : null
}

function speechCacheKey(
  text: string,
  settings: Pick<ReaderSettings, 'ttsVoice' | 'ttsRate' | 'ttsVolume'>
): string {  return [
    settings.ttsVoice,
    settings.ttsRate.toFixed(2),
    settings.ttsVolume.toFixed(2),
    text
  ].join('\u0000')
}

export function splitSpeechText(text: string, maximum = 1200): string[] {
  const characters = Array.from(text)
  if (characters.length <= maximum) return text.trim() ? [text] : []
  const chunks: string[] = []
  for (let index = 0; index < characters.length; index += maximum) {
    const chunk = characters.slice(index, index + maximum).join('').trim()
    if (chunk) chunks.push(chunk)
  }
  return chunks
}

function speechUnitAt(
  snapshot: ReaderSpeechSnapshot,
  segmentIndex: number,
  chunkIndex: number
): string | null {
  const segment = snapshot.segments[segmentIndex]
  if (!segment) return null
  const chunks = splitSpeechText(segment.text)
  if (chunkIndex < chunks.length) return chunks[chunkIndex]
  const next = snapshot.segments[segmentIndex + 1]
  return next ? splitSpeechText(next.text)[0] ?? null : null
}

function highlightBackground(color: string): string {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color)
  if (!match) return 'rgba(245, 197, 66, 0.38)'
  const channels = match.slice(1).map((value) => Number.parseInt(value, 16))
  return `rgba(${channels.join(', ')}, 0.38)`
}
