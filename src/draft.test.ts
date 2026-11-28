import { describe, expect, it } from 'vitest'
import {
  addBlock,
  addLine,
  applyDraft,
  clearBlock,
  draftKey,
  dropLine,
  isDraft,
  moveLine,
  snapshot,
  splitLine,
  toggleList,
  updateHeading,
  updateLine,
  updateMeta,
} from './draft'
import { documentText, type SummaryResult } from './summarize'

function sample(): SummaryResult {
  return {
    title: '定例',
    headline: '進捗',
    dateline: '2026年11月28日',
    attendees: '佐藤',
    blocks: [
      { heading: '要点', lines: ['予算を確認する。', '来月に再提出する。'] },
      { heading: '宿題', lines: ['資料を送る。'], list: true },
    ],
    plain: '',
    charCount: 0,
    target: 400,
    min: 300,
    max: 500,
    note: '',
    style: 'memo',
    length: 'c400',
    styleLabel: '読みやすいメモ',
    lengthLabel: '400文字程度',
  }
}

describe('原稿の直し', () => {
  it('行を書き換えると文字数と書き出しが追随する', () => {
    const next = updateLine(sample(), 0, 0, '予算は据え置く。')
    expect(next.blocks[0].lines[0]).toBe('予算は据え置く。')
    expect(next.plain).toContain('予算は据え置く。')
    expect(next.charCount).toBe(next.plain.replace(/[\s　]/g, '').length)
    expect(next.styleLabel).toBe('読みやすいメモ')
    expect(documentText(next)).toContain('予算は据え置く。')
  })

  it('改行を貼り付けると行が分かれる', () => {
    const next = updateLine(sample(), 0, 0, '前半。\n後半。')
    expect(next.blocks[0].lines).toEqual(['前半。', '後半。', '来月に再提出する。'])
  })

  it('カーソル位置で行を分割する', () => {
    const next = splitLine(sample(), 0, 0, 2)
    expect(next.blocks[0].lines.slice(0, 2)).toEqual(['予算', 'を確認する。'])
  })

  it('行の追加、削除、入れ替えができる', () => {
    const added = addLine(sample(), 0, 0)
    expect(added.blocks[0].lines).toEqual(['予算を確認する。', '', '来月に再提出する。'])
    const dropped = dropLine(added, 0, 1)
    expect(dropped.blocks[0].lines).toEqual(['予算を確認する。', '来月に再提出する。'])
    const moved = moveLine(sample(), 0, 1, -1)
    expect(moved.blocks[0].lines).toEqual(['来月に再提出する。', '予算を確認する。'])
  })

  it('最後の一行は空にし、節が複数なら節ごと外す', () => {
    const cleared = dropLine(sample(), 1, 0)
    expect(cleared.blocks).toHaveLength(1)
    const only = dropLine(cleared, 0, 0)
    expect(only.blocks[0].lines).toEqual(['来月に再提出する。'])
    const emptied = dropLine({ ...only, blocks: [{ heading: '要点', lines: ['残す。'] }] }, 0, 0)
    expect(emptied.blocks).toEqual([{ heading: '要点', lines: [''] }])
  })

  it('行は隣の節へ移せる', () => {
    const next = moveLine(sample(), 1, 0, -1)
    expect(next.blocks[0].lines[next.blocks[0].lines.length - 1]).toBe('資料を送る。')
    expect(next.blocks[1].lines).toEqual([''])
  })

  it('節の追加、削除、箇条書き、見出しを変えられる', () => {
    const added = addBlock(sample())
    expect(added.blocks).toHaveLength(3)
    expect(added.blocks[2].lines).toEqual([''])
    const removed = clearBlock(added, 2)
    expect(removed.blocks).toHaveLength(2)
    const listed = toggleList(sample(), 0)
    expect(listed.blocks[0].list).toBe(true)
    expect(documentText(listed)).toContain('・予算を確認する。')
    const headed = updateHeading(sample(), 0, '決まったこと')
    expect(headed.blocks[0].heading).toBe('決まったこと')
    expect(headed.plain.startsWith('進捗\n決まったこと')).toBe(true)
  })

  it('題名を直しても、まとめ方の情報は残る', () => {
    const next = updateMeta(sample(), { title: '臨時', attendees: '佐藤、田中' })
    expect(next.title).toBe('臨時')
    expect(next.attendees).toBe('佐藤、田中')
    expect(next.lengthLabel).toBe('400文字程度')
    const again = applyDraft(sample(), snapshot(next))
    expect(again.title).toBe('臨時')
    expect(draftKey(again)).toBe(draftKey(next))
  })

  it('範囲外の指定では原稿を変えない', () => {
    const doc = sample()
    expect(updateLine(doc, 4, 0, '無い')).toBe(doc)
    expect(moveLine(doc, 0, 0, -1)).toBe(doc)
  })

  it('壊れた下書きは受け取らない', () => {
    expect(isDraft(snapshot(sample()))).toBe(true)
    expect(isDraft({ title: 'a', headline: '', dateline: '', attendees: '', blocks: [{ heading: 1, lines: [] }] })).toBe(false)
    expect(isDraft(null)).toBe(false)
  })
})
