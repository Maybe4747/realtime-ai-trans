import { safeStorage } from 'electron'
import { mkdir } from 'fs/promises'
import { dirname } from 'path'
import sqlite3 from 'sqlite3'
import type {
  AppSettings,
  LanguageCode,
  SaveAppSettingsInput,
  SubtitleDisplaySettings,
  SubtitleItem,
  SubtitlePosition,
  SubtitleStatus,
  TargetLanguageCode,
  TranslationConfig
} from '../../shared/types'
import { DEFAULT_SUBTITLE_SETTINGS, DEFAULT_TRANSLATION_CONFIG } from '../../shared/types'

const SETTINGS_KEYS = {
  zhipuApiKey: 'provider.zhipuApiKey',
  sourceLanguage: 'translation.sourceLanguage',
  targetLanguage: 'translation.targetLanguage',
  subtitleFontSize: 'subtitles.fontSize',
  subtitleOpacity: 'subtitles.opacity',
  subtitlePosition: 'subtitles.position',
  subtitleShowSource: 'subtitles.showSource',
  subtitleHighlightRevisions: 'subtitles.highlightRevisions'
} as const

const MAX_HISTORY_ITEMS = 300

type SqlValue = string | number | null

interface SettingRow {
  value: string
}

interface SubtitleRow {
  id: string
  session_id: string
  source_language: string
  target_language: string
  source_text: string | null
  translated_text: string
  status: string
  started_at: number
  ended_at: number | null
  updated_at: number
  revision_count: number
}

export class AppDatabase {
  private readonly db: sqlite3.Database

  private constructor(db: sqlite3.Database) {
    this.db = db
  }

  static async open(dbPath: string): Promise<AppDatabase> {
    await mkdir(dirname(dbPath), { recursive: true })

    const db = await new Promise<sqlite3.Database>((resolve, reject) => {
      const database = new sqlite3.Database(
        dbPath,
        sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
        (error) => {
          if (error) {
            reject(error)
            return
          }

          resolve(database)
        }
      )
    })

    const appDatabase = new AppDatabase(db)
    await appDatabase.initialize()
    return appDatabase
  }

  async getSettings(): Promise<AppSettings> {
    const [
      encryptedApiKey,
      sourceLanguage,
      targetLanguage,
      fontSize,
      opacity,
      position,
      showSource,
      highlightRevisions
    ] = await Promise.all([
      this.getSetting(SETTINGS_KEYS.zhipuApiKey),
      this.getSetting(SETTINGS_KEYS.sourceLanguage),
      this.getSetting(SETTINGS_KEYS.targetLanguage),
      this.getSetting(SETTINGS_KEYS.subtitleFontSize),
      this.getSetting(SETTINGS_KEYS.subtitleOpacity),
      this.getSetting(SETTINGS_KEYS.subtitlePosition),
      this.getSetting(SETTINGS_KEYS.subtitleShowSource),
      this.getSetting(SETTINGS_KEYS.subtitleHighlightRevisions)
    ])

    const environmentApiKeyConfigured = Boolean(process.env.ZHIPU_API_KEY?.trim())
    const localApiKeyConfigured = Boolean(encryptedApiKey)

    return {
      provider: {
        apiKeyConfigured: environmentApiKeyConfigured || localApiKeyConfigured,
        apiKeySource: environmentApiKeyConfigured
          ? 'environment'
          : localApiKeyConfigured
            ? 'local'
            : 'none',
        environmentApiKeyConfigured,
        localApiKeyConfigured
      },
      translation: {
        sourceLanguage: parseLanguageCode(
          sourceLanguage,
          DEFAULT_TRANSLATION_CONFIG.sourceLanguage
        ),
        targetLanguage: parseTargetLanguageCode(
          targetLanguage,
          DEFAULT_TRANSLATION_CONFIG.targetLanguage
        )
      },
      subtitles: {
        fontSize: clampNumber(Number(fontSize), 18, 34, DEFAULT_SUBTITLE_SETTINGS.fontSize),
        opacity: clampNumber(Number(opacity), 40, 95, DEFAULT_SUBTITLE_SETTINGS.opacity),
        position: parseSubtitlePosition(position, DEFAULT_SUBTITLE_SETTINGS.position),
        showSource: parseBoolean(showSource, DEFAULT_SUBTITLE_SETTINGS.showSource),
        highlightRevisions: parseBoolean(
          highlightRevisions,
          DEFAULT_SUBTITLE_SETTINGS.highlightRevisions
        )
      }
    }
  }

