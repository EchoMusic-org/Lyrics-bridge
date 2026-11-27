import {
  AUDIO_DOWNLOAD_TIMEOUT_MS,
  MAX_SEEK_SYNC_INTERVAL_MS,
  MAX_UPLOAD_BYTES,
  MIN_SEEK_SYNC_INTERVAL_MS,
  PING_INTERVAL_MS,
  RECONNECT_DELAY_MS,
  SEEK_MARK_CLEAR_DELAY_MS,
  TOAST_DURATION_MS,
  UPLOAD_TIMEOUT_MS,
} from './constants.js'
import { getConfig } from './config.js'
import { handleSetFavorite } from './favorite.js'
import { sendMusicData } from './musicdata.js'
import { handleSetPlayMode, sendPlayModeState } from './playmode.js'
import { refreshLatestSnapshot } from './snapshot.js'
import { nextSeq } from './state.js'
import { getCurrentAudioUrl, getCurrentTrack, getInterpolatedPositionMs, getTrackKey } from './track.js'
import { logDebug, toMilliseconds, toSeekSeconds, toText } from './utils.js'
import { handleSetVolume, sendVolumeState } from './volume.js'


export function isWsOpen(state) {
  return state.ws && state.ws.readyState === WebSocket.OPEN
}

export function send(state, msg) {
  if (!isWsOpen(state)) return false
  try {
    state.ws.send(JSON.stringify(msg))
    return true
  } catch {
    return false
  }
}

export function sendPluginCommand(state, action, data = {}) {
  return send(state, {
    type: 'command',
    source: 'plugin',
    payload: { action, data },
  })
}

export function subscribe(state) {
  send(state, {
    type: 'subscribe',
    seq: nextSeq(state),
    payload: { events: ['control', 'state', 'media'] },
  })
}

export function startPing(state) {
  if (state.pingTimer) clearInterval(state.pingTimer)
  state.pingTimer = setInterval(() => {
    send(state, { type: 'ping' })
  }, PING_INTERVAL_MS)
}

export function stopPing(state) {
  if (!state.pingTimer) return
  clearInterval(state.pingTimer)
  state.pingTimer = null
}

function isSeekWsOpen(state) {
  return state.seekWs && state.seekWs.readyState === WebSocket.OPEN
}

function normalizeSeekSyncInterval(data) {
  const value = Number(data?.interval)
  if (!Number.isFinite(value)) return null
  if (value < MIN_SEEK_SYNC_INTERVAL_MS || value > MAX_SEEK_SYNC_INTERVAL_MS) return null
  return Math.round(value)
}

function buildSeekSyncUrl(serverUrl) {
  const rawUrl = toText(serverUrl)
  if (!rawUrl) return ''

  try {
    const url = new URL(rawUrl)
    url.pathname = '/seek'
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return rawUrl.replace(/\/+$/, '') + '/seek'
  }
}

function clearSeekSyncTimer(state) {
  if (!state.seekTimer) return
  clearTimeout(state.seekTimer)
  state.seekTimer = null
}

function clearSeekSyncState(state) {
  clearSeekSyncTimer(state)

  if (state.seekWs) {
    state.seekWs.onopen = null
    state.seekWs.onmessage = null
    state.seekWs.onclose = null
    state.seekWs.onerror = null
    try { state.seekWs.close() } catch { }
    state.seekWs = null
  }

  state.seekConnecting = false
  state.seekInterval = 0
}

function stopSeekSync(state) {
  state.seekSyncToken += 1
  clearSeekSyncState(state)
}

function sendSeekSyncPosition(state) {
  if (state.disposed || !isSeekWsOpen(state)) return false

  const playback = state.latestSnapshot?.playback || {}

  try {
    state.seekWs.send(JSON.stringify({
      position_ms: getInterpolatedPositionMs(state),
      is_playing: playback.isPlaying === true,
    }))
    return true
  } catch {
    stopSeekSync(state)
    return false
  }
}

function scheduleSeekSyncPush(state) {
  clearSeekSyncTimer(state)
  if (state.disposed || !state.seekInterval || !isSeekWsOpen(state)) return

  state.seekTimer = setTimeout(() => {
    state.seekTimer = null
    if (!sendSeekSyncPosition(state)) return
    scheduleSeekSyncPush(state)
  }, state.seekInterval)
}

