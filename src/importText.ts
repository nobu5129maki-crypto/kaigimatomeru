const MAX_CHARS = 40000

export function decodeTextFile(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3))
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  }
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  const bad = utf8.match(/\uFFFD/g)?.length ?? 0
  if (bad > 0) {
    try {
      return new TextDecoder('shift_jis').decode(bytes)
    } catch {
      return utf8
    }
  }
  return utf8
}

export function transcriptFromFile(name: string, raw: string): string {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  let body = text.trim()
  if (ext === 'vtt' || body.startsWith('WEBVTT')) body = parseVtt(body)
  else if (ext === 'srt' || looksLikeSrt(body)) body = parseSrt(body)
  else body = cleanupPlain(body)
  const chars = Array.from(body)
  if (chars.length > MAX_CHARS) {
    return chars.slice(0, MAX_CHARS).join('')
  }
  return body
}

function looksLikeSrt(text: string): boolean {
  return /^\d+\s*\n\d{2}:\d{2}:\d{2}[,.]\d{3}\s+-->/.test(text)
}

export function parseVtt(raw: string): string {
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  const texts: string[] = []
  let i = 0
  if ((lines[0] ?? '').trim().startsWith('WEBVTT')) i = 1
  for (; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    if (/^(NOTE|STYLE|REGION)\b/.test(line)) {
      while (i + 1 < lines.length && lines[i + 1].trim() !== '') i += 1
      continue
    }
    if (line.includes('-->')) continue
    if (/^\d+$/.test(line)) continue
    texts.push(stripTags(line))
  }
  return dedupeConsecutive(texts.filter(Boolean)).join('\n')
}

export function parseSrt(raw: string): string {
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  const texts: string[] = []
  for (const source of lines) {
    const line = source.trim()
    if (!line) continue
    if (/^\d+$/.test(line)) continue
    if (line.includes('-->')) continue
    texts.push(stripTags(line))
  }
  return dedupeConsecutive(texts.filter(Boolean)).join('\n')
}

function cleanupPlain(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function stripTags(line: string): string {
  return line.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
}

function dedupeConsecutive(lines: string[]): string[] {
  const out: string[] = []
  for (const line of lines) {
    if (out.length > 0 && out[out.length - 1] === line) continue
    out.push(line)
  }
  return out
}
