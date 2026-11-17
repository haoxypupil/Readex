import { useRef, useState } from 'react'
import { BookOpen, Search } from 'lucide-react'
import type { BookRecord, ReadingLocator, SearchResult } from '@shared/types'
import { bookFormatLabel } from '../lib/format'

interface SearchViewProps {
  books: BookRecord[]
  onOpenBook: (bookId: string, locator: ReadingLocator) => void
}

export function SearchView({ books, onOpenBook }: SearchViewProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState('')
  const requestRef = useRef(0)

  const run = async (): Promise<void> => {
    const value = query.trim()
    if (!value) {
      setResults([])
      setSearched('')
      return
    }
    const token = ++requestRef.current
    setSearching(true)
    try {
      const found = await window.readex.search.globalText(value)
      if (token !== requestRef.current) return
      setResults(found)
      setSearched(value)
    } finally {
      if (token === requestRef.current) setSearching(false)
    }
  }

  return (
    <main className="notes-dashboard search-view">
      <header>
        <p className="eyebrow">跨书全文检索</p>
        <h1>全文搜索</h1>
        <p>搜索已导入书库的正文，支持 EPUB、TXT、MOBI 和 AZW3；PDF 和 CBZ 请打开书籍后使用书内搜索。</p>
      </header>

      <div className="fulltext-searchbar">
        <label className="search-field">
          <Search size={16} />
          <input
            value={query}
            placeholder="输入关键词，按 Enter 搜索"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void run()
              }
            }}
          />
        </label>
        <button
          className="primary-button"
          type="button"
          disabled={searching || !query.trim()}
          onClick={() => void run()}
        >
          {searching ? '正在搜索…' : '搜索正文'}
        </button>
      </div>

      {searching ? (
        <section className="empty-notes">
          <Search size={30} />
          <h2>正在检索书库</h2>
          <p>首次搜索 EPUB 时需要先提取正文，大文件可能稍慢。</p>
        </section>
      ) : results.length > 0 ? (
        <>
          <div className="fulltext-summary">
            找到 {results.length} 条结果
            {results.length >= 200 ? '（仅显示前 200 条）' : ''}
          </div>
          <section className="fulltext-results">
            {results.map((result) => {
              const book = books.find((item) => item.id === result.bookId)
              return (
                <article key={result.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (result.bookId && result.locator) onOpenBook(result.bookId, result.locator)
                    }}
                  >
                    <span className="fulltext-book">
                      <BookOpen size={13} />
                      {result.bookTitle ?? '未知书籍'}
                      {book && <em>{bookFormatLabel(book.format)}</em>}
                    </span>
                    <strong>{result.title}</strong>
                    <span className="fulltext-excerpt">{result.excerpt}</span>
                  </button>
                </article>
              )
            })}
          </section>
        </>
      ) : searched ? (
        <section className="empty-notes">
          <Search size={30} />
          <h2>没有找到“{searched}”</h2>
          <p>可以尝试更短的关键词，或确认书籍已经完成导入。</p>
        </section>
      ) : (
        <section className="empty-notes">
          <Search size={30} />
          <h2>搜索整个书库</h2>
          <p>输入关键词后按 Enter。结果会定位到对应章节或文本位置。</p>
        </section>
      )}
    </main>
  )
}
