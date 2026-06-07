import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AppApi,
  AudioChunk,
  OverlayBounds,
  SessionEvent,
  StartSessionOptions,
  SubtitleEvent
} from '../shared/types'

// Custom APIs for renderer
const appApi: AppApi = {
  getSnapshot: () => ipcRenderer.invoke('app:get-snapshot'),
  startSession: (options: StartSessionOptions) => ipcRenderer.invoke('session:start', options),
  pauseSession: () => ipcRenderer.invoke('session:pause'),
  stopSession: () => ipcRenderer.invoke('session:stop'),
  sendAudioChunk: (chunk: AudioChunk) => ipcRenderer.send('audio:chunk', chunk),
  showOverlay: () => ipcRenderer.invoke('overlay:show'),
  hideOverlay: () => ipcRenderer.invoke('overlay:hide'),
  setOverlayBounds: (bounds: OverlayBounds) => ipcRenderer.invoke('overlay:set-bounds', bounds),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  onSessionEvent: (callback: (event: SessionEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: SessionEvent): void => callback(payload)
    ipcRenderer.on('session:event', listener)
    return () => ipcRenderer.removeListener('session:event', listener)
  },
  onSubtitleEvent: (callback: (event: SubtitleEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: SubtitleEvent): void =>
      callback(payload)
    ipcRenderer.on('subtitle:event', listener)
    return () => ipcRenderer.removeListener('subtitle:event', listener)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('appApi', appApi)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.appApi = appApi
}
