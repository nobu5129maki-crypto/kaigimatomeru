import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
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

function clock(total: number): string {
  const safe = Math.max(0, total)
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`
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

function speechErrorMessage(code: string): string {
  if (code === 'not-allowed' || code === 'service-not-allowed') {
    return 'マイクがブロックされています。ブラウザの設定で許可するか、文字を貼り付けてください。'
  }
  if (code === 'audio-capture') return 'マイクが見つかりません。文字を貼り付けてください。'
  if (code === 'network') return '音声認識に通信が必要です。ここまでの文字は残しています。'
  return '音声認識を続けられませんでした。入った文字はそのまま使えます。'
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
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [recError, setRecError] = useState('')
  const [length, setLength] = useState<LengthId>(pref.current.length)
  const [style, setStyle] = useState<StyleId>(pref.current.style)
  const [doc, setDoc] = useState<SummaryResult | null>(null)
  const [signed, setSigned] = useState('')
  const [notice, setNotice] = useState('')
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const resultRef = useRef<HTMLElement>(null)
  const wantRec = useRef(false)
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const baseRef = useRef('')
  const committedRef = useRef('')
  const restartTimer = useRef(0)

  const speechSupported =
    typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)

  useEffect(() => {
    setHistory(loadHistory())
  }, [])

  useEffect(() => {
    if (style === 'point') return
    localStorage.setItem(PREF_KEY, JSON.stringify({ length, style }))
  }, [length, style])

  useEffect(() => {
    if (!recording) return
    const id = window.setInterval(() => setElapsed((value) => value + 1), 1000)
    return () => window.clearInterval(id)
  }, [recording])

  useEffect(() => {
    return () => {
      wantRec.current = false
      window.clearTimeout(restartTimer.current)
      recRef.current?.abort()
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

  function stopRecording() {
    wantRec.current = false
    window.clearTimeout(restartTimer.current)
    recRef.current?.stop()
    setRecording(false)
    setInterim('')
  }

  function startRecording() {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Ctor) {
      setRecError('このブラウザは録音の文字起こしに対応していません。Chromeで開くか、文字を貼り付けてください。')
      return
    }
    setRecError('')
    setNotice('')
    baseRef.current = transcript.trim() ? `${transcript.replace(/\s+$/g, '')}\n` : ''
    committedRef.current = ''
    setElapsed(0)
    setInterim('')
    wantRec.current = true

    const recognition = new Ctor()
    recognition.lang = 'ja-JP'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.onresult = (event) => {
      let interimText = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const piece = event.results[i][0]?.transcript ?? ''
        if (event.results[i].isFinal) committedRef.current += piece
        else interimText += piece
      }
      setTranscript(baseRef.current + committedRef.current)
      setInterim(interimText)
    }
    recognition.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return
      setRecError(speechErrorMessage(event.error))
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed' || event.error === 'audio-capture') {
        wantRec.current = false
        setRecording(false)
      }
    }
    recognition.onend = () => {
      if (!wantRec.current) {
        setRecording(false)
        setInterim('')
        return
      }
      restartTimer.current = window.setTimeout(() => {
        if (!wantRec.current) return
        try {
          recognition.start()
        } catch {
          wantRec.current = false
          setRecording(false)
        }
      }, 250)
    }
    recRef.current = recognition
    try {
      recognition.start()
      setRecording(true)
    } catch {
      wantRec.current = false
      setRecError('録音を始められませんでした。もう一度押すか、文字を貼り付けてください。')
    }
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
    if (recording) return
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

  function runPoint() {
    const text = `${transcript}${interim ? `${transcript.trim() ? '\n' : ''}${interim}` : ''}`
    if (charCount(text) === 0) return
    const next = summarize({ text, title, date, attendees, length, style: 'point' })
    setStyle('point')
    setDoc(next)
    setSigned(signatureOf({ transcript, title, date, attendees, length, style: 'point' }))
    setNotice(next.note)
    if (next.charCount > 0) {
      const item: HistoryItem = {
        id: `${Date.now()}`,
        savedAt: new Date().toISOString(),
        title: title.trim(),
        date,
        attendees: attendees.trim(),
        transcript: text.trim(),
        length,
        style: 'point',
      }
      const prev = loadHistory().filter(
        (entry) => entry.transcript !== item.transcript || entry.style !== item.style || entry.length !== item.length,
      )
      remember([item, ...prev])
    }
    window.setTimeout(() => {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      resultRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    }, 30)
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
  const canSummarize = !recording && charCount(transcript) > 0
  const canPoint = charCount(`${transcript}${interim}`) > 0

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
            {recording ? (
              <button type="button" className="record is-on" onClick={stopRecording} aria-pressed="true">
                <span className="dot" aria-hidden="true" />
                停止 {clock(elapsed)}
              </button>
            ) : (
              <button type="button" className="record" onClick={startRecording} aria-pressed="false">
                <span className="dot" aria-hidden="true" />
                録音する
              </button>
            )}
            <button type="button" className="ghost" onClick={() => fileRef.current?.click()}>
              文字ファイルを開く
            </button>
            <button
              type="button"
              className="ghost"
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
          <p className="fine">
            {speechSupported
              ? '録音の文字起こしはブラウザの音声認識を使います。Chromeでは、話した言葉が認識機能へ送られることがあります。まとめの処理は端末の中だけです。'
              : 'このブラウザは録音の文字起こしに未対応です。文字を貼り付けるか、Zoomなどの文字起こしファイルを開いてください。'}
          </p>
          {recError ? (
            <p className="alert" role="alert">
              {recError}
            </p>
          ) : null}
          <div
            className={dragging ? 'editor is-drag' : 'editor'}
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
              <span>{charCount(transcript).toLocaleString('ja-JP')}文字</span>
            </label>
            <textarea
              id="transcript"
              value={transcript}
              readOnly={recording}
              placeholder="ここに話した内容を貼り付けるか、録音を始めてください。"
              onChange={(event) => setTranscript(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && canSummarize) runSummary()
              }}
            />
            {interim ? <p className="interim">認識中：{interim}</p> : null}
            <button type="button" className="point" disabled={!canPoint} onClick={runPoint}>
              要は、何が言いたい？
            </button>
            <p className="fine">相手の話が長いときに押すと、言いたいことだけを箇条書きにします。</p>
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
            {recording ? '録音を止めてからまとめます' : 'この内容をまとめる'}
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
              <p>見出し、箇条書き、速報のほか、長い話は「要は、何が言いたい？」で要点にできます。</p>
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
        <p>会議の文章はこの端末だけに残ります。ホーム画面に追加すると、アプリのように開けます。</p>
      </footer>
      <InstallBar />
    </>
  )
}

function InstallBar() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [hidden, setHidden] = useState(false)
  const [iosHelp, setIosHelp] = useState(false)
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)

  useEffect(() => {
    if (standalone || sessionStorage.getItem('kaigimatomeru-install-hide') === '1') {
      setHidden(true)
      return
    }
    const onPrompt = (event: Event) => {
      event.preventDefault()
      setPrompt(event as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [standalone])

  if (hidden || standalone) return null

  const dismiss = () => {
    sessionStorage.setItem('kaigimatomeru-install-hide', '1')
    setHidden(true)
  }

  if (prompt) {
    return (
      <div className="install noprint">
        <p>ホーム画面に追加すると、次からアプリとして開けます。</p>
        <div>
          <button
            type="button"
            className="primary"
            onClick={() => {
              void prompt.prompt().then(() => {
                setPrompt(null)
                setHidden(true)
              })
            }}
          >
            追加する
          </button>
          <button type="button" onClick={dismiss}>
            今はしない
          </button>
        </div>
      </div>
    )
  }

  if (!ios) return null

  return (
    <div className="install noprint">
      {iosHelp ? (
        <ol>
          <li>画面下の共有ボタンを押す</li>
          <li>「ホーム画面に追加」を選ぶ</li>
          <li>右上の追加を押す</li>
        </ol>
      ) : (
        <p>iPhoneでは、共有からホーム画面に追加できます。</p>
      )}
      <div>
        <button type="button" className="primary" onClick={() => setIosHelp((value) => !value)}>
          {iosHelp ? '閉じる' : '追加の手順'}
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
