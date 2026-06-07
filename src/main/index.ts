import { app, shell, BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import type {
  AppSettings,
  AudioChunk,
  OverlayBounds,
  StartSessionOptions,
  SubtitlePosition
} from '../shared/types'
import { SessionManager } from './session/SessionManager'
import { AppDatabase } from './storage/AppDatabase'
import { SubtitleStore } from './subtitles/SubtitleStore'

let overlayWindow: BrowserWindow | undefined

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 820,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/main`)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'main' })
  }

  return mainWindow
}

function createOverlayWindow(): BrowserWindow {
  const { x, y, width, height } = getOverlayBounds('bottom')
  const overlayWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  overlayWindow.setAlwaysOnTop(true, 'screen-saver')
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    overlayWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/overlay`)
  } else {
    overlayWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'overlay' })
  }

  return overlayWindow
}

function getOverlayBounds(position: SubtitlePosition): Required<OverlayBounds> {
  const { workArea } = screen.getPrimaryDisplay()
  const width = Math.min(860, Math.round(workArea.width * 0.72))
  const height = 160
  const x = Math.round(workArea.x + (workArea.width - width) / 2)
  const y =
    position === 'top'
      ? Math.round(workArea.y + 56)
      : Math.round(workArea.y + workArea.height - height - 56)

  return { x, y, width, height }
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload)
    }
  }
}

function registerIpcHandlers(
  database: AppDatabase,
  subtitleStore: SubtitleStore,
  sessionManager: SessionManager
): void {
  ipcMain.handle('app:get-snapshot', async () => ({
    session: sessionManager.getState(),
    subtitles: subtitleStore.getSnapshot(),
    settings: await database.getSettings()
  }))

  ipcMain.handle('settings:get', () => database.getSettings())
  ipcMain.handle('settings:save', async (_event, input) => {
    const settings = await database.saveSettings(input)
    broadcast('settings:event', { type: 'settings:changed', settings })
    return settings
  })

  ipcMain.handle('session:start', (_event, options: StartSessionOptions) =>
    sessionManager.start(options)
  )
  ipcMain.handle('session:pause', () => sessionManager.pause())
  ipcMain.handle('session:stop', () => sessionManager.stop())
  ipcMain.on('audio:chunk', (_event, chunk: AudioChunk) => sessionManager.sendAudioChunk(chunk))

  ipcMain.handle('overlay:show', async () => {
    const settings: AppSettings = await database.getSettings()
    overlayWindow?.setBounds(getOverlayBounds(settings.subtitles.position))
    overlayWindow?.showInactive()
  })
  ipcMain.handle('overlay:hide', () => {
    overlayWindow?.hide()
  })
  ipcMain.handle('overlay:set-bounds', (_event, bounds: OverlayBounds) => {
    overlayWindow?.setBounds(bounds)
  })
  ipcMain.handle('history:clear', () => {
    subtitleStore.clear()
  })

  sessionManager.onEvent((event) => broadcast('session:event', event))
  subtitleStore.onEvent((event) => broadcast('subtitle:event', event))
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  void initializeApp()
})

async function initializeApp(): Promise<void> {
  const database = await AppDatabase.open(join(app.getPath('userData'), 'echo-sub.sqlite3'))
  const subtitleStore = new SubtitleStore(database, await database.loadSubtitles())
  const sessionManager = new SessionManager(subtitleStore, () => database.getZhipuApiKey())

  registerIpcHandlers(database, subtitleStore, sessionManager)

  createWindow()
  overlayWindow = createOverlayWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
      overlayWindow = createOverlayWindow()
    }
  })
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
