const TARGET_RATE = 16000

const HALLUCINATIONS = [
  'ご視聴ありがとうございました',
  'ご清聴ありがとうございました',
  '字幕をオンにしてください',
  'チャンネル登録',
  'thanks for watching',
  'thank you for watching',
  'thank you',
]

export function pcmEnergy(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}

export const ROOM_GAIN = 2.4

export function boostForRoom(frame: Float32Array): Float32Array {
  let peak = 0
  for (let i = 0; i < frame.length; i += 1) peak = Math.max(peak, Math.abs(frame[i]))
  if (peak >= 0.2 || peak < 0.004) return new Float32Array(frame)
  const gain = Math.min(ROOM_GAIN, 0.28 / peak)
  const out = new Float32Array(frame.length)
  for (let i = 0; i < frame.length; i += 1) out[i] = Math.max(-1, Math.min(1, frame[i] * gain))
  return out
}

export function collapseRepeats(text: string): string {
  let out = text
  for (let guard = 0; guard < 8; guard += 1) {
    const next = collapseOnce(out)
    if (next === out) break
    out = next
  }
  return out
}

function collapseOnce(text: string): string {
  const max = Math.min(18, Math.floor(text.length / 3))
  for (let size = max; size >= 4; size -= 1) {
    for (let start = 0; start + size * 3 <= text.length; start += 1) {
      const phrase = text.slice(start, start + size)
      if (phrase.trim().length < 4 || /[、,，\s]/.test(phrase)) continue
      let count = 1
      let end = start + size
      while (end < text.length) {
        const sep = /^[、,，\s]+/.exec(text.slice(end))
        const sepLen = sep ? sep[0].length : 0
        if (text.slice(end + sepLen, end + sepLen + size) !== phrase) break
        count += 1
        end += sepLen + size
      }
      if (count >= 2) return text.slice(0, start) + phrase + text.slice(end)
    }
  }
  return text
}

export function isRoomSpeech(rms: number, floor: number): boolean {
  return rms >= Math.max(0.012, floor * 1.8)
}

export function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return new Float32Array(input)
  const ratio = fromRate / toRate
  const length = Math.max(1, Math.floor(input.length / ratio))
  const out = new Float32Array(length)
  for (let i = 0; i < length; i += 1) {
    const pos = i * ratio
    const left = Math.floor(pos)
    const right = Math.min(left + 1, input.length - 1)
    const mix = pos - left
    out[i] = input[left] * (1 - mix) + input[right] * mix
  }
  return out
}

export function concatFloats(parts: Float32Array[]): Float32Array {
  let total = 0
  for (const part of parts) total += part.length
  const out = new Float32Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

export function cleanHeard(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (!trimmed) return ''
  const compact = trimmed.replace(/\s/g, '').toLowerCase()
  if (compact.length < 48 && HALLUCINATIONS.some((item) => compact.includes(item.replace(/\s/g, '').toLowerCase()))) return ''
  if (/^[（(][^）)]{0,24}[）)]$/.test(trimmed)) return ''
  return collapseRepeats(trimmed)
}

export function decideEar(input: {
  pending: boolean
  speechMs: number
  silenceMs: number
  sincePartialMs: number
}): 'wait' | 'partial' | 'final' {
  if (!input.pending) return 'wait'
  if (input.silenceMs >= 700 && input.speechMs >= 300) return 'final'
  if (input.speechMs >= 5000) return 'final'
  if (input.silenceMs < 400 && input.speechMs >= 700 && input.sincePartialMs >= 1200) return 'partial'
  return 'wait'
}

type EarHooks = {
  onPartial: (text: string) => void
  onFinal: (text: string) => void
  onStatus: (note: string) => void
}

type EarJob = { id: number; pcm: Float32Array; final: boolean }

type EarMessage =
  | { type: 'progress'; progress: number }
  | { type: 'ready' }
  | { type: 'text'; id: number; text: string; final: boolean }
  | { type: 'error' }

