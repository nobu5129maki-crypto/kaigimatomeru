import { cleanHeard, downsample, normalizeUtterance, pcmEnergy } from './ear'
import { finishHearing, MAX_MEETING_SECONDS, planHearing, pushHearing } from './meeting'
import { chooseWords } from './wordChoice'

const TARGET_RATE = 16000
const MAX_SECONDS = MAX_MEETING_SECONDS

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

export type EarProgress = { note: string; ratio: number; cap: number }

export function meterSpan(kind: 'download' | 'boot' | 'chunk', value: number, total = 1): Pick<EarProgress, 'ratio' | 'cap'> {
  if (kind === 'boot') return { ratio: 0.36, cap: 0.42 }
  if (kind === 'download') {
    const ratio = 0.05 + Math.max(0, Math.min(1, value)) * 0.3
    return { ratio, cap: Math.min(0.4, ratio + 0.04) }
  }
  const count = Math.max(1, total)
  const index = Math.min(count - 1, Math.max(0, value))
  return {
    ratio: 0.42 + (index / count) * 0.53,
    cap: 0.42 + ((index + 1) / count) * 0.53 - 0.01,
  }
}

type HearResult = { type: 'text'; id: number; text: string; final: boolean }
type EarEvent =
  | { type: 'progress'; progress: number; stage?: string }
  | { type: 'ready' }
  | HearResult
  | { type: 'error' }

export class FileEar {
  private worker: Worker | null = null
  private pending = new Map<number, { resolve: (text: string) => void; reject: (error: Error) => void }>()
  private seq = 0
  private ready = false
  private booting = false
  private writing = false

  constructor(private onStatus: (update: EarProgress) => void) {}

  async transcribe(pcm: Float32Array, options?: { speakers?: boolean }): Promise<{ text: string; note: string }> {
    this.ensure()
    const plan = planHearing(pcm, TARGET_RATE, Boolean(options?.speakers))
    const pieces = plan.pieces.filter((piece) => pcmEnergy(pcm.subarray(piece.start, piece.end)) >= 0.006)
    if (pieces.length === 0) return { text: '', note: plan.note }
    let draft = { text: '', line: '', label: '' }
    for (let index = 0; index < pieces.length; index += 1) {
      const piece = pieces[index]
      this.writing = true
      const span = meterSpan('chunk', index, pieces.length)
      this.onStatus({
        note: piece.label
          ? `声で分けながら原稿を書いています（${index + 1}/${pieces.length}）。音声はこの端末の外へ送りません。`
          : `無音の位置で区切って原稿を書いています（${index + 1}/${pieces.length}）。音声はこの端末の外へ送りません。`,
        ...span,
      })
      const heard = cleanHeard(await this.hear(normalizeUtterance(pcm.subarray(piece.start, piece.end))))
      if (!heard) continue
      draft = pushHearing(draft, heard, piece)
    }
    return { text: chooseWords(finishHearing(draft).trim()), note: plan.note }
  }

  private ensure(): void {
    if (this.worker) return
    this.worker = new Worker(new URL('./ear.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (event: MessageEvent<EarEvent>) => this.onWorker(event.data)
    this.worker.onerror = () => this.fail(new Error('worker'))
    this.worker.postMessage({ type: 'warm', accurate: true })
  }

  private onWorker(data: EarEvent): void {
    if (!data || typeof data !== 'object') return
    if (data.type === 'progress') {
      if (this.ready || this.writing) return
      if (data.stage === 'boot' || data.progress >= 100) this.booting = true
      if (this.booting) {
        this.onStatus({ note: 'モデルを起動しています。起動すると原稿を書きます。', ...meterSpan('boot', 1) })
        return
      }
      this.onStatus({ note: 'まとめの準備をしています。', ...meterSpan('download', data.progress / 100) })
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
      }, 240000)
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
      this.worker?.postMessage({ type: 'hear', id, pcm: copy, final: true, beams: 1 })
    })
  }

  close(): void {
    this.worker?.terminate()
    this.worker = null
    this.ready = false
    this.booting = false
    this.writing = false
    this.fail(new Error('closed'))
  }

  private fail(error: Error): void {
    for (const waiter of this.pending.values()) waiter.reject(error)
    this.pending.clear()
  }
}