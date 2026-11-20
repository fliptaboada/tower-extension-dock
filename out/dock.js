// The dock: a rail of every renderer the tower serves beside a stage that holds them. Each renderer opens in a frame of
// its own at the tower's origin, as it runs opened alone. For now only the one shown runs: the others' frames close
// (`close`), each renderer's hash kept so it opens again where it was.
//
// Below the renderers, the pins: shelf entries the settings name by floor and label. A page is framed as the tower
// page's shelf view frames it, at an opaque origin with the relay; markdown opens in the renderer that hosts views; a
// link opens a tab. Each pinned file is followed (`tower.versions`), and a pin whose file changed since the viewer last
// opened it carries a dot; the one shown is loaded again in place.
//
// The address is the dock's: `#<renderer>`, or `#<renderer>/<that renderer's own hash>` once the dock moved it there;
// a pin's is `#@<floor>:<label>`.
//
// Pure functions first, over plain data; the frames, the rail and the listeners after them.
import { hashOf } from '/lib/layout.js'
import { settingsOf } from '/lib/board.js'
import { rendererUrl, shelfKind, shelfPage, shelfSource } from '/lib/cards.js'
import { brokenExtensions, extensionsListHtml, extensionsSummary } from '/lib/extensions-panel.js'
import { panelsCss } from '/lib/view.js'

/** @typedef {{ name: string, available: boolean, root: string, entry: string, from?: string, kit?: string[] }} Renderer */
/** @typedef {Parameters<typeof hashOf>[0]} Location */
/** @typedef {{ floor: string, label: string, initials?: string, color?: string }} PinSetting */
/** @typedef {{ home?: string, order: string[], hidden: string[], pins: PinSetting[], marks: Record<string, { initials?: string, color?: string, label?: string }> }} Settings */
/** @typedef {import('/lib/board.js').Floor} Floor */
/** @typedef {import('/lib/board.js').ShelfEntry} ShelfEntry */
/**
 * A pin's shelf entry where the board has it: its floor, its index on that floor's shelf, how it opens (`shelfKind`)
 * and where it comes from.
 * @typedef {{ floor: string, floorName: string, n: number, kind: ReturnType<typeof shelfKind>, source: string, entry: ShelfEntry }} PinTarget
 */
/** @typedef {{ name: string, label: string, initials: string, color: string, available: boolean, why: string, pin?: PinTarget }} Mark */

/** The extension's id: its settings' key in the config. */
const ID = 'dock'

/** The names the core's own renderers go by: theirs are fixed, so a word for each is no guess. */
const CORE_LABELS = /** @type {Record<string, string>} */ ({ page: 'Tower page', week: 'The Week', tower3d: 'Tower 3D' })

/**
 * What a renderer is called on the rail: the setting, else the extension's title it came from (with the renderer's own
 * part of a `<cap>.<name>`), else the core's word for it, else its name.
 * @param {Renderer} r @param {Settings} settings @param {Record<string, string>} titles the extensions' titles, by capability
 */
export const labelOf = (r, settings, titles) => {
  const set = settings.marks[r.name]?.label
  if (set) return set
  const title = r.from ? titles[r.from] : undefined
  if (title) return r.name === r.from ? title : `${title} · ${r.name.slice(/** @type {string} */ (r.from).length + 1)}`
  return CORE_LABELS[r.name] ?? r.name
}

const DEFAULTS = /** @type {Settings} */ ({ order: [], hidden: [], pins: [], marks: {} })

/** FNV-1a over the name: the same name gets the same colour on every load and in every window. @param {string} text */
const hashText = (text) => {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return h >>> 0
}

/** Two letters for a name: the heads of its first two words (`tower-3d` → `T3`), else its first two (`page` → `Pa`). @param {string} name */
export const initialsOf = (name) => {
  const words = name.split(/[-_.\s]+/).filter(Boolean)
  const two = words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)
  return two[0].toUpperCase() + two.slice(1)
}

/** A colour for a name, one of a ring of hues at one lightness and chroma, so no mark shouts over another. @param {string} name */
export const colorOf = (name) => `oklch(0.74 0.11 ${hashText(name) % 360})`

/**
 * The rail's marks: the renderers the tower serves less the dock itself and the hidden, the ordered first.
 * @param {Renderer[]} renderers @param {string} self @param {Settings} settings @param {Record<string, string>} titles @returns {Mark[]}
 */
export const marksOf = (renderers, self, settings, titles) => {
  const shown = renderers.filter((r) => r.name !== self && !settings.hidden.includes(r.name))
  const rank = (/** @type {Renderer} */ r) => (settings.order.includes(r.name) ? settings.order.indexOf(r.name) : settings.order.length)
  return shown
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map(({ r }) => ({
      name: r.name,
      label: labelOf(r, settings, titles),
      initials: settings.marks[r.name]?.initials ?? initialsOf(r.name),
      color: settings.marks[r.name]?.color ?? colorOf(r.name),
      available: r.available,
      why: r.available ? '' : `not built: ${r.root}/${r.entry} doesn't exist`,
    }))
}