export class LiveEar {
  private hooks: EarHooks
  private worker: Worker | null = null
  private ctx: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processor: ScriptProcessorNode | null = null
  private mute: GainNode | null = null
  private chunks: Float32Array[] = []
  private sampleCount = 0
  private speechMs = 0
  private silenceMs = 0
  private sincePartialMs = 0
  private floor = 0.006
  private ownsContext = false
  private speaking = false
  private paused = false
  private queue: EarJob[] = []
  private seq = 0
  private busy = false
  private ready = false
  private warming = false
  private failed = false
  private lastPercent = -1
  private lastFinalId = 0

  constructor(hooks: EarHooks) {
    this.hooks = hooks
  }

  open(stream: MediaStream, shared?: AudioContext | null): void {
    this.disconnectNodes()
    this.paused = false
    this.ensureWorker()
    if (this.failed) return
    if (this.ready) this.hooks.onStatus('話した言葉を、文字起こし欄へ順に出します。')
    else this.hooks.onStatus('文字起こしの準備をしています。')
    const Ctx = window.AudioContext
    let ctx = shared && shared.state !== 'closed' ? shared : null
    if (!ctx) {
      if (!Ctx) {
        this.fail()
        return
      }
      try {
        ctx = new Ctx()
      } catch {
        this.fail()
        return
      }
      this.ownsContext = true
    } else {
      this.ownsContext = false
    }
    void ctx.resume()
    const source = ctx.createMediaStreamSource(stream)
    const processor = ctx.createScriptProcessor(4096, 1, 1)
    const mute = ctx.createGain()
    mute.gain.value = 0.00001
    processor.onaudioprocess = (event) => {
      const channel = event.inputBuffer.getChannelData(0)
      this.push(boostForRoom(downsample(channel, ctx.sampleRate, TARGET_RATE)))
    }
    source.connect(processor)
    processor.connect(mute)
    mute.connect(ctx.destination)
    this.ctx = ctx
    this.source = source
    this.processor = processor
    this.mute = mute
  }

  pause(): void {
    this.paused = true
    if (this.sampleCount > 0) this.flush(true)
  }

  resume(): void {
    this.paused = false
    if (this.ready) this.hooks.onStatus('話した言葉を、文字起こし欄へ順に出します。')
  }

  async close(): Promise<void> {
    this.paused = true
    if (this.sampleCount > 0) this.flush(true)
    this.disconnectNodes()
    const started = Date.now()
    while ((this.busy || this.queue.length > 0) && Date.now() - started < 15000) {
      await new Promise((resolve) => setTimeout(resolve, 80))
    }
  }

  release(): void {
    this.paused = true
    this.queue = []
    this.resetUtterance()
    this.disconnectNodes()
  }

  shutdown(): void {
    this.release()
    this.worker?.terminate()
    this.worker = null
    this.ready = false
    this.warming = false
    this.busy = false
    this.failed = false
  }

  private ensureWorker(): void {
    if (this.failed) return
    if (!this.worker) {
      try {
        this.worker = new Worker(new URL('./ear.worker.ts', import.meta.url), { type: 'module' })
      } catch {
        this.fail()
        return
      }
      this.worker.onmessage = (event: MessageEvent<EarMessage>) => this.onWorker(event.data)
      this.worker.onerror = () => {
        if (!this.ready) this.fail()
      }
    }
    if (!this.ready && !this.warming) {
      this.warming = true
      this.worker.postMessage({ type: 'warm' })
    }
  }

  private onWorker(data: EarMessage): void {
    if (!data || typeof data !== 'object') return
    if (data.type === 'progress') {
      if (this.ready) return
      const percent = Math.round(data.progress)
      if (percent === this.lastPercent) return
      this.lastPercent = percent
      this.hooks.onStatus(`文字起こしの準備をしています（${percent}%）。`)
      return
    }
    if (data.type === 'ready') {
      this.ready = true
      this.warming = false
      this.hooks.onStatus('話した言葉を、文字起こし欄へ順に出します。')
      this.pump()
      return
    }
    if (data.type === 'error') {
      this.busy = false
      this.warming = false
      if (!this.ready) this.fail()
      else this.pump()
      return
    }
    if (data.type === 'text') {
      this.busy = false
      const text = cleanHeard(data.text)
      if (data.final) {
        this.lastFinalId = data.id
        if (text) this.hooks.onFinal(text)
      } else if (data.id > this.lastFinalId && text) {
        this.hooks.onPartial(text)
      }
      this.pump()
    }
  }

