type Hint = { pattern: RegExp; weight: number }

type Sense = {
  word: string
  after: Hint[]
  before: Hint[]
  cues: Hint[]
  illegal: RegExp[]
}

const CLUSTERS: Sense[][] = [
  [
    {
      word: '重大',
      after: [
        { pattern: /^な(?!ら)/, weight: 4 },
        { pattern: /^だ/, weight: 3 },
        { pattern: /^です/, weight: 3 },
        { pattern: /^に/, weight: 3 },
        { pattern: /^さ/, weight: 4 },
      ],
      before: [{ pattern: /(?:とても|極めて|きわめて|最も|一番)$/, weight: 2 }],
      cues: [{ pattern: /問題|課題|事態|事故|過失|影響|リスク|違反|結果|ミス/, weight: 2 }],
      illegal: [],
    },
    {
      word: '渋滞',
      after: [
        { pattern: /^[がをはのも]/, weight: 4 },
        { pattern: /^に/, weight: 1 },
        { pattern: /^で/, weight: 2 },
        { pattern: /^情報/, weight: 3 },
      ],
      before: [{ pattern: /[のがはをも]$/, weight: 2 }],
      cues: [{ pattern: /道路|高速|首都|電車|列車|自動車|車|混雑|通行|規制|迂回|環状|ラッシュ|路線|出口|入口/, weight: 3 }],
      illegal: [/^な(?!ら)/],
    },
    {
      word: '重体',
      after: [
        { pattern: /^で/, weight: 2 },
        { pattern: /^に/, weight: 2 },
        { pattern: /^です/, weight: 2 },
      ],
      before: [{ pattern: /[のがはをも]$/, weight: 1 }],
      cues: [{ pattern: /病院|意識|搬送|救急|命|入院/, weight: 4 }],
      illegal: [/^な(?!ら)/],
    },
  ],
  [
    {
      word: '初回',
      after: [{ pattern: /^[価格限定ロット本]/, weight: 3 }],
      before: [],
      cues: [{ pattern: /価格|円|ロット|販売|出荷|製造|限定|生産|本/, weight: 3 }],
      illegal: [],
    },
    {
      word: '初会',
      after: [],
      before: [],
      cues: [{ pattern: /顔合わせ|食事|デート/, weight: 3 }],
      illegal: [],
    },
  ],
  [
    {
      word: '広告',
      after: [
        { pattern: /^案/, weight: 4 },
        { pattern: /^費/, weight: 4 },
        { pattern: /^予算/, weight: 3 },
      ],
      before: [],
      cues: [{ pattern: /宣伝|出稿|掲載|媒体|予算/, weight: 2 }],
      illegal: [/^生/],
    },
    {
      word: '高校',
      after: [{ pattern: /^生/, weight: 4 }],
      before: [],
      cues: [{ pattern: /受験|授業|先生|生徒|部活/, weight: 3 }],
      illegal: [/^案/, /^費/, /^予算/],
    },
  ],
]

const WORDS = CLUSTERS.flatMap((cluster) => cluster.map((sense) => sense.word)).sort((a, b) => b.length - a.length)

export function chooseWords(text: string): string {
  return text
    .split(/(\n)/)
    .map((part) => (part === '\n' ? part : part.split(/([。！？!?])/).map((piece) => chooseSentence(piece)).join('')))
    .join('')
}

function chooseSentence(sentence: string): string {
  if (!sentence) return sentence
  return sentence
    .split(/([、,])/)
    .map((piece) => (/^[、,]$/.test(piece) ? piece : chooseClause(piece)))
    .join('')
}

function chooseClause(clause: string): string {
  const hits: { index: number; word: string; cluster: Sense[] }[] = []
  let index = 0
  while (index < clause.length) {
    const word = WORDS.find((item) => clause.startsWith(item, index))
    if (!word) {
      index += 1
      continue
    }
    const cluster = CLUSTERS.find((senses) => senses.some((sense) => sense.word === word))
    if (cluster) hits.push({ index, word, cluster })
    index += word.length
  }
  let out = clause
  for (const hit of [...hits].reverse()) {
    const next = pick(clause, hit.index, hit.word, hit.cluster)
    if (next === hit.word) continue
    out = `${out.slice(0, hit.index)}${next}${out.slice(hit.index + hit.word.length)}`
  }
  return out
}

function pick(clause: string, index: number, surface: string, cluster: Sense[]): string {
  const before = clause.slice(Math.max(0, index - 16), index)
  const after = clause.slice(index + surface.length)
  const ranked = cluster.map((sense) => ({
    word: sense.word,
    score: scoreSense(sense, clause, before, after),
    cue: sense.cues.some((hint) => hint.pattern.test(clause)),
    illegal: sense.illegal.some((pattern) => pattern.test(after)),
  }))
  ranked.sort((a, b) => b.score - a.score || Number(b.word === surface) - Number(a.word === surface))
  const best = ranked[0]
  const current = ranked.find((item) => item.word === surface)
  if (!best || !current || best.word === surface) return surface
  if (best.score < current.score + 2 || best.score <= 0) return surface
  if (best.cue || current.illegal) return best.word
  return surface
}

function scoreSense(sense: Sense, clause: string, before: string, after: string): number {
  let score = 0
  for (const hint of sense.after) if (hint.pattern.test(after)) score += hint.weight
  for (const hint of sense.before) if (hint.pattern.test(before)) score += hint.weight
  for (const hint of sense.cues) if (hint.pattern.test(clause)) score += hint.weight
  for (const pattern of sense.illegal) if (pattern.test(after)) score -= 5
  return score
}
