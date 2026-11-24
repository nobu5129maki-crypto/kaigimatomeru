import { pickRecordingFormat, roomMicConstraints } from './capture'

export const PEAK_MS = 100

export type RecQuality = 'wav' | 'long'
export type RecPhase = 'idle' | 'live' | 'paused'
export type RecMark = { id: number; ms: number; label: string }
export type RecTake = { blob: Blob; extension: string }

type Listener = {
  onPhase: (phase: RecPhase, elapsedSeconds: number) => void
  onLevel: (level: number) => void
  onWave: (peaks: number[], bytes: number) => void
  onMarks: (marks: RecMark[]) => void
  onNote: (note: string) => void
  onAudio: (take: RecTake | null) => void
}

type WakeLock = { release: () => Promise<void> }

function writeText(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
}

export function pcm16Bytes(input: Float32Array): Uint8Array {
  const bytes = new Uint8Array(input.length * 2)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i] ?? 0))
    view.setInt16(i * 2, sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff), true)
  }
  return bytes
}

export function wavBlob(parts: Uint8Array[], sampleRate: number): Blob {
  const dataBytes = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const header = new ArrayBuffer(44)
  const view = new DataView(header)
  writeText(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeText(view, 8, 'WAVE')
  writeText(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeText(view, 36, 'data')
  view.setUint32(40, dataBytes, true)
  const chunks: BlobPart[] = [header]
  for (const part of parts) {
    const copy = new ArrayBuffer(part.byteLength)
    new Uint8Array(copy).set(part)
    chunks.push(copy)
  }
  return new Blob(chunks, { type: 'audio/wav' })
}

export function blockPeak(input: Float32Array): number {
  let peak = 0
  for (let i = 0; i < input.length; i += 1) peak = Math.max(peak, Math.abs(input[i] ?? 0))
  return Math.min(1, peak)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export function skipTo(peaks: number[], atMs: number, floor = 0.045): number | null {
  const index = Math.floor(atMs / PEAK_MS)
  if (index < 0 || index >= peaks.length || (peaks[index] ?? 0) >= floor) return null
  let quiet = 0
  for (let i = index; i < peaks.length; i += 1) {
    if ((peaks[i] ?? 0) >= floor) return quiet >= 4 ? i * PEAK_MS : null
    quiet += 1
  }
  return null
}

export class FieldRecorder {
  quality: RecQuality = 'wav'
  private mode: RecQuality = 'wav'
  private listener: Listener
  private generation = 0
  private phase: RecPhase = 'idle'
  private ranMs = 0
  private markAt = 0
  private stream: MediaStream | null = null
  private ctx: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private analyser: AnalyserNode | null = null
  private processor: ScriptProcessorNode | null = null
  private mute: GainNode | null = null
  private samples: Uint8Array<ArrayBuffer> | null = null
  private recorder: MediaRecorder | null = null
  private compressed: Blob[] = []
  private pcm: Uint8Array[] = []
  private pcmBytes = 0
  private sampleRate = 48000
  private peaks: number[] = []
  private peakBucket = 0
  private peakMax = 0
  private marks: RecMark[] = []
  private markSeq = 0
  private extension = 'wav'
  private mimeType = ''
  private raf = 0
  private clockTimer = 0
  private waveTimer = 0
  private wake: WakeLock | null = null
  private onVisible = () => {
    if (document.visibilityState === 'visible' && this.phase !== 'idle') void this.claimWake()
  }

  constructor(listener: Listener) {
    this.listener = listener
  }

  async start(): Promise<string> {
    if (!navigator.mediaDevices?.getUserMedia) return 'このブラウザはマイク録音に対応していません。'
    if (this.phase !== 'idle') return ''
    this.destroyQuiet()
    const generation = ++this.generation
    this.ranMs = 0
    this.pcm = []
    this.pcmBytes = 0
    this.compressed = []
    this.peaks = []
    this.peakBucket = 0
    this.peakMax = 0
    this.marks = []
    this.markSeq = 0
    this.mode = this.quality
    this.phase = 'live'
    this.ranMs = 0
    this.markAt = performance.now()
    this.listener.onPhase('live', 0)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: roomMicConstraints() })
    } catch {
      if (this.generation !== generation) return ''
      this.failStart()
      return 'マイクを開けませんでした。ブラウザの設定で許可してください。'
    }
    if (this.generation !== generation || this.phase !== 'live') {
      stream.getTracks().forEach((track) => track.stop())
      return ''
    }
    this.stream = stream
    this.openGraph(stream)
    const lead = performance.now() - this.markAt
    this.markAt = performance.now()
    this.ranMs = 0
    if (this.marks.length) {
      this.marks = this.marks.map((mark) => ({ ...mark, ms: Math.max(0, mark.ms - lead) }))
      this.listener.onMarks(this.marks)
    }
    if (this.mode === 'wav' && !this.processor) this.mode = 'long'
    if (this.mode === 'long') this.openCompressed(stream)
    this.extension = this.mode === 'wav' ? 'wav' : this.extension
    this.clockTimer = window.setInterval(() => this.emitPhase(), 250)
    this.waveTimer = window.setInterval(() => this.emitWave(), 200)
    this.emitPhase()
    this.emitWave()
    this.listener.onMarks(this.marks)
    this.pumpLevel()
    document.addEventListener('visibilitychange', this.onVisible)
    void this.claimWake()
    this.listener.onNote(
      this.mode === 'wav'
        ? '高音質で録音しています。48kHz、16bitのWAVです。'
        : '長時間向けに、容量を抑えて録音しています。',
    )
    return ''
  }

  pause(): void {
    if (this.phase !== 'live') return
    this.ranMs += performance.now() - this.markAt
    this.phase = 'paused'
    if (this.recorder?.state === 'recording' && typeof this.recorder.pause === 'function') this.recorder.pause()
    this.emitPhase()
    this.listener.onNote('一時停止中です。録音はそのまま残っています。')
  }

  resume(): void {
    if (this.phase !== 'paused') return
    this.phase = 'live'
    this.markAt = performance.now()
    if (this.recorder?.state === 'paused' && typeof this.recorder.resume === 'function') this.recorder.resume()
    this.emitPhase()
    this.listener.onNote(this.mode === 'wav' ? '高音質の録音を続けています。' : '録音を続けています。')
  }

  addMark(): void {
    if (this.phase === 'idle') return
    const ms = this.elapsedMs()
    this.markSeq += 1
    this.marks = [...this.marks, { id: this.markSeq, ms, label: `印${this.marks.length + 1}` }]
    this.listener.onMarks(this.marks)
    this.listener.onNote(`${this.marks.length}個目の印を付けました。`)
  }

  async stop(): Promise<void> {
    if (this.phase === 'idle') return
    if (this.phase === 'live') this.ranMs += performance.now() - this.markAt
    this.clearTimers()
    this.generation += 1
    this.phase = 'idle'
    const take = await this.finishTake()
    this.releaseGraph()
    this.releaseHardware()
    document.removeEventListener('visibilitychange', this.onVisible)
    this.listener.onLevel(0)
    this.listener.onPhase('idle', Math.floor(this.ranMs / 1000))
    this.listener.onAudio(take)
    this.listener.onNote(take ? '録音を止めました。この録音を、選んだ長さと形にできます。' : '録音を止めました。音声が残っていません。')
  }

  destroy(): void {
    this.generation += 1
    this.phase = 'idle'
    this.clearTimers()
    this.releaseGraph()
    try {
      if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop()
    } catch {
      /* 停止済み */
    }
    this.recorder = null
    this.releaseHardware()
    document.removeEventListener('visibilitychange', this.onVisible)
  }

  private elapsedMs(): number {
    const extra = this.phase === 'live' ? performance.now() - this.markAt : 0
    return this.ranMs + extra
  }

  private failStart(): void {
    this.phase = 'idle'
    this.clearTimers()
    this.releaseGraph()
    this.releaseHardware()
    this.listener.onLevel(0)
    this.listener.onPhase('idle', 0)
  }

  private destroyQuiet(): void {
    this.clearTimers()
    this.releaseGraph()
    this.recorder = null
    this.releaseHardware()
  }

  private openGraph(stream: MediaStream): void {
    const Ctx = window.AudioContext
    if (!Ctx) return
    try {
      const audio = new Ctx({ sampleRate: 48000 })
      void audio.resume()
      const source = audio.createMediaStreamSource(stream)
      const analyser = audio.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.65
      const processor = audio.createScriptProcessor(4096, 1, 1)
      const mute = audio.createGain()
      mute.gain.value = 0
      source.connect(analyser)
      analyser.connect(processor)
      processor.connect(mute)
      mute.connect(audio.destination)
      processor.onaudioprocess = (event) => this.capture(event.inputBuffer.getChannelData(0))
      this.ctx = audio
      this.source = source
      this.analyser = analyser
      this.processor = processor
      this.mute = mute
      this.sampleRate = audio.sampleRate || 48000
      this.samples = new Uint8Array(new ArrayBuffer(analyser.fftSize))
    } catch {
      this.ctx = null
    }
  }

  private capture(input: Float32Array): void {
    if (this.phase !== 'live') return
    const peak = blockPeak(input)
    this.peakBucket += (input.length / this.sampleRate) * 1000
    this.peakMax = Math.max(this.peakMax, peak)
    while (this.peakBucket >= PEAK_MS) {
      this.peaks.push(this.peakMax)
      this.peakBucket -= PEAK_MS
      this.peakMax = 0
    }
    if (this.mode !== 'wav') return
    const bytes = pcm16Bytes(input)
    this.pcm.push(bytes)
    this.pcmBytes += bytes.byteLength
  }

  private openCompressed(stream: MediaStream): void {
    const format = pickRecordingFormat()
    this.extension = format.extension
    this.mimeType = format.mimeType || 'audio/webm'
    const attempts: MediaRecorderOptions[] = []
    if (format.mimeType) attempts.push({ mimeType: format.mimeType, audioBitsPerSecond: 128000 })
    attempts.push({ audioBitsPerSecond: 128000 })
    attempts.push({})
    let recorder: MediaRecorder | null = null
    for (const options of attempts) {
      try {
        recorder = new MediaRecorder(stream, options)
        break
      } catch {
        recorder = null
      }
    }
    if (!recorder) return
    this.mimeType = recorder.mimeType || this.mimeType
    if (this.mimeType.includes('mp4')) this.extension = 'm4a'
    else if (this.mimeType.includes('ogg')) this.extension = 'ogg'
    else this.extension = 'webm'
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.compressed.push(event.data)
    }
    recorder.start(1000)
    this.recorder = recorder
  }

  private async finishTake(): Promise<RecTake | null> {
    if (this.mode === 'wav') {
      if (this.pcmBytes < this.sampleRate * 0.2) return null
      return { blob: wavBlob(this.pcm, this.sampleRate), extension: 'wav' }
    }
    const recorder = this.recorder
    this.recorder = null
    if (!recorder) return null
    if (recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve()
        try {
          recorder.stop()
        } catch {
          resolve()
        }
      })
    }
    if (!this.compressed.length) return null
    return { blob: new Blob(this.compressed, { type: this.mimeType || 'audio/webm' }), extension: this.extension }
  }

  private releaseGraph(): void {
    if (this.processor) this.processor.onaudioprocess = null
    this.processor?.disconnect()
    this.source?.disconnect()
    this.analyser?.disconnect()
    this.mute?.disconnect()
    this.processor = null
    this.source = null
    this.analyser = null
    this.mute = null
    const ctx = this.ctx
    this.ctx = null
    void ctx?.close()
  }

  private releaseHardware(): void {
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
    void this.wake?.release().catch(() => undefined)
    this.wake = null
  }

  private clearTimers(): void {
    window.clearInterval(this.clockTimer)
    window.clearInterval(this.waveTimer)
    window.cancelAnimationFrame(this.raf)
    this.clockTimer = 0
    this.waveTimer = 0
    this.raf = 0
  }

  private emitPhase(): void {
    this.listener.onPhase(this.phase, Math.floor(this.elapsedMs() / 1000))
  }

  private emitWave(): void {
    const bytes = this.mode === 'wav' ? this.pcmBytes + 44 : this.compressed.reduce((sum, blob) => sum + blob.size, 0)
    this.listener.onWave(this.peaks.slice(), bytes)
  }

  private pumpLevel = (): void => {
    if (this.phase === 'idle') return
    let level = 0
    if (this.phase === 'live' && this.analyser && this.samples) {
      this.analyser.getByteTimeDomainData(this.samples)
      let sum = 0
      for (let i = 0; i < this.samples.length; i += 1) {
        const value = (this.samples[i] - 128) / 128
        sum += value * value
      }
      level = Math.min(1, Math.sqrt(sum / this.samples.length) * 3.4)
    }
    this.listener.onLevel(level)
    this.raf = window.requestAnimationFrame(this.pumpLevel)
  }

  private async claimWake(): Promise<void> {
    const nav = navigator as Navigator & { wakeLock?: { request: (kind: 'screen') => Promise<WakeLock> } }
    if (!nav.wakeLock || this.wake) return
    try {
      this.wake = await nav.wakeLock.request('screen')
    } catch {
      this.wake = null
    }
  }
}
