import test from 'node:test'
import assert from 'node:assert/strict'
import { formatBalance, HIDDEN_BALANCE } from './balanceDisplay.js'

test('shows the amount when balances are visible', () => {
  assert.equal(formatBalance(1500, false), `₦${(1500).toLocaleString()}`)
  assert.equal(formatBalance('250', false), '₦250')
})

test('treats missing or invalid amounts as zero', () => {
  assert.equal(formatBalance(null, false), '₦0')
  assert.equal(formatBalance('abc', false), '₦0')
})

test('masks every amount the same way when hidden', () => {
  assert.equal(formatBalance(1500, true), HIDDEN_BALANCE)
  assert.equal(formatBalance(9999999, true), HIDDEN_BALANCE)
})