/** A pin's name on the rail and in the address: its floor and its label, the label escaped so it holds no `/`. */
export const pinName = (/** @type {string} */ floor, /** @type {string} */ label) => `@${floor}:${encodeURIComponent(label)}`

/**
 * The pins' marks, in the settings' order: each found on its floor's shelf by label, or unavailable, saying what it
 * looked for, when the floor or the entry is gone.
 * @param {PinSetting[]} pins @param {Floor[]} floors @returns {Mark[]}
 */
export const pinMarksOf = (pins, floors) =>
  pins.map((p) => {
    const floor = floors.find((f) => f.id === p.floor)
    const n = floor?.shelf?.findIndex((e) => e.label === p.label) ?? -1
    const base = { name: pinName(p.floor, p.label), label: p.label, initials: p.initials ?? initialsOf(p.label), color: p.color ?? colorOf(p.label) }
    if (!floor || n < 0) return { ...base, available: false, why: floor ? `${floor.name}'s shelf has no "${p.label}"` : `no floor "${p.floor}"` }
    const entry = /** @type {ShelfEntry} */ (floor.shelf?.[n])
    return { ...base, available: true, why: '', pin: { floor: floor.id, floorName: floor.name, n, kind: shelfKind(entry), source: shelfSource(entry), entry } }
  })

/** What a pin's frame and watch stand on: a change to any of it opens and follows the entry afresh. @param {PinTarget} t */
export const pinKey = (t) => JSON.stringify([t.floor, t.n, t.kind, t.source])

/** A shelf file's path under its entry, as `/shelf/<project>/<n>/<file>` and its read name it, each part escaped. */
export const shelfFilePath = (/** @type {PinTarget} */ t, /** @type {string} */ file) => `shelf/${t.floor}/${t.n}/${file.split('/').map(encodeURIComponent).join('/')}`

/** The file an `html` entry's page or an item is, under its entry: the one file such a pin follows. */
export const pageOf = (/** @type {PinTarget} */ t) => shelfPage(t.entry)

