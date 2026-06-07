export type LanguageCode = 'auto' | 'zh-CN' | 'en' | 'ja' | 'ko'
export type TargetLanguageCode = Exclude<LanguageCode, 'auto'>

export interface TranslationConfig {
  sourceLanguage: LanguageCode
  targetLanguage: TargetLanguageCode
}

export interface StartSessionOptions extends TranslationConfig {
  sampleRate: number
}

export type SessionStatus = 'idle' | 'connecting' | 'listening' | 'paused' | 'error'

export interface SessionState {
  sessionId?: string
  status: SessionStatus
  config: TranslationConfig
  startedAt?: number
  error?: string
}

export type SubtitleStatus = 'draft' | 'stable' | 'revised'

export interface SubtitleItem {
  id: string
  sessionId: string
  sourceLanguage: LanguageCode
  targetLanguage: TargetLanguageCode
  sourceText?: string
  translatedText: string
  status: SubtitleStatus
  startedAt: number
  endedAt?: number
  updatedAt: number
  revisionCount: number
}

export type SubtitleEvent =
  | {
      type: 'subtitle:draft'
      item: SubtitleItem
    }
  | {
      type: 'subtitle:stable'
      item: SubtitleItem
    }
  | {
      type: 'subtitle:revised'
      item: SubtitleItem
      previousText: string
    }
  | {
      type: 'subtitle:clear'
      sessionId?: string
    }

export interface AudioChunk {
  sessionId: string
  sampleRate: number
  channels: 1
  format: 'pcm16'
  data: ArrayBuffer
  timestamp: number
}

export interface AppSnapshot {
  session: SessionState
  subtitles: SubtitleItem[]
}

export interface OverlayBounds {
  x?: number
  y?: number
  width?: number
  height?: number
}

export type SessionEvent =
  | {
      type: 'session:state'
      state: SessionState
    }
  | {
      type: 'session:error'
      state: SessionState
      message: string
    }

export interface ProviderRevision {
  targetSubtitleId: string
  translatedText: string
}

export type ProviderEvent =
  | {
      type: 'transcript.completed'
      segmentId: string
      sourceText: string
    }
  | {
      type: 'translation.delta'
      segmentId: string
      sourceText: string
      translatedText: string
    }
  | {
      type: 'translation.completed'
      segmentId: string
      sourceText: string
      translatedText: string
    }
  | {
      type: 'translation.revised'
      targetSubtitleId: string
      translatedText: string
    }

export type Unsubscribe = () => void

export interface AppApi {
  getSnapshot(): Promise<AppSnapshot>
  startSession(options: StartSessionOptions): Promise<SessionState>
  pauseSession(): Promise<SessionState>
  stopSession(): Promise<SessionState>
  sendAudioChunk(chunk: AudioChunk): void
  showOverlay(): Promise<void>
  hideOverlay(): Promise<void>
  setOverlayBounds(bounds: OverlayBounds): Promise<void>
  clearHistory(): Promise<void>
  onSessionEvent(callback: (event: SessionEvent) => void): Unsubscribe
  onSubtitleEvent(callback: (event: SubtitleEvent) => void): Unsubscribe
}
