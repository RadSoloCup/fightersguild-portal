// Faded background for a game-server card. Uses the admin-supplied hero image
// when there is one; otherwise a deterministic gradient keyed to the game name
// so each game still looks distinct.

function hash(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

export function gameGradient(game) {
  const g = String(game || 'server').toLowerCase().trim()
  const hue = hash(g) % 360
  const hue2 = (hue + 38) % 360
  return `linear-gradient(135deg, hsl(${hue} 55% 22%), hsl(${hue2} 50% 10%))`
}

// A safe absolute/relative image URL with quotes/parens/whitespace stripped
// (so it's safe to drop inside a style="" attribute and a CSS url()), or ''.
function safeImage(u) {
  let s = String(u || '').trim().replace(/["'()<>\s]/g, '')
  if (!s) return ''
  if (s.startsWith('/')) return s                       // uploaded asset path
  try {
    const url = new URL(s)
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString()
  } catch {}
  return ''
}

// Inline style for the card's background layer. Contains no quotes so it can go
// straight into a style="" attribute.
export function heroLayerStyle(server) {
  const img = safeImage(server?.hero_url)
  if (img) {
    return `background-image:linear-gradient(180deg,hsla(213,38%,6%,.4),hsla(213,38%,6%,.8)),url(${img});` +
      'background-size:cover;background-position:center;'
  }
  return `background-image:${gameGradient(server?.game)};`
}
