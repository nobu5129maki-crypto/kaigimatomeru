import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
import { audioFileName, formatClock, recordingBlock } from './capture'
import { applyDraft, draftKey, isDraft, snapshot, type DraftBody } from './draft'
import { docxBlob, downloadBlob, fileStem, markdownDocument, shareFile, textBlob } from './files'
import { Manuscript } from './Manuscript'
import { decodeTo16k, FileEar, isAudioFile, limitPcm } from './fileEar'
import {
  FieldRecorder,
  formatBytes,
  skipTo,
  type RecMark,
  type RecPhase,
  type RecQuality,
} from './studio'
import {
  combineRoster,
  emptyRoster,
  joinAttendees,
  rememberRoster,
  rosterFromHistory,
  splitAttendees,
  toggleAttendee,
  type Roster,
} from './roster'
import {
  LENGTHS,
  STYLE_GROUPS,
  STYLES,
  charCount,
  documentText,
  orderStyles,
  summarize,
  type LengthId,
  type StyleId,
  type SummaryResult,
} from './summarize'

const HISTORY_KEY = 'kaigimatomeru.history.v1'
const PREF_KEY = 'kaigimatomeru.pref.v1'
const ROSTER_KEY = 'kaigimatomeru.roster.v1'
const SPEAKER_KEY = 'kaigimatomeru.speakers.v1'

type HistoryItem = {
  id: string
  savedAt: string
  title: string
  date: string
  attendees: string
  transcript: string
  length: LengthId
  style: StyleId
  styles?: StyleId[]
  draft?: DraftBody
}

type Pref = { length: LengthId; styles: StyleId[] }

function loadQuality(): RecQuality {
  try {
    return localStorage.getItem('kaigimatomeru.quality.v1') === 'long' ? 'long' : 'wav'
  } catch {
    return 'wav'
  }
}

function todayIso(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function isLength(value: unknown): value is LengthId {
  return typeof value === 'string' && value in LENGTHS
}

function isStyle(value: unknown): value is StyleId {
  return typeof value === 'string' && value in STYLES
}

function isHistory(value: unknown): value is HistoryItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<HistoryItem>
  return (
    typeof item.id === 'string' &&
    typeof item.savedAt === 'string' &&
    typeof item.title === 'string' &&
    typeof item.date === 'string' &&
    typeof item.attendees === 'string' &&
    typeof item.transcript === 'string' &&
    isLength(item.length) &&
    isStyle(item.style)
  )
}

function loadHistory(): HistoryItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isHistory).slice(0, 12).map((item) => (isDraft(item.draft) ? item : { ...item, draft: undefined }))
  } catch {
    return []
  }
}

function isRoster(value: unknown): value is Roster {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<Roster>
  return Array.isArray(item.titles) && Array.isArray(item.groups) && Array.isArray(item.names) &&
    item.titles.every((entry) => typeof entry === 'string') &&
    item.groups.every((entry) => typeof entry === 'string') &&
    item.names.every((entry) => typeof entry === 'string')
}

function loadSpeakers(): boolean {
  try {
    return localStorage.getItem(SPEAKER_KEY) === 'on'
  } catch {
    return false
  }
}

function loadRoster(): Roster {
  try {
    const parsed = JSON.parse(localStorage.getItem(ROSTER_KEY) ?? '{}') as unknown
    return isRoster(parsed) ? parsed : emptyRoster()
  } catch {
    return emptyRoster()
  }
}

function loadPref(): Pref {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') as {
      length?: unknown
      style?: unknown
      shapes?: unknown
      voice?: unknown
      record?: unknown
    }
    const length = isLength(parsed.length) ? parsed.length : 'c200'
    const shapes = Array.isArray(parsed.shapes)
      ? parsed.shapes.filter((id): id is StyleId => isStyle(id) && STYLES[id].group === 'shape')
      : []
    let voice = isStyle(parsed.voice) && STYLES[parsed.voice].group === 'voice' ? parsed.voice : null
    let record = isStyle(parsed.record) && STYLES[parsed.record].group === 'record' ? parsed.record : null
    if (!voice && !record && shapes.length === 0 && isStyle(parsed.style)) {
      const group = STYLES[parsed.style].group
      if (group === 'shape') shapes.push(parsed.style)
      else if (group === 'voice') voice = parsed.style
      else if (group === 'record') record = parsed.style
      else if (parsed.style === 'point') {
        return { length: 'point', styles: [] }
      }
    }
    const picked = orderStyles([...shapes, ...(voice ? [voice] : []), ...(record ? [record] : [])])
    return { length, styles: picked.length ? picked : ['memo'] }
  } catch {
    return { length: 'c200', styles: [] }
  }
}

function activeStyles(item: { style: StyleId; styles?: StyleId[] }): StyleId[] {
  const styles = item.styles?.filter((id): id is StyleId => isStyle(id)) ?? []
  return orderStyles(styles.length ? styles : [item.style])
}

