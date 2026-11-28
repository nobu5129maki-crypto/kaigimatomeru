import { measureBody, type SummaryBlock, type SummaryResult } from './summarize'

export type DraftBody = {
  title: string
  headline: string
  dateline: string
  attendees: string
  blocks: SummaryBlock[]
}

function copyBlocks(blocks: SummaryBlock[]): SummaryBlock[] {
  return blocks.map((block) => ({
    heading: block.heading,
    lines: [...block.lines],
    list: block.list,
  }))
}

export function snapshot(doc: SummaryResult): DraftBody {
  return {
    title: doc.title,
    headline: doc.headline,
    dateline: doc.dateline,
    attendees: doc.attendees,
    blocks: copyBlocks(doc.blocks),
  }
}

export function draftKey(doc: SummaryResult): string {
  return JSON.stringify(snapshot(doc))
}

export function isDraft(value: unknown): value is DraftBody {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<DraftBody>
  if (
    typeof item.title !== 'string' ||
    typeof item.headline !== 'string' ||
    typeof item.dateline !== 'string' ||
    typeof item.attendees !== 'string' ||
    !Array.isArray(item.blocks)
  ) {
    return false
  }
  return item.blocks.every((block) => {
    if (!block || typeof block !== 'object') return false
    const row = block as Partial<SummaryBlock>
    return typeof row.heading === 'string' && Array.isArray(row.lines) && row.lines.every((line) => typeof line === 'string')
  })
}

function finish(doc: SummaryResult, body: DraftBody): SummaryResult {
  const blocks = copyBlocks(body.blocks)
  const measured = measureBody(body.headline, blocks)
  return {
    ...doc,
    title: body.title,
    headline: body.headline,
    dateline: body.dateline,
    attendees: body.attendees,
    blocks,
    plain: measured.plain,
    charCount: measured.charCount,
  }
}

function meta(doc: SummaryResult, blocks: SummaryBlock[]): DraftBody {
  return {
    title: doc.title,
    headline: doc.headline,
    dateline: doc.dateline,
    attendees: doc.attendees,
    blocks,
  }
}

export function applyDraft(doc: SummaryResult, draft: DraftBody): SummaryResult {
  return finish(doc, {
    title: draft.title,
    headline: draft.headline,
    dateline: draft.dateline,
    attendees: draft.attendees,
    blocks: draft.blocks,
  })
}

export function updateMeta(
  doc: SummaryResult,
  patch: Partial<Pick<DraftBody, 'title' | 'headline' | 'dateline' | 'attendees'>>,
): SummaryResult {
  return finish(doc, { ...snapshot(doc), ...patch })
}

export function updateHeading(doc: SummaryResult, blockIndex: number, heading: string): SummaryResult {
  const blocks = copyBlocks(doc.blocks)
  const block = blocks[blockIndex]
  if (!block) return doc
  block.heading = heading
  return finish(doc, meta(doc, blocks))
}

export function updateLine(doc: SummaryResult, blockIndex: number, lineIndex: number, value: string): SummaryResult {
  const blocks = copyBlocks(doc.blocks)
  const block = blocks[blockIndex]
  if (!block || lineIndex < 0 || lineIndex >= block.lines.length) return doc
  const parts = value.replace(/\r\n/g, '\n').split('\n')
  block.lines.splice(lineIndex, 1, ...parts)
  return finish(doc, meta(doc, blocks))
}

export function addLine(doc: SummaryResult, blockIndex: number, afterIndex: number): SummaryResult {
  const blocks = copyBlocks(doc.blocks)
  const block = blocks[blockIndex]
  if (!block) return doc
  const at = Math.max(0, Math.min(block.lines.length, afterIndex + 1))
  block.lines.splice(at, 0, '')
  return finish(doc, meta(doc, blocks))
}

export function splitLine(doc: SummaryResult, blockIndex: number, lineIndex: number, at: number): SummaryResult {
  const line = doc.blocks[blockIndex]?.lines[lineIndex]
  if (line === undefined) return doc
  const cut = Math.max(0, Math.min(line.length, at))
  const updated = updateLine(doc, blockIndex, lineIndex, line.slice(0, cut))
  const inserted = addLine(updated, blockIndex, lineIndex)
  return updateLine(inserted, blockIndex, lineIndex + 1, line.slice(cut))
}

export function dropLine(doc: SummaryResult, blockIndex: number, lineIndex: number): SummaryResult {
  const blocks = copyBlocks(doc.blocks)
  const block = blocks[blockIndex]
  if (!block || lineIndex < 0 || lineIndex >= block.lines.length) return doc
  if (block.lines.length <= 1) {
    if (blocks.length === 1) {
      block.lines[0] = ''
      return finish(doc, meta(doc, blocks))
    }
    blocks.splice(blockIndex, 1)
    return finish(doc, meta(doc, blocks))
  }
  block.lines.splice(lineIndex, 1)
  return finish(doc, meta(doc, blocks))
}

export function moveLine(doc: SummaryResult, blockIndex: number, lineIndex: number, dir: -1 | 1): SummaryResult {
  const blocks = copyBlocks(doc.blocks)
  const block = blocks[blockIndex]
  if (!block || lineIndex < 0 || lineIndex >= block.lines.length) return doc
  const nextIndex = lineIndex + dir
  if (nextIndex >= 0 && nextIndex < block.lines.length) {
    const [line] = block.lines.splice(lineIndex, 1)
    block.lines.splice(nextIndex, 0, line)
    return finish(doc, meta(doc, blocks))
  }
  const other = blocks[blockIndex + dir]
  if (!other) return doc
  const [line] = block.lines.splice(lineIndex, 1)
  if (block.lines.length === 0) block.lines.push('')
  if (dir < 0) other.lines.push(line)
  else other.lines.unshift(line)
  return finish(doc, meta(doc, blocks))
}

export function addBlock(doc: SummaryResult): SummaryResult {
  const blocks = copyBlocks(doc.blocks)
  blocks.push({ heading: '', lines: [''], list: false })
  return finish(doc, meta(doc, blocks))
}

export function clearBlock(doc: SummaryResult, blockIndex: number): SummaryResult {
  const blocks = copyBlocks(doc.blocks)
  const block = blocks[blockIndex]
  if (!block) return doc
  if (blocks.length === 1) {
    blocks[0] = { heading: '', lines: [''], list: false }
    return finish(doc, meta(doc, blocks))
  }
  blocks.splice(blockIndex, 1)
  return finish(doc, meta(doc, blocks))
}

export function toggleList(doc: SummaryResult, blockIndex: number): SummaryResult {
  const blocks = copyBlocks(doc.blocks)
  const block = blocks[blockIndex]
  if (!block) return doc
  block.list = !block.list
  return finish(doc, meta(doc, blocks))
}
