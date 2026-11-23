import { appendRecognized } from './capture'
import { cleanHeard, downsample, normalizeUtterance, pcmEnergy } from './ear'

const TARGET_RATE = 16000
const MAX_SECONDS = 45 * 60
const CHUNK_SECONDS = 30

export const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'wav', 'aac', 'mp4', 'ogg', 'webm', 'flac', '3gp', 'caf', 'amr', 'wma', 'm4b']

export function isAudioFile(file: { name: string; type: string }): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return file.type.startsWith('audio/') || file.type.startsWith('video/') || AUDIO_EXTENSIONS.includes(ext)
}

export function mixDown(buffer: AudioBuffer): Float32Array {
  const length = buffer.length
  const out = new Float32Array(length)
  const channels = Math.max(1, buffer.numberOfChannels)
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < length; i += 1) out[i] += data[i] / channels
  }
  return out
}

export function slicePcm(pcm: Float32Array, rate: number, seconds: number): Float32Array[] {
  const size = Math.max(1, Math.floor(rate * seconds))
  const parts: Float32Array[] = []
  for (let offset = 0; offset < pcm.length; offset += size) {
    parts.push(pcm.subarray(offset, Math.min(pcm.length, offset + size)))
  }
  return parts.length ? parts : [new Float32Array()]
}

export function limitPcm(pcm: Float32Array, rate: number, seconds = MAX_SECONDS): { pcm: Float32Array; trimmed: boolean } {
  const max = Math.floor(rate * seconds)
  if (pcm.length <= max) return { pcm, trimmed: false }
  return { pcm: pcm.slice(0, max), trimmed: true }
}

export async function decodeTo16k(buffer: ArrayBuffer): Promise<Float32Array> {
  const ctx = new AudioContext()
  try {
    const audio = await ctx.decodeAudioData(buffer.slice(0))
    return downsample(mixDown(audio), audio.sampleRate, TARGET_RATE)
  } finally {
    await ctx.close()
  }
}

type HearResult = { type: 'text'; id: number; text: string; final: boolean }
type EarEvent = { type: 'progress'; progress: number } | { type: 'ready' } | HearResult | { type: 'error' }

export class FileEar {
  private worker: Worker | null = null
  private pending = new Map<number, { resolve: (text: string) => void; reject: (error: Error) => void }>()
  private seq = 0
  private ready = false

  constructor(private onStatus: (note: string) => void) {}

  async transcribe(pcm: Float32Array): Promise<string> {
    this.ensure()
    const slices = slicePcm(pcm, TARGET_RATE, CHUNK_SECONDS).filter((slice) => pcmEnergy(slice) >= 0.006)
    if (slices.length === 0) return ''
    let text = ''
    for (let index = 0; index < slices.length; index += 1) {
      this.onStatus(`文字にしています（${index + 1}/${slices.length}）。音声はこの端末の外へ送りません。`)
      const heard = cleanHeard(await this.hear(normalizeUtterance(slices[index])))
      if (heard) text = appendRecognized(text, heard)
    }
    return text.trim()
  }

  private ensure(): void {
    if (this.worker) return
    this.worker = new Worker(new URL('./ear.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (event: MessageEvent<EarEvent>) => this.onWorker(event.data)
    this.worker.onerror = () => this.fail(new Error('worker'))
    this.worker.postMessage({ type: 'warm' })
  }

  private onWorker(data: EarEvent): void {
    if (!data || typeof data !== 'object') return
    if (data.type === 'progress') {
      if (this.ready) return
      this.onStatus(`文字起こしの準備をしています（${Math.round(data.progress)}%）。`)
      return
    }
    if (data.type === 'ready') {
      this.ready = true
      return
    }
    if (data.type === 'error') {
      this.fail(new Error('hear'))
      return
    }
    const waiter = this.pending.get(data.id)
    if (!waiter) return
    this.pending.delete(data.id)
    waiter.resolve(data.text)
  }

  private hear(pcm: Float32Array): Promise<string> {
    const id = (this.seq += 1)
    const copy = new Float32Array(pcm)
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('timeout'))
      }, 180000)
      this.pending.set(id, {
        resolve: (text) => {
          window.clearTimeout(timer)
          resolve(text)
        },
        reject: (error) => {
          window.clearTimeout(timer)
          reject(error)
        },
      })
      this.worker?.postMessage({ type: 'hear', id, pcm: copy, final: true })
    })
  }

  private fail(error: Error): void {
    for (const waiter of this.pending.values()) waiter.reject(error)
    this.pending.clear()
  }
}