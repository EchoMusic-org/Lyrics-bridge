import assert from 'node:assert/strict'
import test from 'node:test'

import { createState } from '../src/state.js'
import { handleSnapshot, syncPlaybackBaselines } from '../src/snapshot.js'

// WebSocket 未连接时 sendPluginCommand 会安全返回 false，不产生副作用
const ctx = {}

test('停止播放（playback 置空）复位基线', () => {
  const state = createState()
  state.lastTrackKey = 'hashA'
  state.lastIsPlaying = true
  state.lastSentMusicDataKey = 'key'
  state.lastSeekGeneration = 100

  handleSnapshot(state, ctx, { playback: null })

  assert.equal(state.lastTrackKey, '')
  assert.equal(state.lastSentMusicDataKey, '')
  assert.equal(state.lastIsPlaying, false)
  assert.equal(state.lastPositionMs, 0)
  assert.equal(state.lastSeekGeneration, null)
})

test('停止播放后的重复空快照不再重复处理', () => {
  const state = createState()
  state.lastTrackKey = ''
  handleSnapshot(state, ctx, { playback: null })
  assert.equal(state.lastTrackKey, '')
})

test('seek 代次变化时更新基线（未连接不发送但状态前移）', () => {
  const state = createState()
  state.lastTrackKey = 'hashA'
  state.lastIsPlaying = true
  state.lastSeekGeneration = 100
  state.lastPositionTimestamp = Date.now()

  handleSnapshot(state, ctx, {
    playback: {
      lyricHash: 'hashA',
      isPlaying: true,
      currentTime: 30,
      clock: { generation: 200, positionMs: 30000, sampledAt: Date.now(), isAdvancing: true },
    },
  })

  assert.equal(state.lastSeekGeneration, 200)
})

test('缓冲停滞（代次不变）不误更新 seek 代次', () => {
  const state = createState()
  state.lastTrackKey = 'hashA'
  state.lastIsPlaying = true
  state.lastSeekGeneration = 100
  state.lastPositionTimestamp = Date.now()

  handleSnapshot(state, ctx, {
    playback: {
      lyricHash: 'hashA',
      isPlaying: true,
      currentTime: 30,
      clock: { generation: 100, positionMs: 30000, sampledAt: Date.now(), isAdvancing: true },
    },
  })

  assert.equal(state.lastSeekGeneration, 100)
})

test('曲目切换分支复位 MusicData 去重键并更新代次', () => {
  const state = createState()
  state.lastTrackKey = 'hashA'
  state.lastSentMusicDataKey = 'old'
  state.lastIsPlaying = true
  state.lastSeekGeneration = 100

  handleSnapshot(state, ctx, {
    playback: {
      lyricHash: 'hashB',
      isPlaying: true,
      currentTime: 0,
      clock: { generation: 100, positionMs: 0, sampledAt: Date.now(), isAdvancing: true },
    },
  })

  assert.equal(state.lastTrackKey, 'hashB')
  assert.equal(state.lastSentMusicDataKey, '')
  assert.equal(state.lastSeekGeneration, 100)
})

test('syncPlaybackBaselines 从快照同步播放基线', () => {
  const state = createState()
  syncPlaybackBaselines(state, {
    playback: {
      isPlaying: true,
      currentTime: 8,
      clock: { generation: 77 },
    },
  })

  assert.equal(state.lastIsPlaying, true)
  assert.equal(state.lastPositionMs, 8000)
  assert.ok(state.lastPositionTimestamp > 0)
  assert.equal(state.lastSeekGeneration, 77)
})

test('syncPlaybackBaselines：无 clock 时代次为 null，空快照直接返回', () => {
  const state = createState()
  state.lastSeekGeneration = 5
  syncPlaybackBaselines(state, { playback: { isPlaying: false, currentTime: 1 } })
  assert.equal(state.lastSeekGeneration, null)
  assert.equal(state.lastIsPlaying, false)

  syncPlaybackBaselines(state, null)
  assert.equal(state.lastIsPlaying, false)
})