function styleCaption(styles: StyleId[], length: LengthId): string {
  const labels = styles.filter((id) => id !== 'point').map((id) => STYLES[id].label)
  if (length === 'point' || (styles.length === 1 && styles[0] === 'point')) {
    return labels.length ? `${STYLES.point.label}、${labels.join('、')}` : STYLES.point.label
  }
  if (labels.length === 0) return LENGTHS[length].label
  return `${labels.join('、')}／${LENGTHS[length].label}`
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', 'true')
    area.style.position = 'fixed'
    area.style.left = '-9999px'
    document.body.appendChild(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  }
}

function signatureOf(input: {
  transcript: string
  title: string
  date: string
  attendees: string
  length: LengthId
  styles: StyleId[]
}): string {
  return JSON.stringify({
    transcript: input.transcript.trim(),
    title: input.title.trim(),
    date: input.date,
    attendees: input.attendees.trim(),
    length: input.length,
    styles: orderStyles(input.styles),
  })
}

export function App() {
  const pref = useRef(loadPref())
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(todayIso)
  const [attendees, setAttendees] = useState('')
  const [transcript, setTranscript] = useState('')
  const [phase, setPhase] = useState<RecPhase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [quality, setQuality] = useState<RecQuality>(loadQuality)
  const [peaks, setPeaks] = useState<number[]>([])
  const [bytes, setBytes] = useState(0)
  const [marks, setMarks] = useState<RecMark[]>([])
  const [skipSilence, setSkipSilence] = useState(false)
  const [playMs, setPlayMs] = useState(0)
  const [recError, setRecError] = useState('')
  const [recNote, setRecNote] = useState('')
  const [audioUrl, setAudioUrl] = useState('')
  const [audioExt, setAudioExt] = useState('webm')
  const [length, setLength] = useState<LengthId>(pref.current.length)
  const [styles, setStyles] = useState<StyleId[]>(pref.current.styles)
  const [hearing, setHearing] = useState(false)
  const [bar, setBar] = useState(0)
  const [doc, setDoc] = useState<SummaryResult | null>(null)
  const [fresh, setFresh] = useState('')
  const [generation, setGeneration] = useState(0)
  const [signed, setSigned] = useState('')
  const [notice, setNotice] = useState('')
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [roster, setRoster] = useState<Roster>(emptyRoster)
  const [speakers, setSpeakers] = useState(loadSpeakers)
  const [dragging, setDragging] = useState(false)
  const resultRef = useRef<HTMLElement>(null)
  const meterRef = useRef<HTMLSpanElement>(null)
  const waveRef = useRef<HTMLCanvasElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const peaksRef = useRef<number[]>([])
  const recorderRef = useRef<FieldRecorder | null>(null)
  const audioBlobRef = useRef<Blob | null>(null)
  const audioUrlRef = useRef('')
  const fileEarRef = useRef<FileEar | null>(null)
  const barCapRef = useRef(8)
  const audioFileRef = useRef<HTMLInputElement>(null)
  const heardModeRef = useRef('')
  const draftIdRef = useRef('')

  const micBlock = recordingBlock()

  useEffect(() => {
    const saved = loadHistory()
    setHistory(saved)
    setRoster(combineRoster(loadRoster(), rosterFromHistory(saved)))
  }, [])

  function keepNames(nextTitle = title, nextAttendees = attendees) {
    setRoster((current) => {
      const next = rememberRoster(current, { title: nextTitle, attendees: nextAttendees })
      try {
        localStorage.setItem(ROSTER_KEY, JSON.stringify(next))
      } catch {
        /* 記憶できなくても、入力自体はそのまま使える */
      }
      return next
    })
  }

  useEffect(() => {
    const shapes = styles.filter((id) => STYLES[id].group === 'shape')
    const voice = styles.find((id) => STYLES[id].group === 'voice') ?? null
    const record = styles.find((id) => STYLES[id].group === 'record') ?? null
    localStorage.setItem(
      PREF_KEY,
      JSON.stringify({
        length,
        style: voice || record || shapes[0] || (length === 'point' ? 'point' : 'memo'),
        shapes,
        voice,
        record,
      }),
    )
  }, [length, styles])

  useEffect(() => {
    const recorder = new FieldRecorder({
      onPhase: (next, seconds) => {
        setPhase(next)
        setElapsed(seconds)
      },
      onLevel: (level) => {
        if (meterRef.current) meterRef.current.style.transform = `scaleX(${level.toFixed(3)})`
      },
      onWave: (next, size) => {
        peaksRef.current = next
        setPeaks(next)
        setBytes(size)
      },
      onMarks: (next) => setMarks(next),
      onNote: (note) => setRecNote(note),
      onAudio: (take) => {
        if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
        if (!take) {
          audioBlobRef.current = null
          audioUrlRef.current = ''
          setAudioUrl('')
          return
        }
        const url = URL.createObjectURL(take.blob)
        audioBlobRef.current = take.blob
        audioUrlRef.current = url
        setAudioUrl(url)
        setAudioExt(take.extension)
        setTranscript('')
        heardModeRef.current = ''
        setPlayMs(0)
      },
    })
    recorderRef.current = recorder
    return () => {
      recorder.destroy()
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    }
  }, [])

  useEffect(() => {
    const canvas = waveRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const width = canvas.clientWidth || 320
    const height = 72
    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(height * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#1b2838'
    ctx.fillRect(0, 0, width, height)
    const count = Math.max(peaks.length, 1)
    const bar = width / count
    ctx.fillStyle = '#f3c7b8'
    peaks.forEach((peak, index) => {
      const h = Math.max(2, peak * (height - 8))
      ctx.fillRect(index * bar, (height - h) / 2, Math.max(1, bar - 0.5), h)
    })
    const duration = Math.max(peaks.length * 100, 1)
    ctx.fillStyle = '#fff8f2'
    marks.forEach((mark) => {
      ctx.fillRect((mark.ms / duration) * width, 0, 2, height)
    })
    if (playMs > 0) {
      ctx.fillStyle = '#9d2c1c'
      ctx.fillRect((Math.min(playMs, duration) / duration) * width, 0, 2, height)
    }
  }, [peaks, marks, playMs])

  function remember(next: HistoryItem[]) {
    const trimmed = next.slice(0, 12)
    setHistory(trimmed)
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed))
    } catch {
      setNotice('この端末の保存容量が足りず、履歴は残せませんでした。まとめ自体は画面に出ています。')
    }
  }

  function openDraft(next: SummaryResult, origin: string, historyId: string) {
    setDoc(next)
    setFresh(origin)
    setGeneration((current) => current + 1)
    draftIdRef.current = historyId
  }

  function editDoc(next: SummaryResult) {
    setDoc(next)
    const id = draftIdRef.current
    if (!id) return
    setHistory((current) => {
      const updated = current.map((item) =>
        item.id === id ? { ...item, title: next.title.trim() || item.title, draft: snapshot(next) } : item,
      )
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(updated.slice(0, 12)))
      } catch {
        /* 画面の原稿はそのまま残す */
      }
      return updated
    })
  }

  async function startRecording() {
    if (hearing) return
    setRecError('')
    setNotice('')
    keepNames()
    const replacing = Boolean(audioBlobRef.current)
    if (recorderRef.current) recorderRef.current.quality = quality
    const error = (await recorderRef.current?.start()) ?? ''
    if (error) {
      setRecError(error)
      return
    }
    setDoc(null)
    setTranscript('')
    heardModeRef.current = ''
    setPlayMs(0)
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    audioBlobRef.current = null
    audioUrlRef.current = ''
    setAudioUrl('')
    try {
      localStorage.setItem('kaigimatomeru.quality.v1', quality)
    } catch {
      /* 音質の記憶は次回に回す */
    }
    if (replacing) setNotice('新しい録音を始めました。前の音声ファイルは置き換わりました。')
  }

  function pauseRecording() {
    recorderRef.current?.pause()
  }

  function resumeRecording() {
    recorderRef.current?.resume()
  }

  async function stopRecording() {
    await recorderRef.current?.stop()
  }

  async function saveAudio() {
    if (!audioBlobRef.current) return
    const filename = audioFileName(title, date, audioExt)
    const outcome = await shareFile(audioBlobRef.current, filename, '会議の録音です。')
    if (outcome === 'cancelled') setNotice('送信をキャンセルしました。')
    else if (outcome === 'shared') setNotice('共有シートを開きました。録音をパソコンへ送れます。')
    else setNotice('音声ファイルを保存しました。')
  }

  function addMark() {
    recorderRef.current?.addMark()
  }

  async function readFile(file: File) {
    if (phase === 'live' || phase === 'paused' || hearing) {
      setNotice(phase === 'idle' ? 'いままとめています。終わるまでお待ちください。' : '録音を止めてから、ファイルを開いてください。')
      return
    }
    if (!isAudioFile(file)) {
      setNotice('録音ファイルを選んでください。mp3、m4a、wavなどを開けます。')
      return
    }
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    const url = URL.createObjectURL(file)
    audioBlobRef.current = file
    audioUrlRef.current = url
    setAudioUrl(url)
    setAudioExt(file.name.split('.').pop()?.toLowerCase() || 'wav')
    setTranscript('')
    heardModeRef.current = ''
    setPeaks([])
    peaksRef.current = []
    setMarks([])
    setBytes(file.size)
    setPlayMs(0)
    setDoc(null)
    setNotice('録音を開きました。まとめ方を選んで、この録音をまとめるを押してください。')
  }

  function keepSpeakers(next: boolean) {
    setSpeakers(next)
    try {
      localStorage.setItem(SPEAKER_KEY, next ? 'on' : 'off')
    } catch {
      /* 次回は分けない設定から始めます */
    }
  }

  function chooseStyle(id: StyleId) {
    setStyles((current) => {
      const group = STYLES[id].group
      if (group === 'shape') {
        const rest = current.filter((item) => STYLES[item].group !== 'shape')
        const shapes = current.filter((item) => STYLES[item].group === 'shape')
        const nextShapes = shapes.includes(id) ? shapes.filter((item) => item !== id) : [...shapes, id]
        return orderStyles([...rest, ...nextShapes])
      }
      const rest = current.filter((item) => STYLES[item].group !== group)
      if (current.includes(id)) return rest
      return orderStyles([...rest, id])
    })
  }

  function summarySelection(): { length: LengthId; styles: StyleId[] } {
    const body = styles.filter((id) => id !== 'point')
    if (length === 'point') return { length: 'point', styles: orderStyles([...body, 'point']) }
    return { length, styles: body.length ? body : ['memo'] }
  }

  useEffect(() => {
    if (!hearing) return
    const timer = window.setInterval(() => {
      setBar((current) => {
        const cap = barCapRef.current
        if (current >= cap) return current
        const gap = cap - current
        const step = gap > 8 ? 0.45 : 0.15
        return Math.min(cap, current + step)
      })
    }, 400)
    return () => window.clearInterval(timer)
  }, [hearing])

  function showResult() {
    window.setTimeout(() => {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      resultRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    }, 60)
  }

  async function runSummary() {
    if (phase !== 'idle' || hearing) return
    keepNames()
    const speakerMode = speakers ? 'on' : 'off'
    let text = transcript.trim()
    let trimmed = false
    let speakerNote = ''
    if (audioBlobRef.current && (!text || heardModeRef.current !== speakerMode)) {
      setHearing(true)
      setDoc(null)
      setBar(3)
      barCapRef.current = 8
      setNotice('原稿を書いています。')
      showResult()
      let limited: { pcm: Float32Array; trimmed: boolean }
      try {
        const pcm = await decodeTo16k(await audioBlobRef.current.arrayBuffer())
        limited = limitPcm(pcm, 16000)
      } catch {
        setHearing(false)
        setBar(0)
        barCapRef.current = 8
        setNotice('この録音はブラウザが読めませんでした。mp3、m4a、wavにしてから開いてください。')
        return
      }
      try {
        fileEarRef.current ??= new FileEar((update) => {
          setNotice(update.note)
          barCapRef.current = Math.max(barCapRef.current, update.cap * 100)
          setBar((current) => Math.max(current, update.ratio * 100))
        })
        const heard = await fileEarRef.current.transcribe(limited.pcm, { speakers })
        text = heard.text.trim()
        speakerNote = heard.note
        if (!text) {
          setNotice('声が聞き取れませんでした。もう一度録音するか、別のファイルを開いてください。')
          return
        }
        heardModeRef.current = speakerMode
        setTranscript(text)
        trimmed = limited.trimmed
      } catch (error) {
        fileEarRef.current?.close()
        fileEarRef.current = null
        const timedOut = error instanceof Error && error.message === 'timeout'
        setNotice(
          timedOut
            ? 'まとめが時間内に終わりませんでした。短い録音でもう一度試してください。会議の音声自体は送りません。'
            : '原稿を書けませんでした。通信できる状態でもう一度まとめるを押してください。会議の音声自体は送りません。',
        )
        return
      } finally {
        setHearing(false)
        setBar(0)
        barCapRef.current = 8
      }
    }
    if (!text) return
    const picked = summarySelection()
    const next = summarize({
      text,
      title,
      date,
      attendees,
      length: picked.length,
      style: picked.styles[0] ?? 'memo',
      styles: picked.styles,
    })
    const itemId = `${Date.now()}`
    openDraft(next, draftKey(next), next.charCount > 0 ? itemId : '')
    setSigned(signatureOf({ transcript: text, title, date, attendees, length: picked.length, styles: picked.styles }))
    const bits = [trimmed ? '先頭の3時間までを書き起こしました。' : '', speakerNote, next.note].filter(Boolean)
    setNotice(bits.join(''))
    showResult()
    if (next.charCount > 0) {
      const item: HistoryItem = {
        id: itemId,
        savedAt: new Date().toISOString(),
        title: title.trim(),
        date,
        attendees: attendees.trim(),
        transcript: text,
        length: picked.length,
        style: picked.styles[0] ?? 'memo',
        styles: picked.styles,
      }
      const prev = loadHistory().filter(
        (entry) =>
          entry.transcript !== item.transcript ||
          activeStyles(entry).join() !== picked.styles.join() ||
          entry.length !== picked.length,
      )
      remember([item, ...prev])
    }
  }

  function seekAudio(ms: number) {
    const audio = audioRef.current
    if (!audio || !Number.isFinite(audio.duration)) return
    audio.currentTime = Math.min(audio.duration, Math.max(0, ms / 1000))
    setPlayMs(audio.currentTime * 1000)
  }

  function followPlayback() {
    const audio = audioRef.current
    if (!audio) return
    const at = audio.currentTime * 1000
    setPlayMs(at)
    if (!skipSilence || audio.paused) return
    const jump = skipTo(peaksRef.current, at)
    if (jump !== null && jump / 1000 < audio.duration) audio.currentTime = jump / 1000
  }

  async function downloadWord() {
    if (!doc || doc.charCount === 0) return
    setNotice('Word形式のファイルを用意しています。')
    const blob = await docxBlob(doc)
    const filename = `${fileStem(doc)}.docx`
    const outcome = await shareFile(blob, filename, '会議のまとめです。')
    if (outcome === 'cancelled') setNotice('共有をキャンセルしました。')
    else if (outcome === 'shared') setNotice('共有シートを開きました。Word形式（.docx）のファイルを送れます。')
    else setNotice('Word形式（.docx）をダウンロードしました。')
  }

  async function saveText(kind: 'txt' | 'md') {
    if (!doc || doc.charCount === 0) return
    const stem = fileStem(doc)
    if (kind === 'md') {
      downloadBlob(new Blob([markdownDocument(doc)], { type: 'text/markdown;charset=utf-8' }), `${stem}.md`)
      setNotice('Markdown形式（.md）をダウンロードしました。')
      return
    }
    downloadBlob(textBlob(documentText(doc)), `${stem}.txt`)
    setNotice('テキスト形式（.txt）をダウンロードしました。')
  }

  const pickedNow = summarySelection()
  const currentSignature = signatureOf({
    transcript,
    title,
    date,
    attendees,
    length: pickedNow.length,
    styles: pickedNow.styles,
  })
  const dirty = Boolean(doc && signed && signed !== currentSignature)
  const revised = Boolean(doc && fresh && draftKey(doc) !== fresh)
  const canSummarize = phase === 'idle' && !hearing && (Boolean(audioUrl) || charCount(transcript) > 0)

  return (
    <>
      <header className="masthead">
        <div className="masthead-inner">
          <p className="brand">会議まとめ</p>
          <h1>録音を、渡せる原稿に。</h1>
          <p className="lede">
            録音した音声を、選んだ長さ、形、文章の調子で一つの原稿にします。会議の中身はサーバーへ送りません。
          </p>
        </div>
      </header>
      <main className="desk">
        <section className="card source" aria-labelledby="source-heading">
          <h2 id="source-heading">録音</h2>
          <div className="meta">
            <div className="field">
              <label htmlFor="meeting-title">会議名</label>
              <input
                id="meeting-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onBlur={(event) => keepNames(event.currentTarget.value, attendees)}
                maxLength={80}
                placeholder="例：発売会議"
                list="meeting-titles"
                autoComplete="organization"
              />
              <datalist id="meeting-titles">
                {roster.titles.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              {roster.titles.length > 0 ? (
                <div className="picks" role="group" aria-label="前に使った会議名">
                  {roster.titles.map((name) => (
                    <button
                      key={name}
                      type="button"
                      className={title.trim() === name ? 'is-on' : ''}
                      onClick={() => {
                        setTitle(name)
                        keepNames(name, attendees)
                      }}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <label>
              日付
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
            <div className="field wide">
              <label htmlFor="meeting-people">出席者</label>
              <input
                id="meeting-people"
                value={attendees}
                onChange={(event) => setAttendees(event.target.value)}
                onBlur={(event) => keepNames(title, event.currentTarget.value)}
                maxLength={120}
                placeholder="例：佐藤、田中"
                list="meeting-people-list"
                autoComplete="off"
              />
              <datalist id="meeting-people-list">
                {roster.groups.map((group) => (
                  <option key={group} value={group} />
                ))}
                {roster.names.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              {roster.groups.length > 0 || roster.names.length > 0 ? (
                <div className="picks" role="group" aria-label="前に使った出席者">
                  {roster.groups.map((group) => (
                    <button
                      key={group}
                      type="button"
                      className={joinAttendees(splitAttendees(attendees)) === group ? 'is-on crew' : 'crew'}
                      onClick={() => {
                        setAttendees(group)
                        keepNames(title, group)
                      }}
                    >
                      {group}
                    </button>
                  ))}
                  {roster.names.map((name) => {
                    const on = splitAttendees(attendees).includes(name)
                    return (
                      <button
                        key={name}
                        type="button"
                        aria-pressed={on}
                        className={on ? 'is-on' : ''}
                        onClick={() => {
                          const next = toggleAttendee(attendees, name)
                          setAttendees(next)
                          keepNames(title, next)
                        }}
                      >
                        {name}
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </div>
          </div>
          <div
            className={dragging ? 'studio is-drag' : 'studio'}
            onDragOver={(event) => {
              event.preventDefault()
              if (phase === 'idle' && !hearing) setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragging(false)
              const file = event.dataTransfer.files?.[0]
              if (file) void readFile(file)
            }}
          >
            <div className="tools">
              {phase === 'idle' ? (
                <button type="button" className="record" disabled={hearing} onClick={() => void startRecording()} aria-pressed="false">
                  <span className="dot" aria-hidden="true" />
                  録音する
                </button>
              ) : (
                <>
                  <button type="button" className="record is-on" onClick={() => void stopRecording()} aria-pressed="true">
                    <span className="dot" aria-hidden="true" />
                    停止 {formatClock(elapsed)}
                  </button>
                  {phase === 'paused' ? (
                    <button type="button" onClick={resumeRecording}>
                      続ける
                    </button>
                  ) : (
                    <button type="button" onClick={pauseRecording}>
                      一時停止
                    </button>
                  )}
                  <button type="button" onClick={addMark}>
                    印
                  </button>
                </>
              )}
              <button type="button" className="ghost" disabled={hearing || phase !== 'idle'} onClick={() => audioFileRef.current?.click()}>
                録音ファイルを開く
              </button>
              <input
                ref={audioFileRef}
                className="file"
                type="file"
                accept="audio/*,video/*,.mp3,.m4a,.wav,.aac,.mp4,.ogg,.webm,.flac,.3gp,.caf,.amr,.wma,.m4b"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) void readFile(file)
                }}
              />
            </div>
            {phase === 'idle' ? (
              <div className="picks" role="group" aria-label="音質">
                <button type="button" className={quality === 'wav' ? 'is-on' : ''} onClick={() => setQuality('wav')}>
                  高音質
                </button>
                <button type="button" className={quality === 'long' ? 'is-on' : ''} onClick={() => setQuality('long')}>
                  長時間
                </button>
              </div>
            ) : null}
            {peaks.length > 0 ? (
              <canvas
                ref={waveRef}
                className="wave"
                aria-label="録音の波形"
                onClick={(event) => {
                  const width = event.currentTarget.clientWidth
                  const audio = audioRef.current
                  if (!audio || !width || !Number.isFinite(audio.duration)) return
                  seekAudio((event.nativeEvent.offsetX / width) * audio.duration * 1000)
                }}
              />
            ) : null}
            {phase !== 'idle' ? (
              <div className="meter" aria-hidden="true">
                <span ref={meterRef} />
              </div>
            ) : null}
            {bytes > 0 ? (
              <p className="fine">
                {quality === 'wav' && phase !== 'idle' ? '高音質 WAV' : audioExt.toUpperCase()}　{formatBytes(bytes)}
                {phase !== 'idle' ? `　${formatClock(elapsed)}` : ''}
              </p>
            ) : null}
            {recNote ? <p className="rec-status">{recNote}</p> : null}
            {audioUrl ? (
              <div className="take noprint">
                <audio
                  ref={audioRef}
                  controls
                  src={audioUrl}
                  preload="metadata"
                  onTimeUpdate={followPlayback}
                />
                {peaks.length > 0 ? (
                  <label className="skip">
                    <input type="checkbox" checked={skipSilence} onChange={(event) => setSkipSilence(event.target.checked)} />
                    無音を飛ばして再生
                  </label>
                ) : null}
                <button type="button" onClick={() => void saveAudio()}>
                  音声を保存
                </button>
                {marks.length > 0 ? (
                  <div className="marks">
                    {marks.map((mark) => (
                      <label key={mark.id}>
                        <button type="button" onClick={() => seekAudio(mark.ms)}>
                          {formatClock(mark.ms / 1000)}
                        </button>
                        <input
                          value={mark.label}
                          maxLength={40}
                          aria-label={`${formatClock(mark.ms / 1000)}の印`}
                          onChange={(event) =>
                            setMarks((current) =>
                              current.map((item) => (item.id === mark.id ? { ...item, label: event.target.value } : item)),
                            )
                          }
                        />
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            <p className="fine">
              高音質は48kHz・16bitのWAVで、1分あたり約6MBです。長時間は容量を抑えます。まとめると、選んだ長さ、形、調子の原稿になります。初回の準備は通信を使います。会議の音声自体は送りません。
            </p>
            {micBlock ? <p className="alert">{micBlock}</p> : null}
            {recError ? (
              <p className="alert" role="alert">
                {recError}
              </p>
            ) : null}
          </div>
        </section>

        <section className="card options" aria-labelledby="option-heading">
          <h2 id="option-heading">まとめ方</h2>
          <fieldset>
            <legend>長さ</legend>
            <div className="choices" role="radiogroup" aria-label="長さ">
              {(Object.keys(LENGTHS) as LengthId[]).filter((id) => id !== 'point').map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={length === id}
                  className={length === id ? 'choice is-on' : 'choice'}
                  onClick={() => setLength(id)}
                >
                  <strong>{LENGTHS[id].label}</strong>
                  <span>{LENGTHS[id].hint}</span>
                </button>
              ))}
              <button
                type="button"
                role="radio"
                aria-checked={length === 'point'}
                className={length === 'point' ? 'choice is-on' : 'choice'}
                onClick={() => setLength('point')}
              >
                <strong>要は、何が言いたい？</strong>
                <span>言いたいことを短く箇条書きにします</span>
              </button>
            </div>
          </fieldset>
          <p className="fine">選んだ長さ、形、文章の調子、記録の型を、一つの原稿にまとめます。形は複数選べます。</p>
          {STYLE_GROUPS.filter((group) => group.id !== 'live').map((group) => {
            const multi = group.id === 'shape'
            return (
              <fieldset key={group.id}>
                <legend>{group.label}</legend>
                <div className="choices styles" role={multi ? 'group' : 'radiogroup'} aria-label={group.label}>
                  {(Object.keys(STYLES) as StyleId[])
                    .filter((id) => STYLES[id].group === group.id)
                    .map((id) => (
                      <button
                        key={id}
                        type="button"
                        role={multi ? 'checkbox' : 'radio'}
                        aria-checked={styles.includes(id)}
                        className={styles.includes(id) ? 'choice is-on' : 'choice'}
                        onClick={() => chooseStyle(id)}
                      >
                        <strong>{STYLES[id].label}</strong>
                        <span>{STYLES[id].hint}</span>
                      </button>
                    ))}
                </div>
              </fieldset>
            )
          })}
          <fieldset>
            <legend>話者</legend>
            <div className="choices styles" role="radiogroup" aria-label="話者">
              <button
                type="button"
                role="radio"
                aria-checked={!speakers}
                className={speakers ? 'choice' : 'choice is-on'}
                onClick={() => keepSpeakers(false)}
              >
                <strong>分けない</strong>
                <span>一つの原稿にします</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={speakers}
                className={speakers ? 'choice is-on' : 'choice'}
                onClick={() => keepSpeakers(true)}
              >
                <strong>声で分ける</strong>
                <span>話者1、話者2と分けます</span>
              </button>
            </div>
          </fieldset>
          <p className="fine">
            長い録音は無音の位置で区切り、3時間を超える分は入りません。声で分けるときは、声の高さと間だけを見ます。音声はこの端末の外へ送りません。
          </p>
          {revised ? <p className="alert">直した原稿があります。もう一度まとめると、直した文は置き換わります。</p> : null}
          <button type="button" className="summarize" disabled={!canSummarize} onClick={() => void runSummary()}>
            {hearing ? 'まとめています' : phase !== 'idle' ? '録音を止めてからまとめます' : 'この録音をまとめる'}
          </button>
        </section>

        <section className="result" ref={resultRef}>
          {dirty ? <p className="alert">録音や条件が変わっています。もう一度まとめると、表示中の原稿は作り直されます。</p> : null}
          {notice && !hearing ? <p className="notice" aria-live="polite">{notice}</p> : null}
          {hearing ? (
            <div className="empty working">
              <p>原稿を書いています。</p>
              <div className="barometer">
                <div className="barometer-label">
                  <span>{notice || '選んだ長さ、形、調子で、この端末の中でまとめています。'}</span>
                  <strong>{Math.round(bar)}%</strong>
                </div>
                <div
                  className="barometer-track"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(bar)}
                  aria-label="まとめの進み具合"
                >
                  <span style={{ width: `${Math.round(bar)}%` }} />
                </div>
              </div>
            </div>
          ) : doc && (doc.charCount > 0 || doc.blocks.length > 0) ? (
            <>
              <Manuscript key={generation} doc={doc} onChange={editDoc} />
              <div className="actions noprint">
                <button type="button" className="primary" disabled={doc.charCount === 0} onClick={() => void downloadWord()}>
                  Word形式でダウンロード
                </button>
                <button
                  type="button"
                  disabled={doc.charCount === 0}
                  onClick={() => void copyText(documentText(doc)).then(() => setNotice('直した原稿をコピーしました。'))}
                >
                  コピー
                </button>
                <button type="button" disabled={doc.charCount === 0} onClick={() => void saveText('txt')}>
                  テキスト形式でダウンロード
                </button>
                <button type="button" disabled={doc.charCount === 0} onClick={() => void saveText('md')}>
                  Markdown形式でダウンロード
                </button>
                <button type="button" onClick={() => window.print()}>
                  原稿を印刷
                </button>
              </div>
              <p className="fine noprint">
                直した題名、見出し、本文が、コピー、ダウンロード、印刷にそのまま出ます。
              </p>
            </>
          ) : (
            <div className="empty">
              <p>まとめると、ここに原稿が出ます。</p>
              <p>まとめ方で「要は、何が言いたい？」を選ぶと、長い話を要点にできます。</p>
            </div>
          )}
          {history.length > 0 ? (
            <details className="history noprint">
              <summary>この端末に残っているまとめ（{history.length}）</summary>
              <ul>
                {history.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="restore"
                      onClick={() => {
                        const picked = activeStyles(item)
                        const point = item.length === 'point' || picked.includes('point')
                        const body = orderStyles(picked.filter((id) => id !== 'point'))
                        setTitle(item.title)
                        setDate(item.date)
                        setAttendees(item.attendees)
                        setTranscript(item.transcript)
                        setLength(point ? 'point' : item.length)
                        setStyles(body)
                        const summaryStyles = point ? orderStyles([...body, 'point']) : body.length ? body : (['memo'] as StyleId[])
                        const summaryLength = point ? 'point' : item.length
                        const next = summarize({
                          text: item.transcript,
                          title: item.title,
                          date: item.date,
                          attendees: item.attendees,
                          length: summaryLength,
                          style: summaryStyles[0] ?? 'memo',
                          styles: summaryStyles,
                        })
                        const opened = item.draft ? applyDraft(next, item.draft) : next
                        openDraft(opened, draftKey(item.draft ? next : opened), item.id)
                        setSigned(
                          signatureOf({
                            transcript: item.transcript,
                            title: item.title,
                            date: item.date,
                            attendees: item.attendees,
                            length: summaryLength,
                            styles: summaryStyles,
                          }),
                        )
                        setNotice(item.draft ? '直した原稿を開きました。' : '保存していた原稿を開きました。')
                      }}
                    >
                      <strong>{item.title || '無題の会議'}</strong>
                      <span>
                        {item.date}　{styleCaption(activeStyles(item), item.length)}
                        {item.draft ? <span className="draft-mark">直した</span> : null}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="textish"
                      onClick={() => remember(history.filter((entry) => entry.id !== item.id))}
                    >
                      消す
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className="textish" onClick={() => remember([])}>
                履歴をすべて消す
              </button>
            </details>
          ) : null}
        </section>
      </main>
      <footer className="colophon noprint">
        <p>会議の文章はこの端末だけに残ります。</p>
      </footer>
      <InstallBar />
    </>
  )
}

function installSteps(): string[] {
  const ua = navigator.userAgent
  const chrome = /chrome|crios/i.test(ua) && !/edg\//i.test(ua)
  if (/iphone|ipad|ipod/i.test(ua)) {
    return ['画面下の共有ボタン（四角と上向き矢印）を押す', '「ホーム画面に追加」を選ぶ', '右上の「追加」を押す']
  }
  if (/android/i.test(ua)) {
    return chrome
      ? ['右上のメニュー（︙）を押す', '「ホーム画面に追加」または「アプリをインストール」を選ぶ', '追加を押す']
      : ['このページをChromeで開く', '右上のメニュー（︙）を押す', '「ホーム画面に追加」または「アプリをインストール」を選ぶ']
  }
  return ['アドレスバー右端のインストールアイコンを押す', '無いときはブラウザのメニューを開く', '「会議まとめをインストール」を選ぶ']
}

function InstallBar() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(window.__installPrompt ?? null)
  const [hidden, setHidden] = useState(false)
  const [help, setHelp] = useState(false)
  const [note, setNote] = useState('')
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true

  useEffect(() => {
    if (standalone || sessionStorage.getItem('kaigimatomeru-install-hide') === '1') {
      setHidden(true)
      return
    }
    const onPrompt = (event: Event) => {
      if ('prompt' in event) {
        event.preventDefault()
        window.__installPrompt = event as BeforeInstallPromptEvent
      }
      setPrompt(window.__installPrompt ?? null)
    }
    const onReady = () => setPrompt(window.__installPrompt ?? null)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('kaigi-install-ready', onReady)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('kaigi-install-ready', onReady)
    }
  }, [standalone])

  if (hidden || standalone) return null

  const dismiss = () => {
    sessionStorage.setItem('kaigimatomeru-install-hide', '1')
    setHidden(true)
  }

  const add = async () => {
    const event = prompt ?? window.__installPrompt
    if (!event) {
      setHelp(true)
      setNote('この画面からは直接追加できないため、次の手順で追加してください。')
      return
    }
    try {
      await event.prompt()
      const choice = await event.userChoice
      window.__installPrompt = null
      setPrompt(null)
      if (choice.outcome === 'accepted') {
        setHidden(true)
        return
      }
      setNote('追加をキャンセルしました。もう一度押すと、手順を表示します。')
      setHelp(true)
    } catch {
      window.__installPrompt = null
      setPrompt(null)
      setHelp(true)
      setNote('この画面からは直接追加できないため、次の手順で追加してください。')
    }
  }

  return (
    <div className="install noprint">
      <p>ホーム画面に追加すると、アプリのように開けます。</p>
      {note ? <p>{note}</p> : null}
      {help ? (
        <ol>
          {installSteps().map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}
      <div>
        <button type="button" className="primary" onClick={() => void add()}>
          ホーム画面に追加
        </button>
        <button type="button" onClick={dismiss}>
          今はしない
        </button>
      </div>
    </div>
  )
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

declare global {
  interface Window {
    __installPrompt: BeforeInstallPromptEvent | null
  }
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error(error)
  }

  render() {
    if (this.state.failed) {
      return (
        <p className="alert" role="alert">
          画面の表示で問題が起きました。ページを読み込み直してください。
        </p>
      )
    }
    return this.props.children
  }
}

export function AppRoot() {
  return (
    <Boundary>
      <App />
    </Boundary>
  )
}
