// Last health snapshot pushed by the Crosstalk bridge (POST /api/status/crosstalk).
let last = null

export function setCrosstalkStatus(snapshot) {
  last = { ...snapshot, receivedAt: Date.now() }
}

export function getCrosstalkStatus() {
  return last
}

// Rows for the Servers status board. Empty when Crosstalk was never configured.
export function crosstalkRows() {
  if (!last) return []
  const age = Date.now() - last.receivedAt
  if (age > 120_000) {
    return [{ key: 'ct', label: 'Crosstalk bridge', status: 'down', detail: 'no report in 2 min' }]
  }
  const rows = []
  rows.push({
    key: 'ct-fluxer', label: 'Crosstalk · Fluxer link',
    status: last.fluxer?.connected ? 'up' : 'down',
  })
  const dc = last.discord || []
  const dcReady = dc.filter(d => d.ready).length
  rows.push({
    key: 'ct-discord', label: 'Crosstalk · Discord link',
    status: dc.length && dcReady === dc.length ? 'up' : dcReady ? 'unknown' : 'down',
    detail: dc.length ? `${dcReady}/${dc.length} bot${dc.length === 1 ? '' : 's'}` : 'no bots',
  })
  rows.push({
    key: 'ct-text', label: 'Crosstalk · text bridge',
    status: last.text?.live ? 'up' : 'down',
    detail: `${last.text?.channels || 0} channel${last.text?.channels === 1 ? '' : 's'}`,
  })
  const active = last.voice?.active || []
  rows.push({
    key: 'ct-voice', label: 'Crosstalk · voice bridge',
    status: 'up',
    detail: active.length ? `bridging ${active.join(', ')}` : `idle, ${last.voice?.pairs || 0} pair${last.voice?.pairs === 1 ? '' : 's'} watched`,
  })
  return rows
}
