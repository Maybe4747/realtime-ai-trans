import { useEffect, useMemo, useState } from 'react'
import type {
  LanguageCode,
  SessionState,
  SubtitleEvent,
  SubtitleItem,
  TargetLanguageCode
} from '../../shared/types'
import { useAudioCapture } from './hooks/useAudioCapture'

function App(): React.JSX.Element {
  const isOverlay = window.location.hash === '#/overlay'
  const [session, setSession] = useState<SessionState>(defaultSession)
  const [subtitles, setSubtitles] = useState<SubtitleItem[]>([])

  useEffect(() => {
    document.body.classList.toggle('overlay-body', isOverlay)
    return () => document.body.classList.remove('overlay-body')
  }, [isOverlay])

  useEffect(() => {
    void window.appApi.getSnapshot().then((snapshot) => {
      setSession(snapshot.session)
      setSubtitles(snapshot.subtitles)
    })

    const unsubscribeSession = window.appApi.onSessionEvent((event) => {
      setSession(event.state)
    })
    const unsubscribeSubtitles = window.appApi.onSubtitleEvent((event) => {
      setSubtitles((current) => applySubtitleEvent(current, event))
    })

    return () => {
      unsubscribeSession()
      unsubscribeSubtitles()
    }
  }, [])

  if (isOverlay) {
    return <OverlayView session={session} subtitles={subtitles} />
  }

  return <MainView session={session} setSession={setSession} subtitles={subtitles} />
}

interface MainViewProps {
  session: SessionState
  setSession: (session: SessionState) => void
  subtitles: SubtitleItem[]
}