async function startSeekSync(state, ctx, data) {
  const interval = normalizeSeekSyncInterval(data)
  if (interval == null) {
    stopSeekSync(state)
    return
  }

  const token = state.seekSyncToken + 1
  state.seekSyncToken = token
  clearSeekSyncState(state)
  state.seekInterval = interval
  state.seekConnecting = true

  let serverUrl = ''
  try {
    serverUrl = (await getConfig(ctx)).serverUrl
  } catch {
    if (state.seekSyncToken === token) stopSeekSync(state)
    return
  }

  if (state.disposed || state.seekSyncToken !== token) return

  const seekUrl = buildSeekSyncUrl(serverUrl)
  if (!seekUrl) {
    stopSeekSync(state)
    return
  }

  try {
    const socket = new WebSocket(seekUrl)
    state.seekWs = socket
    state.seekConnecting = true

    socket.onopen = () => {
      if (state.disposed || state.seekSyncToken !== token || state.seekWs !== socket) {
        try { socket.close() } catch { }
        return
      }

      state.seekConnecting = false
      if (!sendSeekSyncPosition(state)) return
      scheduleSeekSyncPush(state)
    }

    socket.onclose = () => {
      if (state.seekWs !== socket) return
      state.seekSyncToken += 1
      clearSeekSyncTimer(state)
      state.seekWs = null
      state.seekConnecting = false
      state.seekInterval = 0
    }

    socket.onerror = () => {
      if (state.seekWs === socket) stopSeekSync(state)
    }
  } catch {
    if (state.seekSyncToken === token) stopSeekSync(state)
  }
}

function updateSeekSync(state, data) {
  const interval = normalizeSeekSyncInterval(data)
  if (interval == null) {
    stopSeekSync(state)
    return
  }

  // update 只调整已启动的 /seek 同步，不负责主动建立连接。
  if (!state.seekWs && !state.seekConnecting && !state.seekTimer) return

  state.seekInterval = interval
  if (isSeekWsOpen(state)) scheduleSeekSyncPush(state)
}

export function showNotification(ctx, data) {
  const title = toText(data?.title)
  const message = toText(data?.message)
  const text = [title, message].filter(Boolean).join(': ')
  if (text) ctx.toast.info(text, TOAST_DURATION_MS)
}

export async function handleShowMainWindow(state, ctx) {
  const isMainWindowForeground = () => {
    try {
      return document.visibilityState === 'visible' && document.hasFocus()
    } catch {
      return false
    }
  }

  // 已在前台则无需处理
  if (isMainWindowForeground()) return

  const showMainWindow = ctx.electron?.miniPlayer?.command
  if (typeof showMainWindow === 'function') {
    // 宿主命令是 fire-and-forget 的 IPC，调用后立刻检查可见性读到的必然是旧状态；
    // 就此收口不再回发服务端命令，避免宿主已拉起成功后服务端二次激活
    showMainWindow('showMainWindow')
    return
  }

  // 宿主无窗口唤起接口时，发送插件命令让服务端激活主窗口
  sendPluginCommand(state, 'show_main_window', { process_name: 'EchoMusic.exe' })
}

// 读取宿主应用版本（优先取设置 store 已水合的值，兜底走 IPC）
async function getHostAppVersion(ctx) {
  const storedVersion = toText(ctx.stores?.settings?.appVersion)
  if (storedVersion) return storedVersion

  try {
    const appInfo = await ctx.electron?.appInfo?.get?.()
    return toText(appInfo?.version)
  } catch {
    return ''
  }
}

async function sendSoftwareInfo(state, ctx) {
  const version = await getHostAppVersion(ctx)
  sendPluginCommand(state, 'software_info', {
    name: 'EchoMusic',
    version,
    author: '',
  })
}

