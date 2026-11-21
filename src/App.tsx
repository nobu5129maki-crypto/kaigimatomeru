import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
import { audioFileName, formatClock, liveTranscript, MeetingRecorder, recordingBlock, type RecorderPhase } from './capture'
import { docxBlob, downloadBlob, fileStem, markdownDocument, shareFile, textBlob } from './files'
import { decodeTextFile, transcriptFromFile } from './importText'
import { SAMPLE_ATTENDEES, SAMPLE_DATE, SAMPLE_TITLE, SAMPLE_TRANSCRIPT } from './sample'
import {
  LENGTHS,
  STYLE_GROUPS,
  STYLES,
  charCount,
  documentText,
  summarize,
  type LengthId,
  type StyleId,
  type SummaryResult,
} from './summarize'

const HISTORY_KEY = 'kaigimatomeru.history.v1'
const PREF_KEY = 'kaigimatomeru.pref.v1'

type HistoryItem = {
  id: string
  savedAt: string
  title: string
  date: string
  attendees: string
  transcript: string
  length: LengthId
  style: StyleId
}

type Pref = { length: LengthId; style: StyleId }

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
    return parsed.filter(isHistory).slice(0, 12)
  } catch {
    return []
  }
}

function loadPref(): Pref {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') as Partial<Pref>
    return {
      length: isLength(parsed.length) ? parsed.length : 'c200',
      style: isStyle(parsed.style) ? parsed.style : 'news',
    }
  } catch {
    return { length: 'c200', style: 'news' }
  }
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
  style: StyleId
}): string {
  return JSON.stringify({
    transcript: input.transcript.trim(),
    title: input.title.trim(),
    date: input.date,
    attendees: input.attendees.trim(),
    length: input.length,
    style: input.style,
  })
}

