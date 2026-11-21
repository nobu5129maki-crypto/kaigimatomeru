export type LengthId = 'c100' | 'c200' | 'c400' | 'c800' | 'a4'
export type StyleId = 'memo' | 'news' | 'politics' | 'minutes' | 'mail'

export const LENGTHS: Record<
  LengthId,
  { label: string; hint: string; target: number; min: number; max: number }
> = {
  c100: { label: '100文字程度', hint: '一声で伝わる長さ', target: 100, min: 70, max: 140 },
  c200: { label: '200文字程度', hint: '短い連絡に足りる長さ', target: 200, min: 150, max: 260 },
  c400: { label: '400文字程度', hint: '段落が2つほどの長さ', target: 400, min: 300, max: 500 },
  c800: { label: '800文字程度', hint: '経緯が残る長さ', target: 800, min: 620, max: 980 },
  a4: { label: 'A4用紙一枚', hint: '印刷すると1枚に収まる長さ', target: 1050, min: 820, max: 1200 },
}

export const STYLES: Record<StyleId, { label: string; hint: string }> = {
  memo: { label: '読みやすいメモ', hint: '話した順に、要点だけを残します' },
  news: { label: '新聞記事', hint: '見出しとリード、そのあとに本文です' },
  politics: { label: '政治記者風', hint: '決まったこと、論点、このあとに分けます' },
  minutes: { label: '議事録', hint: '決定・宿題・確認・次回に分けます' },
  mail: { label: '社内連絡', hint: '件名つきで、そのまま送れる形です' },
}

export type SummarizeInput = {
  text: string
  title: string
  date: string
  attendees: string
  length: LengthId
  style: StyleId
}

export type SummaryBlock = {
  heading: string
  lines: string[]
}

export type SummaryResult = {
  title: string
  headline: string
  dateline: string
  attendees: string
  blocks: SummaryBlock[]
  plain: string
  charCount: number
  target: number
  min: number
  max: number
  note: string
  style: StyleId
  length: LengthId
  styleLabel: string
  lengthLabel: string
}

type Kind = 'decision' | 'action' | 'issue' | 'schedule' | 'fact'

type Unit = {
  index: number
  text: string
  kind: Kind
  score: number
}

const KIND_WEIGHT: Record<Kind, number> = {
  decision: 8,
  action: 6,
  issue: 5,
  schedule: 5,
  fact: 2,
}

export function charCount(text: string): number {
  return Array.from(text.replace(/[\s　]/g, '')).length
}

export function formatJapaneseDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!match) return iso.trim()
  return `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日`
}

export function summarize(input: SummarizeInput): SummaryResult {
  const length = LENGTHS[input.length]
  const style = STYLES[input.style]
  const title = input.title.trim()
  const attendees = input.attendees.trim()
  const dateline = formatJapaneseDate(input.date)
  const units = scoreUnits(splitUnits(input.text))
  const base = {
    title: title || '会議まとめ',
    dateline,
    attendees,
    target: length.target,
    min: length.min,
    max: length.max,
    style: input.style,
    length: input.length,
    styleLabel: style.label,
    lengthLabel: length.label,
  }

  if (units.length === 0) {
    return {
      ...base,
      headline: '',
      blocks: [],
      plain: '',
      charCount: 0,
      note: 'まとめられる文章がありません。録音するか、文字を貼り付けてください。',
    }
  }

  const fitted = fitUnits(units, input.style, title, length.max, length.min, length.target)
  let note = ''
  if (fitted.charCount < length.min) {
    note = '原稿が短いため、指定より短くなっています。話していないことは足していません。'
  }
  return {
    ...base,
    headline: fitted.headline,
    blocks: fitted.blocks,
    plain: fitted.plain,
    charCount: fitted.charCount,
    note,
    title: title || fitted.headline || '会議まとめ',
  }
}

