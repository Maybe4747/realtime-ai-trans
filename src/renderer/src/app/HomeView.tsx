import type { AppSettings, SessionState, SubtitleItem } from '../../../shared/types'
import { HistoryList } from '../components/HistoryList'
import { StatusRow } from '../components/StatusRow'
import { StopIcon } from '../components/icons'
import { formatDuration } from '../lib/format'
import { positionText, statusText, subtitleStatusText } from '../lib/labels'

interface HomeViewProps {
  canStart: boolean
  clockNow: number
  isBusy: boolean
  isCapturing: boolean
  isListening: boolean
  latestSubtitle?: SubtitleItem
  localError: string
  overlayVisible: boolean
  recentSubtitles: SubtitleItem[]
  session: SessionState
  sessionDurationMs: number
  settings: AppSettings
  subtitlesToday: number
  onClearHistory: () => Promise<void>
  onPause: () => Promise<void>
  onStart: () => Promise<void>
  onStop: () => Promise<void>
  onToggleOverlay: () => Promise<void>
}

export function HomeView({
  canStart,
  clockNow,
  isBusy,
  isCapturing,
  isListening,
  latestSubtitle,
  localError,
  onClearHistory,
  onPause,
  onStart,
  onStop,
  onToggleOverlay,
  overlayVisible,
  recentSubtitles,
  session,
  sessionDurationMs,
  settings,
  subtitlesToday
}: HomeViewProps): React.JSX.Element {
  return (
    <section className="view">
      <header className="page-header">
        <div className="page-title">
          <h2>主页</h2>
          <p>查看最近字幕和当前听译状态。</p>
        </div>
        <div className="header-actions">
          {isListening ? (
            <button className="text-button" onClick={onPause}>
              暂停
            </button>
          ) : (
            <button className="text-button" disabled={!canStart || isBusy} onClick={onStart}>
              {session.status === 'paused' ? '继续听译' : '开始听译'}
            </button>
          )}
          <button className="icon-button" disabled={session.status === 'idle'} onClick={onStop}>
            <StopIcon />
          </button>
        </div>
      </header>

      <section className="overview-grid" aria-label="统计">
        <article className="stat-card">
          <span className="label">本次听译</span>
          <strong className="value">{formatDuration(sessionDurationMs)}</strong>
          <span className="caption">{statusText[session.status]}</span>
        </article>
        <article className="stat-card">
          <span className="label">今日字幕</span>
          <strong className="value">{subtitlesToday}</strong>
          <span className="caption">已生成字幕</span>
        </article>
      </section>

      {(session.error || localError) && <p className="error-line">{session.error || localError}</p>}

      <div className="home-layout">
        <section className="content-group">
          <div className="group-header">
            <h3>最近历史</h3>
            <button
              className="link-button"
              disabled={recentSubtitles.length === 0}
              onClick={onClearHistory}
            >
              清空
            </button>
          </div>
          <HistoryList
            clockNow={clockNow}
            showSource={settings.subtitles.showSource}
            subtitles={recentSubtitles}
          />
        </section>

        <section className="content-group">
          <div className="group-header">
            <h3>听译状态</h3>
          </div>
          <div className="insight-stack">
            <StatusRow
              label="当前字幕"
              text={latestSubtitle?.translatedText || '等待音频输入'}
              value={latestSubtitle ? subtitleStatusText[latestSubtitle.status] : '等待中'}
            />
            <StatusRow
              label="收音状态"
              text={isCapturing ? '正在接收音频' : '未开始收音'}
              value={isCapturing ? '进行中' : '空闲'}
            />
            <StatusRow
              label="字幕窗口"
              text={`位置：${positionText[settings.subtitles.position]}`}
              value={overlayVisible ? '显示' : '隐藏'}
            />
          </div>
          <div className="panel-actions">
            <button className="secondary-button" onClick={onToggleOverlay}>
              {overlayVisible ? '隐藏字幕窗' : '显示字幕窗'}
            </button>
          </div>
        </section>
      </div>
    </section>
  )
}
