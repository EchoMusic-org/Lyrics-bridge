import assert from 'node:assert/strict'
import test from 'node:test'

import { rememberCoverBase64 } from '../src/cover.js'
import { createState } from '../src/state.js'

function makeEntry(sizeChars) {
  return 'A'.repeat(sizeChars)
}

test('rememberCoverBase64：写入并去重同一 URL', () => {
  const state = createState()
  rememberCoverBase64(state, 'url1', makeEntry(100))
  rememberCoverBase64(state, 'url1', makeEntry(200))
  assert.equal(state.coverBase64Cache.size, 1)
  assert.equal(state.coverBase64Cache.get('url1').length, 200)
})

test('rememberCoverBase64：超过总量预算时淘汰最旧条目', () => {
  const state = createState()
  // 每条 4MB 字符，预算 8MB：写第三条时应淘汰第一条
  rememberCoverBase64(state, 'url1', makeEntry(4 * 1024 * 1024))
  rememberCoverBase64(state, 'url2', makeEntry(4 * 1024 * 1024))
  assert.equal(state.coverBase64Cache.size, 2)
  rememberCoverBase64(state, 'url3', makeEntry(4 * 1024 * 1024))
  assert.equal(state.coverBase64Cache.has('url1'), false)
  assert.equal(state.coverBase64Cache.has('url2'), true)
  assert.equal(state.coverBase64Cache.has('url3'), true)
})

test('rememberCoverBase64：单条超预算也至少保留最新一条', () => {
  const state = createState()
  rememberCoverBase64(state, 'url1', makeEntry(100))
  rememberCoverBase64(state, 'url2', makeEntry(10 * 1024 * 1024))
  assert.equal(state.coverBase64Cache.size, 1)
  assert.equal(state.coverBase64Cache.has('url2'), true)
})

test('rememberCoverBase64：空参数不写入', () => {
  const state = createState()
  rememberCoverBase64(state, '', makeEntry(100))
  rememberCoverBase64(state, 'url1', '')
  assert.equal(state.coverBase64Cache.size, 0)
})

test('createState 含 seek 代次与并发去重字段', () => {
  const state = createState()
  assert.equal(state.lastSeekGeneration, null)
  assert.ok(state.coverInflight instanceof Map)
})
