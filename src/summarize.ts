import { chooseWords } from './wordChoice'

export type LengthId = 'c100' | 'c200' | 'c400' | 'c800' | 'a4' | 'c2000' | 'c4000' | 'point'
export type StyleId =
  | 'titled'
  | 'bullets'
  | 'titledList'
  | 'lead'
  | 'timeline'
  | 'contrast'
  | 'todo'
  | 'flash'
  | 'fivew'
  | 'report'
  | 'memo'
  | 'news'
  | 'politics'
  | 'minutes'
  | 'mail'
  | 'point'
export type StyleGroup = 'shape' | 'voice' | 'record' | 'live'

export const LENGTHS: Record<
  LengthId,
  { label: string; hint: string; target: number; min: number; max: number }
> = {
  c100: { label: '100文字程度', hint: '一声で伝わる長さ', target: 100, min: 70, max: 140 },
  c200: { label: '200文字程度', hint: '短い連絡に足りる長さ', target: 200, min: 150, max: 260 },
  c400: { label: '400文字程度', hint: '段落が2つほどの長さ', target: 400, min: 300, max: 500 },
  c800: { label: '800文字程度', hint: '30分までの経緯が残る長さ', target: 800, min: 620, max: 980 },
  a4: { label: 'A4用紙一枚', hint: '印刷すると1枚に収まる長さ', target: 1050, min: 820, max: 1200 },
  c2000: { label: '2,000文字程度', hint: '1時間を、読んで渡せる長さ', target: 2000, min: 1600, max: 2400 },
  c4000: { label: '4,000文字程度', hint: '論点まで残す詳しい記録', target: 4000, min: 3200, max: 4800 },
  point: { label: '要は、何が言いたい？', hint: '言いたいことを短く箇条書きにします', target: 160, min: 1, max: 260 },
}

export const STYLE_GROUPS: { id: StyleGroup; label: string }[] = [
  { id: 'shape', label: '形' },
  { id: 'voice', label: '文章の調子' },
  { id: 'record', label: '記録の型' },
]

export const STYLES: Record<StyleId, { label: string; hint: string; group: StyleGroup }> = {
  titled: { label: '見出しをつける', hint: 'タイトルをつけ、候補を3つ出します', group: 'shape' },
  bullets: { label: '箇条書き', hint: '一つのことずつ、行を分けます', group: 'shape' },
  titledList: { label: '見出しと箇条書き', hint: '見出しの下を、項目だけで読みます', group: 'shape' },
  lead: { label: '結論からはじめる', hint: '最初に決まったこと、あとから経緯です', group: 'shape' },
  timeline: { label: '時系列', hint: '話の流れが分かる順で残します', group: 'shape' },
  contrast: { label: '賛成と懸念', hint: 'まとまったことと、残った不安を分けます', group: 'shape' },
  todo: { label: 'やること', hint: '誰が何をするかを項目にします', group: 'shape' },
  flash: { label: '速報', hint: '見出しと、いま分かっている要点です', group: 'shape' },
  fivew: { label: '5W1H', hint: '何を、なぜ、いつ、どこで、どのようにに分けます', group: 'shape' },
  report: { label: '報告書', hint: '要旨、本文、このあとの三段です', group: 'shape' },
  news: { label: '新聞記事', hint: '見出し、リード、本文の順です', group: 'voice' },
  politics: { label: '政治記者風', hint: '決まったこと、論点、このあとに分けます', group: 'voice' },
  memo: { label: '読みやすいメモ', hint: '話した順に、要点だけを残します', group: 'voice' },
  minutes: { label: '議事録', hint: '決定・宿題・確認・次回に分けます', group: 'record' },
  mail: { label: '社内連絡', hint: '件名つきで、そのまま送れる形です', group: 'record' },
  point: { label: '要は、何が言いたい？', hint: '長い話を、言いたいことの箇条書きにします', group: 'live' },
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
  list?: boolean
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

export function orderStyles(styles: StyleId[]): StyleId[] {
  const rank = new Map((Object.keys(STYLES) as StyleId[]).map((id, index) => [id, index]))
  return [...styles].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0))
}

