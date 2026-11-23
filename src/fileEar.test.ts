import { describe, expect, it } from 'vitest'
import { isAudioFile, limitPcm, mixDown, slicePcm } from './fileEar'

describe('録音ファイル', () => {
  it('ボイスレコーダーの形式を音声として扱う', () => {
    expect(isAudioFile({ name: '会議.m4a', type: '' })).toBe(true)
    expect(isAudioFile({ name: 'memo.MP3', type: '' })).toBe(true)
    expect(isAudioFile({ name: 'note.txt', type: 'text/plain' })).toBe(false)
  })

  it('左右の音を一つの列に混ぜる', () => {
    const buffer = {
      length: 2,
      numberOfChannels: 2,
      sampleRate: 16000,
      getChannelData: (channel: number) => (channel === 0 ? new Float32Array([0.25, 0.5]) : new Float32Array([0.75, 0.5])),
    } as AudioBuffer
    expect(Array.from(mixDown(buffer))).toEqual([0.5, 0.5])
  })

  it('長い録音を決めた秒数で分ける', () => {
    const pcm = new Float32Array(16000 * 3)
    const parts = slicePcm(pcm, 16000, 2)
    expect(parts).toHaveLength(2)
    expect(parts[0]).toHaveLength(32000)
    expect(parts[1]).toHaveLength(16000)
  })

  it('長すぎる録音は先頭だけ残す', () => {
    const pcm = new Float32Array(16000 * 3)
    const limited = limitPcm(pcm, 16000, 2)
    expect(limited.trimmed).toBe(true)
    expect(limited.pcm).toHaveLength(32000)
  })
})