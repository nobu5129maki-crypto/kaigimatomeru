import { describe, expect, it } from 'vitest'
import { audioToPcm, isRecorderFile, mixToMono, slicePcm } from './fileEar'

describe('ボイスレコーダー', () => {
  it('録音ファイルだと分かる', () => {
    expect(isRecorderFile({ name: '会議.m4a', type: '' })).toBe(true)
    expect(isRecorderFile({ name: 'memo.mp3', type: 'audio/mpeg' })).toBe(true)
    expect(isRecorderFile({ name: '議事.txt', type: 'text/plain' })).toBe(false)
  })

  it('左右の音を一つに混ぜる', () => {
    const mono = mixToMono([Float32Array.from([0, 1]), Float32Array.from([1, 1])])
    expect(Array.from(mono)).toEqual([0.5, 1])
  })

  it('長い録音を区切る', () => {
    const pcm = audioToPcm({
      numberOfChannels: 1,
      sampleRate: 16000,
      getChannelData: () => new Float32Array(16000 * 30),
    })
    expect(slicePcm(pcm, 28).length).toBe(2)
    expect(slicePcm(new Float32Array(100), 28)[0].length).toBe(100)
  })
})