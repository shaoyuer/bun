'use strict';

require('../common');
const assert = require('assert');

// Tests below are not from WPT.
const params = new URLSearchParams('a=b&c=d');
const entries = params.entries();
assert.strictEqual(typeof entries[Symbol.iterator], 'function');
assert.strictEqual(entries[Symbol.iterator](), entries);
assert.deepStrictEqual(entries.next(), {
  value: ['a', 'b'],
  done: false
});
assert.deepStrictEqual(entries.next(), {
  value: ['c', 'd'],
  done: false
});
assert.deepStrictEqual(entries.next(), {
  value: undefined,
  done: true
});
assert.deepStrictEqual(entries.next(), {
  value: undefined,
  done: true
});

assert.throws(() => {
  entries.next.call(undefined);
}, {
  code: 'ERR_INVALID_THIS',
  name: 'TypeError',
  message: 'Cannot call next() on a non-Iterator object'
});
assert.throws(() => {
  params.entries.call(undefined);
}, {
  code: 'ERR_INVALID_THIS',
  name: 'TypeError',
  message:  'Can only call URLSearchParams.entries on instances of URLSearchParams'
});
