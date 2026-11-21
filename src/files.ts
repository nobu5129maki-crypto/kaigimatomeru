import { Document, Packer, Paragraph, TextRun } from 'docx'
import type { SummaryResult } from './summarize'

export function fileStem(doc: SummaryResult): string {
  const raw = `${doc.title}_${doc.dateline || '日付なし'}_${doc.styleLabel}`
  const cleaned = raw.replace(/[\\/:*?"<>|\r\n]/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned.slice(0, 80) || '会議まとめ'
}

export function markdownDocument(doc: SummaryResult): string {
  const lines: string[] = [`# ${doc.title}`]
  const meta = [doc.dateline, doc.attendees ? `出席：${doc.attendees}` : ''].filter(Boolean).join('　')
  if (meta) lines.push('', meta)
  lines.push('', `まとめ方：${doc.styleLabel}／${doc.lengthLabel}`)
  if (doc.headline && doc.headline !== doc.title) lines.push('', `## ${doc.headline}`)
  for (const block of doc.blocks) {
    if (block.heading) lines.push('', `### ${block.heading}`)
    for (const line of block.lines) lines.push('', block.list ? `- ${line}` : line)
  }
  lines.push('')
  return lines.join('\n')
}

function textRun(value: string, opts: { bold?: boolean; size?: number; font?: string } = {}): TextRun {
  return new TextRun({
    text: value,
    bold: opts.bold,
    size: opts.size ?? 21,
    font: opts.font ?? 'Yu Gothic',
  })
}

function makeDocument(doc: SummaryResult): Document {
  const children: Paragraph[] = [
    new Paragraph({
      spacing: { after: 160 },
      children: [textRun(doc.title, { bold: true, size: 32, font: 'Yu Mincho' })],
    }),
    new Paragraph({
      spacing: { after: 280 },
      children: [
        textRun(
          [doc.dateline, doc.attendees ? `出席：${doc.attendees}` : '', `まとめ方：${doc.styleLabel}／${doc.lengthLabel}`]
            .filter(Boolean)
            .join('　'),
          { size: 18 },
        ),
      ],
    }),
  ]
  if (doc.headline && doc.headline !== doc.title) {
    children.push(
      new Paragraph({
        spacing: { before: 80, after: 160 },
        children: [textRun(doc.headline, { bold: true, size: 28, font: 'Yu Mincho' })],
      }),
    )
  }
  for (const block of doc.blocks) {
    if (block.heading) {
      children.push(
        new Paragraph({
          spacing: { before: 220, after: 60 },
          children: [textRun(block.heading, { bold: true, size: 22 })],
        }),
      )
    }
    for (const line of block.lines) {
      children.push(
        new Paragraph({
          spacing: { after: 80 },
          children: [textRun(block.list ? `・${line}` : line)],
        }),
      )
    }
  }
  return new Document({
    creator: '会議まとめ',
    title: doc.title,
    description: '会議のまとめ',
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
          },
        },
        children,
      },
    ],
  })
}

export async function docxBuffer(doc: SummaryResult): Promise<Uint8Array> {
  return Packer.toBuffer(makeDocument(doc))
}

export async function docxBlob(doc: SummaryResult): Promise<Blob> {
  return Packer.toBlob(makeDocument(doc))
}

export function textBlob(text: string): Blob {
  return new Blob(['\uFEFF' + text.replace(/\n/g, '\r\n')], { type: 'text/plain;charset=utf-8' })
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

export async function shareFile(
  blob: Blob,
  filename: string,
  text: string,
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' })
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean }
  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: filename, text })
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
    }
  }
  downloadBlob(blob, filename)
  return 'downloaded'
}
