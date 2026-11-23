import { appendRecognized } from './capture'
import { cleanHeard, downsample, pcmEnergy } from './ear'

const RATE = 16000
const SLICE_SECONDS = 28

const AUDIO_EXT = ['mp3', 'm4a', 'wav', 'mp4', 'webm', 'aac', 'ogg', '3gp', 'wma', 'flac', 'm4b']

export function isRecorderFile(file: { name: string; type: string }): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return file.type.startsWith('audio/') || file.type.startsWith('video/') || AUDIO_EXT.includes(ext)
}

export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array()
  if (channels.length === 1) return new Float32Array(channels[0])
  const length = channels[0].length
  const out = new Float32Array(length)
  for (let i = 0; i < length; i += 1) {
    let sum = 0
    for (const channel of channels) sum += channel[i] ?? 0
    out[i] = sum / channels.length
  }
  return out
}

export function slicePcm(pcm: Float32Array, seconds = SLICE_SECONDS, rate = RATE): Float32Array[] {
  const size = Math.max(1, Math.floor(rate * seconds))
  if (pcm.length === 0) return []
  const parts: Float32Array[] = []
  for (let offset = 0; offset < pcm.length; offset += size) {
    parts.push(pcm.slice(offset, Math.min(pcm.length, offset + size)))
  }
  return parts
}

type AudioLike = {
  numberOfChannels: number
  sampleRate: number
  getChannelData: (index: number) => Float32Array
}

export function audioToPcm(audio: AudioLike): Float32Array {
  const channels: Float32Array[] = []
  for (let i = 0; i < audio.numberOfChannels; i += 1) channels.push(audio.getChannelData(i))
  return downsample(mixToMono(channels), audio.sampleRate, RATE)
}

type HearMessage =
  | { type: 'progress'; progress: number }
  | { type: 'ready' }
  | { type: 'text'; id: number; text: string }
  | { type: 'error' }

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export async function transcribeRecording(
  file: File,
  hooks: {
    onStatus: (note: string) => void
    onText: (text: string) => void
    signal?: AbortSignal
  },
): Promise<string> {
  hooks.onStatus('録音を読み込んでいます。')
  const ctx = new AudioContext()
  let audio: AudioBuffer
  try {
    const bytes = await file.arrayBuffer()
    audio = await ctx.decodeAudioData(bytes.slice(0))
  } catch {
    await ctx.close().catch(() => undefined)
    throw new Error('unreadable')
  }
  const pcm = audioToPcm(audio)
  await ctx.close().catch(() => undefined)
  if (pcm.length < RATE * 0.4) throw new Error('short')
  const slices = slicePcm(pcm).filter((slice) => pcmEnergy(slice) >= 0.004)
  if (slices.length === 0) throw new Error('quiet')
  const worker = new Worker(new URL('./ear.worker.ts', import.meta.url), { type: 'module' })
  let text = ''
  try {
    await hearSlices(worker, slices, hooks.signal, (index, total, piece, preparing) => {
      if (preparing !== undefined) {
        hooks.onStatus(`文字起こしの準備をしています（${preparing}%）。最初の1回だけ、この端末にモデルを置きます。`)
        return
      }
      hooks.onStatus(`ボイスレコーダーを文字にしています（${index}/${total}）。音声はこの端末の外へは出しません。`)
      if (!piece) return
      text = text ? appendRecognized(text, piece) : piece
      hooks.onText(text)
    })
  } finally {
    worker.terminate()
  }
  return text.trim()
}

function hearSlices(
  worker: Worker,
  slices: Float32Array[],
  signal: AbortSignal | undefined,
  onPiece: (index: number, total: number, piece: string, preparing?: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let ready = false
    let settled = false
    const pending = new Map<number, (text: string) => void>()
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    const stop = () => fail(new Error('cancelled'))
    signal?.addEventListener('abort', stop, { once: true })
    worker.onmessage = (event: MessageEvent<HearMessage>) => {
      const data = event.data
      if (!data || typeof data !== 'object') return
      if (data.type === 'progress' && !ready && typeof data.progress === 'number') {
        onPiece(0, slices.length, '', Math.round(data.progress))
        return
      }
      if (data.type === 'ready') {
        ready = true
        return
      }
      if (data.type === 'error') {
        fail(new Error('hear'))
        return
      }
      if (data.type === 'text') pending.get(data.id)?.(cleanHeard(data.text ?? ''))
    }
    worker.onerror = () => fail(new Error('worker'))
    worker.postMessage({ type: 'warm' })
    const run = async () => {
      const started = Date.now()
      while (!ready) {
        if (settled) return
        if (signal?.aborted) throw new Error('cancelled')
        if (Date.now() - started > 180000) throw new Error('timeout')
        await wait(200)
      }
      for (let i = 0; i < slices.length; i += 1) {
        if (signal?.aborted) throw new Error('cancelled')
        const id = i + 1
        const copy = new Float32Array(slices[i])
        const heard = new Promise<string>((done) => pending.set(id, done))
        worker.postMessage({ type: 'hear', id, pcm: copy, final: true }, [copy.buffer])
        const piece = await Promise.race([
          heard,
          wait(180000).then(() => {
            throw new Error('timeout')
          }),
        ])
        onPiece(i + 1, slices.length, piece)
      }
    }
    run().then(() => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', stop)
      resolve()
    }).catch((error: unknown) => {
      signal?.removeEventListener('abort', stop)
      fail(error instanceof Error ? error : new Error('hear'))
    })
  })
}
