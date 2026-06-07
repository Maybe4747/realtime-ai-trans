import type {
  LanguageCode,
  ProviderEvent,
  StartSessionOptions,
  SubtitleItem,
  TargetLanguageCode
} from '../../shared/types'

const ASR_ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/audio/transcriptions'
const CHAT_ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
const ASR_MODEL = 'glm-asr-2512'
const CHAT_MODEL = 'glm-4.7-flash'
const SEGMENT_MS = 3_200
const MIN_SEGMENT_BYTES = 16_000

interface ZhipuProviderOptions {
  apiKey: string
  sessionId: string
  config: StartSessionOptions
  getRecentSubtitles: () => SubtitleItem[]
}

interface TranslationResult {
  translatedText: string
  revisions: Array<{
    id: string
    translatedText: string
  }>
}

const languageLabels: Record<LanguageCode, string> = {
  auto: '自动识别',
  'zh-CN': '简体中文',
  en: '英语',
  ja: '日语',
  ko: '韩语'
}

export class ZhipuProvider {
  private readonly eventListeners = new Set<(event: ProviderEvent) => void>()
  private readonly errorListeners = new Set<(error: unknown) => void>()
  private readonly apiKey: string
  private readonly sessionId: string
  private readonly config: StartSessionOptions
  private readonly getRecentSubtitles: () => SubtitleItem[]
  private buffers: Buffer[] = []
  private segmentStartedAt = 0
  private active = false
  private flushing = Promise.resolve()
  private segmentIndex = 0

  constructor(options: ZhipuProviderOptions) {
    this.apiKey = options.apiKey
    this.sessionId = options.sessionId
    this.config = options.config
    this.getRecentSubtitles = options.getRecentSubtitles
  }

  start(): void {
    this.active = true
    this.segmentStartedAt = Date.now()
  }

  sendAudioChunk(data: ArrayBuffer, timestamp: number): void {
    if (!this.active) {
      return
    }

    if (this.buffers.length === 0) {
      this.segmentStartedAt = timestamp
    }

    this.buffers.push(Buffer.from(data))

    if (timestamp - this.segmentStartedAt >= SEGMENT_MS) {
      this.queueFlush()
    }
  }

  async stop(): Promise<void> {
    this.active = false
    this.queueFlush()
    await this.flushing
  }

  cancel(): void {
    this.active = false
    this.buffers = []
  }

  onEvent(callback: (event: ProviderEvent) => void): () => void {
    this.eventListeners.add(callback)
    return () => this.eventListeners.delete(callback)
  }

  onError(callback: (error: unknown) => void): () => void {
    this.errorListeners.add(callback)
    return () => this.errorListeners.delete(callback)
  }

  private queueFlush(): void {
    const buffers = this.buffers
    this.buffers = []
    this.segmentStartedAt = Date.now()

    if (buffers.reduce((total, buffer) => total + buffer.byteLength, 0) < MIN_SEGMENT_BYTES) {
      return
    }

    this.flushing = this.flushing
      .then(() => this.flushSegment(buffers))
      .catch((error: unknown) => this.emitError(error))
  }

  private async flushSegment(buffers: Buffer[]): Promise<void> {
    const segmentId = `${this.sessionId}-${++this.segmentIndex}`
    const pcm = Buffer.concat(buffers)
    const wav = createWav(pcm, this.config.sampleRate)
    const sourceText = await this.transcribe(wav, segmentId)

    if (!sourceText) {
      return
    }

    this.emit({ type: 'transcript.completed', segmentId, sourceText })
    const result = await this.translateAndRevise(sourceText)

    if (!result.translatedText) {
      return
    }

    this.emit({
      type: 'translation.delta',
      segmentId,
      sourceText,
      translatedText: result.translatedText
    })
    this.emit({
      type: 'translation.completed',
      segmentId,
      sourceText,
      translatedText: result.translatedText
    })

    for (const revision of result.revisions) {
      this.emit({
        type: 'translation.revised',
        targetSubtitleId: revision.id,
        translatedText: revision.translatedText
      })
    }
  }

