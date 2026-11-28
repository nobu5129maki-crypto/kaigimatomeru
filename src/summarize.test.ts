import { describe, expect, it } from 'vitest'
import { docxBuffer, fileStem, markdownDocument } from './files'
import { parseSrt, parseVtt, transcriptFromFile } from './importText'
import { SAMPLE_ATTENDEES, SAMPLE_DATE, SAMPLE_TITLE, SAMPLE_TRANSCRIPT } from './sample'
import {
  LENGTHS,
  STYLES,
  charCount,
  documentText,
  formatJapaneseDate,
  summarize,
  trimToCount,
  type LengthId,
  type StyleId,
} from './summarize'

const lengths = (Object.keys(LENGTHS) as LengthId[]).filter((id) => id !== 'point')
const styles = Object.keys(STYLES) as StyleId[]
const headings = new Set([
  '',
  '要点',
  '決まったこと',
  '論点',
  '宿題',
  '確認されたこと',
  '決定事項',
  '保留・懸念',
  '次回',
  '確認事項',
  '会議のまとめ',
  '結論',
  '経緯',
  '流れ',
  'まとまったこと',
  '残っていること',
  'ほか',
  'やること',
  '期限',
  '関連する話',
  '要旨',
  '本文',
  '何を',
  'なぜ',
  'いつ',
  'どこで',
  'どのように',
  '誰が',
  '言いたいこと',
  '分かっていること',
  'はじめに',
  '次に',
  'そのあと',
])

function digitsOf(text: string): string[] {
  return [...text.matchAll(/\d[\d,]*/g)].map((match) => match[0].replace(/,/g, ''))
}

describe('文字数', () => {
  it('空白を除いて数える', () => {
    expect(charCount('あ い　う')).toBe(3)
    expect(charCount('980円')).toBe(4)
  })

  it('長い文を区切りで短くする', () => {
    const cut = trimToCount('初回価格は980円、3月1日から1,080円へ見直します。', 12)
    expect(charCount(cut)).toBeLessThanOrEqual(12)
    expect(cut.endsWith('…')).toBe(true)
  })
})

describe('日付', () => {
  it('ISOを日本語にする', () => {
    expect(formatJapaneseDate('2026-11-21')).toBe('2026年11月21日')
  })
})

