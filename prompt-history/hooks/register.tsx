import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptSubmitInput, Register } from 'claude-code'

import type { Entry, EntryStatus } from '../types'

const PANE = 'prompt-history'
const TITLE = 'Prompt history'
const KEEP = 100
const PROMPT_ROOM = 2000
const ANSWER_ROOM = 6000
const QUEUE_ROOM = 20
// A slash command's card: light blue, so it stands out from typed prompts.
const COMMAND_BACKGROUND = '#E3F1FF'
const COMMAND_BORDER = '#A9D1F7'
const COMMAND_INK = '#12263F'
// Between the replies of a card's turns, oldest first.
const REPLY_BREAK = '\n\n---\n\n'

// Change the tag when an entry's fields change: it declines what an earlier
// version stored, which outlives a reload.
const entries = atom({ plugin: 'prompt-history', key: 'entries' } as const, [], {
  shape: 'entries-1',
})
// Minutes east of UTC, read from the Mac's own clock at session start.
const zone = atom({ plugin: 'prompt-history', key: 'zoneOffsetMin' } as const, null)
// True between a press of Clear and the Yes or Cancel that follows it.
const isConfirmingClear = atom({ plugin: 'prompt-history', key: 'isConfirmingClear' } as const, false)
// True once the person closes the panel, until they ask for it again.
const isClosedByPerson = atom({ plugin: 'prompt-history', key: 'isClosedByPerson' } as const, false)

const SYSTEM = `You label entries in a history sidebar of a coding session.
You get the user's request and the assistant's replies, oldest first, split by --- lines. The last reply is where the work ended up. Answer with exactly two lines:
ASKED: what the user asked for, at most 10 words, plain words, no quotes.
DONE: what was finally done or found, at most 18 words, past tense, judged by the last reply. If the work is unfinished there, say what is left. If the request was a question, give the answer's gist.
Write in the language of the request. No markdown, no extra lines.`

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const STATUS: Record<EntryStatus, { label: string; color: 'success' | 'claude' | 'warning' | 'error' }> = {
  running: { label: 'Working…', color: 'claude' },
  done: { label: 'Done', color: 'success' },
  stopped: { label: 'Stopped', color: 'warning' },
  failed: { label: 'Failed', color: 'error' },
}

// Where a prompt nobody typed comes from: background work, other sessions,
// relays and the engine itself. Anything else is taken as the person's.
const MACHINE_ORIGINS = new Set([
  'task-notification',
  'scheduled-trigger',
  'peer',
  'peer-send-message',
  'projects-relay',
  'channel',
  'coordinator',
  'observer',
  'observer-activity',
  'unclassified',
  'plugin',
])

function isPersons(e: PromptSubmitInput): boolean {
  const text = e.text.trim()
  if (e.isMeta || text === '' || MACHINE_ORIGINS.has(e.origin.kind)) return false

  // The desktop app hands its own notices over as a prompt wrapped in a tag.
  return !/^<(system-reminder|task-notification)\b/.test(text)
}

// A slash command as typed (`/audit`, `/plugin:skill args`), not a path.
function isCommand(prompt: string): boolean {
  return /^\/[\w:-]+(\s|$)/.test(prompt)
}

function clip(text: string, room: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length <= room ? flat : `${flat.slice(0, room - 1).trimEnd()}…`
}

// Keeps the end, where a reply says how the work ended.
function tail(text: string, room: number): string {
  return text.length <= room ? text : `…${text.slice(-(room - 1)).trimStart()}`
}

function lastReply(answer: string): string {
  const replies = answer.split(REPLY_BREAK)

  return replies[replies.length - 1] ?? ''
}

function firstSentence(text: string): string {
  const flat = text.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim()
  const end = flat.search(/[.!?](\s|$)/)

  return end === -1 ? flat : flat.slice(0, end + 1)
}

