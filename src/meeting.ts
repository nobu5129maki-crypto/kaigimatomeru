import { appendRecognized } from './capture'
import { splitAttendees } from './roster'

export const MAX_MEETING_SECONDS = 3 * 60 * 60

export type Span = { start: number; end: number }

export type HearingPiece = Span & { label: string; stitch: boolean }

export type HearingPlan = { pieces: HearingPiece[]; note: string }

export type HearingDraft = { text: string; line: string; label: string }

export function pushHearing(draft: HearingDraft, heard: string, piece: { label: string; stitch: boolean }): HearingDraft {
  const speech = heard.trim()
  if (!speech) return draft
  if (!piece.label) {
    const flushed = finishHearing(draft)
    return { text: appendRecognized(flushed, speech), line: '', label: '' }
  }
  if (piece.stitch && piece.label === draft.label) {
    return { ...draft, line: appendRecognized(draft.line, speech) }
  }
  return { text: finishHearing(draft), line: speech, label: piece.label }
}

export function finishHearing(draft: HearingDraft): string {
  const body = draft.line.trim()
  if (!body) return draft.text
  const row = draft.label ? `${draft.label}：${body}` : body
  return draft.text ? `${draft.text}\n${row}` : row
}

type Feature = { pitch: number; zcr: number }

const SAME_VOICE = 0.22

export function splitAtSilence(pcm: Float32Array, rate: number, targetSec = 30, overlapSec = 1): Span[] {
  const target = Math.max(1, Math.floor(rate * targetSec))
  const overlap = Math.max(0, Math.floor(rate * overlapSec))
  const minAdvance = Math.max(1, Math.floor(rate * 8))
  if (pcm.length === 0) return []
  if (pcm.length <= target + minAdvance) return [{ start: 0, end: pcm.length }]
  const spans: Span[] = []
  let from = 0
  while (from < pcm.length) {
    const remaining = pcm.length - from
    if (remaining <= target + minAdvance) {
      spans.push({ start: from, end: pcm.length })
      break
    }
    const ideal = from + target
    const searchFrom = Math.max(from + minAdvance, ideal - Math.floor(rate * 6))
    const searchTo = Math.min(pcm.length - 1, ideal + Math.floor(rate * 2))
    const hop = Math.max(1, Math.floor(rate * 0.05))
    const probe = Math.max(1, Math.floor(rate * 0.2))
    let bestAt = ideal
    let best = Number.POSITIVE_INFINITY
    for (let at = searchFrom; at <= searchTo; at += hop) {
      const energy = windowRms(pcm, at, probe)
      if (energy < best) {
        best = energy
        bestAt = at
      }
    }
    const end = Math.max(from + minAdvance, Math.min(pcm.length, bestAt))
    spans.push({ start: from, end })
    const next = Math.max(from + minAdvance, end - overlap)
    if (next <= from) break
    from = next
  }
  return spans
}

export function planHearing(pcm: Float32Array, rate: number, separate: boolean, attendees: string): HearingPlan {
  const whole = splitAtSilence(pcm, rate)
  if (!separate) return { pieces: whole.map((span) => ({ ...span, label: '', stitch: true })), note: '' }
  const turns = separateSpeakers(pcm, rate)
  const ids = [...new Set(turns.map((turn) => turn.speaker))]
  if (ids.length < 2) {
    return { pieces: whole.map((span) => ({ ...span, label: '', stitch: true })), note: '声は一人分でした。' }
  }
  const names = namesForSpeakers(ids, turns, attendees)
  const pieces: HearingPiece[] = []
  for (const turn of turns) {
    const slice = pcm.subarray(turn.start, turn.end)
    const parts = splitAtSilence(slice, rate).map((part) => ({
      start: turn.start + part.start,
      end: turn.start + part.end,
    }))
    parts.forEach((part, index) => {
      pieces.push({ ...part, label: names.get(turn.speaker) ?? `話者${turn.speaker + 1}`, stitch: index > 0 })
    })
  }
  const named = names.size > 0 && [...names.values()].some((label) => !label.startsWith('話者'))
  const note = named
    ? `声の違いで${ids.length}人に分け、話し始めた順に出席者名を付けました。`
    : `声の違いで${ids.length}人に分けました。人の名前は声だけでは決まりません。`
  return { pieces, note }
}

export function separateSpeakers(pcm: Float32Array, rate: number): (Span & { speaker: number })[] {
  const segments = speechSegments(pcm, rate)
  const speakers: Feature[] = []
  const turns: (Span & { speaker: number })[] = []
  for (const segment of segments) {
    const feature = voiceFeature(pcm.subarray(segment.start, segment.end), rate)
    let speaker = speakers.findIndex((item) => voiceDistance(item, feature) < SAME_VOICE)
    if (speaker < 0) {
      if (feature.pitch <= 0 && speakers.length > 0) speaker = speakers.length - 1
      else if (speakers.length >= 6) speaker = nearestSpeaker(speakers, feature)
      else {
        speakers.push(feature)
        speaker = speakers.length - 1
      }
    } else {
      const current = speakers[speaker]
      const count = turns.filter((turn) => turn.speaker === speaker).length + 1
      speakers[speaker] = {
        pitch: current.pitch <= 0 ? feature.pitch : (current.pitch * (count - 1) + feature.pitch) / count,
        zcr: (current.zcr * (count - 1) + feature.zcr) / count,
      }
    }
    const last = turns[turns.length - 1]
    if (last && last.speaker === speaker && segment.start - last.end < rate * 0.8) {
      last.end = segment.end
      continue
    }
    turns.push({ ...segment, speaker })
  }
  return turns
}

