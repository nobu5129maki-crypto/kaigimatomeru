import { describe, expect, it } from 'vitest'
import { cleanHeard, concatFloats, decideEar, downsample, isRoomSpeech, normalizeUtterance, pcmEnergy } from './ear'

describe('端末内の文字起こし', () => {
  it('無音はエネルギーがゼロ', () => {
    expect(pcmEnergy(new Float32Array(8))).toBe(0)
  })

  it('16kHzはそのままの長さでコピーする', () => {
    const input = Float32Array.from([0.25, 0.5, 0.75])
    const out = downsample(input, 16000, 16000)
    expect(Array.from(out)).toEqual([0.25, 0.5, 0.75])
    input[0] = 0
    expect(out[0]).toBe(0.25)
  })

  it('48kHzを16kHzへ間引く', () => {
    const input = new Float32Array(48)
    expect(downsample(input, 48000, 16000).length).toBe(16)
  })

  it('断片をつなぐ', () => {
    expect(Array.from(concatFloats([Float32Array.from([1]), Float32Array.from([2, 3])]))).toEqual([1, 2, 3])
  })

  it('無音の幻覚を捨てる', () => {
    expect(cleanHeard('ご視聴ありがとうございました')).toBe('')
    expect(cleanHeard('（拍手）')).toBe('')
    expect(cleanHeard('価格は980円です。')).toBe('価格は980円です。')
    expect(cleanHeard('社会拡充で、社会拡充で、社会拡充で、社会拡充で')).toBe('社会拡充で')
  })

  it('小さなスピーカーの音は拾い、静かな部屋は拾わない', () => {
    expect(isRoomSpeech(0.001, 0.006)).toBe(false)
    expect(isRoomSpeech(0.008, 0.006)).toBe(true)
    const quiet = new Float32Array(8)
    quiet.fill(0.02)
    const leveled = normalizeUtterance(quiet)
    expect(leveled[0]).toBeGreaterThan(0.05)
    expect(leveled[0]).toBeLessThanOrEqual(0.5)
    const loud = new Float32Array(8)
    loud.fill(0.6)
    expect(normalizeUtterance(loud)[0]).toBeCloseTo(0.6)
  })

  it('話している途中は欄へ出し、間が空いたら確定する', () => {
    expect(decideEar({ pending: true, speechMs: 1300, silenceMs: 0, sincePartialMs: 1300 })).toBe('partial')
    expect(decideEar({ pending: true, speechMs: 12100, silenceMs: 0, sincePartialMs: 100 })).toBe('final')
    expect(decideEar({ pending: true, speechMs: 500, silenceMs: 800, sincePartialMs: 800 })).toBe('final')
    expect(decideEar({ pending: false, speechMs: 0, silenceMs: 0, sincePartialMs: 0 })).toBe('wait')
  })
})