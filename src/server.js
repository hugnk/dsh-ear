// 收数据的 HTTP 服务：自己监听 0.0.0.0，和 DSH 自带网页服务无关。
// /ingest 收数据（1 秒内回 2xx），/health 只回状态。
import http from 'node:http'
import { timingSafeEqual } from 'node:crypto'

const MAX_BODY = 1_500_000

function sendJson(res, code, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  try {
    res.writeHead(code, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': body.length,
      'cache-control': 'no-store',
      connection: 'close',
    })
    res.end(body)
  } catch (error) {}
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let done = false
    req.on('data', (chunk) => {
      if (done) return
      size += chunk.length
      if (size > limit) { done = true; reject(Object.assign(new Error('body too large'), { code: 'TOO_LARGE' })); return }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (done) return
      done = true
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', (error) => {
      if (done) return
      done = true
      reject(error)
    })
  })
}

function sameToken(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8')
  const right = Buffer.from(String(b || ''), 'utf8')
  if (!left.length || left.length !== right.length) return false
  try { return timingSafeEqual(left, right) } catch (error) { return false }
}

function tokenOf(req) {
  const header = req.headers['authorization']
  if (typeof header === 'string') {
    const m = header.match(/^\s*Bearer\s+(.+)\s*$/i)
    if (m) return m[1].trim()
    if (header.trim()) return header.trim()
  }
  const alt = req.headers['x-ear-token']
  if (typeof alt === 'string' && alt.trim()) return alt.trim()
  try {
    const q = new URL(req.url, 'http://x').searchParams.get('token')
    if (q) return q
  } catch (error) {}
  return ''
}

export function createServer({ getConfig, ingest, stats, log }) {
  let server = null
  let port = 0
  let startedAt = 0
  let lastError = ''

  function handler(req, res) {
    let pathname = '/'
    try { pathname = new URL(req.url, 'http://x').pathname } catch (error) {}
    if (pathname.length > 1) pathname = pathname.replace(/\/+$/, '')

    if (pathname === '/health') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' })
      const s = (() => { try { return stats() } catch (error) { return {} } })()
      return sendJson(res, 200, { ok: true, status: 'ok', app: 'dsh-ear', port, received: s.total || 0, today: s.today || 0, uptime: Math.round((Date.now() - startedAt) / 1000) })
    }

    if (pathname === '/ingest') {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' })
      return handleIngest(req, res)
    }

    return sendJson(res, 404, { ok: false, error: 'not_found' })
  }

  async function handleIngest(req, res) {
    const ip = req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : ''
    const cfg = getConfig()
    if (cfg.require_token) {
      if (!sameToken(tokenOf(req), cfg.token)) {
        log('ingest', { result: 'unauthorized', ip })
        return sendJson(res, 401, { ok: false, error: 'invalid_token' })
      }
    }
    let bodyText = ''
    try {
      bodyText = await readBody(req)
    } catch (error) {
      if (error && error.code === 'TOO_LARGE') {
        log('ingest', { result: 'too_large', ip })
        return sendJson(res, 413, { ok: false, error: 'too_large' })
      }
      log('ingest', { result: 'read_error', ip, message: String(error && error.message) })
      return sendJson(res, 400, { ok: false, error: 'read_error' })
    }
    try {
      const result = ingest(bodyText, { ip, cfg })
      return sendJson(res, result.code, result.payload)
    } catch (error) {
      log('ingest', { result: 'error', ip, message: String(error && error.message) })
      return sendJson(res, 503, { ok: false, error: 'server_busy' })
    }
  }

  function listenOnce(host, wanted) {
    return new Promise((resolve, reject) => {
      const s = http.createServer(handler)
      s.keepAliveTimeout = 5000
      s.headersTimeout = 10000
      s.requestTimeout = 15000
      const onError = (error) => { try { s.close() } catch (error) {}; reject(error) }
      s.once('error', onError)
      s.once('listening', () => {
        s.removeListener('error', onError)
        s.on('error', (error) => { lastError = String(error && error.message); log('server', { result: 'error', message: lastError }) })
        server = s
        const addr = s.address()
        port = addr && typeof addr === 'object' ? addr.port : wanted
        startedAt = Date.now()
        resolve({ port, host })
      })
      try { s.listen({ host, port: wanted }) } catch (error) { onError(error) }
    })
  }

  async function start(cfg) {
    stop()
    lastError = ''
    const host = cfg.host || '0.0.0.0'
    const wanted = Number(cfg.port) || 8788
    let lastErr = null
    for (let i = 0; i < 20; i++) {
      const candidate = wanted + i
      if (candidate > 65535) break
      try {
        const r = await listenOnce(host, candidate)
        log('server', { result: 'listening', port: r.port, host })
        return { ...r, shifted: i > 0 }
      } catch (error) {
        lastErr = error
        if (!error || error.code !== 'EADDRINUSE') break
      }
    }
    lastError = String((lastErr && lastErr.message) || 'listen failed')
    log('server', { result: 'failed', port: wanted, message: lastError })
    throw Object.assign(new Error(lastError), { code: (lastErr && lastErr.code) || 'LISTEN_FAILED' })
  }

  function stop() {
    const s = server
    server = null
    if (!s) return
    try { s.closeAllConnections?.() } catch (error) {}
    try { s.close() } catch (error) {}
    try { s.closeIdleConnections?.() } catch (error) {}
    port = 0
  }

  return {
    start,
    stop,
    handler,
    get port() { return port },
    get listening() { return Boolean(server) },
    get lastError() { return lastError },
    get startedAt() { return startedAt },
  }
}