/** How long ago `at` was, in a few words. @param {number} at @param {number} now */
export const agoWords = (at, now) => {
  const min = Math.floor((now - at) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  if (min < 24 * 60) return `${Math.floor(min / 60)} h ago`
  return `${Math.floor(min / (24 * 60))} d ago`
}

/**
 * The config edit that makes the dock's pins `pins`, given the config as written (`GET /config`): set while it holds
 * them, added (with the objects on the way) while it doesn't.
 * @param {any} raw @param {PinSetting[]} pins
 */
export const pinWrite = (raw, pins) => {
  const key = ['extensions', ID, 'settings', 'pins']
  const had = raw?.extensions?.[ID]?.settings?.pins
  return had === undefined ? { verb: 'config/add', body: { key, value: pins } } : { verb: 'config/set', body: { key, value: pins, was: had } }
}

/**
 * Where a framed page's move of the tower's view lands in the renderer that hosts views: that renderer's hash, or
 * undefined for a subject displayed with no view, which no hash names without the renderer's own placing (a card's
 * short form excepted).
 * @param {string | { key: string }} subject @param {string | undefined} view
 */
export const displayHash = (subject, view) => {
  const key = typeof subject === 'string' ? subject : subject.key
  if (view) return hashOf({ view, subject: key }).slice(1)
  if (key.startsWith('card:')) return key.slice('card:'.length)
  return undefined
}

/** The renderer the dock opens on: the setting, else the tower's default unless that is the dock, else `page`. */
export const homeOf = (/** @type {Mark[]} */ marks, /** @type {Settings} */ settings, /** @type {string} */ towerDefault) =>
  [settings.home, towerDefault, 'page', marks[0]?.name].find((n) => n && marks.some((m) => m.name === n && m.available))

/** The dock's address, split: the renderer it names and that renderer's own hash. @param {string} hash */
export const addressOf = (hash) => {
  const body = hash.replace(/^#/, '')
  const at = body.indexOf('/')
  return at < 0 ? { name: body, inner: undefined } : { name: body.slice(0, at), inner: body.slice(at + 1) }
}

// ── The shell ────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The tower loaded in one of a dock's frames, by a renderer's link to `/` (The Week's "← the tower") while the dock is
 * the tower's default: this frame holds no renderer, so this dock says so to the dock framing it, which opens its home in
 * this frame's place, and draws nothing.
 */
const NESTED = 'dock/nested'
if (window.parent !== window) {
  window.parent.postMessage({ t: NESTED }, '*')
  throw new Error('dock: loaded inside a dock, which opens its home in this frame\'s place')
}

const rail = /** @type {HTMLElement} */ (document.querySelector('.rail'))
const marksEl = /** @type {HTMLElement} */ (document.querySelector('.rail .marks'))
const stage = /** @type {HTMLElement} */ (document.querySelector('.stage'))
const self = (await tower.renderer())?.name ?? 'dock'

/** @type {{ renderers: Renderer[], default: string }} */
let served = await tower.get('renderers')
let settings = DEFAULTS
/** The extensions' titles by capability, as the board has them, for the labels. @type {Record<string, string>} */
let titles = {}
/** The floors as the latest board has them, for the pins and the picker. @type {Floor[]} */
let floors = []
/** The rail's marks: the renderers, then the pins. */
const railOf = () => [...marksOf(served.renderers, self, settings, titles), ...pinMarksOf(settings.pins, floors)]
let marks = railOf()

/**
 * Each mark opened, by name: its frame, the URL it loaded at, its hash as the dock last set it (a renderer's), and the
 * relay that holds it (a pinned page's).
 * @type {Map<string, { frame: HTMLIFrameElement, base: string, inner: string, relay?: { close(): void } }>}
 */
const open = new Map()
let current = ''

/** The renderer that hosts views (its kit lends `go`): the home one where it does, else the first that does. */
const host = () => {
  const hosts = served.renderers.filter((r) => r.kit?.includes('go') && marks.some((m) => m.name === r.name && m.available))
  const home = homeOf(marks, settings, served.default)
  return hosts.find((r) => r.name === home)?.name ?? hosts[0]?.name
}

/** The renderer that hosts views shown at `inner`, its own hash, or as it is when undefined. @param {string | undefined} inner */
const toHost = (inner) => {
  const to = host()
  if (!to) return console.warn('dock: no renderer that hosts views to show this in')
  show(to, inner)
}

/** A location (views.ts) shown in the renderer that hosts views. @param {Location} location */
const go = (location) => toHost(hashOf(location).slice(1))

/** A floor's shelf entry in the shelf view of the renderer that hosts views, as a markdown pin opens. */
const shelfView = (/** @type {string} */ project, /** @type {number} */ n) => go({ view: 'tower/shelf', subject: `shelf:${project}/${n}` })

/** A floor's shelf entry a framed page opens: its pin where the dock frames one, else the shelf view. */
const openShelf = (/** @type {string} */ project, /** @type {number} */ n) => {
  const pinned = marks.find((m) => m.pin?.floor === project && m.pin.n === n && framedHere(m))
  if (pinned) return show(pinned.name)
  shelfView(project, n)
}

/** Whether the dock frames this mark: a renderer or a pinned page, not a markdown pin or a link. */
const framedHere = (/** @type {Mark} */ m) => m.available && m.pin?.kind !== 'md' && m.pin?.kind !== 'link'

/** A pinned page's moves of the tower's view, as the tower page's shelf view takes them, landing in the host. */
const ui = {
  select: (/** @type {{ id: string }} */ { id }) => toHost(id),
  home: () => toHost(''),
  shelf: (/** @type {{ project: string, n: number }} */ { project, n }) => openShelf(project, n),
  go: (/** @type {{ location: Location }} */ { location }) => go(location),
  display: (/** @type {{ subject: string | { key: string }, view?: string }} */ { subject, view }) => toHost(displayHash(subject, view)),
}

/** A sandbox that keeps a framed page from navigating the dock away; same-origin for a renderer of the rail. */
const SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-pointer-lock'

/** A pinned page loaded into its frame: an `html` entry's page or an item's file, or a renderer, relayed. @param {PinTarget} t */
const pinUrl = (t) => (t.kind === 'renderer' ? rendererUrl(/** @type {{ renderer: string }} */ (t.entry).renderer) : `/${shelfFilePath(t, pageOf(t))}`)

/**
 * The mark's frame, made the first time it is opened.
 *
 * A renderer of the rail runs at the tower's origin, as it does opened alone, so it calls the routes itself: a view's
 * document frame inherits this sandbox, and at an opaque origin the view could not reach into it to draw (decision
 * `markdown-safe`).
 *
 * A pinned page is framed as the tower page's shelf view frames it: an `html` entry's page, an item's or a renderer at
 * an opaque origin, given the board and the API by the relay; a `url` page as it is, told the scheme.
 * @param {Mark} m
 */
const frameOf = (m) => {
  const had = open.get(m.name)
  if (had) return had
  stage.querySelector('.empty')?.remove()
  const frame = document.createElement('iframe')
  frame.title = m.label
  stage.append(frame)
  const t = m.pin
  /** @type {{ frame: HTMLIFrameElement, base: string, inner: string, relay?: { close(): void } }} */
  let made
  if (!t) {
    frame.setAttribute('sandbox', `${SANDBOX} allow-same-origin`)
    frame.setAttribute('allow', 'clipboard-write')
    made = { frame, base: rendererUrl(m.name), inner: '' }
    frame.src = made.base
  } else if (t.kind === 'url') {
    const url = /** @type {{ url: string }} */ (t.entry).url
    frame.setAttribute('allow', 'clipboard-read; clipboard-write')
    frame.addEventListener('load', () => frame.contentWindow?.postMessage({ t: 'scheme', scheme: tower.prefs.get().scheme }, '*'))
    made = { frame, base: url, inner: '' }
    frame.src = url
  } else {
    frame.setAttribute('sandbox', SANDBOX)
    frame.setAttribute('allow', 'clipboard-write')
    const base = pinUrl(t)
    made = { frame, base, inner: '', relay: tower.relay(frame, base, { self: { project: t.floor, n: t.n }, ui, stored: () => {} }) }
  }
  open.set(m.name, made)
  return made
}

/** A pinned page loaded again in place, its file having changed while it is open. @param {Mark} m */
const reload = (m) => {
  const f = open.get(m.name)
  if (!f || !m.pin) return
  if (!f.relay) return void (f.frame.src = f.base)
  f.relay.close()
  f.relay = tower.relay(f.frame, f.base, { self: { project: m.pin.floor, n: m.pin.n }, ui, stored: () => {} })
}

/**
 * Shows a mark. A renderer moves to its own hash when `inner` names one: a frame already loaded moves in place, with
 * no reload, since only its hash changes. A markdown pin opens in the renderer that hosts views, a link in a tab of
 * its own; either is seen as it opens.
 * @param {string} name @param {string} [inner]
 */
const show = (name, inner) => {
  const m = /** @type {Mark} */ (marks.find((x) => x.name === name))
  if (m.pin?.kind === 'md') return void (saw(name), shelfView(m.pin.floor, m.pin.n))
  if (m.pin?.kind === 'link') return void (saw(name), window.open(/** @type {{ link: string }} */ (m.pin.entry).link, '_blank', 'noopener'), draw())
  if (m.pin) saw(name)
  const f = frameOf(m)
  if (m.pin) inner = undefined
  else inner ??= left.get(name)
  if (inner !== undefined && inner !== f.inner) {
    f.inner = inner
    f.frame.src = `${f.base}#${inner}`
  }
  current = name
  for (const [n, o] of open) o.frame.classList.toggle('on', n === name)
  for (const n of [...open.keys()]) if (n !== name) close(n)
  f.frame.focus()
  const address = `#${name}${f.inner ? `/${f.inner}` : ''}`
  if (location.hash !== address) history.replaceState(null, '', address)
  draw()
}

/**
 * Where each renderer was when the dock closed its frame: its own hash, read from its frame at the tower's origin, so
 * opening it again lands there.
 * @type {Map<string, string>}
 */
const left = new Map()

/**
 * A mark's frame closed as another is shown. For now the dock keeps only the one shown: each renderer at the tower's
 * origin holds connections of its own (its board, its streams), and several running at once exhaust what the browser
 * allows the origin. A renderer's hash is kept for its return; a pinned page opens afresh.
 * @param {string} name
 */
const close = (name) => {
  const f = /** @type {{ frame: HTMLIFrameElement }} */ (open.get(name))
  if (!name.startsWith('@')) left.set(name, /** @type {Window} */ (f.frame.contentWindow).location.hash.slice(1))
  drop(name)
}

/** The renderer gone from the rail (hidden, or the tower serves it no longer): its frame closed. @param {string} name */
const drop = (name) => {
  const f = open.get(name)
  if (!f) return
  f.relay?.close()
  f.frame.remove()
  open.delete(name)
}

const draw = () => {
  const firstPin = marks.findIndex((m) => m.name.startsWith('@'))
  marksEl.replaceChildren(
    ...marks.flatMap((m, i) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = ['mark', open.has(m.name) && 'alive', m.name.startsWith('@') && 'pin', m.pin?.kind === 'link' && 'link', freshOf(m.name) && 'fresh'].filter(Boolean).join(' ')
      b.dataset.name = m.name
      b.textContent = m.initials
      b.style.setProperty('--hue', m.color)
      b.style.setProperty('--on-hue', 'oklch(0.22 0.03 0)')
      // aria-disabled, not disabled: a disabled button hears no pointer, and its tooltip says why it can't open.
      if (!m.available) b.setAttribute('aria-disabled', 'true')
      b.setAttribute('aria-label', m.label)
      if (i < 9 && m.available) b.setAttribute('aria-keyshortcuts', `Control+${i + 1}`)
      if (m.name === current) b.setAttribute('aria-current', 'page')
      if (i !== firstPin) return [b]
      const divider = document.createElement('div')
      divider.className = 'divider'
      divider.setAttribute('role', 'separator')
      return [divider, b]
    }),
  )
  if (tipFor) tipOn(tipFor)
}

// The rail's tooltips: drawn by the dock, so they show the moment a control on the rail is hovered or focused, beside
// the rail and over the stage. A mark's label and its chord, or why it can't open; a tool's name.
const tip = document.createElement('div')
tip.className = 'tip'
tip.id = 'dock-tip'
tip.setAttribute('role', 'tooltip')
tip.hidden = true
document.body.append(tip)
/** The control the tooltip is on. @type {HTMLElement | undefined} */
let tipEl
/** The renderer whose mark it is on, if a mark: a redraw puts it back on the new mark. @type {string | undefined} */
let tipFor

/**
 * The tooltip beside `el`, level with it: `label`, then `extra` as a chord (`kbd`) or a reason, and `lines` under it,
 * each with its class.
 */
const tipAt = (/** @type {HTMLElement} */ el, /** @type {string} */ label, /** @type {{ kbd?: string, why?: string, lines?: [string, string][] }} */ extra = {}) => {
  tipEl?.removeAttribute('aria-describedby')
  tipEl = el
  const name = document.createElement('span')
  name.textContent = label
  const more = extra.kbd ? Object.assign(document.createElement('kbd'), { textContent: extra.kbd })
    : extra.why ? Object.assign(document.createElement('span'), { className: 'why', textContent: extra.why }) : undefined
  const lines = (extra.lines ?? []).map(([text, className]) => Object.assign(document.createElement('small'), { textContent: text, className }))
  tip.replaceChildren(name, ...(more ? [more] : []), ...lines)
  const r = el.getBoundingClientRect()
  tip.style.top = `${r.top + r.height / 2}px`
  tip.style.left = `${rail.getBoundingClientRect().right + 6}px`
  tip.hidden = false
  el.setAttribute('aria-describedby', tip.id)
}

/** The tooltip on a renderer's mark. @param {string} name */
const tipOn = (name) => {
  const i = marks.findIndex((m) => m.name === name)
  const b = /** @type {HTMLElement | null} */ (marksEl.querySelector(`button[data-name="${CSS.escape(name)}"]`))
  if (i < 0 || !b) return tipOff()
  const m = marks[i]
  tipFor = name
  tipAt(b, m.label, { ...(m.available ? (i < 9 ? { kbd: `⌃${i + 1}` } : {}) : { why: m.why }), lines: m.pin ? pinLines(m.name, m.pin) : [] })
}

/** What a pin's tooltip says under its name: when its file last changed, and what it is. @returns {[string, string][]} */
const pinLines = (/** @type {string} */ name, /** @type {PinTarget} */ t) => {
  const at = latestOf(name)
  const when = at === undefined ? [] : freshOf(name) ? [[`updated ${agoWords(at, Date.now())}, since you last looked`, 'ago']] : [[`updated ${agoWords(at, Date.now())}`, '']]
  const what = t.kind === 'link' ? 'opens a new tab' : `${t.floorName} shelf · ${t.kind} · ${t.source}`
  return /** @type {[string, string][]} */ ([...when, [what, '']])
}
const tipOff = () => {
  tipEl?.removeAttribute('aria-describedby')
  tipEl = tipFor = undefined
  tip.hidden = true
}
/** What a tooltip shows for a control on the rail: a mark's by its renderer, a tool's by its name. */
const tipFrom = (/** @type {HTMLElement} */ el) => {
  if (el.classList.contains('mark')) return tipOn(/** @type {string} */ (el.dataset.name))
  if (el.getAttribute('aria-expanded') === 'true') return tipOff()
  tipFor = undefined
  tipAt(el, /** @type {string} */ (el.getAttribute('aria-label')))
}
const controlOf = (/** @type {EventTarget | null} */ t) => /** @type {HTMLElement | null} */ (t instanceof Element ? t.closest('.mark, .tool') : null)
rail.addEventListener('pointerover', (e) => {
  const c = controlOf(e.target)
  if (c) tipFrom(c)
})
rail.addEventListener('pointerout', (e) => {
  if (controlOf(e.target) && !controlOf(/** @type {PointerEvent} */ (e).relatedTarget)) tipOff()
})
rail.addEventListener('pointerleave', tipOff)
rail.addEventListener('focusin', (e) => {
  const c = controlOf(e.target)
  if (c?.matches(':focus-visible')) tipFrom(c)
})
rail.addEventListener('focusout', tipOff)
addEventListener('keydown', (e) => { if (e.key === 'Escape' && tipEl) tipOff() })
addEventListener('blur', tipOff)

// The rail's tools: each a button at the foot that opens a popover beside the rail, its foot level with the button. One
// is open at a time; Escape, a press elsewhere (a frame included, which takes the window's focus) or an act closes it.
/** @type {{ btn: HTMLElement, pop: HTMLElement }[]} */
const tools = []
/** @param {string} btnId @param {string} popId @param {() => void} [opened] what to paint as it opens */
const toolOf = (btnId, popId, opened) => {
  const btn = /** @type {HTMLElement} */ (document.getElementById(btnId))
  const pop = /** @type {HTMLElement} */ (document.getElementById(popId))
  const tool = { btn, pop }
  tools.push(tool)
  btn.addEventListener('click', () => (pop.hidden ? toolOpen(tool, opened) : toolClose(tool, false)))
  return tool
}
const toolOpen = (/** @type {{ btn: HTMLElement, pop: HTMLElement }} */ tool, /** @type {(() => void) | undefined} */ opened) => {
  for (const t of tools) toolClose(t, false)
  tipOff()
  opened?.()
  const r = tool.btn.getBoundingClientRect()
  tool.pop.style.left = `${rail.getBoundingClientRect().right + 6}px`
  tool.pop.style.bottom = `${innerHeight - r.bottom}px`
  tool.pop.hidden = false
  tool.btn.setAttribute('aria-expanded', 'true')
  tool.pop.querySelector('button')?.focus()
}
const toolClose = (/** @type {{ btn: HTMLElement, pop: HTMLElement }} */ tool, /** @type {boolean} */ refocus) => {
  if (tool.pop.hidden) return
  tool.pop.hidden = true
  tool.btn.setAttribute('aria-expanded', 'false')
  if (refocus) tool.btn.focus()
}
/** Every tool's popover closed: `refocus` puts focus back on the button of the one that was open. */
const popClose = (/** @type {boolean} */ refocus) => tools.forEach((t) => toolClose(t, refocus && !t.pop.hidden))
addEventListener('keydown', (e) => { if (e.key === 'Escape') popClose(true) })
addEventListener('pointerdown', (e) => {
  const at = /** @type {Node} */ (e.target)
  for (const t of tools) if (!t.pop.contains(at) && !t.btn.contains(at)) toolClose(t, false)
})
addEventListener('blur', () => popClose(false))

// The config, as the tower page keeps its path at the foot of its sidebar: the path, and the same two acts on it, in the
// user's editor and in Finder (`edit`, `reveal`).
const said = /** @type {HTMLElement} */ (document.getElementById('config-said'))
/** The config's path, as the latest board names it. */
let configPath = ''
const config = toolOf('config-btn', 'config-pop', () => (said.hidden = true))
config.pop.addEventListener('click', async (e) => {
  const b = /** @type {Element} */ (e.target).closest('button[data-verb]')
  if (!(b instanceof HTMLButtonElement)) return
  try {
    await tower.call(/** @type {'edit' | 'reveal'} */ (b.dataset.verb), { path: configPath })
    popClose(false)
  } catch (/** @type {any} */ err) {
    said.textContent = err.message
    said.hidden = false
  }
})

// The extensions, as the tower page lists them at the foot of its sidebar (`/lib/extensions-panel.js`): every one with
// its state and problems, those that should run and don't first. A row, or the full panel, opens the core's
// Extensions view in the renderer that hosts views. The button carries a dot while one is broken, and no count.
const EXTENSIONS_VIEW = 'tower/extensions'
const extBtn = /** @type {HTMLElement} */ (document.getElementById('ext-btn'))
const extList = /** @type {HTMLElement} */ (document.getElementById('ext-list'))
const extSummary = /** @type {HTMLElement} */ (document.getElementById('ext-summary'))
const extAlert = /** @type {HTMLElement} */ (extBtn.querySelector('.alert'))
/** @type {import('/lib/board.js').Board['extensions']} */
let extensions = []
let listed = ''
/**
 * The shared list's rows, given what the dock shows beside it: each one's state, so a running one's lamp is green
 * rather than the list's quiet grey, and its version after its title.
 */
const dressRows = () => {
  const byId = new Map(extensions.map((e) => [e.id, e]))
  for (const row of /** @type {NodeListOf<HTMLElement>} */ (extList.querySelectorAll('.extension-row[data-extension]'))) {
    const e = /** @type {(typeof extensions)[number]} */ (byId.get(/** @type {string} */ (row.dataset.extension)))
    row.dataset.state = e.state
    if (!e.version) continue
    const version = document.createElement('span')
    version.className = 'version'
    version.textContent = e.version
    row.querySelector('.line b')?.after(version)
  }
}
const paintExtensions = () => {
  const html = extensionsListHtml(extensions)
  if (html !== listed) {
    extList.innerHTML = listed = html
    dressRows()
  }
  extSummary.textContent = `· ${extensionsSummary(extensions)}`
}
const markExtensions = () => {
  const broken = brokenExtensions(extensions).length
  extAlert.hidden = !broken
  extBtn.setAttribute('aria-label', broken ? `Extensions: ${broken} not running` : 'Extensions')
}
const ext = toolOf('ext-btn', 'ext-pop', paintExtensions)
ext.pop.addEventListener('click', (e) => {
  const target = /** @type {Element} */ (e.target)
  const id = /** @type {HTMLElement | null} */ (target.closest('[data-extension]'))?.dataset.extension
  if (id === undefined && !target.closest('#ext-full')) return
  popClose(false)
  go(id === undefined ? { view: EXTENSIONS_VIEW } : { view: EXTENSIONS_VIEW, subject: 'board', args: [id] })
})

// Each pin's files, followed while it is on the rail (`tower.versions`): an `html` entry's page, an item's file, every
// file of a markdown glob as listed when the watch began. When the viewer last opened each pin is kept in tower.store,
// in their browser; a pin whose newest file is newer carries a dot. A pin first followed starts as seen at its file's
// time, so the dot means a change since it was pinned or opened.
const SEEN = 'dock.seen'
/** @type {Record<string, number>} */
let seen = /** @type {Record<string, number>} */ ((await tower.store.get(SEEN)) ?? {})
/** By pin: what it follows (a change restarts it), its stops, and each file's time (null while it is gone). */
/** @type {Map<string, { key: string, stops: (() => void)[], at: Map<string, number | null> }>} */
const watches = new Map()

/** The newest time of a pin's files, or undefined before any is heard. */
const latestOf = (/** @type {string} */ name) => {
  const times = [...(watches.get(name)?.at.values() ?? [])].filter((t) => t !== null)
  return times.length ? Math.max(...times) : undefined
}
/** Whether a pin's file changed since the viewer last opened it. */
const freshOf = (/** @type {string} */ name) => {
  const at = latestOf(name)
  return at !== undefined && seen[name] !== undefined && at > seen[name]
}
/** The pin opened now: seen at this moment, or at its newest file's time when that is later. */
const saw = (/** @type {string} */ name) => {
  seen = { ...seen, [name]: Math.max(Date.now(), latestOf(name) ?? 0) }
  tower.store.set(SEEN, seen)
}

/** The files a pin follows: none for a url, a link or a renderer. @param {PinTarget} t @returns {Promise<string[]>} */
const filesOf = async (t) => {
  if (t.kind === 'html') return 'renderer' in t.entry ? [] : [pageOf(t)]
  if (t.kind !== 'md') return []
  if ('item' in t.entry) return [pageOf(t)]
  // A shelf entry's file list, `GET /shelf/<project>/<n>`: a read `Reads` doesn't name by its pattern.
  return /** @type {string[]} */ (await tower.get(/** @type {any} */ (`shelf/${t.floor}/${t.n}`)))
}

/** A pin's files followed: each change heard after the first redraws the rail, and loads the pin again while shown. @param {Mark} m */
const watch = async (m) => {
  const t = /** @type {PinTarget} */ (m.pin)
  const key = pinKey(t)
  if (watches.get(m.name)?.key === key) return
  unwatch(m.name)
  /** @type {{ key: string, stops: (() => void)[], at: Map<string, number | null> }} */
  const w = { key, stops: [], at: new Map() }
  watches.set(m.name, w)
  const files = await filesOf(t)
  if (watches.get(m.name) !== w) return
  // Never seen: each file's first time, as its watch begins, counts as seen, so pinning marks nothing fresh.
  const baseline = seen[m.name] === undefined
  for (const file of files) {
    let first = true
    w.stops.push(tower.versions(shelfFilePath(t, file), (msg) => {
      if (msg.t === 'error') return console.warn(`dock: ${m.label}: ${msg.message}`)
      w.at.set(file, msg.modifiedAt)
      if (first && baseline) {
        seen = { ...seen, [m.name]: Math.max(seen[m.name] ?? 0, msg.modifiedAt ?? 0) }
        tower.store.set(SEEN, seen)
      }
      const changed = !first
      first = false
      if (changed && current === m.name && open.has(m.name)) {
        reload(m)
        saw(m.name)
        toast(`${m.label} updated · reloaded`)
      }
      draw()
    }))
  }
}
const unwatch = (/** @type {string} */ name) => {
  watches.get(name)?.stops.forEach((stop) => stop())
  watches.delete(name)
}
/** Every pin on the rail followed, and none that left it. */
const watchPins = () => {
  for (const m of marks) if (m.pin) void watch(m)
  for (const name of watches.keys()) if (!marks.some((m) => m.name === name && m.pin)) unwatch(name)
}

/** A word over the stage for a few seconds, such as a pin loaded again. */
const toastEl = document.createElement('div')
toastEl.className = 'toast'
toastEl.setAttribute('role', 'status')
toastEl.hidden = true
document.body.append(toastEl)
/** @type {ReturnType<typeof setTimeout> | undefined} */
let toastTimer
const toast = (/** @type {string} */ text) => {
  toastEl.textContent = text
  toastEl.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toastEl.hidden = true), 3000)
}

