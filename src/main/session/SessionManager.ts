import type { AudioChunk, SessionEvent, SessionState, StartSessionOptions } from '../../shared/types'
import { SubtitleStore } from '../subtitles/SubtitleStore'
import { ZhipuProvider } from './ZhipuProvider'

const defaultConfig = {
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN'
} as const

export class SessionManager {
  private readonly subtitleStore: SubtitleStore
  private readonly listeners = new Set<(event: SessionEvent) => void>()
  private provider?: ZhipuProvider
  private state: SessionState = {
    status: 'idle',
    config: defaultConfig
  }

  constructor(subtitleStore: SubtitleStore) {
    this.subtitleStore = subtitleStore
  }

  getState(): SessionState {
    return { ...this.state }
  }

  onEvent(callback: (event: SessionEvent) => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  async start(options: StartSessionOptions): Promise<SessionState> {
    const apiKey = process.env.ZHIPU_API_KEY
    if (!apiKey) {
      return this.fail('请先设置 ZHIPU_API_KEY 环境变量')
    }

    await this.provider?.stop()

    const sessionId =
      this.state.status === 'paused' && this.state.sessionId
        ? this.state.sessionId
        : `session-${Date.now()}`

    if (this.state.status !== 'paused') {
      this.subtitleStore.clear()
    }

    this.setState({
      sessionId,
      status: 'connecting',
      config: {
        sourceLanguage: options.sourceLanguage,
        targetLanguage: options.targetLanguage
      },
      startedAt: Date.now()
    })

    const provider = new ZhipuProvider({
      apiKey,
      sessionId,
      config: options,
      getRecentSubtitles: () => this.subtitleStore.getRecentStable()
    })

    provider.onEvent((event) => {
      if (event.type === 'translation.delta') {
        this.subtitleStore.upsertDraft({
          id: event.segmentId,
          sessionId,
          sourceLanguage: options.sourceLanguage,
          targetLanguage: options.targetLanguage,
          sourceText: event.sourceText,
          translatedText: event.translatedText
        })
      }

      if (event.type === 'translation.completed') {
        this.subtitleStore.stabilize({
          id: event.segmentId,
          sessionId,
          sourceLanguage: options.sourceLanguage,
          targetLanguage: options.targetLanguage,
          sourceText: event.sourceText,
          translatedText: event.translatedText
        })
      }

      if (event.type === 'translation.revised') {
        this.subtitleStore.revise(event.targetSubtitleId, event.translatedText)
      }
    })

    provider.onError((error) => this.fail(readErrorMessage(error)))
    provider.start()
    this.provider = provider
    this.setState({ ...this.state, status: 'listening', error: undefined })
    return this.getState()
  }

  async pause(): Promise<SessionState> {
    await this.provider?.stop()
    this.provider = undefined
    if (this.state.status !== 'idle') {
      this.setState({ ...this.state, status: 'paused' })
    }
    return this.getState()
  }

  async stop(): Promise<SessionState> {
    await this.provider?.stop()
    this.provider = undefined
    this.setState({
      status: 'idle',
      config: this.state.config
    })
    return this.getState()
  }

  sendAudioChunk(chunk: AudioChunk): void {
    if (
      this.state.status !== 'listening' ||
      !this.provider ||
      chunk.sessionId !== this.state.sessionId
    ) {
      return
    }

    this.provider.sendAudioChunk(chunk.data, chunk.timestamp)
  }

  private fail(message: string): SessionState {
    const state: SessionState = {
      ...this.state,
      status: 'error',
      error: message
    }
    this.provider = undefined
    this.setState(state)
    this.emit({ type: 'session:error', state, message })
    return this.getState()
  }

  private setState(state: SessionState): void {
    this.state = state
    this.emit({ type: 'session:state', state: this.getState() })
  }

  private emit(event: SessionEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'AI 服务连接失败'
}
