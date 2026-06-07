import type { CSSProperties } from 'react'
import type { AppSettings, SessionState, SubtitleItem } from '../../../shared/types'
import { statusText } from '../lib/labels'

interface OverlayViewProps {
  session: SessionState
  settings: AppSettings
  subtitles: SubtitleItem[]
}

export function OverlayView({ session, settings, subtitles }: OverlayViewProps): React.JSX.Element {
  const currentSessionSubtitles = session.sessionId
    ? subtitles.filter((item) => item.sessionId === session.sessionId)
    : subtitles
  const latest = currentSessionSubtitles.at(-1)
  const previous = currentSessionSubtitles.length > 1 ? currentSessionSubtitles.at(-2) : undefined
  const overlayStyle = {
    '--subtitle-font-size': `${settings.subtitles.fontSize}px`,
    '--subtitle-opacity': settings.subtitles.opacity / 100
  } as CSSProperties

  return (
    <main
      className={`overlay-shell ${settings.subtitles.highlightRevisions ? 'highlight-revisions' : ''}`}
      style={overlayStyle}
    >
      <div className="overlay-meta">
        <span className={`overlay-dot ${session.status}`} />
        <span>{statusText[session.status]}</span>
      </div>
      {previous && <p className="overlay-previous">{previous.translatedText}</p>}
      <p className={`overlay-current ${latest?.status ?? 'empty'}`}>
        {latest?.translatedText || '等待字幕'}
      </p>
      {settings.subtitles.showSource && latest?.sourceText && (
        <p className="overlay-source">{latest.sourceText}</p>
      )}
    </main>
  )
}
