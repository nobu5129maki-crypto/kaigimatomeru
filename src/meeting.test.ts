import { describe, expect, it } from 'vitest'
import { finishHearing, planHearing, pushHearing, separateSpeakers, splitAtSilence } from './meeting'

function tone(rate: number, seconds: number, freq: number, gain = 0.25): Float32Array {
  const pcm = new Float32Array(Math.floor(rate * seconds))
  for (let index = 0; index < pcm.length; index += 1) {
    pcm[index] = Math.sin((2 * Math.PI * freq * index) / rate) * gain
  }
  return pcm
}

function join(parts: Float32Array[]): Float32Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

describe('長い会議の区切り', () => {
  it('無音の位置で切り、次の区切りは少し重ねる', () => {
    const rate = 16000
    const pcm = join([tone(rate, 9, 180), new Float32Array(rate * 1.5), tone(rate, 12, 180)])
    const spans = splitAtSilence(pcm, rate, 12, 1)
    expect(spans.length).toBeGreaterThan(1)
    expect(spans[0].start).toBe(0)
    expect(spans[0].end).toBeGreaterThan(rate * 8)
    expect(spans[0].end).toBeLessThan(rate * 11)
    expect(spans[1].start).toBeLessThan(spans[0].end)
    expect(spans[spans.length - 1].end).toBe(pcm.length)
  })

  it('短い録音は一つにまとめる', () => {
    const pcm = tone(16000, 4, 180)
    expect(splitAtSilence(pcm, 16000)).toEqual([{ start: 0, end: pcm.length }])
  })
})

describe('話者の分離', () => {
  it('声の高さが違えば二人に分け、同じ声は戻す', () => {
    const rate = 16000
    const pcm = join([
      tone(rate, 0.7, 180),
      new Float32Array(rate * 0.45),
      tone(rate, 0.7, 110),
      new Float32Array(rate * 0.45),
      tone(rate, 0.7, 180),
    ])
    const turns = separateSpeakers(pcm, rate)
    expect(turns).toHaveLength(3)
    expect(turns[0].speaker).toBe(turns[2].speaker)
    expect(turns[0].speaker).not.toBe(turns[1].speaker)
  })

  it('一人の声には名前を付けない', () => {
    const pcm = tone(16000, 1.2, 160)
    const plan = planHearing(pcm, 16000, true, '佐藤、田中')
    expect(plan.pieces.every((piece) => piece.label === '')).toBe(true)
    expect(plan.note).toContain('一人')
  })

  it('分けないときはラベルを付けない', () => {
    const rate = 16000
    const pcm = join([tone(rate, 0.7, 180), new Float32Array(rate * 0.45), tone(rate, 0.7, 110)])
    const plan = planHearing(pcm, rate, false, '佐藤、田中')
    expect(plan.pieces.every((piece) => piece.label === '')).toBe(true)
    expect(plan.note).toBe('')
  })

  it('出席者が同じ人数なら話し始めた順に名前を付ける', () => {
    const rate = 16000
    const pcm = join([tone(rate, 0.7, 180), new Float32Array(rate * 0.45), tone(rate, 0.7, 110)])
    const plan = planHearing(pcm, rate, true, '佐藤、田中')
    expect(plan.pieces.map((piece) => piece.label)).toEqual(['佐藤', '田中'])
    expect(plan.note).toContain('出席者')
  })

  it('同じ話者の続きは一行にし、人が変わると行を分ける', () => {
    let draft = { text: '', line: '', label: '' }
    draft = pushHearing(draft, '価格は980円です', { label: '', stitch: true })
    draft = pushHearing(draft, '980円です。次です', { label: '', stitch: true })
    expect(finishHearing(draft)).toBe('価格は980円です。次です')
    draft = { text: '', line: '', label: '' }
    draft = pushHearing(draft, 'こんにちは。', { label: '佐藤', stitch: false })
    draft = pushHearing(draft, '続きです。', { label: '佐藤', stitch: true })
    draft = pushHearing(draft, 'はい。', { label: '田中', stitch: false })
    expect(finishHearing(draft)).toBe('佐藤：こんにちは。続きです。\n田中：はい。')
  })

  it('人数が合わなければ話者番号のままにする', () => {
    const rate = 16000
    const pcm = join([tone(rate, 0.7, 180), new Float32Array(rate * 0.45), tone(rate, 0.7, 110)])
    const plan = planHearing(pcm, rate, true, '佐藤')
    expect(plan.pieces.map((piece) => piece.label)).toEqual(['話者1', '話者2'])
    expect(plan.note).toContain('名前は声だけでは')
  })
})
