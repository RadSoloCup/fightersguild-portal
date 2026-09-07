import MarkdownIt from 'markdown-it'
import sanitizeHtml from 'sanitize-html'

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: true,
})

// Open links in a new tab, mark them safe.
const defaultRender = md.renderer.rules.link_open || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet('target', '_blank')
  tokens[idx].attrSet('rel', 'noopener nofollow ugc')
  return defaultRender(tokens, idx, options, env, self)
}

const SANITIZE = {
  allowedTags: [
    'p', 'br', 'hr', 'blockquote', 'pre', 'code', 'span',
    'strong', 'em', 'del', 's', 'b', 'i', 'u',
    'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt', 'title'],
    code: ['class'],
    span: ['class'],
    td: ['align'], th: ['align'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener nofollow ugc', target: '_blank' }),
  },
}

export function renderMarkdown(src) {
  const raw = md.render(String(src || ''))
  return sanitizeHtml(raw, SANITIZE)
}

// A one-line plaintext preview (for lists / announcements).
export function excerpt(srcMd, n = 160) {
  const text = String(srcMd || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~\-!\[\]()]/g, ' ')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > n ? `${text.slice(0, n - 1)}…` : text
}
