import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'prompt-history',
  component: 'Pane',
  requestId: 'prompt-history',
  props: {
    title: 'Prompt history',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const USAGE = {
  input_tokens: 1,
  output_tokens: 1,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
}

// Nov 1, 2026, 12:00 UTC: 3:00 PM on a Mac three hours east of UTC.
const NOON_UTC = Date.UTC(2026, 10, 1, 12, 0, 0)

test('a finished prompt shows what was asked, what was done, how long and when', async ($, on) => {
  // Nothing sits beneath the plugin: each hook here stands for the engine.
  const clock = mock.clock(on, { now: NOON_UTC })
  on('command.register', () => ({ value: { command: 'prompt-history' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '+0300\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('model.complete', () => ({
    value: {
      isAnswered: true,
      text: 'ASKED: Add a search icon to the notes app\nDONE: Added a search icon to the tab bar that opens the finder.',
      usage: USAGE,
    },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  await $.prompt.submit({ text: "Let's add an icon to the notes app so users can search", wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: "Let's add an icon to the notes app so users can search", turnId: 't1' })
  await clock.advance(90_000)
  await $.turn.complete({
    answer: 'Done. I added a search icon to the tab bar.',
    durationMs: 90_000,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
  })
  await clock.advance(50)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect((await ui.find({ type: 'Text', text: /search icon to the notes/ }))?.text).toBe(
      'Add a search icon to the notes app',
    )
    expect((await ui.find({ type: 'Text', text: /tab bar/ }))?.text).toBe(
      'Added a search icon to the tab bar that opens the finder.',
    )
    expect((await ui.find({ type: 'Text', text: /^Done$/ }))?.text).toBe('Done')
    expect((await ui.find({ type: 'Text', text: /⏱/ }))?.text).toBe('⏱ 1m 30s  ·  Nov 1, 3:01 PM')
    // A typed prompt keeps the plain card; only commands are blue.
    expect((await ui.findAll({ type: 'Box' })).filter(box => box.props.backgroundColor !== undefined)).toHaveLength(0)
    await ui.unmount()
  }
})

test('a running prompt shows as working, and the model failing falls back to the words given', async ($, on) => {
  const clock = mock.clock(on, { now: NOON_UTC })
  on('command.register', () => ({ value: { command: 'prompt-history' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '+0000\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: USAGE } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  await $.prompt.submit({ text: 'Fix the build warnings', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'Fix the build warnings', turnId: 't1' })

  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Working/ }))?.text).toBe('Working…')
  expect((await ui.find({ type: 'Text', text: /Started/ }))?.text).toBe('Started Nov 1, 12:00 PM')
  await ui.unmount()

  await clock.advance(5_000)
  await $.turn.complete({
    answer: 'Fixed all 4 warnings. The build is clean now.',
    durationMs: 5_000,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
  })
  await clock.advance(50)

  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^Fix the build/ }))?.text).toBe('Fix the build warnings')
  expect((await ui.find({ type: 'Text', text: /^Fixed all/ }))?.text).toBe('Fixed all 4 warnings.')
  await ui.unmount()
})

test('a background task finishing the work updates the same card with the final result', async ($, on) => {
  const clock = mock.clock(on, { now: NOON_UTC })
  on('command.register', () => ({ value: { command: 'prompt-history' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: '+0000\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  // Answers from the last reply, as the real model is told to.
  on('model.complete', (_, e) => ({
    value: {
      isAnswered: true,
      text: e.prompt.trimEnd().endsWith('All 14 tests pass.')
        ? 'ASKED: Fix the TestFlight crash\nDONE: Fixed the crash when Skip is tapped; all tests pass.'
        : 'ASKED: Fix the TestFlight crash\nDONE: Wrote the fix; still waiting for the tests.',
      usage: USAGE,
    },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  await $.prompt.submit({ text: 'A TestFlight user submitted a crash', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'A TestFlight user submitted a crash', turnId: 't1' })
  await clock.advance(60_000)
  await $.turn.complete({
    answer: 'Wrote the fix. Waiting for the test run to finish.',
    durationMs: 60_000,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
  })
  await clock.advance(50)

  const note = '<task-notification>\nTests finished\n</task-notification>'
  await $.prompt.submit({ text: note, wait: false, origin: { kind: 'task-notification' } })
  await $.turn.start({ text: note, turnId: 't2' })

  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /prompt/ }))?.text).toBe('1 prompt · newest first')
  expect((await ui.find({ type: 'Text', text: /Working/ }))?.text).toBe('Working…')
  await ui.unmount()

  await clock.advance(30_000)
  await $.turn.complete({
    answer: "I've fixed the tester's crash. All 14 tests pass.",
    durationMs: 30_000,
    isAborted: false,
    turnId: 't2',
    reason: 'answer',
  })
  await clock.advance(50)

  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^Fixed the crash/ }))?.text).toBe(
    'Fixed the crash when Skip is tapped; all tests pass.',
  )
  expect(await ui.find({ type: 'Text', text: /still waiting/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /⏱/ }))?.text).toBe('⏱ 1m 30s  ·  Nov 1, 12:01 PM')
  await ui.unmount()
})