// The pin picker: every floor's shelf, each entry a checkbox; ticking one pins it, writing the dock's settings through
// the config verbs, and the board that follows draws the rail again.
const pinList = /** @type {HTMLElement} */ (document.getElementById('pin-list'))
const pinSaid = /** @type {HTMLElement} */ (document.getElementById('pin-said'))
const paintPins = () => {
  const pinned = new Set(settings.pins.map((p) => pinName(p.floor, p.label)))
  const shelved = floors.filter((f) => f.shelf?.length)
  pinList.replaceChildren(
    ...(shelved.length
      ? shelved.flatMap((f) => [
          Object.assign(document.createElement('p'), { className: 'floor', textContent: f.name }),
          ...(f.shelf ?? []).map((e) => {
            const b = document.createElement('button')
            b.type = 'button'
            b.className = 'entry'
            b.setAttribute('role', 'menuitemcheckbox')
            b.setAttribute('aria-checked', String(pinned.has(pinName(f.id, e.label))))
            b.dataset.floor = f.id
            b.dataset.label = e.label
            const label = Object.assign(document.createElement('span'), { className: 'label', textContent: e.label })
            const kind = Object.assign(document.createElement('span'), { className: 'kind', textContent: shelfKind(e) })
            b.append(Object.assign(document.createElement('span'), { className: 'check' }), label, kind)
            return b
          }),
        ])
      : [Object.assign(document.createElement('p'), { className: 'none', textContent: 'No floor has a shelf yet: add entries at projects.<floor>.shelf in the config.' })]),
  )
  pinSaid.hidden = true
}
const pinTool = toolOf('pin-btn', 'pin-pop', paintPins)
pinTool.pop.addEventListener('click', async (e) => {
  const b = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest('button.entry'))
  if (!b) return
  const floor = /** @type {string} */ (b.dataset.floor)
  const label = /** @type {string} */ (b.dataset.label)
  const raw = await tower.get('config')
  /** @type {PinSetting[]} */
  const had = /** @type {PinSetting[]} */ (raw?.extensions?.[ID]?.settings?.pins ?? [])
  const pins = had.some((p) => p.floor === floor && p.label === label) ? had.filter((p) => !(p.floor === floor && p.label === label)) : [...had, { floor, label }]
  const { verb, body } = pinWrite(raw, pins)
  try {
    await tower.call(/** @type {'config/add' | 'config/set'} */ (verb), /** @type {any} */ (body))
    b.setAttribute('aria-checked', String(pins.some((p) => p.floor === floor && p.label === label)))
  } catch (/** @type {any} */ err) {
    pinSaid.textContent = err.message
    pinSaid.hidden = false
  }
})

