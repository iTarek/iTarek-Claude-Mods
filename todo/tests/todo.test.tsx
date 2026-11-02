import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = {
  plugin: 'todo',
  component: 'Pane',
  requestId: 'todo',
  props: {
    title: 'ToDo',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const SESSION = { cwd: '/', surface: 'desktop', isInteractive: true } as const

const LIST = `# ToDo

Some words about this file.

## Next

- [ ] **Add a search icon** — it opens the finder from the
  tab bar.
  - [ ] Draw the icon
  - [x] Pick the place
  - Note: not shown in the panel.
- [x] Rename the app

## Later

- [ ] Plain item with \`code\` and a [link](https://example.com)
`

// Each hook here stands for the engine: nothing sits beneath the plugin. They
// all go ahead of the test's first call on `$`.
function engine(on: On, files: Record<string, string>) {
  let mtimeMs = 1
  const reads: string[] = []
  const opened: string[] = []
  on('command.register', () => ({ value: { command: 'todo' } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.list', () => ({
    value: Object.keys(files).map(name => ({ name, kind: 'file' as const, size: files[name]?.length ?? 0, mtimeMs, isLink: false })),
  }))
  on('fs.read', (_, e) => {
    // The engine hands over a full path.
    const name = e.path.split('/').pop() ?? ''
    reads.push(name)

    return { value: files[name] ?? '' }
  })

  return {
    clock: mock.clock(on, { now: 0 }),
    opened,
    reads,
    edit(name: string, text: string) {
      files[name] = text
      mtimeMs += 1
    },
    remove(name: string) {
      delete files[name]
    },
  }
}

test('each item draws in its own box, with a mark and a button if it is open', async ($, on) => {
  const { clock } = engine(on, { 'ToDo.md': LIST })
  await $.session.start(SESSION)
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /open/ }))?.text).toBe('ToDo.md · 2 open · 1 done')
  expect((await ui.find({ type: 'Text', text: /^Add a search icon$/ }))?.text).toBe('Add a search icon')
  // Its wrapped line is joined to the detail, and the note stays out.
  expect((await ui.find({ type: 'Text', text: /opens the finder/ }))?.text).toBe('it opens the finder from the tab bar.')
  expect(await ui.find({ type: 'Text', text: /Note/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /Plain item/ }))?.text).toBe('Plain item with code and a link')
  for (const section of [/^Next$/, /^Later$/]) expect(await ui.find({ type: 'Text', text: section })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /words about/ })).toBeUndefined()

  // Every item can be explained and removed, an open one worked on too, and a
  // step has none of them. Explain sits in the middle.
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.map(button => button.props.label)).toEqual([
    "Let's work on this",
    'Explain this',
    'Remove this',
    'Explain this',
    'Remove this',
    "Let's work on this",
    'Explain this',
    'Remove this',
  ])

  // Three items and two steps, each with its own circle.
  const marks = await ui.findAll({ type: 'Svg' })
  expect(marks.map(svg => svg.props.alt)).toEqual(['Not done', 'Not done', 'Done', 'Done', 'Not done'])
  expect(String(marks.find(svg => svg.props.alt === 'Done')?.props.source)).toContain('<path')
  expect(String(marks.find(svg => svg.props.alt === 'Not done')?.props.source)).not.toContain('<path')
  await ui.unmount()
})

test('a terminal draws the marks as text', async ($, on) => {
  const { clock } = engine(on, { 'ToDo.md': LIST })
  await $.session.start(SESSION)
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(await ui.findAll({ type: 'Text', text: /^○$/ })).toHaveLength(3)
  expect(await ui.findAll({ type: 'Text', text: /^✔$/ })).toHaveLength(2)
  await ui.unmount()
})