  private async transcribe(wav: Buffer, segmentId: string): Promise<string> {
    const form = new FormData()
    form.set('model', ASR_MODEL)
    form.set('stream', 'false')
    form.set('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), `${segmentId}.wav`)

    const response = await fetch(ASR_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`
      },
      body: form
    })

    if (!response.ok) {
      throw new Error(`ASR request failed: ${response.status} ${await response.text()}`)
    }

    return extractAsrText(await response.json()).trim()
  }

  private async translateAndRevise(sourceText: string): Promise<TranslationResult> {
    const recent = this.getRecentSubtitles().map((item) => ({
      id: item.id,
      sourceText: item.sourceText ?? '',
      translatedText: item.translatedText
    }))

    const response = await fetch(CHAT_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              '你是实时字幕翻译引擎。只返回 JSON，不要 Markdown。当前任务是翻译当前片段，并在必要时修正最近字幕。'
          },
          {
            role: 'user',
            content: buildTranslationPrompt(
              sourceText,
              this.config.sourceLanguage,
              this.config.targetLanguage,
              recent
            )
          }
        ]
      })
    })

    if (!response.ok) {
      throw new Error(`Translation request failed: ${response.status} ${await response.text()}`)
    }

    const content = extractChatContent(await response.json())
    return parseTranslationResult(content)
  }

  private emit(event: ProviderEvent): void {
    for (const listener of this.eventListeners) {
      listener(event)
    }
  }

  private emitError(error: unknown): void {
    this.cancel()

    for (const listener of this.errorListeners) {
      listener(error)
    }
  }
}

function createWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44)
  const byteRate = sampleRate * 2
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.byteLength, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.byteLength, 40)
  return Buffer.concat([header, pcm])
}

function buildTranslationPrompt(
  sourceText: string,
  sourceLanguage: LanguageCode,
  targetLanguage: TargetLanguageCode,
  recent: Array<{ id: string; sourceText: string; translatedText: string }>
): string {
  return [
    `源语言：${languageLabels[sourceLanguage]}`,
    `目标语言：${languageLabels[targetLanguage]}`,
    '最近字幕 JSON：',
    JSON.stringify(recent),
    '当前原文：',
    sourceText,
    '返回 JSON 格式：{"translatedText":"当前片段译文","revisions":[{"id":"需要修正的字幕 id","translatedText":"修正后译文"}]}',
    '如果没有需要修正的前文，revisions 返回空数组。'
  ].join('\n')
}

function parseTranslationResult(content: string): TranslationResult {
  const jsonText = stripJsonFence(content)

  try {
    const parsed: unknown = JSON.parse(jsonText)
    if (!isRecord(parsed)) {
      return { translatedText: content.trim(), revisions: [] }
    }

    const revisions = Array.isArray(parsed.revisions)
      ? parsed.revisions.flatMap((revision): TranslationResult['revisions'] => {
          if (!isRecord(revision)) {
            return []
          }

          const id = readString(revision, 'id')
          const translatedText = readString(revision, 'translatedText')
          return id && translatedText ? [{ id, translatedText }] : []
        })
      : []

    return {
      translatedText: readString(parsed, 'translatedText') || content.trim(),
      revisions
    }
  } catch {
    return { translatedText: content.trim(), revisions: [] }
  }
}

function stripJsonFence(content: string): string {
  return content
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
}

function extractAsrText(payload: unknown): string {
  if (!isRecord(payload)) {
    return ''
  }

  const direct = readString(payload, 'text')
  if (direct) {
    return direct
  }

  const data = payload.data
  if (isRecord(data)) {
    return readString(data, 'text')
  }

  return ''
}

function extractChatContent(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    return ''
  }

  const firstChoice = payload.choices[0]
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    return ''
  }

  return readString(firstChoice.message, 'content')
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
