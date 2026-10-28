import test from 'node:test'
import assert from 'node:assert/strict'
import { escapeLikePattern, safeFileName } from './inputSafety.js'

test('escapes like wildcards so search text matches literally', () => {
  assert.equal(escapeLikePattern('50%_off*'), '50\\%\\_off\\*')
  assert.equal(escapeLikePattern('back\\slash'), 'back\\\\slash')
  assert.equal(escapeLikePattern('plain words'), 'plain words')
  assert.equal(escapeLikePattern(null), '')
})

test('file names cannot add folders or unsafe characters', () => {
  assert.equal(safeFileName('../../etc/passwd'), 'etc_passwd')
  assert.equal(safeFileName('my photo (1).JPG'), 'my_photo_1_.JPG')
  assert.equal(safeFileName('été.png'), 'ete.png')
  assert.equal(safeFileName('a/b\\c?d#e.pdf'), 'a_b_c_d_e.pdf')
  assert.equal(safeFileName('...'), 'file')
  assert.equal(safeFileName(''), 'file')
})

test('long file names keep their extension', () => {
  const name = safeFileName(`${'x'.repeat(300)}.png`)
  assert.equal(name.length, 100)
  assert.ok(name.endsWith('.png'))
})
