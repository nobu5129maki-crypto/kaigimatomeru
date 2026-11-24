import { describe, expect, it } from 'vitest'
import { blockPeak, formatBytes, pcm16Bytes, skipTo, wavBlob } from './studio'

describe('高音質の録音', () => {
  it('波形の頂点を0から1に収める', () => {
    expect(blockPeak(new Float32Array([0.2, -0.8, 0.1]))).toBeCloseTo(0.8)
    expect(blockPeak(new Float32Array([2, -3]))).toBe(1)
  })

  it('16bitの無劣化WAVにする', async () => {
    const pcm = pcm16Bytes(new Float32Array([0, 1, -1]))
    expect(pcm.byteLength).toBe(6)
    const wav = wavBlob([pcm], 48000)
    const view = new DataView(await wav.arrayBuffer())
    expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe('RIFF')
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(48000)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(6)
    expect(view.getInt16(44, true)).toBe(0)
    expect(view.getInt16(46, true)).toBe(32767)
    expect(view.getInt16(48, true)).toBe(-32768)
  })

  it('容量の表示を短くする', () => {
    expect(formatBytes(2048)).toBe('2KB')
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5MB')
  })

  it('無音が続いたら次の音まで飛ぶ', () => {
    const peaks = [0.01, 0.01, 0.01, 0.01, 0.01, 0.2]
    expect(skipTo(peaks, 0)).toBe(500)
    expect(skipTo(peaks, 500)).toBeNull()
    expect(skipTo([0.2, 0.01], 0)).toBeNull()
  })
})
