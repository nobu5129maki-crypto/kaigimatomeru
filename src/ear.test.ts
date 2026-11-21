import { describe, expect, it } from 'vitest'
import { cleanHeard, concatFloats, decideEar, downsample, pcmEnergy } from './ear'

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
  })

  it('話している途中は欄へ出し、間が空いたら確定する', () => {
    expect(decideEar({ pending: true, speechMs: 2500, silenceMs: 0, sincePartialMs: 2500 })).toBe('partial')
    expect(decideEar({ pending: true, speechMs: 3000, silenceMs: 1700, sincePartialMs: 1700 })).toBe('final')
    expect(decideEar({ pending: false, speechMs: 0, silenceMs: 0, sincePartialMs: 0 })).toBe('wait')
    expect(decideEar({ pending: true, speechMs: 16000, silenceMs: 0, sincePartialMs: 100 })).toBe('final')
  })
})