import { HELPER_LAUNCH_WAIT_MS } from './src/constants.js'
import { initFavoriteWatch } from './src/favorite.js'
import { initPlayModeWatch } from './src/playmode.js'
import { initNowPlayingSubscription } from './src/snapshot.js'
import { createState } from './src/state.js'
import { defineSettings } from './src/settings.js'
import { initVolumeWatch } from './src/volume.js'
import { logDebug } from './src/utils.js'
import { connect, disconnect, isWsOpen, send } from './src/websocket.js'

// 等待首次连接出结果（成功/失败/超时），用于判断服务端是否已在运行
function waitForConnectionSettled(state, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    const poll = () => {
      if (state.disposed) return resolve(false)

      const ws = state.ws
      if (ws && ws.readyState === WebSocket.OPEN) return resolve(true)
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        return resolve(false)
      }
      if (Date.now() - startedAt >= timeoutMs) return resolve(false)
      setTimeout(poll, 100)
    }
    poll()
  })
}

async function launchHelper(state, ctx) {
  if (state.disposed) return

  const platform = ctx.electron?.platform
  if (platform !== 'win32') return

  const isEnabled = await ctx.storage.get('autoLaunch')
  if (isEnabled === false) return

  // 已连上说明服务端已在运行（如用户手动启动了灵动岛），不再拉起重复实例
  const connected = await waitForConnectionSettled(state, HELPER_LAUNCH_WAIT_MS)
  if (state.disposed || connected) return

  const result = await ctx.process.launch({
    executable: 'bin/EchoMusic-Lyrics-WinIsland.exe',
    args: [],
    cwd: 'bin',
  })

  if (result.ok) {
    state.helperPids.push(result.pid)
  } else if (!result.canceled) {
    ctx.toast.warning(result.error || '启动辅助进程失败')
  }
}

function disposeBridge(state, ctx) {
  state.disposed = true
  if (state.serverSeekClearTimer) {
    clearTimeout(state.serverSeekClearTimer)
    state.serverSeekClearTimer = null
  }

  // 通知服务端插件被禁用
  if (isWsOpen(state)) {
    send(state, {
      type: 'command',
      source: 'plugin',
      payload: { action: 'disabled', data: {} },
    })
  }

  // 终止外部辅助进程
  state.helperPids.forEach(pid => {
    try { ctx.process.terminate(pid) } catch { }
  })
  state.helperPids = []

  disconnect(state)
  if (state.unsubNowPlaying) {
    state.unsubNowPlaying()
    state.unsubNowPlaying = null
  }
  if (state.unsubFavoriteWatch) {
    state.unsubFavoriteWatch()
    state.unsubFavoriteWatch = null
  }
  if (state.unsubVolumeWatch) {
    state.unsubVolumeWatch()
    state.unsubVolumeWatch = null
  }
  if (state.unsubPlayModeWatch) {
    state.unsubPlayModeWatch()
    state.unsubPlayModeWatch = null
  }
  state.latestSnapshot = null
  state.lastTrackKey = ''
  state.lastSentMusicDataKey = ''
  state.lastSentFavoriteStateKey = ''
  state.lastSentVolumeKey = ''
  state.coverBase64Cache.clear()
}

export default async function (ctx) {
  const state = createState()

  defineSettings(ctx, state)

  await initNowPlayingSubscription(state, ctx)
  initFavoriteWatch(state, ctx)
  initVolumeWatch(state, ctx)
  initPlayModeWatch(state, ctx)
  await connect(state, ctx).catch(error => logDebug('初始连接失败', error))
  void launchHelper(state, ctx)

  ctx.dispose(() => {
    disposeBridge(state, ctx)
  })
}
