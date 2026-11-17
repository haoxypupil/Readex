import { describe, expect, it } from 'vitest'
import { normalizeBookTags } from '../../src/shared/bookTags'

describe('book tag normalization', () => {
  it('accepts comma separated text and removes duplicates', () => {
    expect(normalizeBookTags(' 技术，待读, 技术 ,, ')).toEqual(['技术', '待读'])
  })

  it('trims tags, skips empty values and truncates long names', () => {
    expect(normalizeBookTags(['  a  b ', '', 'c'.repeat(40)])).toEqual([
      'a b',
      'c'.repeat(24)
    ])
  })

  it('keeps at most eight tags', () => {
    expect(normalizeBookTags(Array.from({ length: 12 }, (_, index) => `t${index}`))).toHaveLength(8)
  })
})
