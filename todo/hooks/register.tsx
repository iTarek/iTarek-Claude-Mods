import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Item, Scan } from '../types'

const PANE = 'todo'
const TITLE = 'ToDo'
const FILE = /^todo\.md$/i
// A look at the folder costs one listing, and the file is read only when it changed.
const LOOK_EVERY_MS = 3000
const KEEP = 100
const TITLE_ROOM = 140
const DETAIL_ROOM = 200
const SOURCE_ROOM = 2000

const HEADING = /^(#{1,6})\s+(.*)$/
const BOX = /^[-*+]\s+\[( |x|X)\]\s+(.*)$/
const BULLET = /^[-*+]\s+(.*)$/
const CODE_FENCE = /^\s*(```|~~~)/
// A bold lead is the item's title, and what follows it the detail.
const LEAD = /^\*\*(.+?)\*\*[\s:—–-]*(.*)$/

const CREATE_PROMPT =
  'Create a ToDo.md in the root of this project. List the open work you can find in the project as "- [ ]" checkboxes, grouped under "##" headings, each starting with a short **bold title**.'

const OPEN_MARK =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="none" stroke="#8A8F98" stroke-width="1.5"/></svg>'
const DONE_MARK =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7.25" fill="#2E9E5B"/><path d="M4.6 8.3l2.3 2.3 4.5-4.8" fill="none" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'

// Change the tag when an item's fields change: it declines what an earlier
// version stored, which outlives a reload.
const scan = atom({ plugin: 'todo', key: 'scan' } as const, { items: [], more: 0 }, { shape: 'scan-1' })
// True between a press of the create button and the end of the turn it starts.
const isAsking = atom({ plugin: 'todo', key: 'isAsking' } as const, false)
// True once the person closes the panel, until they ask for it again.
const isClosedByPerson = atom({ plugin: 'todo', key: 'isClosedByPerson' } as const, false)

function plain(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function clip(text: string, room: number): string {
  return text.length <= room ? text : `${text.slice(0, room - 1).trimEnd()}…`
}

function titled(text: string): { title: string; detail?: string } {
  const lead = LEAD.exec(text)
  if (!lead) return { title: clip(plain(text), TITLE_ROOM) }

  const detail = plain(lead[2] ?? '')
  return {
    title: clip(plain(lead[1] ?? '').replace(/:$/, ''), TITLE_ROOM),
    detail: detail ? clip(detail, DETAIL_ROOM) : undefined,
  }
}

// An item is a top-level checkbox. A file with none lists its items as plain
// top-level bullets. Under an item, an indented checkbox is a step of it; other
// indented bullets are notes, kept for the prompt and not shown.
function parseTodo(text: string): Item[] {
  const lines = text.split(/\r?\n/)
  const hasBoxes = lines.some(line => BOX.test(line))
  const items: Item[] = []
  let section: string | undefined
  let item: Item | undefined
  // What an indented line of plain text carries on.
  let carrying: 'item' | 'step' | undefined
  let isInCode = false

  for (const line of lines) {
    if (CODE_FENCE.test(line)) isInCode = !isInCode
    if (isInCode || CODE_FENCE.test(line)) continue

    const heading = HEADING.exec(line)
    if (heading) {
      section = heading[1] === '#' ? undefined : plain(heading[2] ?? '')
      item = undefined
      continue
    }

    const box = BOX.exec(line)
    const bullet = hasBoxes ? null : BULLET.exec(line)
    if (box || bullet) {
      item = {
        text: (box ? box[2] : bullet?.[1]) ?? '',
        isDone: box ? box[1] !== ' ' : false,
        section,
        steps: [],
        source: line,
      }
      items.push(item)
      carrying = 'item'
      continue
    }

    if (line.trim() === '') {
      carrying = undefined
      continue
    }
    if (!item) continue
    if (!/^\s/.test(line)) {
      item = undefined
      continue
    }

    item.source += `\n${line}`
    const inner = line.trim()
    const step = BOX.exec(inner)
    const lastStep = item.steps[item.steps.length - 1]
    if (step) {
      item.steps.push({ text: step[2] ?? '', isDone: step[1] !== ' ' })
      carrying = 'step'
    } else if (BULLET.test(inner)) {
      carrying = undefined
    } else if (carrying === 'item') {
      item.text += ` ${inner}`
    } else if (carrying === 'step' && lastStep) {
      lastStep.text += ` ${inner}`
    }
  }

  return items
}

function workPrompt(file: string, item: Item): string {
  return `Let's work on this item from ${file}:\n\n${clip(item.source, SOURCE_ROOM)}\n\nWhen it's finished, update ${file}.`
}

function explainPrompt(file: string, item: Item): string {
  return `Explain this item from ${file} in plain words: what it means, why it matters and what doing it would take. Don't change anything yet:\n\n${clip(item.source, SOURCE_ROOM)}`
}

function removePrompt(file: string, item: Item): string {
  return `Remove this item from ${file}, with its steps and notes, and leave the rest of the file as it is:\n\n${clip(item.source, SOURCE_ROOM)}`
}

// Added after whatever the person has typed so far, which stays.
async function setPrompt($: EngineInterface, prompt: string): Promise<void> {
  const { text } = await $.prompt.read()
  const { isFilled } = await $.prompt.fill({ text: `${text.trim() ? '\n\n' : ''}${prompt}`, mode: 'append' })
  if (!isFilled) $.ui.toast("Couldn't set the prompt right now.")
}

async function look($: EngineInterface): Promise<void> {
  try {
    const found = (await $.fs.list()).find(one => one.kind === 'file' && FILE.test(one.name))
    const stamp = found ? `${found.name}:${found.mtimeMs}:${found.size}` : ''
    if (stamp === (await read($, scan)).stamp) return

    const items = found ? parseTodo(await $.fs.read(found.name)) : []
    const fresh: Scan = {
      stamp,
      file: found?.name,
      items: items.slice(0, KEEP),
      more: Math.max(0, items.length - KEEP),
    }
    await update($, scan, () => fresh)
    if (found) await update($, isAsking, () => false)
  } catch {
    // Tried again at the next look.
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'todo',
      description: "Show this project's ToDo.md in a side panel",
    })
    if (!(await read($, isClosedByPerson))) void $.ui.open({ id: PANE, title: TITLE })
    void look($)
    $.clock.every(LOOK_EVERY_MS, () => void look($))

    return next(e)
  })

  on('command.run', { command: 'todo' }, async $ => {
    await update($, isClosedByPerson, () => false)
    await $.ui.open({ id: PANE, title: TITLE })
    await look($)

    return { text: 'ToDo opened.' }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') await update($, isClosedByPerson, () => true)

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    // Opened unasked at session start, the panel waits undrawn in a narrow
    // window. Opened in answer to a prompt, it draws at any width.
    if (!e.isMeta && e.origin.kind !== 'plugin' && !(await read($, isClosedByPerson))) {
      const panes = await $.ui.panes()
      if (!panes.some(pane => pane.id === PANE && pane.isPlaced)) void $.ui.open({ id: PANE, title: TITLE })
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) await update($, isAsking, () => false)

    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const { stamp, file, items, more } = await read($, scan)
    const isWaiting = await read($, isAsking)

    const mark = (isDone: boolean) => {
      // A terminal draws no picture.
      if (e.surface === 'terminal') {
        return (
          <Text color={isDone ? 'success' : undefined} dimColor={!isDone}>
            {isDone ? '✔' : '○'}
          </Text>
        )
      }
      const { Svg } = $.ui.resolve(e)

      return <Svg source={isDone ? DONE_MARK : OPEN_MARK} alt={isDone ? 'Done' : 'Not done'} />
    }

    if (stamp === undefined) {
      return (
        <Box paddingX={1}>
          <Text dimColor>Looking for ToDo.md…</Text>
        </Box>
      )
    }

    if (!file) {
      const askClaude = async () => {
        await update($, isAsking, () => true)
        await $.prompt.submit({ text: CREATE_PROMPT })
      }

      return (
        <Box flexDirection="column" paddingX={1}>
          <Text wrap="wrap">This project has no ToDo.md.</Text>
          <Box marginTop={1}>
            {isWaiting ? (
              <Text dimColor>Asked Claude to create it…</Text>
            ) : (
              <Button key="create" label="Ask Claude to create it" variant="primary" onPress={() => void askClaude()} />
            )}
          </Box>
        </Box>
      )
    }

    if (items.length === 0) {
      return (
        <Box paddingX={1}>
          <Text dimColor wrap="wrap">
            {file} has no items.
          </Text>
        </Box>
      )
    }

    const done = items.filter(item => item.isDone).length

    return (
      <Box flexDirection="column">
        <Box paddingX={1} marginBottom={1}>
          <Text size="caption" dimColor>
            {file} · {items.length - done + more} open · {done} done
          </Text>
        </Box>
        {items.map((item, i) => {
          const { title, detail } = titled(item.text)
          const isNewSection = item.section !== undefined && item.section !== items[i - 1]?.section

          return (
            <Box flexDirection="column">
              {isNewSection && (
                <Box paddingX={1} marginBottom={1}>
                  <Text size="caption" weight="semibold" wrap="wrap">
                    {item.section}
                  </Text>
                </Box>
              )}
              <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1} marginBottom={1}>
                <Box flexDirection="row" gap={1}>
                  {mark(item.isDone)}
                  <Box flexDirection="column" flexShrink={1}>
                    <Text weight="semibold" wrap="wrap" dimColor={item.isDone}>
                      {title}
                    </Text>
                    {detail && (
                      <Text size="caption" wrap="wrap" dimColor>
                        {detail}
                      </Text>
                    )}
                  </Box>
                </Box>
                {item.steps.map(step => (
                  <Box flexDirection="row" gap={1} marginTop={1}>
                    {mark(step.isDone)}
                    <Box flexShrink={1}>
                      <Text size="caption" wrap="wrap" dimColor={step.isDone}>
                        {clip(plain(step.text), TITLE_ROOM)}
                      </Text>
                    </Box>
                  </Box>
                ))}
                <Box flexDirection="row" flexWrap="wrap" gap={1} marginTop={1}>
                  {!item.isDone && (
                    <Button key={`work-${i}`} label="Let's work on this" onPress={() => void setPrompt($, workPrompt(file, item))} />
                  )}
                  <Button key={`explain-${i}`} label="Explain this" onPress={() => void setPrompt($, explainPrompt(file, item))} />
                  <Button key={`remove-${i}`} label="Remove this" onPress={() => void setPrompt($, removePrompt(file, item))} />
                </Box>
              </Box>
            </Box>
          )
        })}
        {more > 0 && (
          <Box paddingX={1}>
            <Text size="caption" dimColor wrap="wrap">
              And {more} more in {file}.
            </Text>
          </Box>
        )}
      </Box>
    )
  })
}
