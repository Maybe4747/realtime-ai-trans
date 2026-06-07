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
  environment: '已配置',
  local: '已配置',
  none: '未配置'
}

export const apiKeySourceDescription: Record<ApiKeySource, string> = {
  environment: '已检测到可用访问密钥。',
  local: '已保存可用访问密钥。',
  none: '保存后即可开始听译。'
}

export const positionText: Record<SubtitlePosition, string> = {
  top: '顶部',
  bottom: '底部'
}