export async function handleUploadMusicFile(ctx, data) {
  const uploadUrl = data?.upload_url
  if (!uploadUrl) return

  const audioUrl = getCurrentAudioUrl(ctx)
  if (!audioUrl) return

  const normalizedUploadUrl = uploadUrl.replace(/\/+$/, '') + '/Music-file-upload'
  const fetcher = ctx.net?.fetch || fetch

  try {
    // 下载当前音频：限时 + 大小上限，避免大文件或慢链路长期占用内存与带宽
    const downloadController = typeof AbortController !== 'undefined' ? new AbortController() : null
    const downloadTimeout = downloadController
      ? setTimeout(() => downloadController.abort(), AUDIO_DOWNLOAD_TIMEOUT_MS)
      : null

    let audioResponse
    try {
      audioResponse = await fetcher(audioUrl, downloadController ? { signal: downloadController.signal } : undefined)
    } finally {
      if (downloadTimeout) clearTimeout(downloadTimeout)
    }

    if (!audioResponse?.ok) {
      logDebug('音频下载失败，跳过上传')
      return
    }

    const contentLength = Number(audioResponse.headers?.get?.('content-length'))
    if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
      logDebug('音频超过大小上限，跳过上传', contentLength)
      return
    }

    const blob = await audioResponse.blob()
    if (blob.size > MAX_UPLOAD_BYTES) {
      logDebug('音频超过大小上限，跳过上传', blob.size)
      return
    }

    const headers = {
      'Content-Type': blob.type || 'audio/mpeg',
    }

    const track = getCurrentTrack(ctx)
    if (track) {
      const trackId = toText(track?.id || track?.songId || track?.hash)
      if (trackId) headers['X-Music-Id'] = trackId
      const title = toText(track?.title || track?.name)
      if (title) headers['X-Music-Title'] = encodeURIComponent(title)
      const artist = toText(track?.artist)
      if (artist) headers['X-Music-Artist'] = encodeURIComponent(artist)
    }

    const uploadController = typeof AbortController !== 'undefined' ? new AbortController() : null
    const uploadTimeout = uploadController
      ? setTimeout(() => uploadController.abort(), UPLOAD_TIMEOUT_MS)
      : null

    try {
      const uploadResponse = await fetcher(normalizedUploadUrl, {
        method: 'POST',
        headers,
        body: blob,
        ...(uploadController ? { signal: uploadController.signal } : {}),
      })
      if (!uploadResponse?.ok) logDebug('音频上传失败，HTTP', uploadResponse?.status)
    } finally {
      if (uploadTimeout) clearTimeout(uploadTimeout)
    }
  } catch (error) {
    logDebug('音频上传失败', error)
  }
}

export function handleMessage(state, ctx, data) {
  try {
    const msg = JSON.parse(data)
    if (msg.type === 'pong' || msg.type === 'ack') return

    if (msg.type === 'command') {
      const source = msg.source || 'server'
      const action = msg.payload?.action
      const actionData = msg.payload?.data

      if (source === 'server') {
        switch (action) {
          case 'request_MusicData':
            void sendMusicData(state, ctx, { force: true, reason: 'request' })
            break
          case 'show_notification':
            showNotification(ctx, actionData)
            break
          case 'show_main_window':
            void handleShowMainWindow(state, ctx)
            break
          case 'get_playback_state': {
            const positionMs = getInterpolatedPositionMs(state)
            const snapshot = state.latestSnapshot
            const playback = snapshot?.playback || {}
            const durationMs = toMilliseconds(playback.duration || 0)
            const isPlaying = playback.isPlaying === true
            sendPluginCommand(state, 'position', {
              position_ms: positionMs,
              duration_ms: durationMs,
              is_playing: isPlaying,
            })
            break
          }
          case 'get_software_info':
            void sendSoftwareInfo(state, ctx)
            break
          case 'upload_music_file':
            void handleUploadMusicFile(ctx, actionData)
            break
          case 'set_volume':
            handleSetVolume(state, ctx, actionData)
            break
          case 'set_favorite':
            void handleSetFavorite(state, ctx, actionData)
            break
          case 'set_play_mode':
            handleSetPlayMode(state, ctx, actionData)
            break
          case 'start_seek_sync':
            void startSeekSync(state, ctx, actionData)
            break
          case 'update_seek_sync':
            updateSeekSync(state, actionData)
            break
          case 'stop_seek_sync':
            stopSeekSync(state)
            break
          case 'play':
            ctx.player.play()
            break
          case 'pause':
            ctx.player.pause()
            break
          case 'toggle_play':
            ctx.player.toggle()
            break
          case 'next':
            ctx.player.next()
            break
          case 'prev':
            ctx.player.prev()
            break
          case 'seek': {
            const seekSeconds = toSeekSeconds(actionData, msg.payload)
            if (seekSeconds != null) {
              // 标记为由服务端触发的 seek，防闭环
              state.lastServerSeekTriggered = true
              if (state.serverSeekClearTimer) clearTimeout(state.serverSeekClearTimer)
              state.serverSeekClearTimer = setTimeout(() => {
                state.lastServerSeekTriggered = false
                state.serverSeekClearTimer = null
              }, SEEK_MARK_CLEAR_DELAY_MS)
              ctx.player.seek(seekSeconds)
            }
            break
          }
        }
      }
    }
  } catch {
    // 忽略解析错误
  }
}

