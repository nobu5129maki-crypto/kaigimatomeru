import { env, pipeline } from '@huggingface/transformers'

env.allowLocalModels = false
env.useBrowserCache = true
const wasm = env.backends.onnx.wasm
if (wasm) wasm.numThreads = 1

type Warm = { type: 'warm' }
type Hear = { type: 'hear'; id: number; pcm: Float32Array; final: boolean; beams?: number }
type Request = Warm | Hear

type Transcriber = (
  audio: Float32Array,
  options: { language: string; task: 'transcribe'; do_sample: false; num_beams: number },
) => Promise<{ text?: string } | string>

let transcriber: Transcriber | null = null
let warming: Promise<void> | null = null

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null
  postMessage: (data: unknown) => void
}

function reportProgress(update: { status?: string; progress?: number }): void {
  if (update.status !== 'progress' || typeof update.progress !== 'number') return
  scope.postMessage({ type: 'progress', progress: Math.max(0, Math.min(100, update.progress)) })
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
    warm().catch(() => scope.postMessage({ type: 'error' }))
    return
  }
  if (data.type !== 'hear') return
  warm()
    .then(async () => {
      const result = await transcriber?.(data.pcm, {
        language: 'japanese',
        task: 'transcribe',
        do_sample: false,
        num_beams: data.beams === 2 ? 2 : 1,
      })
      const text = typeof result === 'string' ? result : (result?.text ?? '')
      scope.postMessage({ type: 'text', id: data.id, text, final: data.final })
    })
    .catch(() => scope.postMessage({ type: 'error' }))
}
