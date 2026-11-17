/** 在元素内按“忽略空白”的方式查找文本并返回首个 Range。 */
export function findTextRange(root: HTMLElement, query: string): Range | null {
  const target = query.replace(/\s+/g, '')
  if (!target) return null

  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent || ['SCRIPT', 'STYLE'].includes(parent.tagName)) {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    }
  })

  const nodes: Text[] = []
  let text = ''
  let node: Node | null = walker.nextNode()
  while (node) {
    const textNode = node as Text
    nodes.push(textNode)
    text += textNode.data
    node = walker.nextNode()
  }

  let plain = ''
  const originalIndexes: number[] = []
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (/\s/.test(character)) continue
    plain += character
    originalIndexes.push(index)
  }

  const plainStart = plain.indexOf(target)
  if (plainStart < 0) return null
  const startOffset = originalIndexes[plainStart]
  const endOffset = originalIndexes[plainStart + target.length - 1] + 1

  let consumed = 0
  let startNode: Text | null = null
  let startInNode = 0
  let endNode: Text | null = null
  let endInNode = 0
  for (const textNode of nodes) {
    const length = textNode.data.length
    if (!startNode && startOffset < consumed + length) {
      startNode = textNode
      startInNode = startOffset - consumed
    }
    if (endOffset <= consumed + length) {
      endNode = textNode
      endInNode = endOffset - consumed
      break
    }
    consumed += length
  }
  if (!startNode || !endNode) return null

  const range = root.ownerDocument.createRange()
  range.setStart(startNode, startInNode)
  range.setEnd(endNode, endInNode)
  return range
}
