import assert from 'node:assert/strict'
import test from 'node:test'

import { buildLineDetail, buildLyrics } from '../src/lyrics.js'

const realLine = {
  time: 3.43,
  text: '第一句歌词',
  characters: [
    { text: '第', startTime: 3430, endTime: 3550 },
    { text: '一', startTime: 3550, endTime: 3670 },
  ],
  translated: 'First line',
  romanized: 'dai yi ju',
}

test('真实逐字时间轴正常下发', () => {
  const detail = buildLineDetail(realLine)
  assert.deepEqual(detail.characters, [
    { s: 3430, e: 3550, t: '第' },
    { s: 3550, e: 3670, t: '一' },
  ])
  assert.equal(detail.translated, 'First line')
  assert.equal(detail.romanized, 'dai yi ju')
})

test('主歌词为真实逐字时音译逐字随行下发', () => {
  const detail = buildLineDetail({
    ...realLine,
    romanizedCharacters: [
      { text: 'd', startTime: 3430, endTime: 3550 },
      { text: 'y', startTime: 3550, endTime: 3670 },
    ],
  })
  assert.deepEqual(detail.romanized_characters, [
    { s: 3430, e: 3550, t: 'd' },
    { s: 3550, e: 3670, t: 'y' },
  ])
})

test('估算行（charactersEstimated）不下发逐字时间轴', () => {
  const detail = buildLineDetail({
    ...realLine,
    charactersEstimated: true,
    romanizedCharacters: realLine.characters,
  })
  assert.equal(detail.characters, undefined)
  // 音译逐字继承主歌词时间轴，主歌词为估算时同样不下发
  assert.equal(detail.romanized_characters, undefined)
  // 文本仍保留
  assert.equal(detail.translated, 'First line')
  assert.equal(detail.romanized, 'dai yi ju')
})

test('宿主占位字符（endTime=0）不当作逐字数据', () => {
  const detail = buildLineDetail({
    time: 3.43,
    text: '整行文本',
    characters: [{ text: '整行文本', startTime: 3430, endTime: 0 }],
  })
  assert.equal(detail.characters, undefined)
})

test('全零时间轴不当作逐字数据', () => {
  const detail = buildLineDetail({
    text: 'x',
    characters: [{ text: 'x', startTime: 0, endTime: 0 }],
  })
  assert.equal(detail.characters, undefined)
})

test('翻译逐字（宿主为比例均分估算值）不再下发', () => {
  const detail = buildLineDetail({
    ...realLine,
    translatedCharacters: [{ text: 'F', startTime: 3430, endTime: 3500 }],
  })
  assert.equal(detail.translated_characters, undefined)
  assert.equal(detail.translated, 'First line')
})

test('buildLyrics 输出 time_ms 与文本', () => {
  const lines = buildLyrics([realLine])
  assert.equal(lines.length, 1)
  assert.equal(lines[0].time_ms, 3430)
  assert.equal(lines[0].text, '第一句歌词')
  assert.ok(Array.isArray(lines[0].characters))
})

test('buildLyrics 叠加宿主歌词偏移', () => {
  const lines = buildLyrics([realLine], 500)
  assert.equal(lines[0].time_ms, 3930)
  assert.deepEqual(lines[0].characters, [
    { s: 3930, e: 4050, t: '第' },
    { s: 4050, e: 4170, t: '一' },
  ])
})

test('buildLyrics 负偏移与非法偏移', () => {
  assert.equal(buildLyrics([realLine], -300)[0].time_ms, 3130)
  assert.equal(buildLyrics([realLine], 'abc')[0].time_ms, 3430)
  assert.equal(buildLyrics([realLine], null)[0].time_ms, 3430)
})

test('buildLyrics 空数组输出空数组', () => {
  assert.deepEqual(buildLyrics([]), [])
})
