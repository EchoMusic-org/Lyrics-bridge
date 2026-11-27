import { sendMusicData } from './musicdata.js'
import {
  getCurrentFavoriteWatchKey,
  getCurrentTrack,
  getFavoriteStateForSnapshot,
  getTrackIdentityCandidates,
  getTrackProtocolId,
  isFavoriteTrack,
  parseFavoriteWatchKey,
} from './track.js'
import { logDebug, toText } from './utils.js'
import { isWsOpen, sendPluginCommand } from './websocket.js'

export function sendFavoriteState(state, ctx, track, isFavorite, options = {}) {
  const snapshot = state.latestSnapshot
  const playback = snapshot?.playback || {}
  const id = getTrackProtocolId(track, playback)
  if (!id) return false
  const stateKey = `${id}:${isFavorite === true ? '1' : '0'}`
  if (options.force !== true && state.lastSentFavoriteStateKey === stateKey) return true
  const sent = sendPluginCommand(state, 'set_favorite', {
    id,
    is_favorite: isFavorite === true,
  })
  if (sent) state.lastSentFavoriteStateKey = stateKey
  return sent
}

export async function handleSetFavorite(state, ctx, data) {
  if (typeof data?.is_favorite !== 'boolean') return
  const track = getCurrentTrack(ctx)
  if (!track) return

  const snapshot = state.latestSnapshot
  const playback = snapshot?.playback || {}
  const requestedId = toText(data?.id)
  if (requestedId) {
    const candidates = getTrackIdentityCandidates(ctx, track, playback)
    if (!candidates.includes(requestedId)) return
  }

  const shouldFavorite = data.is_favorite === true
  const playlistStore = ctx.stores?.playlist
  if (!playlistStore) return

  // 当前态优先取快照（宿主已做收藏缓存兜底，收藏列表未加载时 store 会误报 false）
  const currentFavorite = getFavoriteStateForSnapshot(ctx, snapshot)
  if (currentFavorite === shouldFavorite) {
    sendFavoriteState(state, ctx, track, shouldFavorite, { force: true })
    void sendMusicData(state, ctx, { force: true, reason: 'favorite-noop' })
    return
  }

  try {
    if (shouldFavorite) {
      await playlistStore.addToFavorites?.(track)
    } else if (typeof playlistStore.removeFavoriteSong === 'function') {
      await playlistStore.removeFavoriteSong(track)
    } else {
      await playlistStore.removeFromFavorites?.(getTrackProtocolId(track, playback))
    }

    // 操作后以 store 为准（快照尚未随本次变更刷新）
    const nextFavorite = isFavoriteTrack(ctx, track)
    sendFavoriteState(state, ctx, track, nextFavorite)
    void sendMusicData(state, ctx, { force: true, reason: 'favorite-command' })
  } catch (error) {
    // 收藏操作失败时保持静默，避免外部服务端误以为状态已切换
    logDebug('收藏操作失败', error)
  }
}

export function handleFavoriteWatchChange(state, ctx, nextKey, previousKey) {
  if (state.disposed || !isWsOpen(state)) return

  const next = parseFavoriteWatchKey(nextKey)
  const previous = parseFavoriteWatchKey(previousKey)
  if (!next.id || !previous.id || next.id !== previous.id) return
  if (next.isFavorite === previous.isFavorite) return

  const track = getCurrentTrack(ctx)
  sendFavoriteState(state, ctx, track, next.isFavorite)
  void sendMusicData(state, ctx, { force: true, reason: 'favorite-change' })
}

export function initFavoriteWatch(state, ctx) {
  if (typeof ctx.vue?.watch !== 'function') return

  state.unsubFavoriteWatch = ctx.vue.watch(
    () => getCurrentFavoriteWatchKey(state, ctx),
    (nextKey, previousKey) => {
      handleFavoriteWatchChange(state, ctx, nextKey, previousKey)
    },
  )
}
