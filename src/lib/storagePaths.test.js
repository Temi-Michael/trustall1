import test from 'node:test'
import assert from 'node:assert/strict'
import { storagePathFromUrl } from './storagePaths.js'

test('plain paths pass through unchanged', () => {
  assert.equal(storagePathFromUrl('dispute-evidence/abc/1_photo.png', 'dispute-evidence'), 'dispute-evidence/abc/1_photo.png')
})

test('old public URLs are turned back into paths', () => {
  const url = 'https://xyz.supabase.co/storage/v1/object/public/dispute-evidence/dispute-evidence/abc/1_my%20photo.png'
  assert.equal(storagePathFromUrl(url, 'dispute-evidence'), 'dispute-evidence/abc/1_my photo.png')
})

test('URLs for another bucket or site give no path', () => {
  assert.equal(storagePathFromUrl('https://xyz.supabase.co/storage/v1/object/public/avatars/a.png', 'dispute-evidence'), '')
  assert.equal(storagePathFromUrl('https://evil.example/x.png', 'dispute-evidence'), '')
  assert.equal(storagePathFromUrl(null, 'dispute-evidence'), '')
})
