export type LanguageCode = 'auto' | 'zh-CN' | 'en' | 'ja' | 'ko'
export type TargetLanguageCode = Exclude<LanguageCode, 'auto'>
export type SubtitlePosition = 'top' | 'bottom'

export const ZHIPU_ASR_MODEL = 'glm-asr-2512'
export const ZHIPU_TRANSLATION_MODEL = 'glm-4.7-flash'

export interface TranslationConfig {
  sourceLanguage: LanguageCode
  targetLanguage: TargetLanguageCode
}

export const DEFAULT_TRANSLATION_CONFIG: TranslationConfig = {
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN'
}

export interface SubtitleDisplaySettings {
  fontSize: number
  opacity: number
  position: SubtitlePosition
  showSource: boolean
  highlightRevisions: boolean
}

export const DEFAULT_SUBTITLE_SETTINGS: SubtitleDisplaySettings = {
  fontSize: 26,
  opacity: 76,
  position: 'bottom',
  showSource: true,
  highlightRevisions: true
}

export type ApiKeySource = 'environment' | 'local' | 'none'

export interface ProviderSettingsSummary {
  apiKeyConfigured: boolean
  apiKeySource: ApiKeySource
  environmentApiKeyConfigured: boolean
  localApiKeyConfigured: boolean
}

export interface AppSettings {
  provider: ProviderSettingsSummary
  translation: TranslationConfig
  subtitles: SubtitleDisplaySettings
}

export interface SaveAppSettingsInput {
  zhipuApiKey?: string
  clearLocalApiKey?: boolean
  translation: TranslationConfig
  subtitles: SubtitleDisplaySettings
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
  settings: AppSettings
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

export interface SettingsEvent {
  type: 'settings:changed'
  settings: AppSettings
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
  getSettings(): Promise<AppSettings>
  saveSettings(input: SaveAppSettingsInput): Promise<AppSettings>
  startSession(options: StartSessionOptions): Promise<SessionState>
  pauseSession(): Promise<SessionState>
  stopSession(): Promise<SessionState>
  sendAudioChunk(chunk: AudioChunk): void
  showOverlay(): Promise<void>
  hideOverlay(): Promise<void>
  setOverlayBounds(bounds: OverlayBounds): Promise<void>
  clearHistory(): Promise<void>
  onSettingsEvent(callback: (event: SettingsEvent) => void): Unsubscribe
  onSessionEvent(callback: (event: SessionEvent) => void): Unsubscribe
  onSubtitleEvent(callback: (event: SubtitleEvent) => void): Unsubscribe
}
