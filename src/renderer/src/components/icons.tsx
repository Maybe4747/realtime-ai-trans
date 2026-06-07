import type { JSX } from 'react'

export function HomeIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24">
      <path d="m3 11 9-8 9 8" />
      <path d="M5 10v10h14V10" />
      <path d="M9 20v-6h6v6" />
    </svg>
  )
}

export function SettingsIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M4 7h5" />
      <path d="M13 7h7" />
      <path d="M4 17h9" />
      <path d="M17 17h3" />
      <circle cx="11" cy="7" r="2" />
      <circle cx="15" cy="17" r="2" />
    </svg>
  )
}

export function StopIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24">
      <rect x="7" y="7" width="10" height="10" rx="2" />
    </svg>
  )
}