describe('ファイルの読み込み', () => {
  it('VTTの時刻を除いて同じ字幕を重ねない', () => {
    const text = parseVtt(`WEBVTT

00:00:01.000 --> 00:00:03.000
価格は980円です。

00:00:03.000 --> 00:00:05.000
価格は980円です。

00:00:05.000 --> 00:00:08.000
次回は12月2日です。
`)
    expect(text).toBe('価格は980円です。\n次回は12月2日です。')
  })

  it('SRTの番号と時刻を除く', () => {
    const text = parseSrt(`1
00:00:01,000 --> 00:00:03,000
決定は980円です。

2
00:00:03,000 --> 00:00:05,000
色は保留です。
`)
    expect(text).toContain('決定は980円です。')
    expect(text).not.toContain('-->')
  })

  it('拡張子でVTTを選ぶ', () => {
    const text = transcriptFromFile('meeting.vtt', 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nこんにちは。\n')
    expect(text).toBe('こんにちは。')
  })
})

describe('まとめ', () => {
  it('空欄は原稿がないと伝える', () => {
    const doc = summarize({
      text: '   \n',
      title: '',
      date: SAMPLE_DATE,
      attendees: '',
      length: 'c200',
      style: 'memo',
    })
    expect(doc.charCount).toBe(0)
    expect(doc.note).toContain('文章がありません')
  })

  it('1時間ぶんの長さは、原稿が長ければ指定の範囲に収まる', () => {
    const lines = Array.from({ length: 160 }, (_, index) => {
      const n = index + 1
      return `佐藤：第${n}号の確認は、在庫${n * 10}本と期限${n}日です。`
    })
    const text = lines.join('\n')
    const doc = summarize({
      text,
      title: '長い会議',
      date: SAMPLE_DATE,
      attendees: '佐藤',
      length: 'c2000',
      style: 'memo',
    })
    expect(doc.charCount).toBeGreaterThanOrEqual(doc.min)
    expect(doc.charCount).toBeLessThanOrEqual(doc.max)
    expect(doc.plain).toContain('第160号')
    for (const n of digitsOf(doc.plain)) {
      expect(text.replace(/,/g, '')).toContain(n)
    }
    const detailed = summarize({
      text,
      title: '長い会議',
      date: SAMPLE_DATE,
      attendees: '佐藤',
      length: 'c4000',
      style: 'minutes',
    })
    expect(detailed.charCount).toBeGreaterThan(doc.charCount)
    expect(detailed.charCount).toBeLessThanOrEqual(detailed.max)
  })

  it('短い原稿に話していないことを足さない', () => {
    const doc = summarize({
      text: '佐藤：明日の会場は本社です。',
      title: '短い会議',
      date: SAMPLE_DATE,
      attendees: '佐藤',
      length: 'a4',
      style: 'news',
    })
    expect(doc.charCount).toBeLessThan(doc.min)
    expect(doc.note).toContain('足していません')
    expect(doc.plain).toContain('本社')
    expect(doc.plain).not.toContain('980')
  })

  it('例文は長さの上限を守り、原稿にあることだけを書く', () => {
    for (const length of lengths) {
      for (const style of styles) {
        const doc = summarize({
          text: SAMPLE_TRANSCRIPT,
          title: SAMPLE_TITLE,
          date: SAMPLE_DATE,
          attendees: SAMPLE_ATTENDEES,
          length,
          style,
        })
        expect(doc.charCount, `${length}/${style}\n${doc.plain}`).toBeLessThanOrEqual(doc.max)
        expect(doc.charCount, `${length}/${style}`).toBeGreaterThan(0)
        if (doc.charCount < doc.min) {
          expect(doc.note, `${length}/${style} ${doc.charCount}`).toContain('短い')
        }
        for (const n of digitsOf(doc.plain)) {
          expect(SAMPLE_TRANSCRIPT.replace(/,/g, ''), `${length}/${style} number ${n}`).toContain(n)
        }
        if (doc.headline && !headings.has(doc.headline) && doc.headline !== SAMPLE_TITLE) {
          expect(SAMPLE_TRANSCRIPT.includes(doc.headline.replace(/…$/g, '')), doc.headline).toBe(true)
        }
        for (const block of doc.blocks) {
          expect(headings.has(block.heading) || SAMPLE_TRANSCRIPT.includes(block.heading)).toBe(true)
          for (const line of block.lines) {
            if (line === '会議の要点を共有します。' || line === '以上です。') continue
            const core = line.replace(/…$/g, '')
            expect(SAMPLE_TRANSCRIPT.includes(core), `${style} ${line}`).toBe(true)
          }
        }
      }
    }
  })

  it('200文字の新聞は見出しがあり、980円が残る', () => {
    const doc = summarize({
      text: SAMPLE_TRANSCRIPT,
      title: SAMPLE_TITLE,
      date: SAMPLE_DATE,
      attendees: SAMPLE_ATTENDEES,
      length: 'c200',
      style: 'news',
    })
    expect(doc.headline.length).toBeGreaterThan(0)
    expect(doc.plain).toContain('980')
    expect(doc.charCount).toBeGreaterThanOrEqual(doc.min)
  })

  it('政治記者風は決まったことと論点に分ける', () => {
    const doc = summarize({
      text: SAMPLE_TRANSCRIPT,
      title: SAMPLE_TITLE,
      date: SAMPLE_DATE,
      attendees: SAMPLE_ATTENDEES,
      length: 'c400',
      style: 'politics',
    })
    expect(doc.plain).toContain('決まったこと')
    expect(doc.plain).toMatch(/論点|保留/)
  })

  it('見出しと箇条書きは、見出しと項目になる', () => {
    const doc = summarize({
      text: SAMPLE_TRANSCRIPT,
      title: SAMPLE_TITLE,
      date: SAMPLE_DATE,
      attendees: SAMPLE_ATTENDEES,
      length: 'c200',
      style: 'titledList',
    })
    expect(doc.headline.length).toBeGreaterThan(0)
    expect(doc.blocks.some((block) => block.list)).toBe(true)
    expect(documentText(doc)).toContain('・')
    expect(doc.charCount).toBeGreaterThanOrEqual(doc.min)
  })

  it('音が近い語は前後の文から選び直す', () => {
    const doc = summarize({
      text: '佐藤：首都高の重大を確認しました。田中：渋滞な問題は迂回で避けます。',
      title: '道路',
      date: '2026-11-28',
      attendees: '佐藤、田中',
      length: 'c400',
      style: 'bullets',
    })
    expect(doc.plain).toContain('首都高の渋滞を確認しました')
    expect(doc.plain).toContain('重大な問題')
    expect(doc.plain).not.toContain('首都高の重大')
    expect(doc.plain).not.toContain('渋滞な')
    expect(doc.note).toContain('前後の文')
  })

  it('渋滞と重大は同じ文のまま残る', () => {
    const text = '佐藤：首都高は渋滞、その影響は重大です。田中：迂回路の案を明日までに出します。'
    for (const style of ['bullets', 'titled', 'fivew', 'contrast', 'lead', 'report'] as StyleId[]) {
      const doc = summarize({
        text,
        title: '道路',
        date: '2026-11-28',
        attendees: '佐藤、田中',
        length: 'c400',
        style,
      })
      const kept = doc.blocks.flatMap((block) => block.lines).some((line) => line.includes('渋滞') && line.includes('重大'))
      expect(kept, style).toBe(true)
    }
  })

  it('見出しをつけるはタイトルを一つ決める', () => {
    const doc = summarize({
      text: SAMPLE_TRANSCRIPT,
      title: SAMPLE_TITLE,
      date: SAMPLE_DATE,
      attendees: SAMPLE_ATTENDEES,
      length: 'c400',
      style: 'titled',
    })
    expect(doc.blocks.some((block) => block.heading === '見出しの候補')).toBe(false)
    expect(doc.plain).not.toContain('このあと')
    expect(doc.headline.length).toBeGreaterThan(0)
    expect(SAMPLE_TRANSCRIPT).toContain(doc.headline)
    expect(doc.blocks.some((block) => block.heading === '決まったこと')).toBe(true)
    for (const block of doc.blocks) {
      for (const line of block.lines) expect(line.includes('：')).toBe(false)
    }
  })

  it('形は話した文の写しではなく、その形の項目になる', () => {
    const expectShape = (style: StyleId, heading: string) => {
      const doc = summarize({
        text: SAMPLE_TRANSCRIPT,
        title: SAMPLE_TITLE,
        date: SAMPLE_DATE,
        attendees: SAMPLE_ATTENDEES,
        length: 'c400',
        style,
      })
      expect(doc.blocks.some((block) => block.heading === heading), style).toBe(true)
      if (style !== 'todo') expect(doc.plain, style).toContain('980')
      for (const block of doc.blocks) {
        for (const line of block.lines) expect(line.includes('：'), `${style} ${line}`).toBe(false)
      }
    }
    expectShape('bullets', '要点')
    expectShape('lead', '結論')
    expectShape('timeline', 'はじめに')
    expectShape('contrast', 'まとまったこと')
    expectShape('todo', 'やること')
    expectShape('flash', '分かっていること')
    expectShape('fivew', '何を')
    expectShape('report', '要旨')
    const listed = summarize({
      text: SAMPLE_TRANSCRIPT,
      title: SAMPLE_TITLE,
      date: SAMPLE_DATE,
      attendees: SAMPLE_ATTENDEES,
      length: 'c400',
      style: 'titledList',
    })
    expect(listed.headline.length).toBeGreaterThan(0)
    expect(listed.blocks.some((block) => block.list)).toBe(true)
    expect(SAMPLE_TRANSCRIPT).toContain(listed.headline)
  })

  it('箇条書きは項目だけで並べる', () => {
    const doc = summarize({
      text: SAMPLE_TRANSCRIPT,
      title: SAMPLE_TITLE,
      date: SAMPLE_DATE,
      attendees: SAMPLE_ATTENDEES,
      length: 'c200',
      style: 'bullets',
    })
    expect(doc.blocks.every((block) => block.list)).toBe(true)
    expect(doc.plain).toContain('980')
  })

  it('形を複数選ぶと、それぞれの見出しで一つの原稿に並ぶ', () => {
    const doc = summarize({
      text: SAMPLE_TRANSCRIPT,
      title: SAMPLE_TITLE,
      date: SAMPLE_DATE,
      attendees: SAMPLE_ATTENDEES,
      length: 'c400',
      style: 'bullets',
      styles: ['bullets', 'todo'],
    })
    expect(doc.charCount).toBeLessThanOrEqual(doc.max)
    expect(doc.charCount).toBeGreaterThan(0)
    expect(doc.styleLabel).toContain('箇条書き')
    expect(doc.styleLabel).toContain('やること')
    expect(doc.blocks.some((block) => block.heading.includes('箇条書き'))).toBe(true)
    expect(doc.blocks.some((block) => block.heading.includes('やること'))).toBe(true)
    expect(doc.plain).toContain('980')
  })

  it('短い原稿でも、選んだ形の見出しは残る', () => {
    const doc = summarize({
      text: '初回価格は980円に決定しました。田中が来週までに広告案を出します。',
      title: '',
      date: SAMPLE_DATE,
      attendees: '',
      length: 'c400',
      style: 'bullets',
      styles: ['bullets', 'todo'],
    })
    expect(doc.blocks.some((block) => block.heading.includes('箇条書き'))).toBe(true)
    expect(doc.blocks.some((block) => block.heading.includes('やること'))).toBe(true)
    expect(doc.charCount).toBeLessThanOrEqual(doc.max)
  })

  it('長さ、形、文章の調子、記録の型を一つの原稿にまとめる', () => {
    const doc = summarize({
      text: SAMPLE_TRANSCRIPT,
      title: SAMPLE_TITLE,
      date: SAMPLE_DATE,
      attendees: SAMPLE_ATTENDEES,
      length: 'c800',
      style: 'bullets',
      styles: ['bullets', 'news', 'minutes'],
    })
    expect(doc.charCount).toBeLessThanOrEqual(doc.max)
    expect(doc.charCount).toBeGreaterThan(0)
    expect(doc.blocks.some((block) => block.heading.includes('箇条書き'))).toBe(true)
    expect(doc.blocks.some((block) => block.heading.includes('新聞記事'))).toBe(true)
    expect(doc.blocks.some((block) => block.heading.includes('議事録'))).toBe(true)
    expect(doc.plain).toContain('980')
  })

  it('要点の長さでも、選んだ形と調子を同じ原稿に入れる', () => {
    const doc = summarize({
      text: SAMPLE_TRANSCRIPT,
      title: SAMPLE_TITLE,
      date: SAMPLE_DATE,
      attendees: SAMPLE_ATTENDEES,
      length: 'point',
      style: 'bullets',
      styles: ['bullets', 'news'],
    })
    expect(doc.lengthLabel).toBe('要は、何が言いたい？')
    expect(doc.charCount).toBeLessThanOrEqual(doc.max)
    expect(doc.blocks.some((block) => block.heading.includes('箇条書き'))).toBe(true)
    expect(doc.blocks.some((block) => block.heading.includes('新聞記事'))).toBe(true)
    expect(doc.blocks.some((block) => block.heading.includes('要は、何が言いたい？'))).toBe(true)
    expect(doc.plain).toContain('980')
  })

  it('要は何が言いたいは、長い答えだけを箇条書きにする', () => {
    const interview = `私：今日の値段、どう思いますか？
田中：えーと、そうですね。原価は1本620円です。980円だと粗利が薄いです。広告費を乗せると赤字に近づきます。要するに、初回は980円で認知を取り、3月1日から1,080円に見直すべきだと思います。色は青と緑で迷っていますが、今日は決めなくていいです。
私：色は？`
    const doc = summarize({
      text: interview,
      title: '価格のインタビュー',
      date: SAMPLE_DATE,
      attendees: '私、田中',
      length: 'c200',
      style: 'point',
    })
    expect(doc.blocks.some((block) => block.list && block.heading === '言いたいこと')).toBe(true)
    expect(doc.blocks.reduce((sum, block) => sum + block.lines.length, 0)).toBeGreaterThan(1)
    expect(doc.plain).toContain('980')
    expect(doc.plain).toContain('要するに')
    expect(doc.plain).not.toContain('どう思いますか')
    expect(doc.plain).not.toContain('色は？')
    expect(doc.plain).not.toContain('えーと')
    expect(doc.note).toContain('田中')
    for (const block of doc.blocks) {
      for (const line of block.lines) {
        expect(interview.includes(line), line).toBe(true)
      }
    }
  })

  it('議事録は決定事項を出す', () => {
    const doc = summarize({
      text: SAMPLE_TRANSCRIPT,
      title: SAMPLE_TITLE,
      date: SAMPLE_DATE,
      attendees: SAMPLE_ATTENDEES,
      length: 'c400',
      style: 'minutes',
    })
    expect(doc.plain).toContain('決定事項')
  })

  it('清書用の本文に日付と出席者を添える', () => {
    const doc = summarize({
      text: SAMPLE_TRANSCRIPT,
      title: SAMPLE_TITLE,
      date: SAMPLE_DATE,
      attendees: SAMPLE_ATTENDEES,
      length: 'c200',
      style: 'mail',
    })
    const full = documentText(doc)
    expect(full).toContain(SAMPLE_TITLE)
    expect(full).toContain('2026年11月21日')
    expect(full).toContain('出席：佐藤、田中、鈴木、高橋')
    expect(full).toContain('社内連絡')
    expect(markdownDocument(doc)).toContain(`# ${SAMPLE_TITLE}`)
    expect(fileStem(doc)).not.toMatch(/[\\/:*?"<>|]/)
  })
})

describe('Word', () => {
  it('Wordで開けるファイルになる', async () => {
    const doc = summarize({
      text: SAMPLE_TRANSCRIPT,
      title: SAMPLE_TITLE,
      date: SAMPLE_DATE,
      attendees: SAMPLE_ATTENDEES,
      length: 'c200',
      style: 'news',
    })
    const buffer = await docxBuffer(doc)
    expect(buffer[0]).toBe(0x50)
    expect(buffer[1]).toBe(0x4b)
    const xml = new TextDecoder().decode(buffer)
    expect(xml.includes(SAMPLE_TITLE) || buffer.byteLength > 1000).toBe(true)
  })
})