export async function scheduleReconnect(state, ctx) {
  if (state.disposed) return

  // 配置读取失败时按默认开启重试，等待下次连接成功后再确认用户设置
  let autoReconnect = true
  try {
    ;({ autoReconnect } = await getConfig(ctx))
  } catch (error) {
    logDebug('读取重连配置失败，按默认策略重试', error)
  }
  if (state.disposed || !autoReconnect) return
  if (state.reconnectTimer) clearTimeout(state.reconnectTimer)

  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null
    void connect(state, ctx)
  }, RECONNECT_DELAY_MS)
}

export async function connect(state, ctx) {
  if (state.disposed || state.connecting) return
  if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) return

  state.connecting = true

  let serverUrl = ''
  try {
    ;({ serverUrl } = await getConfig(ctx))
  } catch (error) {
    // 配置读取失败必须复位 connecting，否则后续所有连接都会被 early-return 挡死
    state.connecting = false
    logDebug('读取连接配置失败', error)
    void scheduleReconnect(state, ctx)
    return
  }

  if (state.disposed) {
    state.connecting = false
    return
  }

  try {
    const socket = new WebSocket(serverUrl)
    state.ws = socket

    socket.onopen = async () => {
      state.connecting = false
      ctx.toast.success('已连接到 EchoMusic-Lyrics-WinIsland')

      if (!state.disposed && isWsOpen(state)) {
        sendVolumeState(state, ctx, { force: true })
        sendPlayModeState(state, ctx, { force: true })
      }

      await refreshLatestSnapshot(state, ctx)
      if (!state.disposed && isWsOpen(state)) {
        // 连接建立后同步当前播放状态：服务端（如灵动岛）重启后无法得知 EchoMusic 是否在播放，
        // 需要立刻收到 play/pause 与进度，否则要等到下一次状态变化才能对齐
        const snapshot = state.latestSnapshot
        if (snapshot && getTrackKey(snapshot)) {
          const isPlaying = snapshot.playback?.isPlaying === true
          sendPluginCommand(state, isPlaying ? 'play' : 'pause', {
            position_ms: getInterpolatedPositionMs(state),
          })
        }

        // 连接成功后发送 MusicData（可能有歌词也可能没有）
        await sendMusicData(state, ctx, { force: true, reason: 'connect' })
        subscribe(state)
        startPing(state)
      }
    }

    socket.onmessage = event => handleMessage(state, ctx, event.data)

    socket.onclose = () => {
      state.connecting = false
      stopPing(state)
      stopSeekSync(state)
      if (state.ws === socket) state.ws = null
      void scheduleReconnect(state, ctx)
    }

    socket.onerror = () => {
      state.connecting = false
    }
  } catch {
    state.connecting = false
    void scheduleReconnect(state, ctx)
  }
}

export function disconnect(state) {
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer)
    state.reconnectTimer = null
  }
  stopPing(state)
  stopSeekSync(state)
  if (state.ws) {
    state.ws.onopen = null
    state.ws.onmessage = null
    state.ws.onclose = null
    state.ws.onerror = null
    state.ws.close()
    state.ws = null
  }
  state.connecting = false
}
