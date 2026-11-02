import type { Register } from 'claude-code'

const FENCE = '```recap'
const FENCE_END = '```'
// Lines past this are dropped: the card stays short.
const MOST_LINES = 3

// About the chat column's own width, so the card's text keeps its size there.
const WIDTH = 760
// Wider than any chat: the surface draws a markup's width up to its slot, so
// the card takes the chat's full width and scales to it.
const MARKUP_WIDTH = 3000
const PAD = 28
const TITLE_SIZE = 18
const LINE_HEIGHT = 22
// What fits on a row at the card's text size, on the careful side.
const LINE_ROOM = 88
// Light in either theme, so the card keeps its own dark text.
const GRADIENT = ['#DCEBFF', '#E9E1FF', '#FFE3EE']
const INK = '#12263F'
const RECAP_COLOR = '#1E2A78'
const ATTENTION_COLOR = '#B4400F'
const ATTENTION_FILL = '#FFB27A'
const NEXT_COLOR = '#1F5FBF'
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

const GUIDE = `# Recap card

End the last message of your turn with this block, as the very last thing in the message. The interface draws it as a card, so never mention or explain it.

${FENCE}
Recap:
- what was done or found
Attention:
- only something important the person would be hurt by missing
Next:
- the most useful next move, as a concrete action
${FENCE_END}

- Recap: 1 to 3 lines. Next: 1 to 3 lines.
- Attention is rare: most messages have none, so leave the whole section out.
- Use Attention only for a failure, a risk to the person's work, something unverified they would assume works, or a decision only they can make. At most 3 lines.
- Never use Attention for routine steps like reloading, restarting, committing or pushing, for work simply not done yet, or for anything Next says. Those belong in Next.
- Each line is one plain sentence of at most 12 words, in the language of the message, with no markdown.
- Leave the block out of a reply of one short sentence, and of a message to another agent.
- This block replaces any other closing recap, summary or next-step line, even where another instruction asks for one. Do not write one above it.`

type Recap = { recap: string[]; attention: string[]; next: string[] }
type Section = keyof Recap

// The block counts only as the very last thing in the text, so a message
// showing the format along the way stays as written. No end yet: it is
// still being written.
function splitRecap(text: string): { body: string; block?: string } | undefined {
  const at = text.lastIndexOf(FENCE)
  if (at === -1 || (at > 0 && text[at - 1] !== '\n')) return undefined

  const rest = text.slice(at + FENCE.length)
  if (!/^[ \t]*(\n|$)/.test(rest)) return undefined

  const body = text.slice(0, at).trimEnd()
  const end = rest.indexOf(`\n${FENCE_END}`)
  if (end === -1) return { body }
  if (rest.slice(end + 1 + FENCE_END.length).trim() !== '') return undefined

  return { body, block: rest.slice(0, end) }
}