export function documentText(doc: SummaryResult): string {
  const lines: string[] = []
  lines.push(doc.title)
  if (doc.dateline) lines.push(doc.dateline)
  if (doc.attendees) lines.push(`出席：${doc.attendees}`)
  lines.push(`まとめ方：${doc.styleLabel}／${doc.lengthLabel}`)
  lines.push('')
  if (doc.headline && doc.headline !== doc.title) lines.push(doc.headline)
  for (const block of doc.blocks) {
    if (block.heading) {
      lines.push('')
      lines.push(block.heading)
    }
    for (const line of block.lines) lines.push(line)
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

function splitUnits(text: string): string[] {
  const cleaned = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').trim()
  if (!cleaned) return []
  const units: string[] = []
  for (const rawLine of cleaned.split('\n')) {
    const line = rawLine.trim()
    if (!line || !hasWords(line)) continue
    if (charCount(line) <= 160) {
      units.push(line)
      continue
    }
    const speaker = line.match(/^([^：:\n]{1,16})[：:]/)?.[1]
    const parts = line.split(/(?<=[。！？!?])/).flatMap((part) => {
      if (charCount(part) <= 180 || !part.includes('、')) return [part]
      return part.split('、').map((bit, index, all) => (index < all.length - 1 ? `${bit}、` : bit))
    })
    for (const part of parts) {
      let piece = part.trim()
      if (!hasWords(piece)) continue
      if (speaker && !piece.startsWith(`${speaker}：`) && !piece.startsWith(`${speaker}:`)) {
        piece = `${speaker}：${piece}`
      }
      units.push(piece)
    }
  }
  return units.slice(0, 400)
}

function hasWords(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text)
}

function classify(text: string): Kind {
  const body = text.replace(/^[^：:\n]{1,16}[：:]/, '')
  if (/決定は|決定事項|に決定|を決定|で決定|承認|了承|合意|可決|賛成|進める|見直す|で売り|優先します/.test(body)) return 'decision'
  if (/宿題|担当|お願い|私が|共有|作成|修正|準備|送付|終えます|置きます|明記/.test(body)) return 'action'
  if (/課題|懸念|問題|リスク|反対|保留|難しい|未定|分かれ|厳しい|赤字|受けません|決めません/.test(body)) return 'issue'
  if (/次回|来週|来月|日程|締め切り|期限|までに|出荷|入庫/.test(body)) return 'schedule'
  return 'fact'
}

function scoreUnits(texts: string[]): Unit[] {
  return texts.map((text, index) => {
    const kind = classify(text)
    let score = KIND_WEIGHT[kind]
    if (/\d/.test(text)) score += 1
    if (/決定は|決定事項|保留/.test(text)) score += 2
    if (index >= texts.length - 2) score += 1
    const len = charCount(text)
    if (len < 8) score -= 3
    if (len > 220) score -= 1
    if (/^(えーと|あの|はい|うん|そうですね)[。、！？!?]*$/.test(text.replace(/^[^：:]{1,16}[：:]/, ''))) {
      score -= 5
    }
    return { index, text, kind, score }
  })
}

function fitUnits(
  units: Unit[],
  style: StyleId,
  title: string,
  max: number,
  min: number,
  target: number,
): { headline: string; blocks: SummaryBlock[]; plain: string; charCount: number } {
  const ranked = [...units].sort((a, b) => b.score - a.score || a.index - b.index)
  let chosen: Unit[] = []

  const over = (list: Unit[]) => renderedCount(style, list, title) > max

  for (const unit of ranked) {
    if (chosen.some((item) => tooSimilar(item.text, unit.text, max))) continue
    const trial = [...chosen, unit]
    if (over(trial)) continue
    chosen.push(unit)
    if (renderedCount(style, chosen, title) >= target) break
  }

  if (chosen.length === 0 && ranked[0]) {
    chosen = [shrinkUnit(ranked[0], style, title, max)]
  }

  if (renderedCount(style, chosen, title) < min) {
    for (const unit of ranked) {
      if (chosen.some((item) => item.index === unit.index)) continue
      const trial = [...chosen, unit]
      if (over(trial)) continue
      chosen.push(unit)
      if (renderedCount(style, chosen, title) >= min) break
    }
  }

  if (renderedCount(style, chosen, title) < min) {
    const room = max - renderedCount(style, chosen, title)
    if (room >= 24) {
      for (const unit of ranked) {
        if (chosen.some((item) => item.index === unit.index)) continue
        const piece = trimToCount(ensurePeriod(unit.text), room)
        if (charCount(piece) < 16) continue
        const trial = [...chosen, { ...unit, text: piece, score: unit.score - 0.1 }]
        if (over(trial)) continue
        chosen = trial
        break
      }
    }
  }

  chosen.sort((a, b) => a.index - b.index)
  let body = render(style, chosen, title)
  let guard = 0
  while (charCount(body.plain) > max && chosen.length > 1 && guard < 80) {
    guard += 1
    let low = 0
    for (let i = 1; i < chosen.length; i += 1) {
      if (chosen[i].score < chosen[low].score) low = i
    }
    chosen.splice(low, 1)
    chosen.sort((a, b) => a.index - b.index)
    body = render(style, chosen, title)
  }

  if (charCount(body.plain) > max && chosen[0]) {
    chosen[0] = shrinkUnit(chosen[0], style, title, max)
    body = render(style, chosen, title)
  }
  if (charCount(body.plain) > max) body = forceTrim(body, max)
  return body
}

function shrinkUnit(unit: Unit, style: StyleId, title: string, max: number): Unit {
  const empty = render(style, [], title)
  const room = Math.max(20, max - charCount(empty.plain) - 8)
  return { ...unit, text: trimToCount(ensurePeriod(unit.text), room) }
}

function renderedCount(style: StyleId, units: Unit[], title: string): number {
  return charCount(render(style, units, title).plain)
}

function render(
  style: StyleId,
  units: Unit[],
  title: string,
): { headline: string; blocks: SummaryBlock[]; plain: string; charCount: number } {
  if (style === 'news') return finish(renderNews(units))
  if (style === 'politics') return finish(renderPolitics(units))
  if (style === 'minutes') return finish(renderMinutes(units))
  if (style === 'mail') return finish(renderMail(units, title))
  return finish(renderMemo(units))
}

function finish(body: { headline: string; blocks: SummaryBlock[] }): {
  headline: string
  blocks: SummaryBlock[]
  plain: string
  charCount: number
} {
  const plain = plainFrom(body.headline, body.blocks)
  return { ...body, plain, charCount: charCount(plain) }
}

function renderMemo(units: Unit[]): { headline: string; blocks: SummaryBlock[] } {
  return {
    headline: '',
    blocks: units.length ? [{ heading: '要点', lines: units.map((unit) => ensurePeriod(unit.text)) }] : [],
  }
}

function renderNews(units: Unit[]): { headline: string; blocks: SummaryBlock[] } {
  const best = pickHeadlineSource(units)
  const headline = best ? headlineFrom(best.text) : '会議のまとめ'
  const ordered = [...units].sort((a, b) => a.index - b.index)
  const lead = best ?? ordered[0]
  const rest = lead ? ordered.filter((unit) => unit.index !== lead.index) : ordered
  const lines = [lead, ...rest].filter((unit): unit is Unit => Boolean(unit)).map((unit) => ensurePeriod(unit.text))
  const blocks: SummaryBlock[] = []
  if (lines[0]) blocks.push({ heading: '', lines: [lines[0]] })
  if (lines.length > 1) blocks.push({ heading: '', lines: lines.slice(1) })
  return { headline, blocks }
}

function renderPolitics(units: Unit[]): { headline: string; blocks: SummaryBlock[] } {
  const best = pickHeadlineSource(units)
  const headline = best ? headlineFrom(best.text) : '会議のまとめ'
  const order: [Kind, string][] = [
    ['decision', '決まったこと'],
    ['issue', '論点'],
    ['action', '宿題'],
    ['schedule', 'このあと'],
    ['fact', '確認されたこと'],
  ]
  const blocks: SummaryBlock[] = []
  for (const [kind, heading] of order) {
    const lines = units.filter((unit) => unit.kind === kind).map((unit) => ensurePeriod(unit.text))
    if (lines.length > 0) blocks.push({ heading, lines })
  }
  if (blocks.length === 0 && units.length > 0) {
    blocks.push({ heading: '確認されたこと', lines: units.map((unit) => ensurePeriod(unit.text)) })
  }
  return { headline, blocks }
}

function renderMinutes(units: Unit[]): { headline: string; blocks: SummaryBlock[] } {
  const order: [Kind, string][] = [
    ['decision', '決定事項'],
    ['action', '宿題'],
    ['issue', '保留・懸念'],
    ['schedule', '次回'],
    ['fact', '確認事項'],
  ]
  const blocks: SummaryBlock[] = []
  for (const [kind, heading] of order) {
    const lines = units.filter((unit) => unit.kind === kind).map((unit) => ensurePeriod(unit.text))
    if (lines.length > 0) blocks.push({ heading, lines })
  }
  if (blocks.length === 0 && units.length > 0) {
    blocks.push({ heading: '確認事項', lines: units.map((unit) => ensurePeriod(unit.text)) })
  }
  return { headline: '', blocks }
}

function renderMail(units: Unit[], title: string): { headline: string; blocks: SummaryBlock[] } {
  const best = pickHeadlineSource(units)
  const headline = title.trim() || (best ? headlineFrom(best.text) : '会議の連絡')
  const lines = units.map((unit) => ensurePeriod(unit.text))
  if (lines.length > 0) {
    lines.unshift('会議の要点を共有します。')
    lines.push('以上です。')
  }
  return { headline, blocks: lines.length ? [{ heading: '', lines }] : [] }
}

function tooSimilar(a: string, b: string, max: number): boolean {
  const jac = jaccard(a, b)
  if (jac > (max <= 280 ? 0.42 : 0.78)) return true
  if (max > 280) return false
  const left = longDigits(a)
  let shared = 0
  for (const value of longDigits(b)) if (left.has(value)) shared += 1
  return shared >= 2 && jac > 0.12
}

function longDigits(text: string): Set<string> {
  return new Set(
    [...text.matchAll(/\d[\d,]*/g)].map((match) => match[0].replace(/,/g, '')).filter((value) => value.length >= 3),
  )
}

function pickHeadlineSource(units: Unit[]): Unit | undefined {
  return [...units].sort((a, b) => b.score - a.score || a.index - b.index)[0]
}

function plainFrom(headline: string, blocks: SummaryBlock[]): string {
  const parts: string[] = []
  if (headline) parts.push(headline)
  for (const block of blocks) {
    if (block.heading) parts.push(block.heading)
    parts.push(...block.lines)
  }
  return parts.join('\n').trim()
}

function forceTrim(
  body: { headline: string; blocks: SummaryBlock[]; plain: string; charCount: number },
  max: number,
): { headline: string; blocks: SummaryBlock[]; plain: string; charCount: number } {
  const blocks = body.blocks.map((block) => ({ heading: block.heading, lines: [...block.lines] }))
  let headline = body.headline
  const current = () => finish({ headline, blocks })
  let guard = 0
  while (current().charCount > max && guard < 100) {
    guard += 1
    const block = [...blocks].reverse().find((item) => item.lines.length > 0)
    if (!block) {
      headline = trimToCount(headline, max)
      break
    }
    if (block.lines.length > 1) {
      block.lines.pop()
      continue
    }
    const room = Math.max(12, max - (current().charCount - charCount(block.lines[0])))
    const trimmed = trimToCount(block.lines[0], room)
    if (trimmed === block.lines[0] || charCount(trimmed) >= charCount(block.lines[0])) {
      block.lines.pop()
      if (!block.heading && block.lines.length === 0) {
        const index = blocks.indexOf(block)
        if (index >= 0) blocks.splice(index, 1)
      }
      continue
    }
    block.lines[0] = trimmed
  }
  const blocksLeft = blocks.filter((block) => block.heading || block.lines.length > 0)
  return finish({ headline, blocks: blocksLeft })
}

export function trimToCount(text: string, max: number): string {
  if (charCount(text) <= max) return text
  const limit = Math.max(1, max - 1)
  const kept: string[] = []
  let count = 0
  for (const ch of Array.from(text)) {
    if (!/[\s　]/.test(ch)) count += 1
    if (count > limit) break
    kept.push(ch)
  }
  let sliced = kept.join('').replace(/[\s　]+$/g, '')
  const boundary = Math.max(sliced.lastIndexOf('、'), sliced.lastIndexOf('。'), sliced.lastIndexOf('，'))
  if (boundary >= Math.floor(Array.from(sliced).length * 0.45)) {
    sliced = sliced.slice(0, boundary)
  }
  sliced = sliced.replace(/[。！？!?…、，,\s　]+$/g, '')
  if (!sliced) return Array.from(text).slice(0, limit).join('')
  return `${sliced}…`
}

function headlineFrom(text: string): string {
  let body = text.replace(/^[^：:\n]{1,16}[：:]/, '').trim()
  body = body.replace(/[。！？!?]+$/g, '')
  body = body.replace(/^決定(?:は|事項は)[、,]/, '')
  if (charCount(body) <= 28) return body || '会議のまとめ'
  const chars = Array.from(body)
  const slice = chars.slice(0, 28).join('')
  let cut = -1
  for (let i = slice.length - 1; i >= 10; i -= 1) {
    if ('、はがをにへとで'.includes(slice[i] ?? '')) {
      cut = i
      break
    }
  }
  const head = (cut > 0 ? slice.slice(0, cut) : slice).replace(/[、，,\s　]+$/g, '')
  return head || '会議のまとめ'
}

function ensurePeriod(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  if (/[。！？!?…]$/.test(trimmed)) return trimmed
  return `${trimmed}。`
}

function jaccard(a: string, b: string): number {
  const left = bigrams(a)
  const right = bigrams(b)
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const gram of left) if (right.has(gram)) shared += 1
  return shared / (left.size + right.size - shared)
}

function bigrams(text: string): Set<string> {
  const compact = text.replace(/[\s　]/g, '')
  const grams = new Set<string>()
  const chars = Array.from(compact)
  for (let i = 0; i < chars.length - 1; i += 1) grams.add(chars[i] + chars[i + 1])
  return grams
}
