const PAUSE_BREAK_MS = 1800
const RECYCLE_MS = 55000
const SPEECH_BITRATE = 128000

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
  if (typeof navigator === 'undefined') return 'このブラウザはマイク録音に対応していません。文字を貼り付けてください。'
  if (!navigator.mediaDevices?.getUserMedia) {
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      return 'このページは保護されていないため、ブラウザがマイクを渡しません。httpsのアドレスで開くと録音できます。'
    }
    return 'このブラウザはマイク録音に対応していません。文字を貼り付けてください。'
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

function micError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'マイクがブロックされています。ブラウザの設定で許可するか、文字を貼り付けてください。'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'マイクが見つかりません。文字を貼り付けてください。'
  if (name === 'NotReadableError') return 'マイクをほかのアプリが使っています。閉じてから、もう一度録音してください。'
  return '録音を始められませんでした。もう一度押すか、文字を貼り付けてください。'
}

function speechError(code: string): string {
  if (code === 'not-allowed' || code === 'service-not-allowed') {
    return '音声認識がブロックされています。録音そのものは続いています。'
  }
  if (code === 'network') return '文字起こしの通信が途絶えました。録音そのものは続いています。'
  if (code === 'audio-capture') return '文字起こし用のマイクが取れません。録音そのものは続いています。'
  return ''
}

export class MeetingRecorder {
  private listener: Listener
  private generation = 0
  private phase: RecorderPhase = 'idle'
  private base = ''
  private pretty = ''
  private raw = ''
  private lastVoiceAt = 0
  private ranMs = 0
  private mark = 0
  private wantSpeech = false
  private speech: SpeechRecognitionLike | null = null
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
  private recycleTimer = 0
  private restartTimer = 0
  private heardSpeech = false
  private onVisible = () => {
    if (document.visibilityState === 'visible' && this.phase !== 'idle') void this.claimWake()
  }

  constructor(listener: Listener) {
    this.listener = listener
  }

