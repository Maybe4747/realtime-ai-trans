import { useEffect, useMemo, useState } from 'react'
import type {
  AppSettings,
  SessionState,
  SubtitleDisplaySettings,
  SubtitleItem,
  TranslationConfig
} from '../../../shared/types'
import { DEFAULT_SUBTITLE_SETTINGS, DEFAULT_TRANSLATION_CONFIG } from '../../../shared/types'
import { Sidebar } from '../components/Sidebar'
import { useAudioCapture } from '../hooks/useAudioCapture'
import { HISTORY_WINDOW_MS, INITIAL_CLOCK_NOW } from '../lib/constants'
import { readErrorMessage } from '../lib/format'
import { HomeView } from './HomeView'
import { SettingsView } from './SettingsView'

interface MainViewProps {
  draftSubtitles: SubtitleDisplaySettings
  draftTranslation: TranslationConfig
  session: SessionState
  settings: AppSettings
  subtitles: SubtitleItem[]
  setDraftSubtitles: (settings: SubtitleDisplaySettings) => void
  setDraftTranslation: (config: TranslationConfig) => void
  setSession: (session: SessionState) => void
  setSettings: (settings: AppSettings) => void
}

export function MainView({
  draftSubtitles,
  draftTranslation,
  session,
  setDraftSubtitles,
  setDraftTranslation,
  setSession,
  settings,
  setSettings,
  subtitles
}: MainViewProps): React.JSX.Element {
  const [activeView, setActiveView] = useState<'home' | 'settings'>('home')
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [settingsMessage, setSettingsMessage] = useState('')
  const [localError, setLocalError] = useState('')
  const [overlayVisible, setOverlayVisible] = useState(false)
  const [clockNow, setClockNow] = useState(INITIAL_CLOCK_NOW)
  const [isSavingSettings, setIsSavingSettings] = useState(false)
  const { isCapturing, startCapture, stopCapture } = useAudioCapture()

  const isBusy = session.status === 'connecting'
  const isListening = session.status === 'listening'
  const canStart =
    (session.status === 'idle' || session.status === 'paused' || session.status === 'error') &&
    settings.provider.apiKeyConfigured
  const currentSessionSubtitles = useMemo(
    () =>
      session.sessionId ? subtitles.filter((item) => item.sessionId === session.sessionId) : [],
    [session.sessionId, subtitles]
  )
  const latestSubtitle = currentSessionSubtitles.at(-1)
  const recentSubtitles = useMemo(
    () => subtitles.filter((item) => clockNow - item.updatedAt <= HISTORY_WINDOW_MS),
    [clockNow, subtitles]
  )
  const todaySubtitles = useMemo(() => {
    const today = new Date(clockNow)
    today.setHours(0, 0, 0, 0)
    return subtitles.filter((item) => item.updatedAt >= today.getTime())
  }, [clockNow, subtitles])
  const sessionDurationMs =
    session.startedAt && (session.status === 'listening' || session.status === 'paused')
      ? Math.max(0, clockNow - session.startedAt)
      : 0

  useEffect(() => {
    if (session.status === 'error' || session.status === 'idle' || session.status === 'paused') {
      void stopCapture()
    }
  }, [session.status, stopCapture])

  useEffect(() => {
    const interval = window.setInterval(() => setClockNow(Date.now()), 30_000)
    return () => window.clearInterval(interval)
  }, [])

  const start = async (): Promise<void> => {
    setLocalError('')
    const nextSession = await window.appApi.startSession({
      ...settings.translation,
      sampleRate: 16000
    })

    setSession(nextSession)

    if (nextSession.status !== 'listening' || !nextSession.sessionId) {
      return
    }

    try {
      await startCapture(nextSession.sessionId)
      await window.appApi.showOverlay()
      setOverlayVisible(true)
    } catch (error) {
      const message = readErrorMessage(error)
      setLocalError(message)
      await stopCapture()
      setSession(await window.appApi.stopSession())
    }
  }

  const pause = async (): Promise<void> => {
    await stopCapture()
    setSession(await window.appApi.pauseSession())
  }

  const stop = async (): Promise<void> => {
    await stopCapture()
    setSession(await window.appApi.stopSession())
  }

  const toggleOverlay = async (): Promise<void> => {
    if (overlayVisible) {
      await window.appApi.hideOverlay()
      setOverlayVisible(false)
      return
    }

    await window.appApi.showOverlay()
    setOverlayVisible(true)
  }

  const clearHistory = async (): Promise<void> => {
    await window.appApi.clearHistory()
  }

  const saveSettings = async (overrides?: {
    clearLocalApiKey?: boolean
    translation?: TranslationConfig
    subtitles?: SubtitleDisplaySettings
  }): Promise<void> => {
    setSettingsMessage('')
    setIsSavingSettings(true)

    try {
      const nextSettings = await window.appApi.saveSettings({
        zhipuApiKey: apiKeyInput.trim() || undefined,
        clearLocalApiKey: overrides?.clearLocalApiKey,
        translation: overrides?.translation ?? draftTranslation,
        subtitles: overrides?.subtitles ?? draftSubtitles
      })
      setSettings(nextSettings)
      setApiKeyInput('')
      setSettingsMessage('已保存')
    } catch (error) {
      setSettingsMessage(readErrorMessage(error))
    } finally {
      setIsSavingSettings(false)
    }
  }

  const resetDisplaySettings = async (): Promise<void> => {
    setDraftTranslation(DEFAULT_TRANSLATION_CONFIG)
    setDraftSubtitles(DEFAULT_SUBTITLE_SETTINGS)
    await saveSettings({
      translation: DEFAULT_TRANSLATION_CONFIG,
      subtitles: DEFAULT_SUBTITLE_SETTINGS
    })
  }

  return (
    <main className="app-window">
      <Sidebar
        activeView={activeView}
        apiKeyConfigured={settings.provider.apiKeyConfigured}
        recentCount={recentSubtitles.length}
        onViewChange={setActiveView}
      />

      <section className="content">
        {activeView === 'home' && (
          <HomeView
            canStart={canStart}
            clockNow={clockNow}
            isBusy={isBusy}
            isCapturing={isCapturing}
            isListening={isListening}
            latestSubtitle={latestSubtitle}
            localError={localError}
            overlayVisible={overlayVisible}
            recentSubtitles={recentSubtitles}
            session={session}
            sessionDurationMs={sessionDurationMs}
            settings={settings}
            subtitlesToday={todaySubtitles.length}
            onClearHistory={clearHistory}
            onPause={pause}
            onStart={start}
            onStop={stop}
            onToggleOverlay={toggleOverlay}
          />
        )}

        {activeView === 'settings' && (
          <SettingsView
            apiKeyInput={apiKeyInput}
            draftSubtitles={draftSubtitles}
            draftTranslation={draftTranslation}
            isBusy={isBusy || isListening}
            isSaving={isSavingSettings}
            message={settingsMessage}
            settings={settings}
            onApiKeyInputChange={setApiKeyInput}
            onClearLocalApiKey={() => saveSettings({ clearLocalApiKey: true })}
            onReset={resetDisplaySettings}
            onSave={() => saveSettings()}
            onSubtitlesChange={setDraftSubtitles}
            onTranslationChange={setDraftTranslation}
          />
        )}
      </section>
    </main>
  )
}
