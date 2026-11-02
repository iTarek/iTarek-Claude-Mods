export type Step = {
  text: string
  isDone: boolean
}

export type Item = {
  text: string
  isDone: boolean
  section?: string
  steps: Step[]
  // The item's lines as the file has them, for the prompt.
  source: string
}

export type Scan = {
  // The file as last read, to tell when it changed: empty with no file, absent
  // before the first look.
  stamp?: string
  file?: string
  items: Item[]
  // Items past the panel's room.
  more: number
}

declare module 'claude-code' {
  interface PluginState {
    todo: {
      scan: Shaped<Scan>
      isAsking: boolean
      isClosedByPerson: boolean
    }
  }
}
