import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeVolume } from '../src/volume.js'
import { normalizePlayMode } from '../src/playmode.js'

test('normalizeVolume：0~100 数值直通并保留 3 位小数', () => {
  assert.equal(normalizeVolume(80), 80)
  assert.equal(normalizeVolume(12.3456), 12.346)
})

test('normalizeVolume：超范围裁剪到 0~100', () => {
  assert.equal(normalizeVolume(-5), 0)
  assert.equal(normalizeVolume(150), 100)
})

test('normalizeVolume：字符串数值可用', () => {
  assert.equal(normalizeVolume('42'), 42)
  assert.equal(normalizeVolume('  42  '), 42)
})

test('normalizeVolume：非法值返回 null', () => {
  assert.equal(normalizeVolume('abc'), null)
  assert.equal(normalizeVolume(''), null)
  assert.equal(normalizeVolume(null), null)
  assert.equal(normalizeVolume(undefined), null)
  assert.equal(normalizeVolume({}), null)
})

test('normalizeVolume：解开 ref 形态（{value}）', () => {
  assert.equal(normalizeVolume({ value: 60 }), 60)
})

test('normalizePlayMode：合法播放模式直通', () => {
  assert.equal(normalizePlayMode('sequential'), 'sequential')
  assert.equal(normalizePlayMode('list'), 'list')
  assert.equal(normalizePlayMode('random'), 'random')
  assert.equal(normalizePlayMode('single'), 'single')
})

test('normalizePlayMode：非法值返回 null', () => {
  assert.equal(normalizePlayMode('shuffle'), null)
  assert.equal(normalizePlayMode(''), null)
  assert.equal(normalizePlayMode(null), null)
})