test('the button sets the prompt to the item, after what is typed', async ($, on) => {
  const { clock } = engine(on, { 'ToDo.md': LIST })
  let draft = ''
  const filled: { text: string; mode?: string }[] = []
  on('prompt.read', () => ({ value: { text: draft, cursor: draft.length } }))
  on('prompt.fill', (_, e) => {
    filled.push({ text: e.text, mode: e.mode })

    return { isFilled: true }
  })
  await $.session.start(SESSION)
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'work-0' })
  await ui.press({ key: 'work-2' })
  draft = 'First this'
  await ui.press({ key: 'work-2' })
  await ui.unmount()

  expect(filled[0]?.mode).toBe('append')
  expect(filled[0]?.text.startsWith("Let's work on this item from ToDo.md:\n\n- [ ] **Add a search icon**")).toBe(true)
  // The item's own steps and notes go with it, and the next item doesn't.
  expect(filled[0]?.text).toContain('  - [ ] Draw the icon')
  expect(filled[0]?.text).toContain('  - Note: not shown in the panel.')
  expect(filled[0]?.text).not.toContain('Rename the app')
  expect(filled[0]?.text.endsWith("When it's finished, update ToDo.md.")).toBe(true)
  expect(filled[1]?.text).toContain('Plain item')
  expect(filled[2]?.text.startsWith('\n\nLet')).toBe(true)
})

test('the explain button sets the prompt to explain that item, changing nothing', async ($, on) => {
  const { clock } = engine(on, { 'ToDo.md': LIST })
  const filled: string[] = []
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_, e) => {
    filled.push(e.text)

    return { isFilled: true }
  })
  await $.session.start(SESSION)
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'explain-0' })
  await ui.press({ key: 'explain-1' })
  await ui.unmount()

  expect(filled[0]?.startsWith('Explain this item from ToDo.md in plain words')).toBe(true)
  expect(filled[0]).toContain("Don't change anything yet")
  expect(filled[0]).toContain('- [ ] **Add a search icon**')
  expect(filled[0]).not.toContain('Rename the app')
  // A done item can be explained too.
  expect(filled[1]).toContain('- [x] Rename the app')
})

test('the remove button sets the prompt to remove that item, and nothing else', async ($, on) => {
  const { clock, reads } = engine(on, { 'ToDo.md': LIST })
  const filled: string[] = []
  const written: string[] = []
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_, e) => {
    filled.push(e.text)

    return { isFilled: true }
  })
  on('fs.write', (_, e) => {
    written.push(e.path)

    return { value: undefined }
  })
  await $.session.start(SESSION)
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'remove-0' })
  await ui.press({ key: 'remove-1' })
  await ui.unmount()

  expect(filled[0]?.startsWith('Remove this item from ToDo.md')).toBe(true)
  expect(filled[0]).toContain('- [ ] **Add a search icon**')
  expect(filled[0]).toContain('  - [ ] Draw the icon')
  expect(filled[0]).not.toContain('Rename the app')
  // A done item can go too.
  expect(filled[1]).toContain('- [x] Rename the app')
  // The file stays as it is until the person sends the prompt.
  expect(written).toEqual([])
  expect(reads).toHaveLength(1)
})

test('a prompt box that takes nothing says so', async ($, on) => {
  const { clock } = engine(on, { 'ToDo.md': LIST })
  const toasts: string[] = []
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', () => ({ isFilled: false }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  await $.session.start(SESSION)
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'work-0' })
  await ui.unmount()

  expect(toasts).toEqual(["Couldn't set the prompt right now."])
})

test('with no file the panel says so, and its button asks Claude for one', async ($, on) => {
  const { clock, edit } = engine(on, { 'notes.md': '- [ ] not this', 'todo.txt': '- [ ] nor this' })
  const asked: string[] = []
  on('prompt.submit', (_, e) => {
    asked.push(e.text)

    return { text: e.text }
  })
  await $.session.start(SESSION)
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /has no ToDo\.md/ })).toBeDefined()

  await ui.press({ key: 'create' })
  await clock.settle()
  expect(asked).toHaveLength(1)
  expect(asked[0]).toContain('Create a ToDo.md')
  await ui.unmount()

  // Pressed once: no second request while Claude is on it.
  const waiting = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await waiting.find({ type: 'Button' })).toBeUndefined()
  expect(await waiting.find({ type: 'Text', text: /Asked Claude/ })).toBeDefined()
  await waiting.unmount()

  // Once the file is there, the panel shows it by itself.
  edit('ToDo.md', '- [ ] First item')
  await clock.advance(3000)
  const shown = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await shown.find({ type: 'Text', text: /^First item$/ })).toBeDefined()
  await shown.unmount()
})