const panelStyle = document.createElement('style')
panelStyle.textContent = panelsCss
document.head.prepend(panelStyle)

/** The rail read again from the renderers and the settings as they stand: what left it is closed, what it shows stays. */
const rerail = () => {
  const was = new Map(marks.map((m) => [m.name, m.pin && pinKey(m.pin)]))
  marks = railOf()
  // A pin whose entry moved or changed is framed afresh.
  for (const name of open.keys()) {
    const m = marks.find((x) => x.name === name && x.available)
    if (!m || (m.pin && was.get(name) !== pinKey(m.pin))) drop(name)
  }
  watchPins()
  if (!pinTool.pop.hidden) paintPins()
  if (!open.has(current)) {
    const home = homeOf(marks, settings, served.default)
    return home ? show(home) : ((current = ''), draw())
  }
  draw()
}

rail.addEventListener('click', (e) => {
  const b = /** @type {HTMLElement} */ (e.target).closest('button[data-name]')
  if (b instanceof HTMLButtonElement && !b.hasAttribute('aria-disabled')) show(/** @type {string} */ (b.dataset.name))
})

/** ⌃1…⌃9 show the rail's renderers, pressed in the dock or forwarded by the frame holding focus. */
const chord = (/** @type {string} */ key, /** @type {string[]} */ mods) => {
  const m = marks[Number(key) - 1]
  if (mods.length !== 1 || mods[0] !== 'Ctrl' || !m?.available) return false
  show(m.name)
  return true
}
addEventListener('keydown', (e) => {
  if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && chord(e.key, ['Ctrl'])) e.preventDefault()
})
addEventListener('message', (e) => {
  const from = [...open.entries()].find(([, o]) => o.frame.contentWindow === e.source)?.[0]
  if (from === undefined) return
  // Escape pressed while focus is in a frame closes what the dock has open, as it does pressed in the dock.
  if (e.data?.t === 'key' && e.data.key === 'Escape' && !e.data.mods.length) return void (popClose(false), tipOff())
  if (e.data?.t === 'key') return void chord(e.data.key, e.data.mods)
  if (e.data?.t !== NESTED) return
  drop(from)
  const home = homeOf(marks, settings, served.default)
  if (home) show(home)
})

