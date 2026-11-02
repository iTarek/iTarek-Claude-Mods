import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const FENCE = '```'

function message(text: string) {
  return {
    plugin: 'recap-card',
    component: 'AssistantMessage',
    requestId: 'm1',
    props: { text, isFirstOfReply: true },
  } as const
}

function block(lines: string[]): string {
  return [`${FENCE}recap`, ...lines, FENCE].join('\n')
}

// Nothing sits beneath the plugin: this hook stands for the engine's own row.
function drawsTheReply(on: On) {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>{e.props.text}</Text>
  })
}

const FULL = block(['Recap:', '- Fixed the login crash.', 'Attention:', '- Not tried on a device.', 'Next:', '- Try it, then commit.'])

test('a recap at the end of a message draws as a gradient card under the reply', async ($, on) => {
  drawsTheReply(on)

  const ui = await $.ui.mount({ ...message(`The crash is gone.\n\n${FULL}`), surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /crash is gone/ }))?.text).toBe('The crash is gone.')
  expect(await ui.find({ type: 'Text', text: /recap/ })).toBeUndefined()

  const card = await ui.find({ type: 'Svg' })
  expect(card?.props.alt).toBe('Recap: Fixed the login crash. Attention: Not tried on a device. Next: Try it, then commit.')
  const source = String(card?.props.source)
  expect(source).toContain('linearGradient')
  expect(source).toContain('rx="20"')
  for (const word of ['>Recap<', '>Attention<', '>Next<', 'Fixed the login crash.', 'Try it, then commit.']) {
    expect(source).toContain(word)
  }
  // The three titles share one size, and Attention alone sits on a callout.
  const titleSizes = [...source.matchAll(/font-size="(\d+)"[^>]*>(?:Recap|Attention|Next)</g)].map(title => title[1])
  expect(titleSizes).toEqual(['18', '18', '18'])
  expect(source.match(/fill="#FFB27A"/g)).toHaveLength(1)
  await ui.unmount()
})

test('surfaces other than the desktop draw the same titles in real text', async ($, on) => {
  drawsTheReply(on)

  for (const surface of ['terminal', 'mobile', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...message(`Done.\n\n${FULL}`), surface })

    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    for (const title of [/^Recap$/, /^Attention$/, /^Next$/]) expect(await ui.find({ type: 'Text', text: title })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /login crash/ }))?.text).toBe('• Fixed the login crash.')
    await ui.unmount()
  }
})

test('the card asks for more width than any chat, keeping its proportions', async ($, on) => {
  drawsTheReply(on)

  const ui = await $.ui.mount({ ...message(FULL), surface: 'desktop' })
  const source = String((await ui.find({ type: 'Svg' }))?.props.source)
  const root = /width="(\d+)" height="(\d+)" viewBox="0 0 (\d+) (\d+)"/.exec(source)

  expect(root?.[1]).toBe('3000')
  expect(root?.[3]).toBe('760')
  expect(root?.[2]).toBe(String(Math.round((3000 * Number(root?.[4])) / 760)))
  await ui.unmount()
})

test('Attention is left out when nothing needs attention', async ($, on) => {
  drawsTheReply(on)

  for (const lines of [
    ['Recap:', '- Renamed the app.', 'Next:', '- Commit it.'],
    ['Recap:', '- Renamed the app.', 'Attention:', '- None.', 'Next:', '- Commit it.'],
  ]) {
    const ui = await $.ui.mount({ ...message(block(lines)), surface: 'desktop' })

    const source = String((await ui.find({ type: 'Svg' }))?.props.source)
    expect(source).not.toContain('Attention')
    expect(source).not.toContain('#FFB27A')
    await ui.unmount()
  }
})

test('a section keeps its first three lines', async ($, on) => {
  drawsTheReply(on)

  const ui = await $.ui.mount({ ...message(block(['Recap:', '- one', '- two', '- three', '- four'])), surface: 'desktop' })

  expect((await ui.find({ type: 'Svg' }))?.props.alt).toBe('Recap: one two three')
  await ui.unmount()
})

test('a block still being written is hidden until it closes', async ($, on) => {
  drawsTheReply(on)

  const ui = await $.ui.mount({ ...message(`Done.\n\n${FENCE}recap\nRecap:\n- Fixed`), surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /^Done/ }))?.text).toBe('Done.')
  expect(await ui.find({ type: 'Text', text: /Fixed/ })).toBeUndefined()
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Writing recap/ })).toBeDefined()
  await ui.unmount()
})

test('a block in the middle of a message stays as written', async ($, on) => {
  drawsTheReply(on)
  const text = `Here is the format:\n\n${FULL}\n\nThat is all.`

  const ui = await $.ui.mount({ ...message(text), surface: 'desktop' })

  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /That is all/ }))?.text).toBe(text)
  await ui.unmount()
})

test('text from the model cannot become markup in the card', async ($, on) => {
  drawsTheReply(on)

  const ui = await $.ui.mount({
    ...message(block(['Recap:', '- <script>alert("x")</script> & more'])),
    surface: 'desktop',
  })
  const source = String((await ui.find({ type: 'Svg' }))?.props.source)

  expect(source).not.toContain('<script>')
  expect(source).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; more')
  await ui.unmount()
})

test('a long line wraps across rows of the card', async ($, on) => {
  drawsTheReply(on)
  const long = 'word '.repeat(40).trim()

  const ui = await $.ui.mount({ ...message(block(['Recap:', `- ${long}`])), surface: 'desktop' })
  const source = String((await ui.find({ type: 'Svg' }))?.props.source)
  const rows = [...source.matchAll(/fill="#12263F">([^<]*)<\/text>/g)].map(row => row[1] ?? '')

  expect(rows.length).toBeGreaterThan(1)
  expect(rows.join(' ')).toBe(long)
  for (const row of rows) expect(row.length).toBeLessThanOrEqual(88)
  await ui.unmount()
})

test('each prompt asks for the block, where something can draw it', async ($, on) => {
  let surfaces: 'desktop'[] = ['desktop']
  on('session.surfaces', () => ({ value: surfaces }))
  on('classic.UserPromptSubmit', () => ({ additionalContext: ['from another hook'] }))

  const drawn = await $.classic.UserPromptSubmit({ prompt: 'Fix the login' })
  expect(drawn.additionalContext?.[0]).toBe('from another hook')
  expect(drawn.additionalContext?.[1]).toContain(`${FENCE}recap`)
  expect(drawn.additionalContext?.[1]).toContain('Attention is rare')

  surfaces = []
  const headless = await $.classic.UserPromptSubmit({ prompt: 'Fix the login' })
  expect(headless.additionalContext).toEqual(['from another hook'])
})