export function App() {
  const pref = useRef(loadPref())
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(todayIso)
  const [attendees, setAttendees] = useState('')
  const [transcript, setTranscript] = useState('')
  const [interim, setInterim] = useState('')
  const [phase, setPhase] = useState<RecorderPhase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [recError, setRecError] = useState('')
  const [recNote, setRecNote] = useState('')
  const [audioUrl, setAudioUrl] = useState('')
  const [audioExt, setAudioExt] = useState('webm')
  const [length, setLength] = useState<LengthId>(pref.current.length)
  const [style, setStyle] = useState<StyleId>(pref.current.style)
  const [doc, setDoc] = useState<SummaryResult | null>(null)
  const [signed, setSigned] = useState('')
  const [notice, setNotice] = useState('')
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const resultRef = useRef<HTMLElement>(null)
  const meterRef = useRef<HTMLSpanElement>(null)
  const transcriptRef = useRef<HTMLTextAreaElement>(null)
  const recorderRef = useRef<MeetingRecorder | null>(null)
  const audioBlobRef = useRef<Blob | null>(null)
  const audioUrlRef = useRef('')

  const micBlock = recordingBlock()

  useEffect(() => {
    setHistory(loadHistory())
  }, [])

  useEffect(() => {
    localStorage.setItem(PREF_KEY, JSON.stringify({ length, style }))
  }, [length, style])

  useEffect(() => {
    if (phase !== 'live') return
    const area = transcriptRef.current
    if (!area) return
    area.scrollTop = area.scrollHeight
  }, [phase, transcript, interim])

  useEffect(() => {
    const recorder = new MeetingRecorder({
      onText: (committed, interimText) => {
        setTranscript(committed)
        setInterim(interimText)
      },
      onPhase: (next, seconds) => {
        setPhase(next)
        setElapsed(seconds)
      },
      onLevel: (level) => {
        if (meterRef.current) meterRef.current.style.transform = `scaleX(${level.toFixed(3)})`
      },
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
      },
    })
    recorderRef.current = recorder
    return () => {
      recorder.destroy()
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    }
  }, [])

  function remember(next: HistoryItem[]) {
    const trimmed = next.slice(0, 12)
    setHistory(trimmed)
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed))
    } catch {
      setNotice('この端末の保存容量が足りず、履歴は残せませんでした。まとめ自体は画面に出ています。')
    }
  }

  async function startRecording() {
    setRecError('')
    setNotice('')
    const replacing = Boolean(audioBlobRef.current)
    const error = (await recorderRef.current?.start(transcript)) ?? ''
    if (error) {
      setRecError(error)
      return
    }
    if (replacing) {
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
      audioBlobRef.current = null
      audioUrlRef.current = ''
      setAudioUrl('')
      setNotice('新しい録音を始めました。前の音声ファイルは置き換わりました。')
    }
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

  async function readFile(file: File) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (file.type.startsWith('audio/') || file.type.startsWith('video/') || ['mp3', 'm4a', 'wav', 'mp4', 'webm', 'aac'].includes(ext)) {
      setNotice('音声ファイルの自動文字起こしには対応していません。録音ボタンを使うか、文字起こしのテキストを開いてください。')
      return
    }
    let decoded = ''
    try {
      decoded = decodeTextFile(await file.arrayBuffer())
    } catch {
      setNotice('ファイルを読めませんでした。')
      return
    }
    const text = transcriptFromFile(file.name, decoded)
    if (!text.trim()) {
      setNotice('読み取れる文字がありませんでした。テキスト、VTT、SRTを選んでください。')
      return
    }
    setTranscript(text)
    setNotice(
      Array.from(decoded).length > 40000
        ? '先頭の4万文字だけ読みました。'
        : `${file.name} を原稿に入れました。`,
    )
  }

  function runSummary() {
    if (phase === 'live') return
    const next = summarize({ text: transcript, title, date, attendees, length, style })
    setDoc(next)
    setSigned(signatureOf({ transcript, title, date, attendees, length, style }))
    setNotice(next.note)
    if (next.charCount > 0) {
      const item: HistoryItem = {
        id: `${Date.now()}`,
        savedAt: new Date().toISOString(),
        title: title.trim(),
        date,
        attendees: attendees.trim(),
        transcript: transcript.trim(),
        length,
        style,
      }
      const prev = loadHistory().filter((entry) => entry.transcript !== item.transcript || entry.style !== item.style || entry.length !== item.length)
      remember([item, ...prev])
    }
    window.setTimeout(() => {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      resultRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    }, 30)
  }

  function clearTranscript() {
    recorderRef.current?.clearText()
    setTranscript('')
    setInterim('')
    setNotice('文字起こしを消しました。次の録音を始められます。')
  }

  async function sendToPc() {
    if (!doc || doc.charCount === 0) return
    setNotice('Wordファイルを用意しています。')
    const blob = await docxBlob(doc)
    const filename = `${fileStem(doc)}.docx`
    const outcome = await shareFile(blob, filename, '会議のまとめです。パソコンで清書してください。')
    if (outcome === 'cancelled') setNotice('送信をキャンセルしました。')
    else if (outcome === 'shared') setNotice('共有シートを開きました。パソコン宛に送って清書できます。')
    else setNotice('Wordファイルを保存しました。メールやチャットに添付すると、パソコンで清書できます。')
  }

  async function saveText(kind: 'txt' | 'md') {
    if (!doc || doc.charCount === 0) return
    const stem = fileStem(doc)
    if (kind === 'md') {
      downloadBlob(new Blob([markdownDocument(doc)], { type: 'text/markdown;charset=utf-8' }), `${stem}.md`)
      setNotice('Markdownを保存しました。')
      return
    }
    downloadBlob(textBlob(documentText(doc)), `${stem}.txt`)
    setNotice('テキストを保存しました。メモ帳やWordで開けます。')
  }

  const currentSignature = signatureOf({ transcript, title, date, attendees, length, style })
  const dirty = Boolean(doc && signed && signed !== currentSignature)
  const shownTranscript = phase === 'live' ? liveTranscript(transcript, interim) : transcript
  const canSummarize = phase !== 'live' && charCount(transcript) > 0
  const canClear = phase !== 'live' && charCount(shownTranscript) > 0

  return (
    <>
      <header className="masthead">
        <div className="masthead-inner">
          <p className="brand">会議まとめ</p>
          <h1>録音を、渡せる原稿に。</h1>
          <p className="lede">
            長さと書き方を選ぶと、この端末の中だけでまとめます。会議の中身はサーバーへ送りません。
          </p>
        </div>
      </header>
      <main className="desk">
        <section className="card source" aria-labelledby="source-heading">
          <h2 id="source-heading">原稿</h2>
          <div className="meta">
            <label>
              会議名
              <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} placeholder="例：発売会議" />
            </label>
            <label>
              日付
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
            <label className="wide">
              出席者
              <input
                value={attendees}
                onChange={(event) => setAttendees(event.target.value)}
                maxLength={120}
                placeholder="例：佐藤、田中"
              />
            </label>
          </div>
          <div className="tools">
            {phase === 'idle' ? (
              <button type="button" className="record" onClick={() => void startRecording()} aria-pressed="false">
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
              </>
            )}
            <button type="button" className="ghost" onClick={() => fileRef.current?.click()}>
              文字ファイルを開く
            </button>
            <button
              type="button"
              className="ghost"
              disabled={phase !== 'idle'}
              onClick={() => {
                if (transcript.trim() && !window.confirm('入力中の原稿を、例文に入れ替えますか？')) return
                setTitle(SAMPLE_TITLE)
                setDate(SAMPLE_DATE)
                setAttendees(SAMPLE_ATTENDEES)
                setTranscript(SAMPLE_TRANSCRIPT)
                setNotice('例文を入れました。長さと書き方を選んで、まとめてください。')
              }}
            >
              例文を入れる
            </button>
            <input
              ref={fileRef}
              className="file"
              type="file"
              accept=".txt,.md,.vtt,.srt,.csv,text/plain"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) void readFile(file)
              }}
            />
          </div>
          {phase !== 'idle' ? (
            <div className="meter" aria-hidden="true">
              <span ref={meterRef} />
            </div>
          ) : null}
          {recNote ? <p className="rec-status">{recNote}</p> : null}
          {audioUrl ? (
            <div className="take noprint">
              <audio controls src={audioUrl} preload="metadata" />
              <button type="button" onClick={() => void saveAudio()}>
                音声を保存
              </button>
            </div>
          ) : null}
          <p className="fine">
            特殊なアプリは要りません。ChromeまたはEdgeの録音ボタンで、話した言葉が欄に入ります。Firefoxでは話しながらの文字起こしはできません。
          </p>
          {micBlock ? <p className="alert">{micBlock}</p> : null}
          {recError ? (
            <p className="alert" role="alert">
              {recError}
            </p>
          ) : null}
          <div
            className={dragging ? 'editor is-drag' : phase === 'live' ? 'editor is-live' : 'editor'}
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragging(false)
              const file = event.dataTransfer.files?.[0]
              if (file) void readFile(file)
            }}
          >
            <label className="editor-label" htmlFor="transcript">
              文字起こし
              <span>{charCount(shownTranscript).toLocaleString('ja-JP')}文字</span>
            </label>
            <textarea
              id="transcript"
              ref={transcriptRef}
              value={shownTranscript}
              readOnly={phase !== 'idle'}
              placeholder="ここに話した内容を貼り付けるか、録音を始めてください。"
              onChange={(event) => setTranscript(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && canSummarize) runSummary()
              }}
            />
            <div className="tools">
              <button type="button" disabled={!canClear} onClick={clearTranscript}>
                文字起こしを消す
              </button>
            </div>
          </div>
        </section>

        <section className="card options" aria-labelledby="option-heading">
          <h2 id="option-heading">まとめ方</h2>
          <fieldset>
            <legend>長さ</legend>
            <div className="choices" role="radiogroup" aria-label="長さ">
              {(Object.keys(LENGTHS) as LengthId[]).map((id) => (
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
            </div>
          </fieldset>
          {STYLE_GROUPS.map((group) => (
            <fieldset key={group.id}>
              <legend>{group.label}</legend>
              <div className="choices styles" role="radiogroup" aria-label={group.label}>
                {(Object.keys(STYLES) as StyleId[])
                  .filter((id) => STYLES[id].group === group.id)
                  .map((id) => (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={style === id}
                      className={style === id ? 'choice is-on' : 'choice'}
                      onClick={() => setStyle(id)}
                    >
                      <strong>{STYLES[id].label}</strong>
                      <span>{STYLES[id].hint}</span>
                    </button>
                  ))}
              </div>
            </fieldset>
          ))}
          <button type="button" className="summarize" disabled={!canSummarize} onClick={runSummary}>
            {phase === 'live' ? '録音を止めてからまとめます' : 'この内容をまとめる'}
          </button>
        </section>

        <section className="result" ref={resultRef} aria-live="polite">
          {dirty ? <p className="alert">原稿か条件が変わっています。もう一度まとめると、表示が新しい内容になります。</p> : null}
          {notice ? <p className="notice">{notice}</p> : null}
          {doc && doc.charCount > 0 ? (
            <>
              <article className={length === 'a4' ? 'paper sheet' : 'paper'} aria-label="まとめ原稿">
                <p className="kicker">{doc.styleLabel}</p>
                <h2>{doc.title}</h2>
                <p className="dateline">
                  {[doc.dateline, doc.attendees ? `出席：${doc.attendees}` : ''].filter(Boolean).join('　')}
                </p>
                {doc.headline && doc.headline !== doc.title ? <h3>{doc.headline}</h3> : null}
                {doc.blocks.map((block, index) => (
                  <section key={`${block.heading}-${index}`}>
                    {block.heading ? <h4>{block.heading}</h4> : null}
                    {block.list ? (
                      <ul>
                        {block.lines.map((line, lineIndex) => (
                          <li key={`${index}-${lineIndex}`}>{line}</li>
                        ))}
                      </ul>
                    ) : (
                      block.lines.map((line, lineIndex) => <p key={`${index}-${lineIndex}`}>{line}</p>)
                    )}
                  </section>
                ))}
                <p className="count noprint">本文 {doc.charCount.toLocaleString('ja-JP')}文字（目標 {doc.target}文字）</p>
              </article>
              <div className="actions noprint">
                <button type="button" className="primary" onClick={() => void sendToPc()}>
                  パソコンへ送る
                </button>
                <button type="button" onClick={() => void copyText(documentText(doc)).then(() => setNotice('原稿をコピーしました。'))}>
                  コピー
                </button>
                <button type="button" onClick={() => void saveText('txt')}>
                  テキストで保存
                </button>
                <button type="button" onClick={() => void saveText('md')}>
                  Markdown
                </button>
                <button type="button" onClick={() => window.print()}>
                  印刷
                </button>
              </div>
              <p className="fine noprint">
                「パソコンへ送る」は Word（.docx）です。共有シートが出る端末ではメールやチャットに添付でき、出ない端末では保存されます。テキストもメモ帳で開けます。
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
                        setTitle(item.title)
                        setDate(item.date)
                        setAttendees(item.attendees)
                        setTranscript(item.transcript)
                        setLength(item.length)
                        setStyle(item.style)
                        const next = summarize({
                          text: item.transcript,
                          title: item.title,
                          date: item.date,
                          attendees: item.attendees,
                          length: item.length,
                          style: item.style,
                        })
                        setDoc(next)
                        setSigned(signatureOf(item))
                        setNotice('保存していた原稿を開きました。')
                      }}
                    >
                      <strong>{item.title || '無題の会議'}</strong>
                      <span>
                        {item.date}　{item.style === 'point' ? STYLES[item.style].label : `${STYLES[item.style].label}／${LENGTHS[item.length].label}`}
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
