// Fighters Guild Portal — small progressive-enhancement helpers.
(() => {
  'use strict'

  // ── copy-to-clipboard: <button data-copy="text…"> ─────────────────────────
  document.addEventListener('click', async e => {
    const btn = e.target.closest('[data-copy]')
    if (!btn) return
    e.preventDefault()
    const text = btn.getAttribute('data-copy')
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select()
      try { document.execCommand('copy') } catch {}
      ta.remove()
    }
    const old = btn.textContent
    btn.textContent = 'Copied'
    btn.classList.add('ok')
    setTimeout(() => { btn.textContent = old; btn.classList.remove('ok') }, 1400)
  })

  // ── forum image upload: any <textarea data-upload="/portal/forum/upload"> ──
  // paste an image, drop a file, or use the "add image" button -> inserts
  // ![name](url) at the caret.
  function wireUpload(ta) {
    const url = ta.dataset.upload
    const status = ta.parentElement.querySelector('.upload-status')
    const say = (m, err) => { if (status) { status.textContent = m; status.classList.toggle('error', !!err) } }

    async function send(file) {
      if (!file || !/^image\//.test(file.type)) { say('Only images can be attached.', true); return }
      if (file.size > 8 * 1024 * 1024) { say('Image is over 8 MB.', true); return }
      say('Uploading ' + file.name + '…')
      const fd = new FormData()
      fd.append('file', file, file.name || 'image.png')
      try {
        const res = await fetch(url, { method: 'POST', body: fd })
        const j = await res.json()
        if (!res.ok || !j.url) throw new Error(j.error || res.status)
        insert(ta, `\n![${(file.name || 'image').replace(/[[\]]/g, '')}](${j.url})\n`)
        say('Added ' + file.name)
      } catch (err) {
        say('Upload failed: ' + err.message, true)
      }
    }
    function insert(el, text) {
      const s = el.selectionStart ?? el.value.length
      el.value = el.value.slice(0, s) + text + el.value.slice(el.selectionEnd ?? s)
      el.selectionStart = el.selectionEnd = s + text.length
      el.focus()
    }

    ta.addEventListener('paste', e => {
      const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'))
      if (item) { e.preventDefault(); send(item.getAsFile()) }
    })
    ta.addEventListener('dragover', e => { e.preventDefault(); ta.classList.add('drag') })
    ta.addEventListener('dragleave', () => ta.classList.remove('drag'))
    ta.addEventListener('drop', e => {
      e.preventDefault(); ta.classList.remove('drag')
      const f = e.dataTransfer?.files?.[0]
      if (f) send(f)
    })
    const pick = ta.parentElement.querySelector('[data-pick-image]')
    if (pick) {
      const input = document.createElement('input')
      input.type = 'file'; input.accept = 'image/*'; input.hidden = true
      input.addEventListener('change', () => { if (input.files[0]) send(input.files[0]); input.value = '' })
      pick.after(input)
      pick.addEventListener('click', e => { e.preventDefault(); input.click() })
    }
  }
  document.querySelectorAll('textarea[data-upload]').forEach(wireUpload)

  // ── server background image: <input type=file data-hero-upload> next to a
  // text field -> uploads and fills the sibling text input with the URL ──────
  document.querySelectorAll('input[data-hero-upload]').forEach(input => {
    const field = input.closest('.field')
    const target = field && field.querySelector('input[name="hero_url"]')
    const status = field && field.querySelector('.upload-status')
    const say = (m, err) => { if (status) { status.textContent = m; status.classList.toggle('error', !!err) } }
    input.addEventListener('change', async () => {
      const file = input.files[0]
      if (!file) return
      if (!/^image\//.test(file.type)) { say('Pick an image file.', true); return }
      if (file.size > 8 * 1024 * 1024) { say('Image is over 8 MB.', true); return }
      say('Uploading ' + file.name + '…')
      const fd = new FormData()
      fd.append('file', file, file.name || 'art.png')
      try {
        const res = await fetch(input.dataset.upload || '/portal/forum/upload', { method: 'POST', body: fd })
        const j = await res.json()
        if (!res.ok || !j.url) throw new Error(j.error || res.status)
        if (target) target.value = j.url
        say('Uploaded — save the server to apply.')
      } catch (err) {
        say('Upload failed: ' + err.message, true)
      }
      input.value = ''
    })
  })

  // ── mission role / ship builders: add / remove rows on the new-mission form
  function wireSpecBuilder(rowsId, addId) {
    const rows = document.getElementById(rowsId)
    const add = document.getElementById(addId)
    if (!rows || !add) return
    add.addEventListener('click', () => {
      const row = rows.firstElementChild.cloneNode(true)
      row.querySelectorAll('input').forEach(i => {
        if (i.type === 'hidden') i.value = 'new'
        else if (i.type === 'number') i.value = '1'
        else i.value = ''
      })
      row.querySelector('.spec-signed')?.remove()
      rows.appendChild(row)
      row.querySelector('input[type="text"]')?.focus()
    })
    rows.addEventListener('click', e => {
      const b = e.target.closest('[data-role-remove]')
      if (b && rows.children.length > 1) b.closest('.role-row').remove()
    })
  }
  wireSpecBuilder('role-rows', 'role-add')
  wireSpecBuilder('ship-rows', 'ship-add')

  // ── mission complete: reveal AAR fields once an outcome is picked ─────────
  const aar = document.getElementById('aar-fields')
  if (aar) {
    document.querySelectorAll('input[name="outcome"]').forEach(r =>
      r.addEventListener('change', () => { aar.hidden = false }))
  }
})()