test('a slash command shows as typed, not as the model retold it', async ($, on) => {
  const clock = mock.clock(on, { now: NOON_UTC })
  on('command.register', () => ({ value: { command: 'prompt-history' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: '+0000\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('model.complete', () => ({
    value: {
      isAnswered: true,
      text: 'ASKED: Thorough review of uncommitted changes\nDONE: Fixed 3 stale docs and added a missing test.',
      usage: USAGE,
    },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  // As the engine raises them: the line as typed, then a turn holding its tags.
  await $.prompt.submit({
    text: '/audit check the widgets',
    command: { name: 'audit', args: 'check the widgets' },
    wait: false,
    origin: { kind: 'composer' },
  })
  await $.turn.start({
    text: '<command-message>audit</command-message>\n<command-name>/audit</command-name>\n<command-args>check the widgets</command-args>',
    turnId: 't1',
  })
  await $.turn.complete({ answer: 'Fixed 3 stale docs.', durationMs: 1_000, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(50)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /audit/ }))?.text).toBe('/audit check the widgets')
  expect(await ui.find({ type: 'Text', text: /Thorough review/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /stale docs/ }))?.text).toBe('Fixed 3 stale docs and added a missing test.')
  // A command's card is light blue, with dark text on it.
  const tinted = (await ui.findAll({ type: 'Box' })).filter(box => box.props.backgroundColor !== undefined)
  expect(tinted.map(box => box.props.backgroundColor)).toEqual(['#E3F1FF'])
  expect((await ui.find({ type: 'Text', text: /audit/ }))?.props.color).toBe('#12263F')
  await ui.unmount()
})

test('Clear asks first, then empties the finished cards and keeps a running one', async ($, on) => {
  const clock = mock.clock(on, { now: NOON_UTC })
  on('command.register', () => ({ value: { command: 'prompt-history' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: '+0000\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('model.complete', () => ({
    value: { isAnswered: true, text: 'ASKED: Rename the app\nDONE: Renamed the app.', usage: USAGE },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  await $.prompt.submit({ text: 'Rename the app', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'Rename the app', turnId: 't1' })
  await $.turn.complete({ answer: 'Renamed.', durationMs: 1_000, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(50)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    await ui.press({ key: 'clear' })
    expect((await ui.find({ type: 'Text', text: /^Clear 1 card/ }))?.text).toBe('Clear 1 card?')
    await ui.press({ key: 'clear-cancel' })
    expect((await ui.find({ type: 'Text', text: /^Renamed/ }))?.text).toBe('Renamed the app.')
    await ui.unmount()
  }

  await $.prompt.submit({ text: 'Add a settings screen', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'Add a settings screen', turnId: 't2' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'clear' })
  await ui.press({ key: 'clear-yes' })
  expect(await ui.find({ type: 'Text', text: /^Renamed/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /settings screen/ }))?.text).toBe('Add a settings screen')
  expect((await ui.find({ type: 'Text', text: /prompt/ }))?.text).toBe('1 prompt · newest first')
  await ui.unmount()
})

test("the app's own notices and background tasks get no card", async ($, on) => {
  on('command.register', () => ({ value: { command: 'prompt-history' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const notice = '<system-reminder>\nThe person enabled mod hot-reloading\n</system-reminder>'
  await $.prompt.submit({ text: notice, wait: false, origin: { kind: 'sdk' } })
  await $.turn.start({ text: notice, turnId: 't1' })
  await $.prompt.submit({ text: 'Build finished', wait: false, origin: { kind: 'task-notification' } })
  await $.turn.start({ text: 'Build finished', turnId: 't2' })
  await $.turn.start({ text: 'A turn no prompt started', turnId: 't3' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('Your prompts and what Claude did will show here.')
  await ui.unmount()
})

test('a prompt opens a panel held back at start, unless the person closed it', async ($, on) => {
  let opens = 0
  let isDrawn = false
  let isClosed = false
  on('state.get', (_, e, next) =>
    e.key === 'isClosedByPerson' && isClosed ? { value: { value: true, version: 1 } } : next(e),
  )
  on('state.set', (_, e, next) => {
    if (e.key === 'isClosedByPerson') isClosed = false

    return next(e)
  })
  on('command.register', () => ({ value: { command: 'prompt-history' } }))
  on('ui.open', () => {
    opens += 1

    return { value: { isPlaced: false, reason: 'the window is narrow' } }
  })
  on('ui.panes', () => ({
    value: [{ id: 'prompt-history', title: 'Prompt history', isShown: isDrawn, isFocused: false, isPlaced: isDrawn }],
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))

  // Opened unasked, and held back.
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(opens).toBe(1)

  // Background work is nobody asking.
  await $.prompt.submit({ text: 'Build finished', wait: false, origin: { kind: 'task-notification' } })
  expect(opens).toBe(1)

  // The person's prompt asks for it.
  await $.prompt.submit({ text: 'Fix the login', wait: false, origin: { kind: 'composer' } })
  expect(opens).toBe(2)

  // Drawn: nothing more to open.
  isDrawn = true
  await $.prompt.submit({ text: 'Now the tests', wait: false, origin: { kind: 'composer' } })
  expect(opens).toBe(2)

  // Closed by hand: stays closed, across prompts and a reload. The kit can't
  // raise the person's close, so the value it leaves is answered here.
  isDrawn = false
  isClosed = true
  await $.prompt.submit({ text: 'And the docs', wait: false, origin: { kind: 'composer' } })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(opens).toBe(2)

  // Asked for again by name: back to normal.
  await $.command.run({
    command: 'prompt-history',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  })
  expect(opens).toBe(3)
  await $.prompt.submit({ text: 'One more', wait: false, origin: { kind: 'composer' } })
  expect(opens).toBe(4)
})

test('an empty history says what the panel is for', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect((await ui.find({ type: 'Text' }))?.text).toBe('Your prompts and what Claude did will show here.')
  await ui.unmount()
})