  private fail(): void {
    this.failed = true
    this.warming = false
    this.hooks.onStatus('話しながらの文字起こしを始められませんでした。録音は続いています。')
  }

  private push(frame: Float32Array): void {
    if (this.paused) return
    const rms = pcmEnergy(frame)
    const frameMs = (frame.length / TARGET_RATE) * 1000
    const loud = isRoomSpeech(rms, this.floor)
    if (!loud && !this.speaking) {
      this.floor = this.floor * 0.92 + rms * 0.08
      return
    }
    if (loud) {
      this.speaking = true
      this.silenceMs = 0
      this.speechMs += frameMs
      this.sincePartialMs += frameMs
      this.chunks.push(frame)
      this.sampleCount += frame.length
    } else {
      this.silenceMs += frameMs
      this.sincePartialMs += frameMs
      if (this.silenceMs < 450) {
        this.chunks.push(frame)
        this.sampleCount += frame.length
      }
    }
    const decision = decideEar({
      pending: this.sampleCount >= TARGET_RATE * 0.4,
      speechMs: this.speechMs,
      silenceMs: this.silenceMs,
      sincePartialMs: this.sincePartialMs,
    })
    if (decision === 'final') this.flush(true)
    else if (decision === 'partial') this.flush(false)
  }

  private flush(final: boolean): void {
    if (this.sampleCount < TARGET_RATE * 0.35) {
      if (final) this.resetUtterance()
      return
    }
    const pcm = concatFloats(this.chunks)
    const slice = final && this.silenceMs < 700
    if (!final) {
      this.sincePartialMs = 0
      this.enqueue(pcm, false)
      return
    }
    if (!slice) {
      this.resetUtterance()
      this.enqueue(pcm, true)
      return
    }
    const tailCount = Math.min(pcm.length, Math.floor(TARGET_RATE * 0.35))
    const send = pcm.slice(0, pcm.length - tailCount)
    const tail = pcm.slice(pcm.length - tailCount)
    this.resetUtterance()
    if (tail.length > 0) {
      this.chunks = [tail]
      this.sampleCount = tail.length
      this.speaking = true
      this.speechMs = (tail.length / TARGET_RATE) * 1000
    }
    if (send.length >= TARGET_RATE * 0.35) this.enqueue(send, true)
  }

  private resetUtterance(): void {
    this.chunks = []
    this.sampleCount = 0
    this.speechMs = 0
    this.silenceMs = 0
    this.sincePartialMs = 0
    this.speaking = false
  }

  private enqueue(pcm: Float32Array, final: boolean): void {
    this.queue.push({ id: (this.seq += 1), pcm, final })
    const finals = this.queue.filter((job) => job.final).slice(-4)
    const partial = this.queue.filter((job) => !job.final).slice(-1)
    this.queue = [...finals, ...partial].sort((a, b) => a.id - b.id)
    this.pump()
  }

  private pump(): void {
    if (!this.ready || this.busy || !this.worker) return
    const job = this.queue.shift()
    if (!job) return
    this.busy = true
    const copy = new Float32Array(job.pcm)
    this.worker.postMessage({ type: 'hear', id: job.id, pcm: copy, final: job.final }, [copy.buffer])
  }

  private disconnectNodes(): void {
    this.processor?.disconnect()
    this.source?.disconnect()
    this.mute?.disconnect()
    this.processor = null
    this.source = null
    this.mute = null
    if (this.ownsContext) void this.ctx?.close()
    this.ctx = null
    this.ownsContext = false
  }
}