function normalizeStyles(styles: StyleId[] | undefined, fallback: StyleId): StyleId[] {
  const list = (styles ?? []).filter((id) => id in STYLES)
  return list.length ? orderStyles(list) : [fallback]
}

export function summarize(input: SummarizeInput & { styles?: StyleId[] }): SummaryResult {
  const text = chooseWords(input.text)
  const result = summarizeChosen({ ...input, text })
  if (text === input.text || result.charCount === 0) return result
  const extra = '音の近い語は、前後の文から選びました。'
  return { ...result, note: result.note ? `${result.note}${extra}` : extra }
}

function summarizeChosen(input: SummarizeInput & { styles?: StyleId[] }): SummaryResult {
  const chosen = normalizeStyles(input.styles, input.style).filter((id, index, all) => all.indexOf(id) === index)
  const withPoint =
    input.length === 'point' && !chosen.includes('point') ? orderStyles([...chosen, 'point']) : chosen
  if (withPoint.length > 1) return summarizeShapes(input, withPoint)
  if (withPoint[0] === 'point' || input.length === 'point') return summarizePoint(input)
  return summarizeSingle({ ...input, style: withPoint[0] })
}

function summarizeSingle(input: SummarizeInput): SummaryResult {
  if (input.style === 'point') return summarizePoint(input)
  const length = LENGTHS[input.length]
  const style = STYLES[input.style]
  const title = input.title.trim()
  const attendees = input.attendees.trim()
  const dateline = formatJapaneseDate(input.date)
  const units = scoreUnits(splitUnits(input.text), input.style)
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

function summarizeShapes(input: SummarizeInput, shapes: StyleId[]): SummaryResult {
  const length = LENGTHS[input.length]
  const title = input.title.trim()
  const share = shapes.length
  const sliceMax = Math.max(70, Math.floor(length.max / share))
  const sliceTarget = Math.max(40, Math.floor(length.target / share))
  const sliceMin = Math.min(sliceTarget, Math.max(24, Math.floor(length.min / share)))
  const source = splitUnits(input.text)
  const used = new Set<number>()
  const blocks: SummaryBlock[] = []
  let headline = ''
  for (const style of shapes) {
    const all = scoreUnits(source, style)
    const fresh = all.filter((unit) => !used.has(unit.index))
    const scored = fresh.length ? fresh : all
    if (scored.length === 0) continue
    const fitted = fitUnits(scored, style, title, sliceMax, sliceMin, sliceTarget)
    if (fitted.charCount === 0) continue
    if (!headline && fitted.headline && fitted.headline !== title) headline = fitted.headline
    const plain = fitted.plain.replace(/\s/g, '')
    for (const unit of scored) {
      const core = unit.text.replace(/\s/g, '').slice(0, 18)
      if (core.length >= 8 && plain.includes(core)) used.add(unit.index)
    }
    fitted.blocks.forEach((block, index) => {
      const label = STYLES[style].label
      const own = block.heading && block.heading !== label ? `${label}　${block.heading}` : label
      blocks.push({
        ...block,
        heading: index === 0 ? own : block.heading,
      })
    })
  }
  const body = blocks.length ? forceTrim(finish({ headline, blocks }), length.max) : finish({ headline: '', blocks: [] })
  let note = ''
  if (body.charCount > 0 && body.charCount < length.min) {
    note = '原稿が短いため、指定より短くなっています。話していないことは足していません。'
  }
  return {
    title: title || headline || '会議まとめ',
    headline,
    dateline: formatJapaneseDate(input.date),
    attendees: input.attendees.trim(),
    blocks: body.blocks,
    plain: body.plain,
    charCount: body.charCount,
    target: length.target,
    min: length.min,
    max: length.max,
    note,
    style: shapes[0] === 'point' && shapes.length > 1 ? shapes.find((id) => id !== 'point') ?? 'point' : shapes[0],
    length: input.length,
    styleLabel: shapes
      .filter((id) => !(input.length === 'point' && id === 'point'))
      .map((id) => STYLES[id].label)
      .join('、') || STYLES.point.label,
    lengthLabel: length.label,
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
    for (const line of block.lines) lines.push(block.list ? `・${line}` : line)
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
  return units.slice(0, 800)
}

function hasWords(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text)
}

type TalkTurn = { speaker: string; body: string; chars: number }

function summarizePoint(input: SummarizeInput): SummaryResult {
  const title = input.title.trim()
  const attendees = input.attendees.trim()
  const dateline = formatJapaneseDate(input.date)
  const turn = longAnswer(input.text)
  const spoken = scoreUnits(pointSentences(turn.body), 'point')
  const kept = spoken.filter((unit) => !isFiller(unit.text))
  const units = kept.length > 0 ? kept : spoken
  const length = input.length === 'point' ? LENGTHS.point : null
  const base = {
    title: title || (turn.speaker ? `${turn.speaker}の話` : 'インタビュー'),
    dateline,
    attendees,
    target: length?.target ?? 160,
    min: length?.min ?? 1,
    max: length?.max ?? 260,
    style: 'point' as const,
    length: input.length,
    styleLabel: STYLES.point.label,
    lengthLabel: length?.label ?? '要点だけ',
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
  const fitted = fitUnits(units, 'point', base.title, base.max, base.min, base.target)
  const whose = turn.speaker ? `${turn.speaker}の話を、` : ''
  return {
    ...base,
    headline: fitted.headline,
    blocks: fitted.blocks,
    plain: fitted.plain,
    charCount: fitted.charCount,
    note: `${whose}言いたいことだけを箇条書きにしました。`,
    title: title || base.title,
  }
}

function longAnswer(text: string): TalkTurn {
  const turns = speakerTurns(text)
  if (turns.length === 0) return { speaker: '', body: '', chars: 0 }
  const answers = turns.filter((turn) => !isShortQuestion(turn.body))
  const pool = answers.length > 0 ? answers : turns
  for (let i = pool.length - 1; i >= 0; i -= 1) {
    if (pool[i].chars >= 70) return pool[i]
  }
  return pool.reduce((best, turn) => (turn.chars > best.chars ? turn : best))
}

function speakerTurns(text: string): TalkTurn[] {
  const cleaned = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  if (!cleaned) return []
  const turns: TalkTurn[] = []
  for (const rawLine of cleaned.split('\n')) {
    const line = rawLine.trim()
    if (!line || !hasWords(line)) continue
    const match = /^([^：:\n]{1,16})[：:]/.exec(line)
    const speaker = match?.[1] ?? ''
    const last = turns[turns.length - 1]
    if (last && speaker && last.speaker === speaker) {
      last.body = `${last.body}\n${line}`
    } else if (last && !speaker) {
      last.body = `${last.body}\n${line}`
    } else {
      turns.push({ speaker, body: line, chars: 0 })
    }
  }
  for (const turn of turns) turn.chars = charCount(turn.body)
  return turns
}

function isShortQuestion(body: string): boolean {
  const spoken = spokenBody(body)
  return charCount(spoken) <= 40 && /[？?]$/.test(spoken)
}

function spokenBody(text: string): string {
  return text.replace(/^[^：:\n]{1,16}[：:]/, '').trim()
}

function pointSentences(body: string): string[] {
  const spoken = body
    .split('\n')
    .map((line) => spokenBody(line).trim())
    .filter((line) => hasWords(line))
    .join('')
  return spoken
    .split(/(?<=[。！？!?])/)
    .map((piece) => piece.trim())
    .filter((piece) => hasWords(piece))
}

function isFiller(text: string): boolean {
  const body = spokenBody(text).replace(/[。、！？!?\s　]/g, '')
  return /^(えーと|あのー|あの|はい|うん|ええ|そうですね)+$/.test(body)
}

function pointBonus(text: string, index: number, total: number): number {
  const body = spokenBody(text)
  let bonus = 0
  if (/要するに|つまり|結局|結論|言いたい|ポイント|一番|本音/.test(body)) bonus += 8
  if (/と思います|と考え|すべき|したい|必要|からです|だから|なんです|わけです/.test(body)) bonus += 3
  if (/\d/.test(body)) bonus += 2
  if (/[？?]$/.test(body)) bonus -= 8
  if (index === total - 1) bonus += 2
  if (/^(えーと|あの|はい|うん|そうですね)[。、！？!?]*$/.test(body)) bonus -= 8
  return bonus
}

function classify(text: string): Kind {
  const body = text.replace(/^[^：:\n]{1,16}[：:]/, '')
  if (/決定は|決定事項|に決定|を決定|で決定|承認|了承|合意|可決|賛成|進める|見直す|で売り|優先します/.test(body)) return 'decision'
  if (/宿題|担当|お願い|私が|共有|作成|修正|準備|送付|終えます|置きます|明記/.test(body)) return 'action'
  if (/課題|懸念|問題|リスク|反対|保留|難しい|未定|分かれ|厳しい|赤字|受けません|決めません|重大|重要|渋滞/.test(body)) return 'issue'
  if (/次回|来週|来月|日程|締め切り|期限|までに|出荷|入庫/.test(body)) return 'schedule'
  return 'fact'
}

function scoreUnits(texts: string[], style: StyleId): Unit[] {
  return texts.map((text, index) => {
    const kind = classify(text)
    let score = KIND_WEIGHT[kind]
    if (style === 'todo' && (kind === 'action' || kind === 'schedule')) score += 5
    if (style === 'contrast' && (kind === 'decision' || kind === 'issue')) score += 3
    if (style === 'point') score += pointBonus(text, index, texts.length)
    if (/\d/.test(text)) score += 1
    if (/決定は|決定事項|保留/.test(text)) score += 2
    if (/重大|重要|渋滞|問題|危険|影響/.test(spokenBody(text))) score += 4
    if (index >= texts.length - 2 && style !== 'timeline') score += 1
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
  const ranked = style === 'timeline' ? spreadRank(units) : [...units].sort((a, b) => b.score - a.score || a.index - b.index)
  let chosen: Unit[] = []

  const over = (list: Unit[]) => renderedCount(style, list, title) > max

  for (const unit of ranked) {
    if (chosen.some((item) => tooSimilar(item.text, unit.text, max))) continue
    const trial = [...chosen, unit]
    if (over(trial)) continue
    chosen.push(unit)
    if (style === 'point' && chosen.length >= 6) break
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
  if (style === 'titled') return finish(renderTitled(units))
  if (style === 'news') return finish(renderNews(units))
  if (style === 'bullets') return finish(renderBullets(units, ''))
  if (style === 'titledList') return finish(renderBullets(units, titleCandidates(units)[0] || headlineOf(units)))
  if (style === 'flash') return finish(renderFlash(units))
  if (style === 'lead') return finish(renderLead(units))
  if (style === 'timeline') return finish(renderTimeline(units))
  if (style === 'contrast') return finish(renderContrast(units))
  if (style === 'todo') return finish(renderTodo(units))
  if (style === 'fivew') return finish(renderFive(units))
  if (style === 'report') return finish(renderReport(units))
  if (style === 'politics') return finish(renderPolitics(units))
  if (style === 'minutes') return finish(renderMinutes(units))
  if (style === 'mail') return finish(renderMail(units, title))
  if (style === 'point') return finish(renderPoint(units))
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

function headlineOf(units: Unit[]): string {
  const best = pickHeadlineSource(units)
  return best ? headlineFrom(best.text) : '会議のまとめ'
}

function renderTitled(units: Unit[]): { headline: string; blocks: SummaryBlock[] } {
  const candidates = titleCandidates(units)
  const blocks: SummaryBlock[] = []
  if (candidates.length > 0) blocks.push({ heading: '見出しの候補', lines: candidates, list: true })
  blocks.push(...kindBlocks(units, [
    ['decision', '決まったこと'],
    ['action', 'このあと'],
    ['issue', '残っていること'],
    ['schedule', 'いつ'],
    ['fact', '分かっていること'],
  ]))
  return { headline: candidates[0] || headlineOf(units), blocks }
}

function renderPoint(units: Unit[]): { headline: string; blocks: SummaryBlock[] } {
  const ordered = [...units].sort((a, b) => a.index - b.index)
  const lines = ordered.map((unit) => spokenBody(unit.text)).filter((line) => line.length > 0)
  return {
    headline: headlineOf(units),
    blocks: lines.length ? [{ heading: '言いたいこと', lines, list: true }] : [],
  }
}

function renderBullets(units: Unit[], headline: string): { headline: string; blocks: SummaryBlock[] } {
  const lines = clausesOf(units)
  return {
    headline,
    blocks: lines.length ? [{ heading: headline ? '' : '要点', lines, list: true }] : [],
  }
}

function renderFlash(units: Unit[]): { headline: string; blocks: SummaryBlock[] } {
  const lines = clausesOf([...units].sort((a, b) => b.score - a.score || a.index - b.index))
  return {
    headline: titleCandidates(units)[0] || headlineOf(units),
    blocks: lines.length ? [{ heading: '分かっていること', lines, list: true }] : [],
  }
}

function renderLead(units: Unit[]): { headline: string; blocks: SummaryBlock[] } {
  const best = [...units].sort((a, b) => Number(b.kind === 'decision') - Number(a.kind === 'decision') || b.score - a.score)[0]
  const conclusion = best ? faithfulLine(best.text) : ''
  const rest = clausesOf(units.filter((unit) => unit.index !== best?.index).sort((a, b) => a.index - b.index))
  const blocks: SummaryBlock[] = []
  if (conclusion) blocks.push({ heading: '結論', lines: [conclusion] })
  const background = rest.filter((line) => line !== conclusion)
  if (background.length > 0) blocks.push({ heading: '経緯', lines: background })
  return { headline: titleCandidates(units)[0] || conclusion || headlineOf(units), blocks }
}

function renderTimeline(units: Unit[]): { headline: string; blocks: SummaryBlock[] } {
  const ordered = [...units].sort((a, b) => a.index - b.index)
  const labels = ['はじめに', '次に', 'そのあと']
  const blocks: SummaryBlock[] = []
  const parts = Math.min(labels.length, ordered.length)
  const size = parts > 0 ? Math.ceil(ordered.length / parts) : 0
  for (let index = 0; index < parts; index += 1) {
    const lines = clausesOf(ordered.slice(index * size, (index + 1) * size))
    if (lines.length > 0) blocks.push({ heading: labels[index] ?? 'そのあと', lines, list: true })
  }
  return { headline: titleCandidates(ordered)[0] || headlineOf(ordered), blocks }
}

function renderContrast(units: Unit[]): { headline: string; blocks: SummaryBlock[] } {
  const blocks = kindBlocks(units, [
    ['decision', 'まとまったこと'],
    ['issue', '残っていること'],
  ])
  if (blocks.length === 0 && units.length > 0) blocks.push({ heading: '要点', lines: clausesOf(units), list: true })
  return { headline: titleCandidates(units)[0] || headlineOf(units), blocks }
}

function renderTodo(units: Unit[]): { headline: string; blocks: SummaryBlock[] } {
  const blocks = kindBlocks(units, [
    ['action', 'やること'],
    ['schedule', '期限'],
  ])
  if (blocks.length === 0 && units.length > 0) blocks.push({ heading: 'やること', lines: clausesOf(units), list: true })
  return { headline: titleCandidates(units)[0] || headlineOf(units), blocks }
}

function renderFive(units: Unit[]): { headline: string; blocks: SummaryBlock[] } {
  const order = ['何を', 'なぜ', 'いつ', 'どこで', 'どのように', '誰が'] as const
  const buckets = new Map<string, string[]>()
  for (const unit of units) {
    const answer = fiveAnswer(unit)
    const list = buckets.get(answer.slot) ?? []
    list.push(answer.line)
    buckets.set(answer.slot, list)
  }
  const blocks: SummaryBlock[] = []
  for (const heading of order) {
    const lines = uniqueLines(buckets.get(heading) ?? [])
    if (lines.length > 0) blocks.push({ heading, lines, list: true })
  }
  return { headline: titleCandidates(units)[0] || headlineOf(units), blocks }
}

function renderReport(units: Unit[]): { headline: string; blocks: SummaryBlock[] } {
  const best = [...units].sort((a, b) => Number(b.kind === 'decision') - Number(a.kind === 'decision') || b.score - a.score)[0]
  const later = units.filter((unit) => unit.kind === 'schedule' || unit.kind === 'action')
  const laterIds = new Set(later.map((unit) => unit.index))
  const body = [...units]
    .filter((unit) => unit.index !== best?.index && !laterIds.has(unit.index))
    .sort((a, b) => a.index - b.index)
  const blocks: SummaryBlock[] = []
  const gist = best ? faithfulLine(best.text) : ''
  if (gist) blocks.push({ heading: '要旨', lines: [gist] })
  const middle = clausesOf(body)
  if (middle.length > 0) blocks.push({ heading: '本文', lines: middle })
  const next = clausesOf(later)
  if (next.length > 0) blocks.push({ heading: 'このあと', lines: next, list: true })
  return { headline: titleCandidates(units)[0] || gist || headlineOf(units), blocks }
}

function kindBlocks(units: Unit[], order: [Kind, string][]): SummaryBlock[] {
  const blocks: SummaryBlock[] = []
  for (const [kind, heading] of order) {
    const lines = clausesOf(units.filter((unit) => unit.kind === kind))
    if (lines.length > 0) blocks.push({ heading, lines, list: true })
  }
  return blocks
}

function clausesOf(units: Unit[]): string[] {
  return uniqueLines(units.map((unit) => faithfulLine(unit.text)))
}

function faithfulLine(text: string): string {
  const spoken = spokenBody(text).replace(/\s+/g, ' ').trim()
  if (!spoken) return ''
  return ensurePeriod(spoken)
}

function uniqueLines(lines: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of lines) {
    const text = line.trim()
    if (charCount(text) < 6 || seen.has(text)) continue
    seen.add(text)
    out.push(text)
  }
  return out
}

function titleCandidates(units: Unit[]): string[] {
  const ranked = [...units].sort((a, b) => b.score - a.score || a.index - b.index)
  const pool: string[] = []
  for (const unit of ranked) {
    const spoken = spokenBody(unit.text).replace(/^決定(?:は|事項は)[、,]/, '')
    for (const bit of spoken.split(/[。！？!?、]/)) pool.push(titleFrom(bit))
    pool.push(titleFrom(unit.text))
  }
  const picked: string[] = []
  for (const title of pool) {
    if (picked.length === 3) break
    if (charCount(title) < 6) continue
    if (!ranked.some((unit) => unit.text.includes(title))) continue
    if (picked.some((item) => item === title || jaccard(item, title) > 0.62)) continue
    picked.push(title)
  }
  return picked
}

function titleFrom(text: string): string {
  const clause = pointClause(text)
  if (charCount(clause) <= 24) return clause
  const chars = Array.from(clause)
  const slice = chars.slice(0, 24).join('')
  let cut = -1
  for (let index = slice.length - 1; index >= 8; index -= 1) {
    if ('、はがをにへとで'.includes(slice[index] ?? '')) cut = index
  }
  const head = (cut > 0 ? slice.slice(0, cut) : slice).replace(/[、，,\s　]+$/g, '')
  return clause.includes(head) ? head : clause
}

function pointClause(text: string, kind?: Kind): string {
  const spoken = spokenBody(text).trim()
  if (!spoken) return ''
  const body = spoken.replace(/^決定(?:は|事項は)[、,]/, '')
  const bits = body
    .split(/[。！？!?、]/)
    .map((bit) => bit.trim().replace(/(?:してください|ことです|です)$/g, '').trim())
    .filter((bit) => spoken.includes(bit) && charCount(bit) >= 6)
  if (bits.length === 0) {
    const plain = body.replace(/[。！？!?]+$/g, '').trim()
    return spoken.includes(plain) ? plain : spoken
  }
  return [...bits].sort((a, b) => clauseScore(b, kind) - clauseScore(a, kind) || charCount(b) - charCount(a))[0] ?? body
}

function clauseScore(text: string, kind?: Kind): number {
  let score = 0
  if (/\d/.test(text)) score += 3
  if (/円|決定|売り|担当|まで|出荷|保留|賛成|します|置きます|終えます/.test(text)) score += 2
  if (kind === 'issue' && /保留|懸念|反対|厳しい|赤字|難しい|決めません|分かれ/.test(text)) score += 6
  if (kind === 'schedule' && /月|まで|出荷|次回|入庫/.test(text)) score += 4
  if (kind === 'decision' && /決定|売り|円|賛成/.test(text)) score += 3
  if (kind === 'action' && /します|担当|共有|終えます|置きます|明記/.test(text)) score += 3
  const count = charCount(text)
  if (count >= 8 && count <= 28) score += 2
  if (count > 42) score -= 2
  return score
}

function fiveAnswer(unit: Unit): { slot: string; line: string } {
  return { slot: fiveSlot(spokenBody(unit.text), unit.kind), line: faithfulLine(unit.text) }
}

function fiveSlot(body: string, kind: Kind): string {
  if (/場所は|本社会議室|関東の\d+店舗/.test(body)) return 'どこで'
  if (/担当は/.test(body)) return '誰が'
  if (/\d+月\d+日|来週/.test(body)) return 'いつ'
  if (/近づきます|かかります|厳しい|保留|決めません|重大|重要|渋滞/.test(body)) return 'なぜ'
  if (/注釈に|共有フォルダへ|A4で/.test(body)) return 'どのように'
  if (kind === 'issue') return 'なぜ'
  if (kind === 'schedule') return 'いつ'
  if (kind === 'action') return 'どのように'
  return '何を'
}

function spreadRank(units: Unit[]): Unit[] {
  const byIndex = [...units].sort((a, b) => a.index - b.index)
  const bucketCount = Math.min(6, byIndex.length)
  if (bucketCount === 0) return []
  const size = Math.ceil(byIndex.length / bucketCount)
  const first: Unit[] = []
  const used = new Set<number>()
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const slice = byIndex.slice(bucket * size, (bucket + 1) * size)
    const best = [...slice].sort((a, b) => b.score - a.score)[0]
    if (!best) continue
    first.push(best)
    used.add(best.index)
  }
  const rest = units.filter((unit) => !used.has(unit.index)).sort((a, b) => b.score - a.score || a.index - b.index)
  return [...first, ...rest]
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

export function measureBody(headline: string, blocks: SummaryBlock[]): { plain: string; charCount: number } {
  const plain = plainFrom(headline, blocks)
  return { plain, charCount: charCount(plain) }
}

function forceTrim(
  body: { headline: string; blocks: SummaryBlock[]; plain: string; charCount: number },
  max: number,
): { headline: string; blocks: SummaryBlock[]; plain: string; charCount: number } {
  const blocks = body.blocks.map((block) => ({ heading: block.heading, lines: [...block.lines], list: block.list }))
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
