import { env, pipeline } from '@huggingface/transformers'

env.allowLocalModels = false
env.useBrowserCache = true
const wasm = env.backends.onnx.wasm
if (wasm) wasm.numThreads = 1

type Warm = { type: 'warm'; accurate?: boolean }
type Hear = { type: 'hear'; id: number; pcm: Float32Array; final: boolean; beams?: number }
type Request = Warm | Hear

type Transcriber = (
  audio: Float32Array,
  options: { language: string; task: 'transcribe'; do_sample: false; num_beams: number },
) => Promise<{ text?: string } | string>

let transcriber: Transcriber | null = null
let warming: Promise<void> | null = null
let wantAccurate = false

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null
  postMessage: (data: unknown) => void
}

function reportProgress(update: { status?: string; progress?: number }): void {
  if (update.status === 'done') {
    scope.postMessage({ type: 'progress', progress: 100, stage: 'boot' })
    return
  }
  if (update.status !== 'progress' || typeof update.progress !== 'number') return
  const progress = Math.max(0, Math.min(100, update.progress))
  scope.postMessage({ type: 'progress', progress, stage: progress >= 100 ? 'boot' : 'download' })
}

async function loadModel(model: string): Promise<Transcriber> {
  const created = await pipeline('automatic-speech-recognition', model, {
    device: 'wasm',
    dtype: 'q8',
    progress_callback: reportProgress,
  })
  return created as Transcriber
}

function warm(): Promise<void> {
  if (transcriber) return Promise.resolve()
  if (warming) return warming
  // 話した言葉が残る small を使う。録音のまとめは候補を2本比べて、近い音の取り違えを減らす。
  warming = (async () => {
    try {
      transcriber = await loadModel('Xenova/whisper-small')
    } catch {
      transcriber = await loadModel('Xenova/whisper-tiny')
    }
    scope.postMessage({ type: 'ready' })
  })().catch((error: unknown) => {
    warming = null
    throw error
  })
  return warming
}

scope.onmessage = (event) => {
  const data = event.data
  if (!data || data.type === 'warm') {
    if (data?.type === 'warm' && data.accurate) wantAccurate = true
    warm().catch(() => scope.postMessage({ type: 'error' }))
    return
  }
  if (data.type !== 'hear') return
  warm()
    .then(async () => {
      const beams = wantAccurate ? 2 : data.beams === 2 ? 2 : 1
      const result = await transcriber?.(data.pcm, {
        language: 'japanese',
        task: 'transcribe',
        do_sample: false,
        num_beams: beams,
      })
      const text = typeof result === 'string' ? result : (result?.text ?? '')
      scope.postMessage({ type: 'text', id: data.id, text, final: data.final })
    })
    .catch(() => scope.postMessage({ type: 'error' }))
}
