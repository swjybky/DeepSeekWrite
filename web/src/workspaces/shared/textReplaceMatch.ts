/** 文本替换时的换行归一化 */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export type TextSpan = {
  start: number
  end: number
  matched: string
}

const DOUBLE_QUOTE_CHARS = '"\u201c\u201d\u300c\u300d\u300e\u300f\uff02'
const SINGLE_QUOTE_CHARS = "'\u2018\u2019\uff07"

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 为单个字符生成「等价字符类」正则片段，用于容忍引号/中英文标点差异 */
function flexibleCharPattern(ch: string): string {
  if (DOUBLE_QUOTE_CHARS.includes(ch)) {
    return `[${escapeRegExp(DOUBLE_QUOTE_CHARS)}]`
  }
  if (SINGLE_QUOTE_CHARS.includes(ch)) {
    return `[${escapeRegExp(SINGLE_QUOTE_CHARS)}]`
  }
  if (ch === '，' || ch === ',') return '[，,]'
  if (ch === '；' || ch === ';') return '[；;]'
  if (ch === '：' || ch === ':') return '[：:]'
  if (ch === '（' || ch === '(') return '[（(]'
  if (ch === '）' || ch === ')') return '[）)]'
  if (ch === '！' || ch === '!') return '[！!]'
  if (ch === '？' || ch === '?') return '[？?]'
  if (ch === '—' || ch === '–' || ch === '-' || ch === '−') {
    return '[—–\\-−]'
  }
  if (ch === '…') return '(?:…|\\.\\.\\.)'
  return escapeRegExp(ch)
}

function buildFlexiblePattern(needle: string): RegExp {
  const pattern = [...needle].map(flexibleCharPattern).join('')
  return new RegExp(pattern, 'g')
}

export function countExactOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let pos = 0
  while (pos <= haystack.length) {
    const found = haystack.indexOf(needle, pos)
    if (found === -1) break
    count += 1
    pos = found + needle.length
  }
  return count
}

/** 在正文中查找与 needle 等价（引号/常见标点容忍）的所有出现位置 */
export function findFlexibleOccurrences(haystack: string, needle: string): TextSpan[] {
  if (!needle) return []
  const re = buildFlexiblePattern(needle)
  const results: TextSpan[] = []
  let match: RegExpExecArray | null
  while ((match = re.exec(haystack)) !== null) {
    results.push({
      start: match.index,
      end: match.index + match[0].length,
      matched: match[0],
    })
    if (match[0].length === 0) {
      re.lastIndex += 1
    }
  }
  return results
}

function describeCharMismatch(needle: string, matched: string): string[] {
  const issues = new Set<string>()
  const needleHasAsciiDouble = needle.includes('"')
  const matchedHasCurlyDouble = /[\u201c\u201d\u300c\u300d]/.test(matched)
  if (needleHasAsciiDouble && matchedHasCurlyDouble) {
    issues.add('双引号样式不同（编辑区多为弯引号“”，工具参数里常会写成直引号"）')
  }
  const needleHasAsciiSingle = needle.includes("'")
  const matchedHasCurlySingle = /[\u2018\u2019]/.test(matched)
  if (needleHasAsciiSingle && matchedHasCurlySingle) {
    issues.add('单引号样式不同')
  }
  if (/，/.test(matched) && needle.includes(',')) {
    issues.add('逗号全角/半角不同')
  }
  if (/；/.test(matched) && needle.includes(';')) {
    issues.add('分号全角/半角不同')
  }
  if (needle.length === matched.length && needle !== matched && issues.size === 0) {
    issues.add('个别字符与编辑区不一致，请从 read_workspace_content 返回结果中复制')
  }
  return [...issues]
}

/** 匹配失败时，在正文中找最接近的片段供智能体纠错 */
export function suggestClosestFragment(
  haystack: string,
  needle: string,
  maxHint = 160,
): string | null {
  const trimmed = normalizeNewlines(needle).trim()
  if (trimmed.length < 8) return null

  const minLen = Math.min(20, trimmed.length)
  for (let len = trimmed.length; len >= minLen; len -= Math.max(1, Math.floor(len / 3))) {
    for (let offset = 0; offset <= trimmed.length - len; offset += 1) {
      const sub = trimmed.slice(offset, offset + len)
      const matches = findFlexibleOccurrences(haystack, sub)
      if (matches.length === 0) continue

      const span = matches[0]!
      const pad = 36
      const start = Math.max(0, span.start - pad)
      const end = Math.min(haystack.length, span.end + pad)
      let hint = haystack.slice(start, end)
      if (start > 0) hint = `…${hint}`
      if (end < haystack.length) hint = `${hint}…`
      if (hint.length > maxHint) hint = `${hint.slice(0, maxHint)}…`

      const issues = describeCharMismatch(trimmed, span.matched)
      if (issues.length > 0) {
        return `${hint}\n（可能差异：${issues.join('、')}）`
      }
      return hint
    }
  }
  return null
}

export type ResolveReplacementSpanResult =
  | { kind: 'ok'; span: TextSpan; usedFlexibleMatch: boolean }
  | { kind: 'error'; message: string }

/** 解析待替换片段在正文中的唯一位置：先精确匹配，再容忍引号/标点差异 */
export function resolveReplacementSpan(
  haystack: string,
  needle: string,
  itemName: string,
): ResolveReplacementSpanResult {
  const exactCount = countExactOccurrences(haystack, needle)
  if (exactCount === 1) {
    const start = haystack.indexOf(needle)
    return {
      kind: 'ok',
      span: { start, end: start + needle.length, matched: needle },
      usedFlexibleMatch: false,
    }
  }
  if (exactCount > 1) {
    return {
      kind: 'error',
      message:
        `${itemName}的 original_text 在当前阶段文本中出现了 ${exactCount} 次。请扩大原文片段，使其唯一后再替换。`,
    }
  }

  const flexible = findFlexibleOccurrences(haystack, needle)
  if (flexible.length === 1) {
    return { kind: 'ok', span: flexible[0]!, usedFlexibleMatch: true }
  }
  if (flexible.length > 1) {
    return {
      kind: 'error',
      message:
        `${itemName}的 original_text 经引号/标点归一化后仍匹配到 ${flexible.length} 处。请扩大原文片段，使其唯一后再替换。`,
    }
  }

  const hint = suggestClosestFragment(haystack, needle)
  let message =
    `${itemName}的 original_text 未在当前阶段文本中找到。`
    + '请先调用 read_workspace_content 读取当前阶段，从工具返回的正文中原样复制需替换的片段（不要从对话摘要或旧版本抄写）。'
    + '注意 JSON 参数里的直引号 " 与编辑区弯引号 “” 不同；系统已自动容忍常见引号/标点差异，若仍失败说明片段内容本身不一致。'
  if (hint) {
    message += `\n编辑区中最接近的片段：${hint}`
  }
  return { kind: 'error', message }
}

export function applyTextSpanReplacement(
  haystack: string,
  span: TextSpan,
  newText: string,
): string {
  return haystack.slice(0, span.start) + newText + haystack.slice(span.end)
}