function clockText(ms: number, offsetMin: number): string {
  const d = new Date(ms + offsetMin * 60_000)
  const hours = d.getUTCHours()
  const minutes = String(d.getUTCMinutes()).padStart(2, '0')

  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${hours % 12 || 12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`
}

function durationText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`

  return `${Math.floor(m / 60)}h ${m % 60}m`
}

async function readZone($: EngineInterface): Promise<number> {
  try {
    const { exitCode, stdout } = await $.process.run(['date', '+%z'], { timeoutMs: 5000 })
    const m = /^([+-])(\d{2})(\d{2})/.exec(stdout.trim())
    if (exitCode === 0 && m) {
      const sign = m[1] === '-' ? -1 : 1

      return sign * (Number(m[2]) * 60 + Number(m[3]))
    }
  } catch {
    // Falls back to the runtime's own idea of the zone below.
  }

  return -new Date().getTimezoneOffset()
}

async function summarize($: EngineInterface, turnId: string): Promise<void> {
  const entry = (await read($, entries)).find(one => one.turnId === turnId)
  if (!entry || entry.status === 'running') return
  const answer = entry.answer

  let asked: string | undefined
  let done: string | undefined
  try {
    const reply = await $.model.complete({
      model: 'haiku',
      system: SYSTEM,
      prompt: `REQUEST:\n${entry.prompt}\n\nREPLIES:\n${answer || '(no reply text)'}`,
      maxTokens: 200,
    })
    if (reply.isAnswered) {
      asked = /^\s*ASKED:\s*(.+)$/im.exec(reply.text)?.[1]?.trim()
      done = /^\s*DONE:\s*(.+)$/im.exec(reply.text)?.[1]?.trim()
    }
  } catch {
    // The fallbacks below stand in when the model can't be asked.
  }

  // A follow-up turn that ended meanwhile changed the replies: its own
  // summary is on the way and this one would be stale.
  await update($, entries, list =>
    list.map(one =>
      one.turnId === turnId && one.answer === answer
        ? {
            ...one,
            askedSummary: asked || clip(one.prompt, 90),
            doneSummary: done || clip(firstSentence(lastReply(one.answer ?? '')), 140) || 'No reply text.',
          }
        : one,
    ),
  )
}

export const register: Register = on => {
  // Prompts as submitted, waiting for the turn that runs them.
  let pending: { text: string; isPersons: boolean }[] = []
  // The card a turn nobody typed carries on, by that turn's id.
  const following = new Map<string, string>()

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'prompt-history',
      description: 'Show your prompts and what Claude did in a side panel',
    })
    if (!(await read($, isClosedByPerson))) void $.ui.open({ id: PANE, title: TITLE })
    void readZone($).then(offset => update($, zone, () => offset))

    return next(e)
  })

  on('command.run', { command: 'prompt-history' }, async $ => {
    await update($, isClosedByPerson, () => false)
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Prompt history opened.' }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') await update($, isClosedByPerson, () => true)

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const text = e.text.trim()
    if (text) pending = [...pending, { text, isPersons: isPersons(e) }].slice(-QUEUE_ROOM)

    // Opened unasked at session start, the panel waits undrawn in a narrow
    // window. Opened in answer to the person's prompt, it draws at any width.
    if (isPersons(e) && !(await read($, isClosedByPerson))) {
      const panes = await $.ui.panes()
      if (!panes.some(pane => pane.id === PANE && pane.isPlaced)) void $.ui.open({ id: PANE, title: TITLE })
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)

    const text = e.text.trim()
    const at = text ? pending.findIndex(one => one.text === text) : -1
    // A slash command's turn starts with its expanded text: the line as
    // typed is then the oldest of the person's prompts still waiting.
    const taken = at !== -1 || !text ? at : pending.findIndex(one => one.isPersons)
    const match = taken === -1 ? undefined : pending[taken]

    if (!match?.isPersons) {
      // Nobody typed this turn: a background task reporting back, another
      // session's message, a continuation. It carries on the latest card.
      if (match) pending = pending.filter((_, i) => i !== taken)
      const list = await read($, entries)
      const last = list[list.length - 1]
      if (last) {
        following.set(e.turnId, last.turnId)
        await update($, entries, all =>
          all.map((one): Entry => (one.turnId === last.turnId ? { ...one, status: 'running' } : one)),
        )
      }

      return next(e)
    }

    const prompt = match.text
    // The person's prompts left ahead of it were folded into the turn before.
    const folded = pending
      .slice(0, taken)
      .filter(one => one.isPersons)
      .map(one => one.text)
    pending = pending.slice(taken + 1)

    const entry: Entry = {
      turnId: e.turnId,
      prompt: clip(prompt, PROMPT_ROOM),
      startedAt: await $.clock.now(),
      status: 'running',
    }
    await update($, entries, list => {
      const last = list[list.length - 1]
      const earlier =
        folded.length > 0 && last
          ? [...list.slice(0, -1), { ...last, prompt: clip([last.prompt, ...folded].join('\n'), PROMPT_ROOM) }]
          : list

      return [...earlier, entry].slice(-KEEP)
    })

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result

    const card = following.get(e.turnId) ?? e.turnId
    const isFollowUp = card !== e.turnId
    following.delete(e.turnId)

    const finishedAt = await $.clock.now()
    const status: EntryStatus = e.isAborted ? 'stopped' : e.reason === 'answer' ? 'done' : 'failed'
    let isOurs = false
    await update($, entries, list =>
      list.map(one => {
        if (one.turnId !== card) return one
        isOurs = true

        return {
          ...one,
          status,
          finishedAt,
          // A follow-up counts from the prompt, background work included.
          durationMs: isFollowUp ? finishedAt - one.startedAt : e.durationMs,
          answer: tail([isFollowUp ? one.answer : '', e.answer].filter(Boolean).join(REPLY_BREAK), ANSWER_ROOM),
          doneSummary: undefined,
        }
      }),
    )
    if (isOurs) $.clock.after(0, () => void summarize($, card))

    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, entries)
    const offset = (await read($, zone)) ?? -new Date().getTimezoneOffset()
    const isConfirming = await read($, isConfirmingClear)
    const finished = list.filter(one => one.status !== 'running').length

    // A card still running stays: its turn fills it in when it ends.
    const clearAll = async () => {
      await update($, entries, all => all.filter(one => one.status === 'running'))
      await update($, isConfirmingClear, () => false)
    }

    if (list.length === 0) {
      return (
        <Box flexDirection="column" paddingX={1}>
          <Text dimColor wrap="wrap">
            Your prompts and what Claude did will show here.
          </Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" paddingX={1} marginBottom={1}>
          <Text size="caption" dimColor>
            {isConfirming
              ? `Clear ${finished} ${finished === 1 ? 'card' : 'cards'}?`
              : `${list.length} ${list.length === 1 ? 'prompt' : 'prompts'} · newest first`}
          </Text>
          {isConfirming ? (
            <Box flexDirection="row" gap={1}>
              <Button key="clear-yes" label="Yes, clear" variant="primary" onPress={() => void clearAll()} />
              <Button key="clear-cancel" label="Cancel" onPress={() => void update($, isConfirmingClear, () => false)} />
            </Box>
          ) : (
            finished > 0 && (
              <Button key="clear" label="Clear" onPress={() => void update($, isConfirmingClear, () => true)} />
            )
          )}
        </Box>
        {[...list].reverse().map(entry => {
          const look = STATUS[entry.status]
          const isRunning = entry.status === 'running'
          // A command is shown as typed: the person knows it by its name.
          const isCmd = isCommand(entry.prompt)
          const asked = isCmd ? clip(entry.prompt, 120) : (entry.askedSummary ?? clip(entry.prompt, 120))
          // Dark ink on a command's light blue, readable in either theme.
          const ink = isCmd ? COMMAND_INK : undefined
          const done = isRunning ? undefined : entry.doneSummary
          const footer = isRunning
            ? `Started ${clockText(entry.startedAt, offset)}`
            : `⏱ ${durationText(entry.durationMs ?? 0)}  ·  ${clockText(entry.finishedAt ?? entry.startedAt, offset)}`

          return (
            <Box
              flexDirection="column"
              borderStyle="round"
              borderColor={isCmd ? COMMAND_BORDER : 'subtle'}
              backgroundColor={isCmd ? COMMAND_BACKGROUND : undefined}
              paddingX={1}
              marginBottom={1}
            >
              <Text size="caption" dimColor>
                You asked
              </Text>
              <Text weight="semibold" wrap="wrap" color={ink}>
                {asked}
              </Text>
              <Box flexDirection="column" marginTop={1}>
                <Text size="caption" color={look.color}>
                  {look.label}
                </Text>
                {!isRunning && (
                  <Text wrap="wrap" dimColor={done === undefined} color={ink}>
                    {done ?? 'Summarizing…'}
                  </Text>
                )}
              </Box>
              <Box marginTop={1}>
                <Text size="caption" dimColor>
                  {footer}
                </Text>
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })
}
