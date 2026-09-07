import { tx, one } from '../db.js'
import { renderMarkdown } from './markdown.js'
import { slugify } from './slug.js'

// Create a thread + its opening post in one transaction. Shared by the forum
// routes and by automated posts (e.g. mission after-action reports).
// Returns the thread row, or null if the category slug is unknown.
export async function createThread({ authorId, categorySlug, title, body, pinned = false }) {
  const cat = await one('SELECT id FROM forum_categories WHERE slug = $1', [categorySlug])
  if (!cat) return null

  return tx(async client => {
    const t = (await client.query(
      `INSERT INTO forum_threads (category_id, author_id, title, slug, pinned)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [cat.id, authorId, title.slice(0, 140), slugify(title), pinned],
    )).rows[0]
    await client.query(
      `INSERT INTO forum_posts (thread_id, author_id, body_md, body_html)
       VALUES ($1, $2, $3, $4)`,
      [t.id, authorId, body, renderMarkdown(body)],
    )
    await client.query('UPDATE forum_threads SET post_count = 0 WHERE id = $1', [t.id])
    return t
  })
}
