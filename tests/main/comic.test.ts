import { describe, expect, it } from 'vitest'
import { isComicImagePath, sortComicImages } from '../../src/main/comic'

describe('comic image entries', () => {
  it('accepts common image extensions and ignores metadata files', () => {
    expect(isComicImagePath('chapter/001.jpg')).toBe(true)
    expect(isComicImagePath('002.PNG')).toBe(true)
    expect(isComicImagePath('003.avif')).toBe(true)
    expect(isComicImagePath('__MACOSX/._001.jpg')).toBe(false)
    expect(isComicImagePath('chapter/.hidden.jpg')).toBe(false)
    expect(isComicImagePath('readme.txt')).toBe(false)
  })

  it('sorts pages naturally instead of lexicographically', () => {
    const sorted = sortComicImages([
      { name: '10.jpg' },
      { name: '2.jpg' },
      { name: '1.jpg' }
    ])
    expect(sorted.map((item) => item.name)).toEqual(['1.jpg', '2.jpg', '10.jpg'])
  })
})
