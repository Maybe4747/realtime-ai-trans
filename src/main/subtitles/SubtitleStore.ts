import type {
  LanguageCode,
  SubtitleEvent,
  SubtitleItem,
  TargetLanguageCode
} from '../../shared/types'

const REVISION_MAX_ITEMS = 3
const REVISION_MAX_AGE_MS = 15_000

interface SubtitleStorage {
  saveSubtitle(item: SubtitleItem): Promise<void>
  clearSubtitles(sessionId?: string): Promise<void>
}

interface SubtitleInput {
  id: string
  sessionId: string
  sourceLanguage: LanguageCode
  targetLanguage: TargetLanguageCode
  sourceText?: string
  translatedText: string
}

export class SubtitleStore {
  private items: SubtitleItem[]
  private listeners = new Set<(event: SubtitleEvent) => void>()

  constructor(
    private readonly storage?: SubtitleStorage,
    initialItems: SubtitleItem[] = []
  ) {
    this.items = initialItems
  }

  getSnapshot(): SubtitleItem[] {
    return [...this.items]
  }

  getRecentStable(limit = REVISION_MAX_ITEMS, sessionId?: string): SubtitleItem[] {
    return this.items
      .filter(
        (item) =>
          (item.status === 'stable' || item.status === 'revised') &&
          (!sessionId || item.sessionId === sessionId)
      )
      .slice(-limit)
  }

  onEvent(callback: (event: SubtitleEvent) => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  clear(sessionId?: string): void {
    this.items = sessionId ? this.items.filter((item) => item.sessionId !== sessionId) : []
    void this.storage?.clearSubtitles(sessionId).catch(reportStorageError)
    this.emit({ type: 'subtitle:clear', sessionId })
  }

  upsertDraft(input: SubtitleInput): SubtitleItem {
    const now = Date.now()
    const existing = this.items.find((item) => item.id === input.id)
    const item: SubtitleItem = {
      id: input.id,
      sessionId: input.sessionId,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      sourceText: input.sourceText,
      translatedText: input.translatedText,
      status: 'draft',
      startedAt: existing?.startedAt ?? now,
      updatedAt: now,
      revisionCount: existing?.revisionCount ?? 0
    }

    if (existing) {
      Object.assign(existing, item)
      this.persist(existing)
      this.emit({ type: 'subtitle:draft', item: existing })
      return existing
    }

    this.items.push(item)
    this.persist(item)
    this.emit({ type: 'subtitle:draft', item })
    return item
  }

  stabilize(input: SubtitleInput): SubtitleItem {
    const now = Date.now()
    const existing = this.items.find((item) => item.id === input.id)
    const item: SubtitleItem = {
      id: input.id,
      sessionId: input.sessionId,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      sourceText: input.sourceText,
      translatedText: input.translatedText,
      status: 'stable',
      startedAt: existing?.startedAt ?? now,
      endedAt: now,
      updatedAt: now,
      revisionCount: existing?.revisionCount ?? 0
    }

    if (existing) {
      Object.assign(existing, item)
      this.persist(existing)
      this.emit({ type: 'subtitle:stable', item: existing })
      return existing
    }

    this.items.push(item)
    this.persist(item)
    this.emit({ type: 'subtitle:stable', item })
    return item
  }

  revise(id: string, translatedText: string): SubtitleItem | undefined {
    const item = this.items.find((candidate) => candidate.id === id)
    if (!item || !this.canRevise(item, translatedText)) {
      return undefined
    }

    const previousText = item.translatedText
    item.translatedText = translatedText
    item.status = 'revised'
    item.updatedAt = Date.now()
    item.revisionCount += 1
    this.persist(item)
    this.emit({ type: 'subtitle:revised', item, previousText })
    return item
  }

  private persist(item: SubtitleItem): void {
    void this.storage?.saveSubtitle(item).catch(reportStorageError)
  }

  private canRevise(item: SubtitleItem, translatedText: string): boolean {
    if (!translatedText.trim() || item.translatedText.trim() === translatedText.trim()) {
      return false
    }

    const recentIds = new Set(this.getRecentStable().map((recent) => recent.id))
    const insideAgeWindow = Date.now() - item.updatedAt <= REVISION_MAX_AGE_MS
    return recentIds.has(item.id) && insideAgeWindow
  }

  private emit(event: SubtitleEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

function reportStorageError(error: unknown): void {
  console.error('SQLite subtitle persistence failed', error)
}
