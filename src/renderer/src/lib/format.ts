export function readErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return '麦克风权限未开启'
  }

  return error instanceof Error ? error.message : '操作失败'
}

export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) {
    return `${minutes}m`
  }

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function formatRelativeTime(timestamp: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000))
  if (minutes === 0) {
    return '刚刚'
  }

  return `${minutes}m`
}