function plain(line: string): string {
  return line
    .replace(/^[-*•]\s+/, '')
    .replace(/\*\*|`/g, '')
    .trim()
}

function parseRecap(block: string): Recap | undefined {
  const recap: Recap = { recap: [], attention: [], next: [] }
  let section: Section | undefined

  for (const raw of block.split('\n')) {
    const line = raw.trim()
    const heading = /^(recap|attention|next)\s*:\s*(.*)$/i.exec(line)
    if (heading) section = heading[1]?.toLowerCase() as Section

    const item = plain(heading ? (heading[2] ?? '') : line)
    if (section && item && !/^(none|nothing|n\/a)\.?$/i.test(item) && recap[section].length < MOST_LINES) {
      recap[section].push(item)
    }
  }

  return recap.recap.length > 0 || recap.next.length > 0 ? recap : undefined
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function wrapped(text: string, room: number): string[] {
  const rows: string[] = []
  let row = ''

  for (const word of text.split(/\s+/)) {
    // A word too long for a row, a path say, is cut across rows.
    for (let start = 0; start < word.length; start += room) {
      const piece = word.slice(start, start + room)
      if (row && row.length + 1 + piece.length > room) {
        rows.push(row)
        row = piece
      } else {
        row = row ? `${row} ${piece}` : piece
      }
    }
  }

  return row ? [...rows, row] : rows
}

function cardSource(recap: Recap): string {
  const parts: string[] = []
  let y = PAD
  let isAfterCallout = false

  const section = (name: string, color: string, mark: string, items: string[], isCallout = false) => {
    if (items.length === 0) return
    if (parts.length > 0) {
      y += 16
      if (!isCallout && !isAfterCallout) {
        parts.push(`<line x1="${PAD}" y1="${y}" x2="${WIDTH - PAD}" y2="${y}" stroke="${INK}" stroke-opacity="0.12"/>`)
      }
      y += 10
    }

    const first = parts.length
    const top = y

    y += TITLE_SIZE
    parts.push(`<text x="${PAD}" y="${y}" font-size="${TITLE_SIZE}" font-weight="700" fill="${color}">${name}</text>`)
    y += 6

    for (const item of items) {
      wrapped(item, LINE_ROOM).forEach((row, i) => {
        y += LINE_HEIGHT
        if (i === 0) parts.push(`<text x="${PAD}" y="${y}" font-size="15" font-weight="700" fill="${color}">${mark}</text>`)
        parts.push(`<text x="${PAD + 18}" y="${y}" font-size="15" fill="${INK}">${escapeXml(row)}</text>`)
      })
    }

    if (isCallout) {
      y += 8
      // Painted behind its text, so it goes in ahead of what it holds.
      parts.splice(
        first,
        0,
        `<rect x="${PAD - 12}" y="${top - 8}" width="${WIDTH - 2 * (PAD - 12)}" height="${y - top + 8}" rx="12" fill="${ATTENTION_FILL}" fill-opacity="0.22" stroke="${ATTENTION_COLOR}" stroke-opacity="0.25"/>`,
      )
    }
    isAfterCallout = isCallout
  }

  section('Recap', RECAP_COLOR, '•', recap.recap)
  section('Attention', ATTENTION_COLOR, '•', recap.attention, true)
  section('Next', NEXT_COLOR, '→', recap.next)

  const height = y + PAD
  const stops = GRADIENT.map((color, i) => `<stop offset="${i / (GRADIENT.length - 1)}" stop-color="${color}"/>`).join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${MARKUP_WIDTH}" height="${Math.round((MARKUP_WIDTH * height) / WIDTH)}" viewBox="0 0 ${WIDTH} ${height}" font-family="${FONT}">` +
    `<defs><linearGradient id="card" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient></defs>` +
    `<rect x="1" y="1" width="${WIDTH - 2}" height="${height - 2}" rx="20" fill="url(#card)" stroke="${INK}" stroke-opacity="0.1"/>` +
    parts.join('') +
    '</svg>'
  )
}

function cardAlt(recap: Recap): string {
  return [
    ['Recap', recap.recap],
    ['Attention', recap.attention],
    ['Next', recap.next],
  ]
    .filter(([, items]) => items?.length)
    .map(([name, items]) => `${name}: ${(items as string[]).join(' ')}`)
    .join(' ')
}

export const register: Register = on => {
  // Sent with each prompt: the desktop app's system prompt doesn't carry a
  // section added at `prompt.compose`.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    const result = await next(e)
    // With nothing drawing, as under `claude -p`, a card would be raw text.
    if ((await $.session.surfaces()).length === 0) return result

    return { ...result, additionalContext: [...(result.additionalContext ?? []), GUIDE] }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary) return next(e)

    const split = splitRecap(e.props.text)
    if (!split) return next(e)

    const recap = split.block === undefined ? undefined : parseRecap(split.block)
    // A closed block that holds no recap isn't one of ours.
    if (split.block !== undefined && !recap) return next(e)

    const body = split.body ? await next({ ...e, props: { ...e.props, text: split.body } }) : undefined

    // A picture scaled to a phone's or an editor panel's width has tiny text,
    // and a terminal draws none: these get the same card in real text.
    if (e.surface !== 'desktop') {
      const { Box, Text } = $.ui.resolve(e)

      return (
        <Box flexDirection="column">
          {body}
          {recap ? (
            <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1} marginTop={1}>
              {recap.recap.length > 0 && (
                <Text weight="bold" color="claude">
                  Recap
                </Text>
              )}
              {recap.recap.map(line => (
                <Text wrap="wrap">• {line}</Text>
              ))}
              {recap.attention.length > 0 && (
                <Text weight="bold" color="warning">
                  Attention
                </Text>
              )}
              {recap.attention.map(line => (
                <Text wrap="wrap">• {line}</Text>
              ))}
              {recap.next.length > 0 && (
                <Text weight="bold" color="suggestion">
                  Next
                </Text>
              )}
              {recap.next.map(line => (
                <Text wrap="wrap">→ {line}</Text>
              ))}
            </Box>
          ) : (
            <Text dimColor>Writing recap…</Text>
          )}
        </Box>
      )
    }

    const { Box, Svg, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {body}
        {recap ? (
          <Box flexDirection="column" width="100%" marginTop={1}>
            <Svg source={cardSource(recap)} alt={cardAlt(recap)} />
          </Box>
        ) : (
          <Text dimColor>Writing recap…</Text>
        )}
      </Box>
    )
  })
}