/** A typed or linked address moves the dock as it opened it. */
addEventListener('hashchange', () => {
  const { name, inner } = addressOf(location.hash)
  if (marks.some((m) => m.name === name && m.available)) show(name, inner)
})

/** The settings and the extensions as each board has them: a change re-reads the renderers and draws the rail again. */
let heard = ''
/** @type {(v?: unknown) => void} */
let settled = () => {}
const firstBoard = new Promise((resolve) => (settled = resolve))
tower.subscribe((board) => {
  extensions = board.extensions
  markExtensions()
  if (!ext.pop.hidden) paintExtensions()
  if (board.config !== configPath) {
    configPath = board.config
    const shown = /** @type {HTMLElement} */ (document.getElementById('config-path'))
    shown.textContent = configPath
    shown.parentElement?.setAttribute('title', configPath)
  }
  const now = /** @type {Settings} */ ({ ...DEFAULTS, .../** @type {object} */ (settingsOf(board, ID) ?? {}) })
  const shelves = board.floors.map((f) => [f.id, f.name, (f.shelf ?? []).map((e) => [e.label, shelfKind(e), shelfSource(e)])])
  const key = JSON.stringify([now, board.extensions.map((x) => [x.id, x.state, x.title]), shelves])
  if (key === heard) return
  const first = heard === ''
  heard = key
  settings = now
  floors = board.floors
  titles = Object.fromEntries(board.extensions.map((x) => [x.provides, x.title]))
  if (first) return settled()
  void tower.get('renderers').then((r) => ((served = r), rerail()))
})

await firstBoard
marks = railOf()
watchPins()
const start = addressOf(location.hash)
const startAt = marks.some((m) => m.name === start.name && framedHere(m)) ? start.name : homeOf(marks, settings, served.default)
if (startAt) show(startAt, startAt === start.name ? start.inner : undefined)
else /** @type {HTMLElement} */ (stage.querySelector('.empty')).textContent = 'No renderer to show: the tower serves none but the dock.'
