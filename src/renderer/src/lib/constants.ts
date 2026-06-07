import type {
  AppSettings,
  LanguageCode,
  SessionState,
  TargetLanguageCode
} from '../../../shared/types'
import { DEFAULT_SUBTITLE_SETTINGS, DEFAULT_TRANSLATION_CONFIG } from '../../../shared/types'

export const HISTORY_WINDOW_MS = 3 * 60 * 1000
export const INITIAL_CLOCK_NOW = Date.now()

export const defaultSession: SessionState = {
  status: 'idle',
  config: DEFAULT_TRANSLATION_CONFIG
}

export const defaultSettings: AppSettings = {
  provider: {
    apiKeyConfigured: false,
    apiKeySource: 'none',
    environmentApiKeyConfigured: false,
    localApiKeyConfigured: false
  },
  translation: DEFAULT_TRANSLATION_CONFIG,
  subtitles: DEFAULT_SUBTITLE_SETTINGS
}

export const sourceLanguageOptions: Array<{ value: LanguageCode; label: string }> = [
  { value: 'auto', label: '自动识别' },
  { value: 'en', label: '英语' },
  { value: 'ja', label: '日语' },
  { value: 'ko', label: '韩语' }
]

export const targetLanguageOptions: Array<{ value: TargetLanguageCode; label: string }> = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en', label: '英语' },
  { value: 'ja', label: '日语' },
  { value: 'ko', label: '韩语' }
]
