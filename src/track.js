import { normalizeArtistList, splitArtists, toMilliseconds, toText, unwrapValue } from './utils.js'

export function getCurrentTrack(ctx) {
  const currentTrack = ctx.stores?.player?.currentTrackSnapshot ?? ctx.player?.currentTrack
  return unwrapValue(currentTrack) || null
}

export function getTrackKey(snapshot) {
  const playback = snapshot?.playback
  return toText(playback?.lyricHash || playback?.trackId)
}

export function getCurrentTrackForSnapshot(ctx, snapshot) {
  const track = getCurrentTrack(ctx)
  if (!track) return null

  const trackKey = getTrackKey(snapshot)
  if (!trackKey) return track

  const currentTrackId = unwrapValue(ctx.stores?.player?.currentTrackId)
  const candidates = [track.hash, track.id, track.songId, currentTrackId]
    .map(toText)
    .filter(Boolean)

  return candidates.includes(trackKey) ? track : null
}

export function getTrackProtocolId(track, playback = {}) {
  return toText(track?.id ?? track?.songId ?? playback.trackId ?? track?.hash ?? playback.lyricHash)
}

export function getTrackIdentityCandidates(ctx, track, playback = {}) {
  return [
    track?.id,
    track?.songId,
    track?.hash,
    track?.mixSongId,
    track?.fileId,
    playback.trackId,
    playback.lyricHash,
    unwrapValue(ctx.stores?.player?.currentTrackId),
  ].map(toText).filter(Boolean)
}

export function isFavoriteTrack(ctx, track) {
  if (!track) return false
  try {
    return ctx.stores?.playlist?.isFavoriteSong?.(track) === true
  } catch {
    return false
  }
}

export function getFavoriteStateForSnapshot(ctx, snapshot) {
  const playback = snapshot?.playback
  // 宿主在快照构建时已对收藏状态做过缓存与收藏队列兜底，优先采用
  if (playback && typeof playback.isFavorite === 'boolean') return playback.isFavorite
  return isFavoriteTrack(ctx, getCurrentTrackForSnapshot(ctx, snapshot))
}

export function getCurrentFavoriteWatchKey(state, ctx) {
  const snapshot = state.latestSnapshot
  const track = snapshot ? getCurrentTrackForSnapshot(ctx, snapshot) : getCurrentTrack(ctx)
  const playback = snapshot?.playback || {}
  const id = getTrackProtocolId(track, playback)
  if (!id) return ''
  const isFavorite = snapshot?.playback
    ? playback.isFavorite === true
    : isFavoriteTrack(ctx, track)
  return `${id}:${isFavorite ? '1' : '0'}`
}

export function parseFavoriteWatchKey(key) {
  const text = toText(key)
  if (!text) return { id: '', isFavorite: false }
  const index = text.lastIndexOf(':')
  if (index < 0) return { id: text, isFavorite: false }
  return {
    id: text.slice(0, index),
    isFavorite: text.slice(index + 1) === '1',
  }
}

export function getTrackArtists(track, playback) {
  const artistList = normalizeArtistList(track?.artists)
  if (artistList.length > 0) return artistList

  const singerList = normalizeArtistList(track?.singers)
  if (singerList.length > 0) return singerList

  const artists = splitArtists(playback?.artist || track?.artist)
  return Array.from(new Set(artists))
}

export function detectTrackDirection(state, ctx, newTrackId) {
  try {
    const queue = ctx.playlist?.getActiveQueue?.() || []
    if (!queue.length || !state.lastTrackKey) return 'next'

    // trackKey 来自 playback.lyricHash（酷狗曲目即 hash）， Song.id 是 mixsongid，
    // 二者通常不相等；必须对每项的全部身份字段取候选再比较，否则方向恒判为 next
    const matchesId = (item, id) => {
      const candidates = [item?.id, item?.songId, item?.hash, item?.mixSongId]
        .map(toText)
        .filter(Boolean)
      return candidates.includes(id)
    }

    const oldIndex = queue.findIndex(item => matchesId(item, state.lastTrackKey))
    const newIndex = queue.findIndex(item => matchesId(item, newTrackId))

    if (oldIndex >= 0 && newIndex >= 0) {
      return newIndex > oldIndex ? 'next' : 'prev'
    }
  } catch { }

  return 'next'
}

export function getCurrentPositionMs(state) {
  const playback = state.latestSnapshot?.playback || {}
  return toMilliseconds(playback.currentTime || playback.position || 0)
}

// 宿主时钟的 seek 代次（seekTimestamp，每次 seek 严格递增）；无 clock 的旧版宿主返回 null
export function getSeekGeneration(snapshot) {
  const clock = snapshot?.playback?.clock
  if (!clock || typeof clock !== 'object') return null
  const generation = Number(clock.generation)
  return Number.isFinite(generation) ? generation : null
}

export function getInterpolatedPositionMs(state) {
  const playback = state.latestSnapshot?.playback || {}

  // 优先使用宿主时钟：positionMs 是采样点真实位置，sampledAt 为采样时刻，
  // isAdvancing 区分「播放中」与「缓冲/seek 中」，playbackRate 保证倍速不偏差
  const clock = playback.clock
  if (clock && typeof clock === 'object' && Number.isFinite(Number(clock.positionMs)) && Number(clock.sampledAt) > 0) {
    const positionMs = Math.max(0, Number(clock.positionMs))
    if (clock.isAdvancing === true) {
      const rate = Number(clock.playbackRate)
      const safeRate = Number.isFinite(rate) && rate > 0 ? rate : 1
      const elapsed = Math.max(0, Date.now() - Number(clock.sampledAt))
      const projected = positionMs + elapsed * safeRate
      const durationMs = Number(clock.durationMs)
      return Number.isFinite(durationMs) && durationMs > 0
        ? Math.min(projected, durationMs)
        : projected
    }
    return positionMs
  }

  // 旧版宿主兜底：按 1 倍速线性插值
  const isPlaying = playback.isPlaying === true
  if (isPlaying && state.lastPositionTimestamp > 0) {
    const elapsed = Date.now() - state.lastPositionTimestamp
    return state.lastPositionMs + elapsed
  }

  return getCurrentPositionMs(state)
}

export function getCurrentAudioUrl(ctx) {
  try {
    const audioUrl = ctx.stores?.player?.currentAudioUrl
    if (audioUrl) return audioUrl
  } catch { }
  const track = getCurrentTrack(ctx)
  return track?.audioUrl || ''
}
