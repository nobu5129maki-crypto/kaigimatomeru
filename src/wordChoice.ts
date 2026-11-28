type Hint = { pattern: RegExp; weight: number; reach?: 'sentence' | 'around' }

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
      cues: [{ pattern: /問題|課題|事態|事故|過失|影響|リスク|違反|結果|ミス/, weight: 2, reach: 'sentence' }],
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
      cues: [
        {
          pattern: /道路|高速|首都|電車|列車|自動車|車|混雑|通行|規制|迂回|環状|ラッシュ|路線|出口|入口/,
          weight: 3,
          reach: 'around',
        },
      ],
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
      cues: [{ pattern: /病院|意識|搬送|救急|命|入院/, weight: 4, reach: 'around' }],
      illegal: [/^な(?!ら)/],
    },
  ],
  [
    {
      word: '初回',
      after: [{ pattern: /^[価格限定ロット本]/, weight: 3 }],
      before: [],
      cues: [{ pattern: /価格|円|ロット|販売|出荷|製造|限定|生産/, weight: 3, reach: 'sentence' }],
      illegal: [],
    },
    {
      word: '初会',
      after: [],
      before: [],
      cues: [{ pattern: /顔合わせ|食事|デート/, weight: 3, reach: 'around' }],
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
      cues: [{ pattern: /宣伝|出稿|掲載|媒体|予算/, weight: 2, reach: 'sentence' }],
      illegal: [/^生/],
    },
    {
      word: '高校',
      after: [{ pattern: /^生/, weight: 4 }],
      before: [],
      cues: [{ pattern: /受験|授業|先生|生徒|部活/, weight: 3, reach: 'around' }],
      illegal: [/^案/, /^費/, /^予算/],
    },
  ],
  [
    {
      word: '短歌',
      after: [],
      before: [],
      cues: [
        {
          pattern: /詠|一首|二首|三首|数首|歌会|歌人|歌集|歌壇|俳句|和歌|五七|結社|選者|題詠|短冊|季語/,
          weight: 4,
          reach: 'around',
        },
      ],
      illegal: [],
    },
    {
      word: '単価',
      after: [],
      before: [],
      cues: [{ pattern: /円|原価|コスト|値引|価格|定価|料金|仕入|卸/, weight: 3, reach: 'sentence' }],
      illegal: [],
    },
  ],
]

const WORDS = CLUSTERS.flatMap((cluster) => cluster.map((sense) => sense.word)).sort((a, b) => b.length - a.length)

type Sentence = { body: string; sep: string }

export function chooseWords(text: string): string {
  const sentences = splitSentences(text)
  return sentences
    .map((sentence, index) => {
      const prev = sentences[index - 1]?.body ?? ''
      const next = sentences[index + 1]?.body ?? ''
      return chooseSentence(sentence.body, prev, next) + sentence.sep
    })
    .join('')
}

function splitSentences(text: string): Sentence[] {
  const parts = text.split(/([。！？!?\n]+)/)
  const sentences: Sentence[] = []
  for (let index = 0; index < parts.length; index += 2) {
    sentences.push({ body: parts[index] ?? '', sep: parts[index + 1] ?? '' })
  }
  return sentences
}

function chooseSentence(sentence: string, prev: string, next: string): string {
  if (!sentence) return sentence
  const clauses = splitClauses(sentence)
  return clauses
    .map((clause, index) => {
      const rest = clauses
        .filter((_, other) => other !== index)
        .map((other) => other.body)
        .join('')
      return chooseClause(clause.body, `${prev}\n${rest}\n${next}`) + clause.sep
    })
    .join('')
}

function splitClauses(text: string): Sentence[] {
  const parts = text.split(/([、,]+)/)
  const clauses: Sentence[] = []
  for (let index = 0; index < parts.length; index += 2) {
    clauses.push({ body: parts[index] ?? '', sep: parts[index + 1] ?? '' })
  }
  return clauses
}

function chooseClause(clause: string, around: string): string {
  if (!clause) return clause
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
    const chosen = pick(clause, around, hit.index, hit.word, hit.cluster)
    if (chosen === hit.word) continue
    out = `${out.slice(0, hit.index)}${chosen}${out.slice(hit.index + hit.word.length)}`
  }
  return out
}

function pick(clause: string, around: string, index: number, surface: string, cluster: Sense[]): string {
  const before = clause.slice(Math.max(0, index - 16), index)
  const after = clause.slice(index + surface.length)
  const ranked = cluster.map((sense) => ({
    word: sense.word,
    local: scoreLocal(sense, clause, before, after),
    near: scoreNear(sense, around),
    cue: hasCue(sense, clause, around),
    illegal: sense.illegal.some((pattern) => pattern.test(after)),
  }))
  ranked.sort(
    (a, b) => b.local * 2 + b.near - (a.local * 2 + a.near) || Number(b.word === surface) - Number(a.word === surface),
  )
  const best = ranked[0]
  const current = ranked.find((item) => item.word === surface)
  if (!best || !current || best.word === surface) return surface
  const bestTotal = best.local * 2 + best.near
  const currentTotal = current.local * 2 + current.near
  if (bestTotal < currentTotal + 2 || bestTotal <= 0) return surface
  if (best.cue || current.illegal) return best.word
  return surface
}

function scoreLocal(sense: Sense, clause: string, before: string, after: string): number {
  let score = 0
  for (const hint of sense.after) if (hint.pattern.test(after)) score += hint.weight
  for (const hint of sense.before) if (hint.pattern.test(before)) score += hint.weight
  for (const hint of sense.cues) if (hint.pattern.test(clause)) score += hint.weight
  for (const pattern of sense.illegal) if (pattern.test(after)) score -= 5
  return score
}

function scoreNear(sense: Sense, around: string): number {
  let score = 0
  for (const hint of sense.cues) {
    if (hint.reach === 'sentence') continue
    if (hint.pattern.test(around)) score += hint.weight
  }
  return score
}

function hasCue(sense: Sense, clause: string, around: string): boolean {
  return sense.cues.some((hint) => {
    if (hint.pattern.test(clause)) return true
    return hint.reach !== 'sentence' && hint.pattern.test(around)
  })
}
