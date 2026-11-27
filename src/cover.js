import {
  COVER_SIZE,
  COVER_TIMEOUT_MS,
  MAX_COVER_BYTES,
  MAX_COVER_CACHE_BYTES,
} from './constants.js'
import { arrayBufferToBase64, logDebug, normalizeCoverUrl, stripDataUrlPrefix } from './utils.js'

// 写入缓存并按 base64 字符长度近似计费淘汰最旧条目（LRU），总量受 MAX_COVER_CACHE_BYTES 约束
export function rememberCoverBase64(state, url, base64) {
  if (!url || !base64) return
  const cache = state.coverBase64Cache
  cache.delete(url)
  cache.set(url, base64)

  let totalChars = 0
  for (const value of cache.values()) totalChars += value.length

  while (totalChars > MAX_COVER_CACHE_BYTES && cache.size > 1) {
    const oldestKey = cache.keys().next().value
    const oldestValue = cache.get(oldestKey) || ''
    cache.delete(oldestKey)
    totalChars -= oldestValue.length
  }
}

export async function fetchCoverBase64(state, ctx, url) {
  const normalizedUrl = normalizeCoverUrl(url, COVER_SIZE)
  if (!normalizedUrl) return ''

  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(normalizedUrl)) {
    const base64 = stripDataUrlPrefix(normalizedUrl)
    // data URL 封面同样受大小上限约束，避免异常大图长期驻留内存
    if ((base64.length * 3) / 4 > MAX_COVER_BYTES) return ''
    rememberCoverBase64(state, normalizedUrl, base64)
    return base64
  }

  if (state.coverBase64Cache.has(normalizedUrl)) {
    return state.coverBase64Cache.get(normalizedUrl) || ''
  }

  // 并发去重：同一 URL 的在途请求直接复用，避免重复下载
  const pending = state.coverInflight.get(normalizedUrl)
  if (pending) return pending

  const request = (async () => {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timeout = controller ? setTimeout(() => controller.abort(), COVER_TIMEOUT_MS) : null

    try {
      const fetcher = ctx.net?.fetch || fetch
      const response = await fetcher(normalizedUrl, controller ? { signal: controller.signal } : undefined)
      if (!response?.ok) {
        logDebug('封面下载失败，HTTP', response?.status, normalizedUrl)
        return ''
      }

      const contentLength = Number(response.headers?.get?.('content-length'))
      if (Number.isFinite(contentLength) && contentLength > MAX_COVER_BYTES) return ''

      const buffer = await response.arrayBuffer()
      if (buffer.byteLength > MAX_COVER_BYTES) return ''

      const base64 = arrayBufferToBase64(buffer)
      rememberCoverBase64(state, normalizedUrl, base64)
      return base64
    } catch (error) {
      logDebug('封面下载异常', error)
      return ''
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  })()

  state.coverInflight.set(normalizedUrl, request)
  try {
    return await request
  } finally {
    if (state.coverInflight.get(normalizedUrl) === request) state.coverInflight.delete(normalizedUrl)
  }
}

export async function getCoverBase64(state, ctx, snapshot, track) {
  const coverUrl = normalizeCoverUrl(snapshot?.playback?.coverUrl || track?.coverUrl || track?.cover, COVER_SIZE)
  if (!coverUrl) return ''
  return fetchCoverBase64(state, ctx, coverUrl)
}
