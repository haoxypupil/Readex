import { describe, expect, it } from 'vitest'
import { buildPdfOutlineToc } from '../../src/renderer/src/lib/pdfOutline'

describe('PDF outline mapping', () => {
  it('maps resolved outlines into a toc tree with page targets', () => {
    const toc = buildPdfOutlineToc([
      { title: '第一章', page: 3, items: [{ title: '  第一节  ', page: 5 }] },
      { title: '附录', page: null, items: [{ title: '附录A', page: 40 }] }
    ])

    expect(toc.map((item) => item.label)).toEqual(['第一章', '附录'])
    expect(toc[0].chapterId).toBe('3')
    expect(toc[0].children?.[0]).toMatchObject({ label: '第一节', chapterId: '5' })
    expect(toc[1].children?.[0]).toMatchObject({ label: '附录A', chapterId: '40' })
  })

  it('drops entries without pages or children and trims long titles', () => {
    const toc = buildPdfOutlineToc([
      { title: '', page: null },
      { title: 'x'.repeat(200), page: 12 },
      { title: '无页码', page: null, items: [] }
    ])

    expect(toc).toHaveLength(1)
    expect(toc[0].label).toHaveLength(120)
    expect(toc[0].chapterId).toBe('12')
  })

  it('keeps page-less headings when they still contain children', () => {
    const toc = buildPdfOutlineToc([
      { title: '前言部分', page: null, items: [{ title: '致谢', page: 2 }] }
    ])
    expect(toc).toHaveLength(1)
    expect(toc[0].chapterId).toBeUndefined()
    expect(toc[0].children?.[0]?.chapterId).toBe('2')
  })
})
