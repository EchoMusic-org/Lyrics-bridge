import { SEEK_THRESHOLD_MS } from './constants.js'
import { getMusicDataKey, sendMusicData } from './musicdata.js'
import {
  detectTrackDirection,
  getInterpolatedPositionMs,
  getSeekGeneration,
  getTrackKey,
} from './track.js'
import { toMilliseconds } from './utils.js'
import { isWsOpen, sendPluginCommand } from './websocket.js'

export async function refreshLatestSnapshot(state, ctx) {
  if (!ctx.nowPlaying?.getSnapshot) return state.latestSnapshot

  try {
    const snapshot = await ctx.nowPlaying.getSnapshot()
    state.latestSnapshot = snapshot
    const trackKey = getTrackKey(snapshot)
    if (trackKey && !state.lastTrackKey) state.lastTrackKey = trackKey
    syncPlaybackBaselines(state, snapshot)
    return snapshot
  } catch {
    return state.latestSnapshot
  }
}

// 用快照同步播放基线（播放态、位置、seek 代次），
// 用于插件初始化和连接建立后，避免拿断线前的旧基线插值
export function syncPlaybackBaselines(state, snapshot) {
  if (!snapshot || state.disposed) return

  const playback = snapshot.playback || {}
  state.lastIsPlaying = playback.isPlaying === true
  state.lastPositionMs = toMilliseconds(playback.currentTime || playback.position || 0)
  state.lastPositionTimestamp = Date.now()
  state.lastSeekGeneration = getSeekGeneration(snapshot)
}

export function handleSnapshot(state, ctx, snapshot) {
  if (state.disposed) return

  state.latestSnapshot = snapshot

  const playback = snapshot.playback || {}
  const newTrackKey = getTrackKey(snapshot)
  const newIsPlaying = playback.isPlaying === true
  const newPositionMs = toMilliseconds(playback.currentTime || playback.position || 0)
  const now = Date.now()
  const generation = getSeekGeneration(snapshot)

  // 停止播放/无曲目（宿主 stop 会把 playback 置空）：复位基线并通知暂停，
  // 否则重播同一首时不会上报 play，且回到 0 会被误判为用户 seek
  if (!newTrackKey) {
    if (state.lastTrackKey) {
      const wasPlaying = state.lastIsPlaying
      state.lastTrackKey = ''
      state.lastSentMusicDataKey = ''
      state.lastIsPlaying = false
      state.lastPositionMs = 0
      state.lastPositionTimestamp = now
      state.lastSeekGeneration = null

      if (wasPlaying && isWsOpen(state)) {
        sendPluginCommand(state, 'pause', { position_ms: 0 })
      }
    }
    return
  }

  // 曲目切换
  if (newTrackKey !== state.lastTrackKey) {
    const prevTrackKey = state.lastTrackKey
    state.lastTrackKey = newTrackKey
    state.lastSentMusicDataKey = ''
    state.lastPositionMs = newPositionMs
    state.lastPositionTimestamp = now
    state.lastIsPlaying = newIsPlaying
    if (generation != null) state.lastSeekGeneration = generation

    if (isWsOpen(state)) {
      const direction = prevTrackKey ? detectTrackDirection(state, ctx, newTrackKey) : 'next'
      sendPluginCommand(state, direction, { position_ms: newPositionMs })
      sendMusicData(state, ctx, { force: true, expectedTrackKey: newTrackKey })
    }
    return
  }

  // 播放/暂停状态变化
  if (newIsPlaying !== state.lastIsPlaying) {
    state.lastIsPlaying = newIsPlaying
    state.lastPositionMs = newPositionMs
    state.lastPositionTimestamp = now
    if (generation != null) state.lastSeekGeneration = generation

    if (isWsOpen(state)) {
      sendPluginCommand(state, newIsPlaying ? 'play' : 'pause', {
        position_ms: getInterpolatedPositionMs(state),
      })
    }
    return
  }

  // seek 检测：优先用宿主时钟的 seek 代次（seekTimestamp 严格递增，缓冲/倍速都不会误报）；
  // 旧版宿主无 clock 时回退到位置启发式
  if (generation != null) {
    if (
      state.lastSeekGeneration != null &&
      generation !== state.lastSeekGeneration &&
      !state.lastServerSeekTriggered &&
      isWsOpen(state)
    ) {
      sendPluginCommand(state, 'seek', {
        position_ms: getInterpolatedPositionMs(state),
        cause: 'user',
      })
    }
    state.lastSeekGeneration = generation
  } else if (newIsPlaying && state.lastPositionTimestamp > 0) {
    const elapsed = now - state.lastPositionTimestamp
    const expectedPosition = state.lastPositionMs + elapsed
    const diff = Math.abs(newPositionMs - expectedPosition)

    if (diff > SEEK_THRESHOLD_MS && !state.lastServerSeekTriggered && isWsOpen(state)) {
      sendPluginCommand(state, 'seek', { position_ms: newPositionMs, cause: 'user' })
    }
  }

  // 更新位置基线（供无 clock 的插值兜底使用）
  state.lastPositionMs = newPositionMs
  state.lastPositionTimestamp = now

  // 歌词数据变更（同曲目）
  if (isWsOpen(state) && newTrackKey) {
    const musicDataKey = getMusicDataKey(ctx, snapshot)
    if (state.lastSentMusicDataKey && state.lastSentMusicDataKey !== musicDataKey) {
      sendMusicData(state, ctx, { force: true, expectedTrackKey: newTrackKey })
    }
  }
}

export async function initNowPlayingSubscription(state, ctx) {
  await refreshLatestSnapshot(state, ctx)

  if (!ctx.nowPlaying?.onSnapshot) return

  state.unsubNowPlaying = ctx.nowPlaying.onSnapshot((snapshot) => {
    if (state.disposed) return
    handleSnapshot(state, ctx, snapshot)
  })
}