for (const name of ['TODO.md', 'Todo.md', 'todo.md', 'ToDo.md']) {
  test(`the file is found when it is named ${name}`, async ($, on) => {
    const { clock, reads } = engine(on, { [name]: '- [ ] Item' })
    await $.session.start(SESSION)
    await clock.settle()

    expect(reads).toEqual([name])
  })
}

test('the file is read again only when it changed, and its removal shows', async ($, on) => {
  const { clock, edit, reads, remove } = engine(on, { 'ToDo.md': '- [ ] One' })
  await $.session.start(SESSION)
  await clock.settle()
  expect(reads).toHaveLength(1)

  await clock.advance(9000)
  expect(reads).toHaveLength(1)

  edit('ToDo.md', '- [x] One\n- [ ] Two')
  await clock.advance(3000)
  expect(reads).toHaveLength(2)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /open/ }))?.text).toBe('ToDo.md · 1 open · 1 done')
  await ui.unmount()

  remove('ToDo.md')
  await clock.advance(3000)
  const gone = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await gone.find({ type: 'Text', text: /has no ToDo\.md/ })).toBeDefined()
  await gone.unmount()
})

test('a file with no checkboxes lists its top-level bullets', async ($, on) => {
  const { clock } = engine(on, {
    'TODO.md': '# TODO\n\n## Open\n\n- **The privacy label** (see the doc): each place is sent.\n  - a detail under it\n- Another one\n',
  })
  await $.session.start(SESSION)
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /open/ }))?.text).toBe('TODO.md · 2 open · 0 done')
  expect(await ui.find({ type: 'Text', text: /^The privacy label$/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /see the doc/ }))?.text).toBe('(see the doc): each place is sent.')
  expect(await ui.find({ type: 'Text', text: /a detail under/ })).toBeUndefined()
  await ui.unmount()
})

test('where a file has checkboxes, its plain bullets and code are not items', async ($, on) => {
  const { clock } = engine(on, {
    'Todo.md': ['- Why this matters', '', '```', '- [ ] an example in code', '```', '', '- [ ] **Host check:** accept only local names'].join('\n'),
  })
  await $.session.start(SESSION)
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /open/ }))?.text).toBe('Todo.md · 1 open · 0 done')
  expect(await ui.find({ type: 'Text', text: /^Host check$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Why this|an example/ })).toBeUndefined()
  await ui.unmount()
})

test('a very long list shows its first items and says how many are left', async ($, on) => {
  const { clock } = engine(on, { 'ToDo.md': Array.from({ length: 130 }, (_, i) => `- [ ] Item ${i + 1}`).join('\n') })
  await $.session.start(SESSION)
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.findAll({ type: 'Button' })).toHaveLength(300)
  expect((await ui.find({ type: 'Text', text: /more in/ }))?.text).toBe('And 30 more in ToDo.md.')
  expect((await ui.find({ type: 'Text', text: /open/ }))?.text).toBe('ToDo.md · 130 open · 0 done')
  await ui.unmount()
})

test('a file without items says so, and a long item is cut short', async ($, on) => {
  const { clock, edit } = engine(on, { 'ToDo.md': '# ToDo\n\nNothing yet.' })
  await $.session.start(SESSION)
  await clock.settle()

  const empty = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await empty.find({ type: 'Text' }))?.text).toBe('ToDo.md has no items.')
  await empty.unmount()

  edit('ToDo.md', `- [ ] **Short title** ${'word '.repeat(80)}`)
  await clock.advance(3000)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const detail = (await ui.find({ type: 'Text', text: /word word/ }))?.text ?? ''
  expect(detail.length).toBeLessThanOrEqual(200)
  expect(detail.endsWith('…')).toBe(true)
  await ui.unmount()
})

test('the /todo command opens the panel', async ($, on) => {
  const { clock, opened } = engine(on, { 'ToDo.md': LIST })
  await $.session.start(SESSION)
  await clock.settle()
  opened.length = 0

  const result = await $.command.run({
    command: 'todo',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  })

  expect(result.text).toBe('ToDo opened.')
  expect(opened).toEqual(['todo'])
})
