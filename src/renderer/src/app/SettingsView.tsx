import type {
  AppSettings,
  LanguageCode,
  SubtitleDisplaySettings,
  TargetLanguageCode,
  TranslationConfig
} from '../../../shared/types'
import { ZHIPU_ASR_MODEL, ZHIPU_TRANSLATION_MODEL } from '../../../shared/types'
import { RangeRow, ReadOnlyRow, SwitchRow } from '../components/SettingsControls'
import { sourceLanguageOptions, targetLanguageOptions } from '../lib/constants'
import {
  apiKeySourceDescription,
  languageText,
  positionText,
  providerStateText
} from '../lib/labels'

interface SettingsViewProps {
  apiKeyInput: string
  draftSubtitles: SubtitleDisplaySettings
  draftTranslation: TranslationConfig
  isBusy: boolean
  isSaving: boolean
  message: string
  settings: AppSettings
  onApiKeyInputChange: (value: string) => void
  onClearLocalApiKey: () => Promise<void>
  onReset: () => Promise<void>
  onSave: () => Promise<void>
  onSubtitlesChange: (settings: SubtitleDisplaySettings) => void
  onTranslationChange: (config: TranslationConfig) => void
}

export function SettingsView({
  apiKeyInput,
  draftSubtitles,
  draftTranslation,
  isBusy,
  isSaving,
  message,
  onApiKeyInputChange,
  onClearLocalApiKey,
  onReset,
  onSave,
  onSubtitlesChange,
  onTranslationChange,
  settings
}: SettingsViewProps): React.JSX.Element {
  return (
    <section className="view">
      <header className="page-header">
        <div className="page-title">
          <h2>设置</h2>
          <p>管理智谱连接、语言和字幕窗口偏好。</p>
        </div>
        <div className="header-actions">
          <button className="text-button secondary" disabled={isSaving} onClick={onReset}>
            恢复默认
          </button>
          <button className="text-button" disabled={isSaving} onClick={onSave}>
            {isSaving ? '保存中' : '保存'}
          </button>
        </div>
      </header>

      <div className="settings-stack">
        <section>
          <h3 className="settings-section-title">智谱</h3>
          <div className="settings-group">
            <div className="setting-row">
              <div className="setting-label">
                <strong>API Key</strong>
                <span>{apiKeySourceDescription[settings.provider.apiKeySource]}</span>
              </div>
              <div className="control">
                <input
                  className="field"
                  placeholder="ZHIPU_API_KEY"
                  type="password"
                  value={apiKeyInput}
                  onChange={(event) => onApiKeyInputChange(event.target.value)}
                />
                <span className={`key-status ${settings.provider.apiKeySource}`}>
                  {providerStateText[settings.provider.apiKeySource]}
                </span>
              </div>
            </div>
            <ReadOnlyRow label="语音识别" value={ZHIPU_ASR_MODEL} />
            <ReadOnlyRow label="翻译与修正" value={ZHIPU_TRANSLATION_MODEL} />
            {settings.provider.localApiKeyConfigured && (
              <div className="setting-row compact">
                <div className="setting-label">
                  <strong>本机密钥</strong>
                  <span>已保存在 SQLite。</span>
                </div>
                <div className="control">
                  <button
                    className="secondary-button"
                    disabled={isSaving}
                    onClick={onClearLocalApiKey}
                  >
                    移除
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        <section>
          <h3 className="settings-section-title">语言</h3>
          <div className="settings-group">
            <div className="setting-row">
              <div className="setting-label">
                <strong>源语言</strong>
                <span>{languageText[draftTranslation.sourceLanguage]}</span>
              </div>
              <div className="control">
                <select
                  className="select"
                  disabled={isBusy}
                  value={draftTranslation.sourceLanguage}
                  onChange={(event) =>
                    onTranslationChange({
                      ...draftTranslation,
                      sourceLanguage: event.target.value as LanguageCode
                    })
                  }
                >
                  {sourceLanguageOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="setting-row">
              <div className="setting-label">
                <strong>目标语言</strong>
                <span>{languageText[draftTranslation.targetLanguage]}</span>
              </div>
              <div className="control">
                <select
                  className="select"
                  disabled={isBusy}
                  value={draftTranslation.targetLanguage}
                  onChange={(event) =>
                    onTranslationChange({
                      ...draftTranslation,
                      targetLanguage: event.target.value as TargetLanguageCode
                    })
                  }
                >
                  {targetLanguageOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </section>

        <section>
          <h3 className="settings-section-title">字幕</h3>
          <div className="settings-group">
            <RangeRow
              label="字号"
              max={34}
              min={18}
              suffix=""
              value={draftSubtitles.fontSize}
              onChange={(fontSize) => onSubtitlesChange({ ...draftSubtitles, fontSize })}
            />
            <RangeRow
              label="背景透明度"
              max={95}
              min={40}
              suffix="%"
              value={draftSubtitles.opacity}
              onChange={(opacity) => onSubtitlesChange({ ...draftSubtitles, opacity })}
            />
            <div className="setting-row">
              <div className="setting-label">
                <strong>默认位置</strong>
                <span>{positionText[draftSubtitles.position]}</span>
              </div>
              <div className="control">
                <div className="segmented" role="group" aria-label="默认位置">
                  <button
                    className={draftSubtitles.position === 'top' ? 'active' : ''}
                    onClick={() => onSubtitlesChange({ ...draftSubtitles, position: 'top' })}
                  >
                    顶部
                  </button>
                  <button
                    className={draftSubtitles.position === 'bottom' ? 'active' : ''}
                    onClick={() => onSubtitlesChange({ ...draftSubtitles, position: 'bottom' })}
                  >
                    底部
                  </button>
                </div>
              </div>
            </div>
            <SwitchRow
              checked={draftSubtitles.showSource}
              label="显示原文"
              onChange={(showSource) => onSubtitlesChange({ ...draftSubtitles, showSource })}
            />
            <SwitchRow
              checked={draftSubtitles.highlightRevisions}
              label="修正高亮"
              onChange={(highlightRevisions) =>
                onSubtitlesChange({ ...draftSubtitles, highlightRevisions })
              }
            />
          </div>
        </section>

        <section>
          <h3 className="settings-section-title">预览</h3>
          <div className="settings-group">
            <div className="preview-pane">
              <div
                className="subtitle-preview"
                style={{
                  opacity: draftSubtitles.opacity / 100
                }}
              >
                <strong style={{ fontSize: draftSubtitles.fontSize }}>字幕预览文本</strong>
                <span>{`${positionText[draftSubtitles.position]} / ${draftSubtitles.fontSize}px / ${draftSubtitles.opacity}%`}</span>
              </div>
            </div>
          </div>
        </section>

        {message && <p className="settings-message">{message}</p>}
      </div>
    </section>
  )
}
