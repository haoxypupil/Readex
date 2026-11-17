import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AutoScrollController,
  adjustAutoScrollSpeed,
  autoScrollPixelsPerSecond,
  findSegmentIndexAt,
  normalizeAutoScrollSpeed,
  splitSentenceSegments,
  type ScrollSegment
} from '../../src/renderer/src/lib/autoScroll'

describe('automatic scrolling', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('maps speed levels to a smooth bounded pixels-per-second curve', () => {
    const speeds = Array.from({ length: 100 }, (_, index) =>
      autoScrollPixelsPerSecond(index + 1)
    )
    expect(speeds[0]).toBe(4)
    expect(speeds[19]).toBeCloseTo(20, 6)
    expect(speeds[99]).toBeCloseTo(120, 6)
    expect(speeds.every((speed, index) => index === 0 || speed > speeds[index - 1])).toBe(
      true
    )
    // 低速段刻意拉开每级差异（约 8.8%）；高速段保持平缓（<4%）。
    expect(Math.max(...speeds.slice(1).map((speed, index) => speed / speeds[index]))).toBeLessThan(
      1.09
    )
    expect(
      Math.max(...speeds.slice(20).map((speed, index) => speed / speeds[index + 19]))
    ).toBeLessThan(1.04)
    expect(autoScrollPixelsPerSecond(25)).toBeGreaterThan(speeds[23])
    expect(autoScrollPixelsPerSecond(25)).toBeLessThan(speeds[25])
  })

  it('spreads low speed levels so each step feels distinctly slower', () => {
    // 低速段（1-20 级）相邻档位至少差 8%，否则调不出体感差异。
    const lowSpeeds = Array.from({ length: 19 }, (_, index) =>
      autoScrollPixelsPerSecond(index + 1)
    )
    expect(
      Math.min(...lowSpeeds.slice(1).map((speed, index) => speed / lowSpeeds[index]))
    ).toBeGreaterThan(1.08)
    // 15 级时应明显低于旧曲线的约 19 px/s。
    expect(autoScrollPixelsPerSecond(15)).toBeLessThan(14)
  })

  it('normalizes and adjusts speed as integer levels from 1 to 100', () => {
    expect(normalizeAutoScrollSpeed(4.06)).toBe(4)
    expect(normalizeAutoScrollSpeed(-2)).toBe(1)
    expect(normalizeAutoScrollSpeed(120)).toBe(100)
    expect(adjustAutoScrollSpeed(25, 1)).toBe(26)
    expect(adjustAutoScrollSpeed(25, -5)).toBe(20)
    expect(adjustAutoScrollSpeed(1, -1)).toBe(1)
  })

  it('splits Chinese paragraphs into individual sentences', () => {
    expect(splitSentenceSegments('第一句。第二句！\n第三句？').map((item) => item.text)).toEqual([
      '第一句。',
      '第二句！',
      '第三句？'
    ])
  })

  it('finds the segment covering the reading line', () => {
    const segments = [
      { top: 10, bottom: 40 },
      { top: 40, bottom: 90 },
      { top: 90, bottom: 120 }
    ].map((value, index) => ({ range: null, text: `#${index}`, ...value })) as unknown as ScrollSegment[]

    expect(findSegmentIndexAt(segments, 5)).toBe(-1)
    expect(findSegmentIndexAt(segments, 10)).toBe(0)
    expect(findSegmentIndexAt(segments, 45)).toBe(1)
    expect(findSegmentIndexAt(segments, 400)).toBe(2)
    expect(findSegmentIndexAt([], 10)).toBe(-1)
  })

  it('moves the container continuously instead of jumping sentence by sentence', () => {
    let timerCallback: (() => void) | null = null
    vi.stubGlobal('setInterval', (callback: () => void) => {
      timerCallback = callback
      return 1
    })
    vi.stubGlobal('clearInterval', () => undefined)
    vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(16)

    const container = {
      scrollTop: 0,
      scrollHeight: 1000,
      clientHeight: 100,
      scrollTo: vi.fn(({ top }: ScrollToOptions) => {
        container.scrollTop = top ?? 0
      })
    } as unknown as HTMLElement
    const rootElement = {
      getBoundingClientRect: () => ({
        top: 0,
        bottom: 900,
        left: 0,
        right: 500,
        width: 500,
        height: 900,
        x: 0,
        y: 0,
        toJSON: () => undefined
      })
    } as unknown as HTMLElement
    const controller = new AutoScrollController({
      getContainer: () => container,
      getRoots: () => [
        {
          el: rootElement,
          document: {} as Document,
          highlightHost: rootElement,
          mapY: (viewportY) => viewportY
        }
      ],
      getSpeed: () => 25,
      getHighlightColor: () => '#b7e4c7',
      isLightBackground: () => true,
      isHighlightEnabled: () => false,
      getHighlightStyle: () => 'sentence',
      getBandHost: () => null,
      getBandRect: () => null
    })

    expect(controller.start()).toBe('started')
    expect(timerCallback).not.toBeNull()
    timerCallback?.()
    expect(container.scrollTop).toBeCloseTo(autoScrollPixelsPerSecond(25) * 0.016)
    controller.stop()
  })
})
