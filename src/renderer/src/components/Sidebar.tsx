import type { ApiKeySource } from '../../../shared/types'
import { providerDetailText, providerStateText } from '../lib/labels'
import { HomeIcon, SettingsIcon } from './icons'

interface SidebarProps {
  activeView: 'home' | 'settings'
  apiKeyConfigured: boolean
  apiKeySource: ApiKeySource
  recentCount: number
  onViewChange: (view: 'home' | 'settings') => void
}

export function Sidebar({
  activeView,
  apiKeyConfigured,
  apiKeySource,
  recentCount,
  onViewChange
}: SidebarProps): React.JSX.Element {
  return (
    <aside className="sidebar">
      <div className="traffic-row" aria-hidden="true">
        <span className="traffic close" />
        <span className="traffic minimize" />
        <span className="traffic zoom" />
      </div>

      <div className="brand">
        <h1>听译窗</h1>
        <p>实时字幕助手</p>
      </div>

      <nav className="nav" aria-label="主导航">
        <button
          className={activeView === 'home' ? 'active' : ''}
          onClick={() => onViewChange('home')}
        >
          <span className="glyph" aria-hidden="true">
            <HomeIcon />
          </span>
          <span className="nav-label">主页</span>
          <span className="nav-meta">{recentCount}</span>
        </button>
        <button
          className={activeView === 'settings' ? 'active' : ''}
          onClick={() => onViewChange('settings')}
        >
          <span className="glyph" aria-hidden="true">
            <SettingsIcon />
          </span>
          <span className="nav-label">设置</span>
          <span className="nav-meta">{apiKeyConfigured ? 'ok' : '!'}</span>
        </button>
      </nav>

      <div className="side-status">
        <div className="connection-card">
          <span className={`state-light ${apiKeySource}`} />
          <div>
            <strong>{providerStateText[apiKeySource]}</strong>
            <span>{providerDetailText[apiKeySource]}</span>
          </div>
        </div>
      </div>
    </aside>
  )
}
