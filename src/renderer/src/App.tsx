import { useEffect, useState } from 'react'
import type {
  AppSettings,
  SessionState,
  SubtitleDisplaySettings,
  SubtitleItem,
  TranslationConfig
} from '../../shared/types'
import { DEFAULT_SUBTITLE_SETTINGS, DEFAULT_TRANSLATION_CONFIG } from '../../shared/types'
import { MainView } from './app/MainView'
import { OverlayView } from './app/OverlayView'
import { defaultSession, defaultSettings } from './lib/constants'
import { applySubtitleEvent } from './lib/subtitleEvents'

function App(): React.JSX.Element {
  const isOverlay = window.location.hash === '#/overlay'
  const [session, setSession] = useState<SessionState>(defaultSession)
  const [subtitles, setSubtitles] = useState<SubtitleItem[]>([])
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [draftTranslation, setDraftTranslation] = useState<TranslationConfig>(
    DEFAULT_TRANSLATION_CONFIG
  )
  const [draftSubtitles, setDraftSubtitles] =
    useState<SubtitleDisplaySettings>(DEFAULT_SUBTITLE_SETTINGS)

  useEffect(() => {
    document.body.classList.toggle('overlay-body', isOverlay)
    return () => document.body.classList.remove('overlay-body')
  }, [isOverlay])

  useEffect(() => {
    void window.appApi.getSnapshot().then((snapshot) => {
      setSession(snapshot.session)
      setSubtitles(snapshot.subtitles)
      setSettings(snapshot.settings)
      setDraftTranslation(snapshot.settings.translation)
      setDraftSubtitles(snapshot.settings.subtitles)
    })

    const unsubscribeSettings = window.appApi.onSettingsEvent((event) => {
      setSettings(event.settings)
      setDraftTranslation(event.settings.translation)
      setDraftSubtitles(event.settings.subtitles)
    })
    const unsubscribeSession = window.appApi.onSessionEvent((event) => {
      setSession(event.state)
    })
    const unsubscribeSubtitles = window.appApi.onSubtitleEvent((event) => {
      setSubtitles((current) => applySubtitleEvent(current, event))
    })

    return () => {
      unsubscribeSettings()
      unsubscribeSession()
      unsubscribeSubtitles()
    }
  }, [])

  if (isOverlay) {
    return <OverlayView session={session} settings={settings} subtitles={subtitles} />
  }

  return (
    <MainView
      draftSubtitles={draftSubtitles}
      draftTranslation={draftTranslation}
      session={session}
      setDraftSubtitles={setDraftSubtitles}
      setDraftTranslation={setDraftTranslation}
      setSession={setSession}
      setSettings={setSettings}
      settings={settings}
      subtitles={subtitles}
    />
  )
}

export default App