function namesForSpeakers(ids: number[], turns: (Span & { speaker: number })[], attendees: string): Map<number, string> {
  const order: number[] = []
  for (const turn of turns) if (!order.includes(turn.speaker)) order.push(turn.speaker)
  const names = splitAttendees(attendees)
  const map = new Map<number, string>()
  ids.forEach((id) => map.set(id, `話者${order.indexOf(id) + 1}`))
  if (names.length !== order.length) return map
  order.forEach((id, index) => map.set(id, names[index] || map.get(id) || `話者${index + 1}`))
  return map
}

function speechSegments(pcm: Float32Array, rate: number): Span[] {
  const frame = Math.max(1, Math.floor(rate * 0.02))
  const energies: number[] = []
  for (let start = 0; start + frame <= pcm.length; start += frame) energies.push(windowRms(pcm, start, frame))
  if (energies.length === 0) return []
  const sorted = [...energies].sort((a, b) => a - b)
  const quiet = sorted[Math.floor(sorted.length * 0.1)] ?? 0
  const loud = sorted[Math.floor(sorted.length * 0.9)] ?? quiet
  const spread = loud - quiet
  const threshold = spread < 0.02 ? Math.max(0.008, quiet * 0.45) : Math.max(0.01, quiet + spread * 0.28)
  const voiced = energies.map((energy) => energy >= threshold)
  const minGap = Math.floor(0.28 / 0.02)
  for (let index = 0; index < voiced.length; index += 1) {
    if (voiced[index]) continue
    let gap = 0
    while (index + gap < voiced.length && !voiced[index + gap]) gap += 1
    const before = index > 0 && voiced[index - 1]
    const after = index + gap < voiced.length && voiced[index + gap]
    if (before && after && gap <= minGap) {
      for (let fill = 0; fill < gap; fill += 1) voiced[index + fill] = true
    }
    index += Math.max(0, gap - 1)
  }
  const segments: Span[] = []
  let open = -1
  voiced.forEach((on, index) => {
    if (on && open < 0) open = index
    if (!on && open >= 0) {
      segments.push({ start: open * frame, end: index * frame })
      open = -1
    }
  })
  if (open >= 0) segments.push({ start: open * frame, end: Math.min(pcm.length, voiced.length * frame) })
  const minSamples = Math.floor(rate * 0.4)
  return segments.filter((segment) => segment.end - segment.start >= minSamples)
}

function voiceFeature(pcm: Float32Array, rate: number): Feature {
  const need = Math.floor(rate * 0.45)
  const start = pcm.length > need ? Math.floor((pcm.length - need) / 2) : 0
  const slice = pcm.subarray(start, Math.min(pcm.length, start + Math.max(need, pcm.length)))
  return { pitch: pitchOf(slice, rate), zcr: zeroCrossing(slice) }
}

function pitchOf(pcm: Float32Array, rate: number): number {
  const minLag = Math.max(1, Math.floor(rate / 400))
  const maxLag = Math.min(pcm.length - 2, Math.floor(rate / 70))
  if (maxLag <= minLag) return 0
  let bestLag = 0
  let best = 0
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let corr = 0
    let left = 0
    let right = 0
    const last = pcm.length - lag
    for (let index = 0; index < last; index += 2) {
      const a = pcm[index]
      const b = pcm[index + lag]
      corr += a * b
      left += a * a
      right += b * b
    }
    const norm = Math.sqrt(left * right)
    const score = norm > 1e-8 ? corr / norm : 0
    if (score > best) {
      best = score
      bestLag = lag
    }
  }
  if (best < 0.45 || bestLag === 0) return 0
  return rate / bestLag
}

function zeroCrossing(pcm: Float32Array): number {
  if (pcm.length < 2) return 0
  let count = 0
  for (let index = 1; index < pcm.length; index += 1) {
    if (pcm[index] >= 0 !== pcm[index - 1] >= 0) count += 1
  }
  return count / pcm.length
}

function voiceDistance(a: Feature, b: Feature): number {
  if (a.pitch > 0 && b.pitch > 0) return Math.abs(Math.log2(a.pitch / b.pitch))
  return Math.abs(a.zcr - b.zcr) * 40
}

function nearestSpeaker(speakers: Feature[], feature: Feature): number {
  let best = 0
  let score = Number.POSITIVE_INFINITY
  speakers.forEach((item, index) => {
    const distance = voiceDistance(item, feature)
    if (distance < score) {
      score = distance
      best = index
    }
  })
  return best
}

function windowRms(pcm: Float32Array, start: number, length: number): number {
  const end = Math.min(pcm.length, start + length)
  const count = Math.max(1, end - start)
  let sum = 0
  for (let index = start; index < end; index += 1) sum += pcm[index] * pcm[index]
  return Math.sqrt(sum / count)
}