  async saveSettings(input: SaveAppSettingsInput): Promise<AppSettings> {
    const translation = normalizeTranslationConfig(input.translation)
    const subtitles = normalizeSubtitleSettings(input.subtitles)

    await Promise.all([
      this.setSetting(SETTINGS_KEYS.sourceLanguage, translation.sourceLanguage),
      this.setSetting(SETTINGS_KEYS.targetLanguage, translation.targetLanguage),
      this.setSetting(SETTINGS_KEYS.subtitleFontSize, String(subtitles.fontSize)),
      this.setSetting(SETTINGS_KEYS.subtitleOpacity, String(subtitles.opacity)),
      this.setSetting(SETTINGS_KEYS.subtitlePosition, subtitles.position),
      this.setSetting(SETTINGS_KEYS.subtitleShowSource, String(subtitles.showSource)),
      this.setSetting(
        SETTINGS_KEYS.subtitleHighlightRevisions,
        String(subtitles.highlightRevisions)
      )
    ])

    if (input.clearLocalApiKey) {
      await this.deleteSetting(SETTINGS_KEYS.zhipuApiKey)
    } else if (input.zhipuApiKey?.trim()) {
      await this.setSetting(SETTINGS_KEYS.zhipuApiKey, encodeSecret(input.zhipuApiKey.trim()))
    }

    return this.getSettings()
  }

  async getZhipuApiKey(): Promise<string | undefined> {
    const environmentApiKey = process.env.ZHIPU_API_KEY?.trim()
    if (environmentApiKey) {
      return environmentApiKey
    }

    const storedApiKey = await this.getSetting(SETTINGS_KEYS.zhipuApiKey)
    return storedApiKey ? decodeSecret(storedApiKey) : undefined
  }

  async loadSubtitles(): Promise<SubtitleItem[]> {
    const rows = await this.all<SubtitleRow>(
      `
        SELECT *
        FROM subtitles
        ORDER BY updated_at DESC
        LIMIT ?
      `,
      [MAX_HISTORY_ITEMS]
    )

    return rows
      .map(readSubtitleRow)
      .filter((item): item is SubtitleItem => Boolean(item))
      .sort((a, b) => a.startedAt - b.startedAt)
  }

  async saveSubtitle(item: SubtitleItem): Promise<void> {
    await this.run(
      `
        INSERT INTO subtitles (
          id,
          session_id,
          source_language,
          target_language,
          source_text,
          translated_text,
          status,
          started_at,
          ended_at,
          updated_at,
          revision_count
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          session_id = excluded.session_id,
          source_language = excluded.source_language,
          target_language = excluded.target_language,
          source_text = excluded.source_text,
          translated_text = excluded.translated_text,
          status = excluded.status,
          started_at = excluded.started_at,
          ended_at = excluded.ended_at,
          updated_at = excluded.updated_at,
          revision_count = excluded.revision_count
      `,
      [
        item.id,
        item.sessionId,
        item.sourceLanguage,
        item.targetLanguage,
        item.sourceText ?? null,
        item.translatedText,
        item.status,
        item.startedAt,
        item.endedAt ?? null,
        item.updatedAt,
        item.revisionCount
      ]
    )
  }

