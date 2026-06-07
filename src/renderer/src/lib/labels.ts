import type {
  ApiKeySource,
  LanguageCode,
  SessionStatus,
  SubtitlePosition,
  SubtitleStatus
} from '../../../shared/types'

export const languageText: Record<LanguageCode, string> = {
  auto: '自动识别',
  'zh-CN': '简体中文',
  en: '英语',
  ja: '日语',
  ko: '韩语'
}

export const statusText: Record<SessionStatus, string> = {
  idle: '未开始',
  connecting: '连接中',
  listening: '听译中',
  paused: '已暂停',
  error: '连接失败'
}

export const subtitleStatusText: Record<SubtitleStatus, string> = {
  draft: '生成中',
  stable: '已确认',
  revised: '已修正'
}

export const providerStateText: Record<ApiKeySource, string> = {
  environment: '环境变量',
  local: '本机密钥',
  none: '等待 API Key'
}

export const providerDetailText: Record<ApiKeySource, string> = {
  environment: 'ZHIPU_API_KEY',
  local: 'SQLite 已保存',
  none: '设置后开始听译'
}

export const apiKeySourceDescription: Record<ApiKeySource, string> = {
  environment: '当前使用 ZHIPU_API_KEY 环境变量。',
  local: '当前使用本机 SQLite 中保存的密钥。',
  none: '保存后由主进程读取。'
}

export const positionText: Record<SubtitlePosition, string> = {
  top: '顶部',
  bottom: '底部'
}
