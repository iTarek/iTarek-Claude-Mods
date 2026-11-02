export type EntryStatus = 'running' | 'done' | 'stopped' | 'failed'

export type Entry = {
  turnId: string
  prompt: string
  answer?: string
  askedSummary?: string
  doneSummary?: string
  startedAt: number
  finishedAt?: number
  durationMs?: number
  status: EntryStatus
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-history': {
      entries: Shaped<Entry[]>
      zoneOffsetMin: number | null
      isConfirmingClear: boolean
      isClosedByPerson: boolean
    }
  }
}