  async clearSubtitles(sessionId?: string): Promise<void> {
    if (sessionId) {
      await this.run('DELETE FROM subtitles WHERE session_id = ?', [sessionId])
      return
    }

    await this.run('DELETE FROM subtitles')
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })
  }

  private async initialize(): Promise<void> {
    await this.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS subtitles (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        source_language TEXT NOT NULL,
        target_language TEXT NOT NULL,
        source_text TEXT,
        translated_text TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        updated_at INTEGER NOT NULL,
        revision_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_subtitles_updated_at
      ON subtitles(updated_at);

      CREATE INDEX IF NOT EXISTS idx_subtitles_session_id
      ON subtitles(session_id);
    `)
  }

  private async getSetting(key: string): Promise<string | undefined> {
    const row = await this.get<SettingRow>('SELECT value FROM settings WHERE key = ?', [key])
    return row?.value
  }

  private async setSetting(key: string, value: string): Promise<void> {
    await this.run(
      `
        INSERT INTO settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `,
      [key, value, Date.now()]
    )
  }

  private async deleteSetting(key: string): Promise<void> {
    await this.run('DELETE FROM settings WHERE key = ?', [key])
  }

  private exec(sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.exec(sql, (error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })
  }

  private run(sql: string, params: SqlValue[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, (error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })
  }

  private get<T>(sql: string, params: SqlValue[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      this.db.get<T>(sql, params, (error, row) => {
        if (error) {
          reject(error)
          return
        }

        resolve(row)
      })
    })
  }

  private all<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.db.all<T>(sql, params, (error, rows) => {
        if (error) {
          reject(error)
          return
        }

        resolve(rows)
      })
    })
  }
}

function normalizeTranslationConfig(config: TranslationConfig): TranslationConfig {
  return {
    sourceLanguage: parseLanguageCode(
      config.sourceLanguage,
      DEFAULT_TRANSLATION_CONFIG.sourceLanguage
    ),
    targetLanguage: parseTargetLanguageCode(
      config.targetLanguage,
      DEFAULT_TRANSLATION_CONFIG.targetLanguage
    )
  }
}

function normalizeSubtitleSettings(settings: SubtitleDisplaySettings): SubtitleDisplaySettings {
  return {
    fontSize: clampNumber(settings.fontSize, 18, 34, DEFAULT_SUBTITLE_SETTINGS.fontSize),
    opacity: clampNumber(settings.opacity, 40, 95, DEFAULT_SUBTITLE_SETTINGS.opacity),
    position: parseSubtitlePosition(settings.position, DEFAULT_SUBTITLE_SETTINGS.position),
    showSource: Boolean(settings.showSource),
    highlightRevisions: Boolean(settings.highlightRevisions)
  }
}

function parseLanguageCode(value: unknown, fallback: LanguageCode): LanguageCode {
  return value === 'auto' || value === 'zh-CN' || value === 'en' || value === 'ja' || value === 'ko'
    ? value
    : fallback
}

function parseTargetLanguageCode(value: unknown, fallback: TargetLanguageCode): TargetLanguageCode {
  return value === 'zh-CN' || value === 'en' || value === 'ja' || value === 'ko' ? value : fallback
}

function parseSubtitlePosition(value: unknown, fallback: SubtitlePosition): SubtitlePosition {
  return value === 'top' || value === 'bottom' ? value : fallback
}

function parseSubtitleStatus(value: unknown): SubtitleStatus | undefined {
  return value === 'draft' || value === 'stable' || value === 'revised' ? value : undefined
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (value === 'true') {
    return true
  }

  if (value === 'false') {
    return false
  }

  return fallback
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback
  }

  return Math.min(max, Math.max(min, Math.round(value)))
}

function readSubtitleRow(row: SubtitleRow): SubtitleItem | undefined {
  const sourceLanguage = parseLanguageCode(row.source_language, 'auto')
  const targetLanguage = parseTargetLanguageCode(row.target_language, 'zh-CN')
  const status = parseSubtitleStatus(row.status)

  if (!status) {
    return undefined
  }

  return {
    id: row.id,
    sessionId: row.session_id,
    sourceLanguage,
    targetLanguage,
    sourceText: row.source_text ?? undefined,
    translatedText: row.translated_text,
    status,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    updatedAt: row.updated_at,
    revisionCount: row.revision_count
  }
}

function encodeSecret(value: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return `safe:v1:${safeStorage.encryptString(value).toString('base64')}`
  }

  return `plain:v1:${value}`
}

function decodeSecret(value: string): string {
  if (value.startsWith('safe:v1:')) {
    return safeStorage.decryptString(Buffer.from(value.slice('safe:v1:'.length), 'base64'))
  }

  if (value.startsWith('plain:v1:')) {
    return value.slice('plain:v1:'.length)
  }

  return value
}