function MainView({ session, setSession, subtitles }: MainViewProps): React.JSX.Element {
  const [sourceLanguage, setSourceLanguage] = useState<LanguageCode>('auto')
  const [targetLanguage, setTargetLanguage] = useState<TargetLanguageCode>('zh-CN')
  const [historyOpen, setHistoryOpen] = useState(true)
  const [overlayVisible, setOverlayVisible] = useState(false)
  const [localError, setLocalError] = useState('')
  const { isCapturing, startCapture, stopCapture } = useAudioCapture()

  const latestSubtitle = useMemo(() => subtitles.at(-1), [subtitles])
  const canStart = session.status === 'idle' || session.status === 'paused' || session.status === 'error'
  const isBusy = session.status === 'connecting'
  const isListening = session.status === 'listening'

  useEffect(() => {
    if (session.status === 'error' || session.status === 'idle' || session.status === 'paused') {
      void stopCapture()
    }
  }, [session.status, stopCapture])

  const start = async (): Promise<void> => {
    setLocalError('')
    const nextSession = await window.appApi.startSession({
      sourceLanguage,
      targetLanguage,
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

  return (
    <main className="main-shell">
      <header className="titlebar">
        <div>
          <h1>听译窗</h1>
          <p>麦克风实时字幕</p>
        </div>
        <span className={`status-pill ${session.status}`}>{statusText[session.status]}</span>
      </header>

      <section className="control-section">
        <label>
          <span>源语言</span>
          <select
            value={sourceLanguage}
            disabled={isListening || isBusy}
            onChange={(event) => setSourceLanguage(event.target.value as LanguageCode)}
          >
            {sourceLanguageOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>目标语言</span>
          <select
            value={targetLanguage}
            disabled={isListening || isBusy}
            onChange={(event) => setTargetLanguage(event.target.value as TargetLanguageCode)}
          >
            {targetLanguageOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="action-row">
        {canStart && (
          <button className="primary-button" disabled={isBusy} onClick={start}>
            {session.status === 'paused' ? '继续听译' : '开始听译'}
          </button>
        )}
        {isListening && (
          <button className="primary-button" onClick={pause}>
            暂停
          </button>
        )}
        <button className="ghost-button" disabled={session.status === 'idle'} onClick={stop}>
          结束
        </button>
        <button className="ghost-button" onClick={toggleOverlay}>
          {overlayVisible ? '隐藏字幕窗' : '显示字幕窗'}
        </button>
      </section>

      {(session.error || localError) && <p className="error-line">{session.error || localError}</p>}

      <section className="now-section">
        <div className="section-heading">
          <span>当前字幕</span>
          <span className={isCapturing ? 'meter active' : 'meter'} />
        </div>
        <p className={`now-subtitle ${latestSubtitle?.status ?? 'empty'}`}>
          {latestSubtitle?.translatedText || '等待真实音频输入'}
        </p>
        {latestSubtitle?.sourceText && <p className="source-line">{latestSubtitle.sourceText}</p>}
      </section>

      <section className="history-section">
        <div className="section-heading">
          <button className="link-button" onClick={() => setHistoryOpen((open) => !open)}>
            历史
          </button>
          <button className="link-button" disabled={subtitles.length === 0} onClick={clearHistory}>
            清空
          </button>
        </div>
        {historyOpen && <HistoryList subtitles={subtitles} />}
      </section>
    </main>
  )
}

interface OverlayViewProps {
  session: SessionState
  subtitles: SubtitleItem[]
}

function OverlayView({ session, subtitles }: OverlayViewProps): React.JSX.Element {
  const latest = subtitles.at(-1)
  const previous = subtitles.length > 1 ? subtitles.at(-2) : undefined

  return (
    <main className="overlay-shell">
      <div className="overlay-meta">
        <span className={`overlay-dot ${session.status}`} />
        <span>{statusText[session.status]}</span>
      </div>
      {previous && <p className="overlay-previous">{previous.translatedText}</p>}
      <p className={`overlay-current ${latest?.status ?? 'empty'}`}>
        {latest?.translatedText || '等待字幕'}
      </p>
    </main>
  )
}

function HistoryList({ subtitles }: { subtitles: SubtitleItem[] }): React.JSX.Element {
  if (subtitles.length === 0) {
    return <p className="empty-history">暂无字幕记录</p>
  }

  return (
    <ol className="history-list">
      {subtitles
        .slice()
        .reverse()
        .map((item) => (
          <li key={item.id} className={`history-item ${item.status}`}>
            <div>
              <p>{item.translatedText}</p>
              {item.sourceText && <span>{item.sourceText}</span>}
            </div>
            <strong>{subtitleStatusText[item.status]}</strong>
          </li>
        ))}
    </ol>
  )
}

function applySubtitleEvent(current: SubtitleItem[], event: SubtitleEvent): SubtitleItem[] {
  if (event.type === 'subtitle:clear') {
    return event.sessionId ? current.filter((item) => item.sessionId !== event.sessionId) : []
  }

  const next = current.filter((item) => item.id !== event.item.id)
  return [...next, event.item].sort((a, b) => a.startedAt - b.startedAt)
}

function readErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return '麦克风权限未开启'
  }

  return error instanceof Error ? error.message : '麦克风启动失败'
}

const defaultSession: SessionState = {
  status: 'idle',
  config: {
    sourceLanguage: 'auto',
    targetLanguage: 'zh-CN'
  }
}

const sourceLanguageOptions: Array<{ value: LanguageCode; label: string }> = [
  { value: 'auto', label: '自动识别' },
  { value: 'en', label: '英语' },
  { value: 'ja', label: '日语' },
  { value: 'ko', label: '韩语' }
]

const targetLanguageOptions: Array<{ value: TargetLanguageCode; label: string }> = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en', label: '英语' },
  { value: 'ja', label: '日语' },
  { value: 'ko', label: '韩语' }
]

const statusText = {
  idle: '未开始',
  connecting: '连接中',
  listening: '听译中',
  paused: '已暂停',
  error: '连接失败'
}

const subtitleStatusText = {
  draft: '生成中',
  stable: '已确认',
  revised: '已修正'
}

export default App
