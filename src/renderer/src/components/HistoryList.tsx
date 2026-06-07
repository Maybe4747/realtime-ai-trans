import type { SubtitleItem } from '../../../shared/types'
import { formatRelativeTime } from '../lib/format'
import { subtitleStatusText } from '../lib/labels'

interface HistoryListProps {
  clockNow: number
  showSource: boolean
  subtitles: SubtitleItem[]
}

export function HistoryList({
  clockNow,
  showSource,
  subtitles
}: HistoryListProps): React.JSX.Element {
  if (subtitles.length === 0) {
    return (
      <div className="empty-history">
        <div className="empty-symbol" aria-hidden="true" />
        <strong>暂无字幕记录</strong>
        <p>开始听译后，最新字幕会按时间顺序显示在这里。</p>
      </div>
    )
  }

  return (
    <ol className="history-list">
      {subtitles
        .slice()
        .reverse()
        .map((item) => (
          <li key={item.id} className={`history-item ${item.status}`}>
            <time>{formatRelativeTime(item.updatedAt, clockNow)}</time>
            <div>
              <p>{item.translatedText}</p>
              {showSource && item.sourceText && <span>{item.sourceText}</span>}
            </div>
            <strong>{subtitleStatusText[item.status]}</strong>
          </li>
        ))}
    </ol>
  )
}