  async start(existing: string): Promise<string> {
    const blocked = recordingBlock()
    if (blocked) return blocked
    this.destroyQuiet()
    const generation = ++this.generation
    this.base = existing.trim() ? `${existing.replace(/\s+$/g, '')}\n` : ''
    this.pretty = ''
    this.raw = ''
    this.chunks = []
    this.ranMs = 0
    this.lastVoiceAt = 0
    this.heardSpeech = false
    this.phase = 'live'
    this.mark = performance.now()
    this.wantSpeech = this.openSpeech()
    this.clockTimer = window.setInterval(() => this.emitPhase(), 250)
    this.emitPhase()
    this.emitText('')
    this.listener.onNote(
      this.wantSpeech
        ? '話した言葉を、文字起こし欄へ順に出します。'
        : '音声を録音しています。このブラウザは話しながらの文字起こしができないため、音声ファイルに残します。',
    )
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: { ideal: 1 },
        },
      })
    } catch (error) {
      if (this.generation === generation) this.failStart()
      return micError(error)
    }
    if (this.generation !== generation) {
      stream.getTracks().forEach((track) => track.stop())
      return ''
    }
    this.stream = stream
    this.openMeter(stream)
    try {
      this.openRecorder(stream)
    } catch {
      this.failStart()
      return '音声ファイルを作れませんでした。もう一度押すか、文字を貼り付けてください。'
    }
    document.addEventListener('visibilitychange', this.onVisible)
    void this.claimWake()
    this.pumpLevel()
    return ''
  }

  private failStart(): void {
    this.wantSpeech = false
    this.phase = 'idle'
    this.clearTimers()
    try {
      this.speech?.abort()
    } catch {
      /* 未開始 */
    }
    this.speech = null
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
    window.clearTimeout(this.recycleTimer)
    window.clearTimeout(this.restartTimer)
    try {
      this.speech?.stop()
    } catch {
      this.speech = null
      this.foldSession()
    }
    if (this.recorder?.state === 'recording' && typeof this.recorder.pause === 'function') this.recorder.pause()
    this.emitPhase()
    this.listener.onNote('一時停止中です。ここまでの音声と文字は残っています。')
  }

  resume(): void {
    if (this.phase !== 'paused') return
    this.phase = 'live'
    this.mark = performance.now()
    if (this.recorder?.state === 'paused' && typeof this.recorder.resume === 'function') this.recorder.resume()
    this.wantSpeech = this.openSpeech()
    this.emitPhase()
    this.listener.onNote(this.wantSpeech ? '録音を続けています。' : '音声の録音を続けています。')
  }

  async stop(): Promise<void> {
    if (this.phase === 'idle') return
    this.generation += 1
    if (this.phase === 'live') this.ranMs += performance.now() - this.mark
    this.phase = 'idle'
    this.wantSpeech = false
    this.clearTimers()
    const speech = this.speech
    this.speech = null
    if (speech) {
      await new Promise<void>((resolve) => {
        const previous = speech.onend
        speech.onend = () => {
          previous?.call(speech)
          resolve()
        }
        try {
          speech.stop()
        } catch {
          resolve()
        }
        window.setTimeout(resolve, 900)
      })
    }
    this.foldSession()
    const take = await this.finishRecorder()
    this.releaseHardware()
    document.removeEventListener('visibilitychange', this.onVisible)
    this.listener.onLevel(0)
    this.emitText('')
    this.listener.onPhase('idle', Math.floor(this.ranMs / 1000))
    this.listener.onAudio(take)
    this.listener.onNote(take ? '録音を止めました。音声ファイルを保存できます。' : '録音を止めました。')
  }

  destroy(): void {
    this.generation += 1
    this.wantSpeech = false
    this.phase = 'idle'
    this.clearTimers()
    try {
      this.speech?.abort()
    } catch {
      /* すでに止まっている */
    }
    this.speech = null
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
    this.clearTimers()
    try {
      this.speech?.abort()
    } catch {
      /* 未開始 */
    }
    this.speech = null
    this.recorder = null
    this.releaseHardware()
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

  private openSpeech(): boolean {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Ctor || this.speech) return Boolean(this.speech)
    const recognition = new Ctor()
    recognition.lang = 'ja-JP'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.onresult = (event) => {
      let finals = ''
      let interim = ''
      for (let i = 0; i < event.results.length; i += 1) {
        const piece = event.results[i][0]?.transcript ?? ''
        if (event.results[i].isFinal) finals += piece
        else interim += piece
      }
      this.takeFinals(finals)
      if (finals || interim) this.markHeard()
      this.emitText(interim)
    }
    recognition.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return
      const note = speechError(event.error)
      if (note) this.listener.onNote(note)
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') this.wantSpeech = false
    }
    recognition.onend = () => {
      this.foldSession()
      this.speech = null
      window.clearTimeout(this.recycleTimer)
      if (!this.wantSpeech || this.phase !== 'live') return
      this.restartTimer = window.setTimeout(() => {
        if (this.wantSpeech && this.phase === 'live') this.openSpeech()
      }, 160)
    }
    try {
      recognition.start()
    } catch {
      return false
    }
    this.speech = recognition
    window.clearTimeout(this.recycleTimer)
    this.recycleTimer = window.setTimeout(() => {
      if (this.speech === recognition && this.phase === 'live') {
        try {
          recognition.stop()
        } catch {
          /* 次の onend で繋ぐ */
        }
      }
    }, RECYCLE_MS)
    return true
  }

  private takeFinals(finals: string): void {
    if (!finals) return
    const now = performance.now()
    if (finals.startsWith(this.raw)) {
      const added = finals.slice(this.raw.length)
      if (added) {
        this.pretty = appendPiece(this.pretty, added, this.lastVoiceAt ? now - this.lastVoiceAt : 0)
        this.lastVoiceAt = now
      }
      this.raw = finals
      return
    }
    const novel = appendRecognized('', tailAfter(this.raw, finals))
    if (novel) {
      this.pretty = appendPiece(this.pretty, novel, this.lastVoiceAt ? now - this.lastVoiceAt : 0)
      this.lastVoiceAt = now
    }
    this.raw = finals
  }

  private foldSession(): void {
    if (!this.pretty.trim() && !this.raw.trim()) {
      this.pretty = ''
      this.raw = ''
      return
    }
    this.base = appendRecognized(this.base, this.pretty || this.raw)
    this.pretty = ''
    this.raw = ''
    this.emitText('')
  }

  private markHeard(): void {
    if (this.heardSpeech) return
    this.heardSpeech = true
    this.listener.onNote('文字起こし欄に、話した順で出しています。')
  }

  private emitText(interim: string): void {
    this.listener.onText(appendRecognized(this.base, this.pretty), interim)
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
    window.clearTimeout(this.recycleTimer)
    window.clearTimeout(this.restartTimer)
    this.clockTimer = 0
  }
}

function tailAfter(previous: string, incoming: string): string {
  const joined = appendRecognized(previous, incoming)
  return joined.slice(previous.length)
}
