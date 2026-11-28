import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  addBlock,
  addLine,
  clearBlock,
  dropLine,
  moveLine,
  splitLine,
  toggleList,
  updateHeading,
  updateLine,
  updateMeta,
} from './draft'
import type { SummaryResult } from './summarize'

type Pick = { block: number; line: number }
type Caret = { key: string; edge: 'start' | 'end' }

function PaperInk({
  value,
  label,
  className,
  placeholder,
  takeFocus,
  onChange,
  onFocus,
  onKeyDown,
  onFocused,
}: {
  value: string
  label: string
  className: string
  placeholder?: string
  takeFocus: 'start' | 'end' | false
  onChange: (value: string) => void
  onFocus?: () => void
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onFocused: () => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const done = useRef(onFocused)
  done.current = onFocused
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  useLayoutEffect(() => {
    if (!takeFocus) return
    const el = ref.current
    if (!el) return
    el.focus()
    const at = takeFocus === 'start' ? 0 : el.value.length
    el.setSelectionRange(at, at)
    done.current()
  }, [takeFocus])
  return (
    <textarea
      ref={ref}
      className={className}
      aria-label={label}
      rows={1}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
    />
  )
}

export function Manuscript({ doc, onChange }: { doc: SummaryResult; onChange: (next: SummaryResult) => void }) {
  const [pick, setPick] = useState<Pick | null>(null)
  const [caret, setCaret] = useState<Caret | null>(null)
  const [headlineOn, setHeadlineOn] = useState(() => Boolean(doc.headline && doc.headline !== doc.title))
  const safePick =
    pick && doc.blocks[pick.block] && pick.line >= 0 && pick.line < doc.blocks[pick.block].lines.length ? pick : null
  const tone = doc.charCount < doc.min ? 'short' : doc.charCount > doc.max ? 'long' : 'fit'
  const toneLabel =
    tone === 'short' ? '目標より短いです' : tone === 'long' ? '目標より長いです' : '目標の長さに収まっています'
  const ratio = doc.max > 0 ? Math.min(100, Math.round((doc.charCount / doc.max) * 100)) : 0
  const atStart = !safePick || (safePick.block === 0 && safePick.line === 0)
  const atEnd =
    !safePick ||
    (safePick.block === doc.blocks.length - 1 && safePick.line === doc.blocks[safePick.block].lines.length - 1)

  function focused() {
    setCaret(null)
  }

  function place(next: SummaryResult, nextPick: Pick | null, edge?: 'start' | 'end') {
    onChange(next)
    setPick(nextPick)
    if (nextPick && edge) setCaret({ key: `${nextPick.block}:${nextPick.line}`, edge })
  }

  function addSentence() {
    const block = safePick?.block ?? Math.max(0, doc.blocks.length - 1)
    const line = safePick?.line ?? (doc.blocks[block]?.lines.length ?? 1) - 1
    if (!doc.blocks[block]) {
      place(addBlock(doc), { block: 0, line: 0 }, 'start')
      return
    }
    place(addLine(doc, block, line), { block, line: line + 1 }, 'start')
  }

  function shift(dir: -1 | 1) {
    if (!safePick) return
    const next = moveLine(doc, safePick.block, safePick.line, dir)
    if (next === doc) return
    const within = safePick.line + dir
    const block = doc.blocks[safePick.block]
    let nextPick: Pick
    if (within >= 0 && within < block.lines.length) nextPick = { block: safePick.block, line: within }
    else if (dir < 0) nextPick = { block: safePick.block - 1, line: doc.blocks[safePick.block - 1].lines.length }
    else nextPick = { block: safePick.block + 1, line: 0 }
    place(next, nextPick, 'end')
  }

  function cut() {
    if (!safePick) return
    const { block, line } = safePick
    const source = doc.blocks[block]
    const next = dropLine(doc, block, line)
    let nextPick: Pick
    if (source.lines.length <= 1 && doc.blocks.length > 1) {
      nextPick = block > 0 ? { block: block - 1, line: Math.max(0, doc.blocks[block - 1].lines.length - 1) } : { block: 0, line: 0 }
    } else if (line > 0 && line >= source.lines.length - 1) {
      nextPick = { block, line: line - 1 }
    } else {
      nextPick = { block, line: Math.min(line, Math.max(0, (next.blocks[block]?.lines.length ?? 1) - 1)) }
    }
    if (!next.blocks[nextPick.block]) nextPick = { block: 0, line: 0 }
    place(next, nextPick, 'end')
  }

  function onLineKey(event: KeyboardEvent<HTMLTextAreaElement>, block: number, line: number) {
    if (event.nativeEvent.isComposing || event.key === 'Process') return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      const at = event.currentTarget.selectionStart ?? event.currentTarget.value.length
      place(splitLine(doc, block, line, at), { block, line: line + 1 }, 'start')
      return
    }
    if (event.key === 'Backspace' && event.currentTarget.value === '' && event.currentTarget.selectionStart === 0) {
      const source = doc.blocks[block]
      if (!source || (source.lines.length <= 1 && doc.blocks.length === 1)) return
      event.preventDefault()
      const next = dropLine(doc, block, line)
      const nextPick: Pick =
        line > 0
          ? { block, line: line - 1 }
          : block > 0
            ? { block: block - 1, line: Math.max(0, doc.blocks[block - 1].lines.length - 1) }
            : { block: 0, line: 0 }
      place(next, next.blocks[nextPick.block] ? nextPick : { block: 0, line: 0 }, 'end')
    }
  }

  return (
    <>
      <div className="edit-bar noprint">
        <p className="edit-lead">
          <strong>原稿を直す</strong>
          <span className="edit-count">
            {doc.charCount.toLocaleString('ja-JP')}文字
            <small>目標 {doc.target.toLocaleString('ja-JP')}</small>
          </span>
        </p>
        <p className={`edit-status ${tone}`}>{toneLabel}（{doc.min.toLocaleString('ja-JP')}〜{doc.max.toLocaleString('ja-JP')}文字）</p>
        <div className={`count-track ${tone}`} aria-hidden="true">
          <span style={{ width: `${ratio}%` }} />
        </div>
      </div>
      <div className="edit-tools noprint" role="toolbar" aria-label="原稿の編集">
        <button type="button" onClick={addSentence}>
          文を足す
        </button>
        <button type="button" disabled={atStart} onClick={() => shift(-1)}>
          上へ
        </button>
        <button type="button" disabled={atEnd} onClick={() => shift(1)}>
          下へ
        </button>
        <button type="button" className="tool-cut" disabled={!safePick} onClick={cut}>
          この文を消す
        </button>
        <button type="button" onClick={() => place(addBlock(doc), { block: doc.blocks.length, line: 0 }, 'start')}>
          節を足す
        </button>
      </div>
      <p className="edit-hint noprint">
        {safePick
          ? `${safePick.block + 1}節の${safePick.line + 1}行目を選んでいます。Enterで行を分け、空の行でBackspaceすると消せます。`
          : '行を押すと、移動と削除が使えます。Enterで行を分けられます。'}
      </p>
      <article className={doc.length === 'a4' ? 'paper sheet' : 'paper'} aria-label="まとめ原稿">
        <p className="kicker">{doc.styleLabel}</p>
        <PaperInk
          className="ink ink-title"
          label="題名"
          value={doc.title}
          placeholder="題名"
          takeFocus={false}
          onChange={(value) => onChange(updateMeta(doc, { title: value }))}
          onFocused={focused}
        />
        <div className="meta-edit">
          <label className="meta-field">
            <span className="meta-label noprint">日付</span>
            <PaperInk
              className="ink ink-meta"
              label="日付"
              value={doc.dateline}
              placeholder="2026年11月28日"
              takeFocus={false}
              onChange={(value) => onChange(updateMeta(doc, { dateline: value }))}
              onFocused={focused}
            />
          </label>
          <label className="meta-field">
            <span className="meta-label noprint">出席</span>
            <PaperInk
              className="ink ink-meta"
              label="出席"
              value={doc.attendees}
              placeholder="名前を並べます"
              takeFocus={false}
              onChange={(value) => onChange(updateMeta(doc, { attendees: value }))}
              onFocused={focused}
            />
          </label>
        </div>
        {headlineOn ? (
          <PaperInk
            className={`ink ink-headline${doc.headline && doc.headline !== doc.title ? '' : ' noprint'}`}
            label="見出し"
            value={doc.headline}
            placeholder="見出し"
            takeFocus={caret?.key === 'headline' ? 'start' : false}
            onChange={(value) => onChange(updateMeta(doc, { headline: value }))}
            onFocused={focused}
          />
        ) : (
          <button type="button" className="add-headline noprint" onClick={() => {
            setHeadlineOn(true)
            setCaret({ key: 'headline', edge: 'start' })
          }}>
            見出しを足す
          </button>
        )}
        {doc.blocks.map((block, index) => (
          <section key={`block-${index}`} className="block-edit">
            <PaperInk
              className={block.heading ? 'ink ink-heading' : 'ink ink-heading noprint'}
              label={`${index + 1}節の見出し`}
              value={block.heading}
              placeholder="節の見出し"
              takeFocus={false}
              onChange={(value) => onChange(updateHeading(doc, index, value))}
              onFocused={focused}
            />
            <div className="block-actions noprint">
              <button type="button" aria-pressed={Boolean(block.list)} onClick={() => onChange(toggleList(doc, index))}>
                {block.list ? '文章に戻す' : '箇条書きにする'}
              </button>
              <button
                type="button"
                className="tool-cut"
                onClick={() => {
                  const next = clearBlock(doc, index)
                  const nextBlock = Math.min(index, Math.max(0, next.blocks.length - 1))
                  place(next, { block: nextBlock, line: 0 }, 'end')
                }}
              >
                {doc.blocks.length > 1 ? 'この節を消す' : 'この節を空にする'}
              </button>
            </div>
            {block.lines.map((line, lineIndex) => {
              const picked = safePick?.block === index && safePick.line === lineIndex
              const key = `${index}:${lineIndex}`
              return (
                <div
                  key={key}
                  className={`line-row${block.list ? ' has-mark' : ''}${picked ? ' is-picked' : ''}${line.trim() ? '' : ' noprint'}`}
                >
                  {block.list ? <span className="bullet" aria-hidden="true">・</span> : null}
                  <PaperInk
                    className="ink ink-line"
                    label={`${index + 1}節の${lineIndex + 1}行目`}
                    value={line}
                    placeholder="ここに文を書きます"
                    takeFocus={caret?.key === key ? caret.edge : false}
                    onChange={(value) => {
                      const before = block.lines.length
                      const next = updateLine(doc, index, lineIndex, value)
                      const after = next.blocks[index]?.lines.length ?? before
                      if (after > before) {
                        const at = lineIndex + (after - before)
                        place(next, { block: index, line: at }, 'end')
                      } else {
                        onChange(next)
                        setPick({ block: index, line: lineIndex })
                      }
                    }}
                    onFocus={() => setPick({ block: index, line: lineIndex })}
                    onKeyDown={(event) => onLineKey(event, index, lineIndex)}
                    onFocused={focused}
                  />
                </div>
              )
            })}
          </section>
        ))}
        <p className="count noprint">
          本文 {doc.charCount.toLocaleString('ja-JP')}文字（目標 {doc.target.toLocaleString('ja-JP')}文字）
        </p>
      </article>
    </>
  )
}
