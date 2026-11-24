import { LiveEar } from './ear'

const PAUSE_BREAK_MS = 1800
const SPEECH_BITRATE = 256000

export type RecorderPhase = 'idle' | 'live' | 'paused'

export type AudioTake = { blob: Blob; extension: string }

type Listener = {
  onText: (committed: string, interim: string) => void
  onPhase: (phase: RecorderPhase, elapsedSeconds: number) => void
  onLevel: (level: number) => void
  onNote: (note: string) => void
  onAudio: (take: AudioTake | null) => void
}

type WakeLock = { release: () => Promise<void> }

export function recordingBlock(): string {
    if (typeof navigator === 'undefined') return 'このブラウザはマイク録音に対応していません。'
  if (!navigator.mediaDevices?.getUserMedia) {
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      return 'このページは保護されていないため、ブラウザがマイクを渡しません。httpsのアドレスで開くと録音できます。'
    }
    return 'このブラウザはマイク録音に対応していません。'
  }
  return ''
}

export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60
  const clock = `${minutes}:${String(seconds).padStart(2, '0')}`
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` : clock
}

export function audioFileName(title: string, date: string, extension: string): string {
  const raw = `${title.trim() || '会議'}_${date.trim() || '日付なし'}`
  const cleaned = raw.replace(/[\\/:*?"<>|\r\n]/g, ' ').replace(/\s+/g, ' ').trim()
  return `${cleaned.slice(0, 60) || '会議'}.${extension}`
}

export function appendPiece(previous: string, piece: string, gapMs: number): string {
  if (!piece) return previous
  if (!previous) return piece
  if (gapMs >= PAUSE_BREAK_MS && !previous.endsWith('\n')) return `${previous}\n${piece}`
  return previous + piece
}

export function liveTranscript(committed: string, interim: string): string {
  const pending = interim.trim()
  if (!pending) return committed
  return appendRecognized(committed, pending)
}

export function speechCovers(marks: number[], capturedAt: number, audioMs: number): boolean {
  const start = capturedAt - audioMs
  const end = capturedAt + 800
  return marks.some((mark) => mark >= start && mark <= end)
}

export function roomMicConstraints(): MediaTrackConstraints {
  return {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: true,
    channelCount: 1,
    sampleRate: { ideal: 48000 },
    voiceIsolation: false,
  } as MediaTrackConstraints
}

function compactHeard(text: string): string {
  return text.replace(/[\s、。！？!?・「」『』（）()]/g, '')
}

export function heardAlready(previous: string, incoming: string): boolean {
  const next = compactHeard(incoming)
  if (next.length < 4) return true
  const prev = compactHeard(previous)
  if (!prev) return false
  const window = prev.slice(-Math.max(next.length * 2, 80))
  if (window.includes(next)) return true
  const size = 6
  if (next.length < size) return false
  let hit = 0
  let total = 0
  for (let i = 0; i <= next.length - size; i += 2) {
    total += 1
    if (window.includes(next.slice(i, i + size))) hit += 1
  }
  return total > 0 && hit / total >= 0.6
}

export function mergeHeard(previous: string, incoming: string): string {
  const next = incoming.trim()
  if (!next || heardAlready(previous, next)) return previous
  const prev = previous.replace(/\s+$/g, '')
  if (!prev) return next
  const merged = appendRecognized(prev, next)
  if (merged !== prev + next) return merged
  return `${prev}\n${next}`
}

export function appendRecognized(previous: string, incoming: string): string {
  const next = incoming.trim()
  if (!next) return previous
  if (!previous) return next
  const prevChars = Array.from(previous)
  const nextChars = Array.from(next)
  const max = Math.min(prevChars.length, nextChars.length, 30)
  for (let size = max; size >= 4; size -= 1) {
    if (prevChars.slice(-size).join('') === nextChars.slice(0, size).join('')) {
      return previous + nextChars.slice(size).join('')
    }
  }
  return previous + next
}

export function pickRecordingFormat(): { mimeType: string; extension: string } {
  const options = [
    { mimeType: 'audio/webm;codecs=opus', extension: 'webm' },
    { mimeType: 'audio/webm', extension: 'webm' },
    { mimeType: 'audio/mp4', extension: 'm4a' },
    { mimeType: 'audio/ogg;codecs=opus', extension: 'ogg' },
  ]
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return { mimeType: '', extension: 'webm' }
  }
  for (const option of options) {
    if (MediaRecorder.isTypeSupported(option.mimeType)) return option
  }
  return { mimeType: '', extension: 'webm' }
}

export class MeetingRecorder {
  private listener: Listener
  private generation = 0
  private phase: RecorderPhase = 'idle'
  private base = ''
  private lastVoiceAt = 0
  private ranMs = 0
  private mark = 0
  private ear: LiveEar
  private liveCtx: AudioContext | null = null
  private speech: SpeechRecognitionLike | null = null
  private wantSpeech = false
  private speechHeard = false
  private speechFails = 0
  private interimSpeech = ''
  private speechMarks: number[] = []
  private restartTimer = 0
  private localStarted = false
  private recorder: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private audio: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private samples: Uint8Array<ArrayBuffer> | null = null
  private chunks: Blob[] = []
  private extension = 'webm'
  private mimeType = ''
  private wake: WakeLock | null = null
  private raf = 0
  private clockTimer = 0
  private heardSpeech = false
  private onVisible = () => {
    if (document.visibilityState === 'visible' && this.phase !== 'idle') void this.claimWake()
  }

  constructor(listener: Listener) {
    this.listener = listener
    this.ear = new LiveEar({
      onPartial: (text) => {
        if (this.phase !== 'live' || this.speechHeard || this.interimSpeech.trim()) return
        if (heardAlready(this.base, text)) return
        this.markHeard()
        this.emitText(text)
      },
      onFinal: (text, capturedAt, audioMs) => {
        const browserText = `${this.base}${this.interimSpeech}`.trim()
        if (browserText && this.wantSpeech && speechCovers(this.speechMarks, capturedAt, audioMs)) return
        const merged = mergeHeard(this.base, text)
        if (merged === this.base) return
        this.base = merged
        this.lastVoiceAt = performance.now()
        this.markHeard()
        this.emitText(this.interimSpeech)
      },
      onStatus: (note) => {
        if (this.phase === 'idle') return
        if (this.speechHeard && !note.includes('準備')) return
        this.listener.onNote(note)
      },
    })
  }

  clearText(): void {
    this.base = ''
    this.interimSpeech = ''
    this.lastVoiceAt = 0
    this.emitText('')
  }

  async start(existing: string): Promise<string> {
    const blocked = recordingBlock()
    if (blocked) return blocked
    const canSpeech = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
    this.destroyQuiet()
    const generation = ++this.generation
    this.base = existing.trim() ? `${existing.replace(/\s+$/g, '')}\n` : ''
    this.chunks = []
    this.ranMs = 0
    this.lastVoiceAt = 0
    this.heardSpeech = false
    this.speechHeard = false
    this.speechFails = 0
    this.interimSpeech = ''
    this.speechMarks = []
    this.localStarted = false
    this.phase = 'live'
    this.mark = performance.now()
    this.wantSpeech = canSpeech
    if (canSpeech) this.openSpeech()
    if (!this.speech) this.wantSpeech = false
    this.clockTimer = window.setInterval(() => this.emitPhase(), 250)
    this.emitPhase()
    this.emitText('')
    this.primeAudio()
    void this.beginLocal()
    this.listener.onNote(
      this.speech
        ? '自分の声はすぐに文字にします。拾えない音は、精度の高いモデルで少し遅れて足します。'
        : 'マイクの音を、この端末の中で文字にします。少し遅れて欄に出ます。',
    )
    document.addEventListener('visibilitychange', this.onVisible)
    void this.claimWake()
    if (this.generation !== generation) return ''
    return ''
  }

  private failStart(): void {
    this.wantSpeech = false
    this.phase = 'idle'
    this.clearTimers()
    this.stopSpeech()
    this.ear.release()
    this.closeLiveCtx()
    this.recorder = null
    this.releaseHardware()
    document.removeEventListener('visibilitychange', this.onVisible)
    this.listener.onLevel(0)
    this.listener.onPhase('idle', 0)
  }

  pause(): void {
    if (this.phase !== 'live') return
    this.ranMs += performance.now() - this.mark
    this.phase = 'paused'
    this.wantSpeech = false
    this.stopSpeech()
    this.emitText('')
    this.ear.pause()
    if (this.recorder?.state === 'recording' && typeof this.recorder.pause === 'function') this.recorder.pause()
    this.emitPhase()
    this.listener.onNote('一時停止中です。ここまでの音声と文字は残っています。')
  }

  resume(): void {
    if (this.phase !== 'paused') return
    this.phase = 'live'
    this.mark = performance.now()
    if (this.recorder?.state === 'paused' && typeof this.recorder.resume === 'function') this.recorder.resume()
    this.wantSpeech = true
    this.speechFails = 0
    this.openSpeech()
    this.ear.resume()
    this.emitPhase()
  }

  async stop(): Promise<void> {
    if (this.phase === 'idle') return
    if (this.phase === 'live') this.ranMs += performance.now() - this.mark
    this.wantSpeech = false
    this.clearTimers()
    this.stopSpeech()
    await this.ear.close()
    this.closeLiveCtx()
    this.generation += 1
    this.phase = 'idle'
    const take = await this.finishRecorder()
    this.releaseHardware()
    document.removeEventListener('visibilitychange', this.onVisible)
    this.listener.onLevel(0)
    this.emitText('')
    this.listener.onPhase('idle', Math.floor(this.ranMs / 1000))
    this.listener.onAudio(take)
    this.listener.onNote(take ? '録音を止めました。音声ファイルを保存できます。' : '録音を止めました。文字は欄に残っています。')
  }

  destroy(): void {
    this.generation += 1
    this.wantSpeech = false
    this.phase = 'idle'
    this.clearTimers()
    this.stopSpeech()
    this.ear.shutdown()
    this.closeLiveCtx()
    try {
      if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop()
    } catch {
      /* 停止済み */
    }
    this.recorder = null
    this.releaseHardware()
    document.removeEventListener('visibilitychange', this.onVisible)
  }

  private destroyQuiet(): void {
    this.wantSpeech = false
    this.clearTimers()
    this.stopSpeech()
    this.ear.release()
    this.closeLiveCtx()
    this.recorder = null
    this.releaseHardware()
  }

  private primeAudio(): void {
    if (this.liveCtx && this.liveCtx.state !== 'closed') {
      void this.liveCtx.resume()
      return
    }
    const Ctx = window.AudioContext
    if (!Ctx) return
    try {
      this.liveCtx = new Ctx()
      void this.liveCtx.resume()
    } catch {
      this.liveCtx = null
    }
  }

  private closeLiveCtx(): void {
    const ctx = this.liveCtx
    this.liveCtx = null
    void ctx?.close()
  }

  private openSpeech(): void {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Ctor || this.speech || !this.wantSpeech || this.phase !== 'live') return
    const recognition = new Ctor()
    recognition.lang = 'ja-JP'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.onresult = (event) => {
      let finals = ''
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        const alternative = result?.[0]
        const piece = alternative?.transcript ?? ''
        if (result?.isFinal) finals += piece
        else interim += piece
      }
      if (finals || interim) {
        this.speechHeard = true
        this.speechFails = 0
        this.speechMarks.push(performance.now())
        if (this.speechMarks.length > 40) this.speechMarks.splice(0, this.speechMarks.length - 40)
        this.markHeard()
      }
      if (finals) {
        this.commitHeard(finals)
        this.interimSpeech = ''
      }
      this.interimSpeech = interim
      this.emitText(interim)
    }
    recognition.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.wantSpeech = false
        this.listener.onNote('マイクの音声認識がブロックされています。ブラウザの設定で許可してください。')
        return
      }
      if (event.error === 'audio-capture') {
        this.listener.onNote('自分の声の文字起こしを続けます。')
        return
      }
      this.speechFails += 1
      if (this.speechFails >= 4) this.wantSpeech = false
    }
    recognition.onend = () => {
      if (this.interimSpeech) {
        this.commitHeard(this.interimSpeech)
        this.interimSpeech = ''
        this.emitText('')
      }
      this.speech = null
      if (!this.wantSpeech || this.phase !== 'live') return
      this.restartTimer = window.setTimeout(() => this.openSpeech(), this.speechFails > 0 ? 700 : 250)
    }
    try {
      recognition.start()
    } catch {
      return
    }
    this.speech = recognition
  }

  private async beginLocal(): Promise<void> {
    if (this.localStarted || this.phase !== 'live') return
    this.localStarted = true
    let stream: MediaStream
    try {
      // エコー除去と雑音抑制は、スピーカーのラジオを声以外として消す。
      stream = await navigator.mediaDevices.getUserMedia({ audio: roomMicConstraints() })
    } catch {
      if (this.phase !== 'live') return
      if (this.speech) {
        this.listener.onNote('スピーカーの音を拾うマイクを開けませんでした。自分の声の文字起こしは続きます。')
        return
      }
      this.failStart()
      this.listener.onNote('文字起こしを始められませんでした。Chromeで開き直すか、文字を貼り付けてください。')
      return
    }
    if (this.phase !== 'live') {
      stream.getTracks().forEach((track) => track.stop())
      return
    }
    this.stream = stream
    this.primeAudio()
    this.openMeter(stream)
    try {
      this.openRecorder(stream)
    } catch {
      this.listener.onNote('音声ファイルは保存できません。文字起こしは続けます。')
    }
    this.ear.open(stream, this.liveCtx)
    this.pumpLevel()
    if (this.wantSpeech && !this.speechHeard && this.phase === 'live') {
      this.stopSpeech()
      this.wantSpeech = true
      this.openSpeech()
      if (!this.speech) this.restartTimer = window.setTimeout(() => this.openSpeech(), 400)
    }
  }

  private stopSpeech(): void {
    window.clearTimeout(this.restartTimer)
    this.restartTimer = 0
    if (this.interimSpeech) {
      this.commitHeard(this.interimSpeech)
      this.interimSpeech = ''
    }
    const speech = this.speech
    this.speech = null
    if (!speech) return
    try {
      speech.onend = null
      speech.onresult = null
      speech.onerror = null
      speech.abort()
    } catch {
      /* すでに止まっている */
    }
  }

  private openRecorder(stream: MediaStream): void {
    const format = pickRecordingFormat()
    this.extension = format.extension
    this.mimeType = format.mimeType || 'audio/webm'
    const attempts: MediaRecorderOptions[] = []
    if (format.mimeType) {
      attempts.push({ mimeType: format.mimeType, audioBitsPerSecond: SPEECH_BITRATE })
      attempts.push({ mimeType: format.mimeType })
    }
    attempts.push({ audioBitsPerSecond: SPEECH_BITRATE })
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
    if (!recorder) throw new Error('MediaRecorder')
    this.mimeType = recorder.mimeType || this.mimeType
    if (this.mimeType.includes('mp4')) this.extension = 'm4a'
    else if (this.mimeType.includes('ogg')) this.extension = 'ogg'
    else this.extension = 'webm'
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data)
    }
    recorder.start(1000)
    this.recorder = recorder
  }

  private openMeter(stream: MediaStream): void {
    const Ctx = window.AudioContext
    if (!Ctx) return
    try {
      const audio = new Ctx()
      void audio.resume()
      const source = audio.createMediaStreamSource(stream)
      const analyser = audio.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.65
      source.connect(analyser)
      this.audio = audio
      this.analyser = analyser
      this.samples = new Uint8Array(new ArrayBuffer(analyser.fftSize))
    } catch {
      this.audio = null
      this.analyser = null
    }
  }

  private commitHeard(text: string): void {
    const clean = text.trim()
    if (!clean) return
    const now = performance.now()
    const gap = this.lastVoiceAt ? now - this.lastVoiceAt : 0
    if (!this.base.trim()) this.base = clean
    else if (gap >= PAUSE_BREAK_MS && !this.base.endsWith('\n')) this.base = `${this.base}\n${clean}`
    else this.base = appendRecognized(this.base, clean)
    this.lastVoiceAt = now
    this.markHeard()
  }

  private markHeard(): void {
    if (this.heardSpeech) return
    this.heardSpeech = true
    this.listener.onNote('文字起こし欄に、話した順で出しています。')
  }

  private emitText(interim: string): void {
    this.listener.onText(this.base, interim)
  }

  private emitPhase(): void {
    const extra = this.phase === 'live' ? performance.now() - this.mark : 0
    this.listener.onPhase(this.phase, Math.floor((this.ranMs + extra) / 1000))
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

  private async finishRecorder(): Promise<AudioTake | null> {
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
        window.setTimeout(resolve, 900)
      })
    }
    if (this.chunks.length === 0) return null
    return { blob: new Blob(this.chunks, { type: this.mimeType || 'audio/webm' }), extension: this.extension }
  }

  private async claimWake(): Promise<void> {
    const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLock> } }
    if (!nav.wakeLock || this.phase === 'idle') return
    try {
      this.wake = await nav.wakeLock.request('screen')
    } catch {
      this.wake = null
    }
  }

  private releaseHardware(): void {
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
    void this.audio?.close()
    this.audio = null
    this.analyser = null
    this.samples = null
    void this.wake?.release()
    this.wake = null
    if (this.raf) window.cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  private clearTimers(): void {
    window.clearInterval(this.clockTimer)
    window.clearTimeout(this.restartTimer)
    this.clockTimer = 0
    this.restartTimer = 0
  }
}
