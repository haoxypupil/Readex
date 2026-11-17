import { describe, expect, it } from 'vitest'
import { clampComicPage, snapSpreadStart } from '../../src/renderer/src/lib/comicPages'

describe('comic paging helpers', () => {
  it('clamps pages into the book range', () => {
    expect(clampComicPage(0, 10)).toBe(1)
    expect(clampComicPage(11, 10)).toBe(10)
    expect(clampComicPage(Number.NaN, 10)).toBe(1)
    expect(clampComicPage(4.6, 10)).toBe(5)
    expect(clampComicPage(1, 1)).toBe(1)
  })

  it('snaps spread starts to odd pages', () => {
    expect(snapSpreadStart(4)).toBe(3)
    expect(snapSpreadStart(8)).toBe(7)
    expect(snapSpreadStart(7)).toBe(7)
    expect(snapSpreadStart(1)).toBe(1)
  })
})
