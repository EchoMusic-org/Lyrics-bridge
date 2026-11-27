import assert from 'node:assert/strict'
import test from 'node:test'

import {
  arrayBufferToBase64,
  normalizeArtistList,
  normalizeCoverUrl,
  normalizeServerUrl,
  splitArtists,
  stripDataUrlPrefix,
  toMilliseconds,
  toSeekSeconds,
  toText,
} from '../src/utils.js'

test('toText 空值返回空串并去除首尾空白', () => {
  assert.equal(toText(null), '')
  assert.equal(toText(undefined), '')
  assert.equal(toText('  abc  '), 'abc')
  assert.equal(toText(123), '123')
})

test('toMilliseconds 秒转毫秒并取整', () => {
  assert.equal(toMilliseconds(1.2345), 1235)
  assert.equal(toMilliseconds('2'), 2000)
  assert.equal(toMilliseconds(-1), 0)
  assert.equal(toMilliseconds('abc'), 0)
})

test('toSeekSeconds 支持 _ms 后缀毫秒字段', () => {
  assert.equal(toSeekSeconds({ position_ms: 65000 }), 65)
  assert.equal(toSeekSeconds({ time_ms: 1000 }), 1)
})

test('toSeekSeconds 不带 _ms 的字段按秒处理', () => {
  assert.equal(toSeekSeconds({ position: 30 }), 30)
  assert.equal(toSeekSeconds({ currentTime: 12.5 }), 12.5)
})

test('toSeekSeconds 非法值返回 null', () => {
  assert.equal(toSeekSeconds({ position_ms: 'abc' }), null)
  assert.equal(toSeekSeconds({}), null)
  assert.equal(toSeekSeconds(undefined), null)
})

test('toSeekSeconds data 缺失时回退 msgPayload', () => {
  assert.equal(toSeekSeconds(null, { position_ms: 5000 }), 5)
})

test('splitArtists 按常见分隔符拆分', () => {
  assert.deepEqual(splitArtists('A、B&C/D；E'), ['A', 'B', 'C', 'D', 'E'])
  assert.deepEqual(splitArtists('  单人歌手 '), ['单人歌手'])
  assert.deepEqual(splitArtists(''), [])
})

test('normalizeArtistList 去重并提取名称', () => {
  assert.deepEqual(
    normalizeArtistList([{ name: 'A' }, { title: 'B' }, 'C', { name: 'A' }]),
    ['A', 'B', 'C'],
  )
  assert.deepEqual(normalizeArtistList('not-array'), [])
})

test('normalizeCoverUrl 补 https、替换 {size} 与旧 CDN 域名', () => {
  assert.equal(
    normalizeCoverUrl('http://c1.kgimg.com/stdmusic/{size}/a.jpg', 400),
    'https://imge.kugou.com/stdmusic/400/a.jpg',
  )
})

test('normalizeCoverUrl 保留 data URL', () => {
  const dataUrl = 'data:image/jpeg;base64,abcd'
  assert.equal(normalizeCoverUrl(dataUrl), dataUrl)
})

test('normalizeCoverUrl 空值返回空串', () => {
  assert.equal(normalizeCoverUrl(''), '')
  assert.equal(normalizeCoverUrl(null), '')
})

test('stripDataUrlPrefix 提取 base64 内容', () => {
  assert.equal(stripDataUrlPrefix('data:image/png;base64, QUJD '), 'QUJD')
  assert.equal(stripDataUrlPrefix('plain'), 'plain')
})

test('normalizeServerUrl 补全 ws:// 前缀', () => {
  assert.equal(normalizeServerUrl('127.0.0.1:17195'), 'ws://127.0.0.1:17195/')
})

test('normalizeServerUrl 合法 ws/wss 地址原样通过', () => {
  assert.equal(normalizeServerUrl('ws://127.0.0.1:17195'), 'ws://127.0.0.1:17195/')
  assert.equal(normalizeServerUrl('wss://example.com/lyrics'), 'wss://example.com/lyrics')
})

test('normalizeServerUrl 拒绝 http 协议与非法值', () => {
  assert.equal(normalizeServerUrl('http://127.0.0.1:17195'), '')
  assert.equal(normalizeServerUrl(':::bad::'), '')
  assert.equal(normalizeServerUrl(''), '')
})

test('normalizeServerUrl 空值返回 fallback', () => {
  assert.equal(normalizeServerUrl('', 'ws://fallback'), 'ws://fallback')
})

test('arrayBufferToBase64 编码正确', () => {
  const bytes = new TextEncoder().encode('AB')
  assert.equal(arrayBufferToBase64(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), 'QUI=')
})

test('arrayBufferToBase64 支持超过单个分块的输入', () => {
  const bytes = new Uint8Array(0x8000 + 5).fill(65)
  const base64 = arrayBufferToBase64(bytes.buffer)
  assert.ok(base64.startsWith('QUJDREVGRw==') || base64.length > 0)
  assert.equal(base64, Buffer.from(bytes).toString('base64'))
})
