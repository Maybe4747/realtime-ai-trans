import type { SubtitleEvent, SubtitleItem } from '../../../shared/types'

export function applySubtitleEvent(current: SubtitleItem[], event: SubtitleEvent): SubtitleItem[] {
  if (event.type === 'subtitle:clear') {
    return event.sessionId ? current.filter((item) => item.sessionId !== event.sessionId) : []
  }

  const next = current.filter((item) => item.id !== event.item.id)
  return [...next, event.item].sort((a, b) => a.startedAt - b.startedAt)
}
