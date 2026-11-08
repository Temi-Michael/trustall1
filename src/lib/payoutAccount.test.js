import test from 'node:test'
import assert from 'node:assert/strict'
import { isCompleteAccountNumber, namesLookRelated, normalizeAccountNumber } from './payoutAccount.js'

test('account numbers keep digits only, up to 10', () => {
  assert.equal(normalizeAccountNumber('012 345-6789'), '0123456789')
  assert.equal(normalizeAccountNumber('01234567899999'), '0123456789')
  assert.equal(normalizeAccountNumber(null), '')
  assert.equal(isCompleteAccountNumber('0123456789'), true)
  assert.equal(isCompleteAccountNumber('012345678'), false)
  assert.equal(isCompleteAccountNumber('01234567ab'), false)
})

test('account names are compared on real words, ignoring business words', () => {
  assert.equal(namesLookRelated('OKAFOR ADA CHIOMA', 'Ada Okafor'), true)
  assert.equal(namesLookRelated('ADA FASHION VENTURES', 'Chioma Eze', 'Ada Fashion'), true)
  assert.equal(namesLookRelated('BELLO MUSA', 'Ada Okafor', 'Ada Fashion Ventures'), false)
  assert.equal(namesLookRelated('GLOBAL SERVICES LTD', 'Global Services'), true, 'only generic words: nothing to compare')
  assert.equal(namesLookRelated('ADA OKAFOR', '', null), true, 'no profile names: no warning')
})
