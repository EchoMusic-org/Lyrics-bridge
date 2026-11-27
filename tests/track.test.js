import assert from 'node:assert/strict'
import test from 'node:test'

import {
  detectTrackDirection,
  getInterpolatedPositionMs,
  getSeekGeneration,
  getTrackKey,
} from '../src/track.js'
import { createState } from '../src/state.js'

test('getTrackKey 优先 lyricHash，其次 trackId', () => {
  assert.equal(getTrackKey({ playback: { lyricHash: 'h1', trackId: 't1' } }), 'h1')
  assert.equal(getTrackKey({ playback: { trackId: 't1' } }), 't1')
  assert.equal(getTrackKey({ playback: {} }), '')
  assert.equal(getTrackKey(null), '')
})

test('切歌方向：按 hash 匹配队列（酷狗 Song.id 是 mixsongid，不等于 hash）', () => {
  const state = createState()
  state.lastTrackKey = 'hashA'
  const ctx = {
    playlist: {
      getActiveQueue: () => [
        { id: 'mix1', songId: 's1', hash: 'hashA' },
        { id: 'mix2', songId: 's2', hash: 'hashB' },
      ],
    },
  }
  assert.equal(detectTrackDirection(state, ctx, 'hashB'), 'next')
  assert.equal(detectTrackDirection(state, ctx, 'hashA'), 'prev')
})

test('切歌方向：按 mixSongId 匹配（trackKey 可能来自 track.id）', () => {
  const state = createState()
  state.lastTrackKey = 'mix1'
  const ctx = {
    playlist: {
      getActiveQueue: () => [
        { id: 'mix1', hash: 'hashA' },
        { id: 'mix2', hash: 'hashB' },
      ],
    },
  }
  assert.equal(detectTrackDirection(state, ctx, 'mix2'), 'next')
})

test('切歌方向：队列为空或找不到时默认 next', () => {
  const state = createState()
  state.lastTrackKey = 'hashA'
  assert.equal(detectTrackDirection(state, { playlist: { getActiveQueue: () => [] } }, 'hashB'), 'next')
  assert.equal(detectTrackDirection(state, { playlist: { getActiveQueue: () => [{ id: 'x' }] } }, 'unknown'), 'next')
})

test('getSeekGeneration 从 clock 提取，无 clock 返回 null', () => {
  assert.equal(getSeekGeneration({ playback: { clock: { generation: 12345 } } }), 12345)
  assert.equal(getSeekGeneration({ playback: { clock: { generation: 0 } } }), 0)
  assert.equal(getSeekGeneration({ playback: {} }), null)
  assert.equal(getSeekGeneration({}), null)
})

test('getInterpolatedPositionMs：clock 推进时按 playbackRate 外推', async () => {
  const state = createState()
  state.latestSnapshot = {
    playback: {
      isPlaying: true,
      currentTime: 1,
      clock: {
        positionMs: 1000,
        sampledAt: Date.now() - 1000,
        playbackRate: 2,
        isAdvancing: true,
        durationMs: 200000,
      },
    },
  }
  const position = getInterpolatedPositionMs(state)
  // 1000 + 1000ms × 2 倍速 ≈ 3000，留出调度误差
  assert.ok(position >= 2900 && position <= 3100, `position=${position}`)
})

test('getInterpolatedPositionMs：clock 未推进（缓冲/暂停）返回采样位置', () => {
  const state = createState()
  state.latestSnapshot = {
    playback: {
      isPlaying: true,
      clock: {
        positionMs: 12345,
        sampledAt: Date.now() - 5000,
        playbackRate: 1,
        isAdvancing: false,
        durationMs: 200000,
      },
    },
  }
  assert.equal(getInterpolatedPositionMs(state), 12345)
})

test('getInterpolatedPositionMs：clock 推进时按 durationMs 截断', () => {
  const state = createState()
  state.latestSnapshot = {
    playback: {
      clock: {
        positionMs: 199000,
        sampledAt: Date.now() - 10000,
        playbackRate: 1,
        isAdvancing: true,
        durationMs: 200000,
      },
    },
  }
  assert.equal(getInterpolatedPositionMs(state), 200000)
})

test('getInterpolatedPositionMs：无 clock 回退到 1 倍速线性插值', async () => {
  const state = createState()
  state.lastPositionMs = 5000
  state.lastPositionTimestamp = Date.now() - 1000
  state.latestSnapshot = { playback: { isPlaying: true, currentTime: 5 } }
  const position = getInterpolatedPositionMs(state)
  assert.ok(position >= 5900 && position <= 6100, `position=${position}`)
})

test('getInterpolatedPositionMs：无 clock 且暂停时使用快照位置', () => {
  const state = createState()
  state.lastPositionMs = 5000
  state.lastPositionTimestamp = Date.now() - 60000
  state.latestSnapshot = { playback: { isPlaying: false, currentTime: 12.5 } }
  assert.equal(getInterpolatedPositionMs(state), 12500)
})
