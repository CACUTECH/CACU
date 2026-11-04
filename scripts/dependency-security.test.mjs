import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const deepmergeEntry = require.resolve('deepmerge');
const mergeImplementations = [
  ['CommonJS entry', require('deepmerge')],
  ['UMD entry', require(path.join(path.dirname(deepmergeEntry), 'umd.js'))],
];

for (const [entry, merge] of mergeImplementations) {
  for (const [shape, target] of [
    ['null prototype', Object.create(null)],
    ['own dangerous keys', JSON.parse('{"__proto__":{"isAdmin":true},"constructor":{"prototype":{"isAdmin":true}},"prototype":{"isAdmin":true},"safe":1}')],
  ]) {
    test(`${entry}: rejects dangerous source and target keys (${shape})`, () => {
      const source = JSON.parse('{"__proto__":{"isAdmin":true},"constructor":{"prototype":{"isAdmin":true}},"prototype":{"isAdmin":true},"name":"CACU"}');
      const result = merge(target, source);
      assert.equal(Object.getPrototypeOf(result), Object.prototype);
      assert.equal(result.isAdmin, undefined);
      for (const key of ['__proto__', 'constructor', 'prototype']) {
        assert.equal(Object.hasOwn(result, key), false);
      }
      assert.equal(result.name, 'CACU');
      assert.equal(Object.prototype.isAdmin, undefined);
    });
  }

  test(`${entry}: rejects nested poisoning with null/primitive placeholders`, () => {
    for (const placeholder of [null, false, 0, '']) {
      const result = merge({ session: placeholder }, JSON.parse('{"session":{"__proto__":{"isAdmin":true},"name":"owner"}}'));
      assert.equal(Object.getPrototypeOf(result.session), Object.prototype);
      assert.equal(result.session.isAdmin, undefined);
      assert.equal(result.session.name, 'owner');
    }
    const result = merge.all([{ items: [] }, JSON.parse('{"items":[{"__proto__":{"isAdmin":true},"id":1}]}')]);
    assert.equal(result.items[0].isAdmin, undefined);
    assert.equal(result.items[0].id, 1);
  });

  test(`${entry}: preserves normal merging, symbols, arrays and custom options`, () => {
    const key = Symbol('metadata');
    const source = { nested: { b: 2 }, list: [2], [key]: 'safe' };
    const result = merge({ nested: { a: 1 }, list: [1] }, source);
    assert.deepEqual(result.nested, { a: 1, b: 2 });
    assert.deepEqual(result.list, [1, 2]);
    assert.equal(result[key], 'safe');
    assert.notEqual(result.nested, source.nested);
    assert.deepEqual(merge({ list: [1] }, { list: [2] }, { arrayMerge: (_target, value) => value }), { list: [2] });
    assert.deepEqual(merge({ nested: { a: 1 } }, { nested: { b: 2 } }, { customMerge: name => name === 'nested' ? () => ({ custom: true }) : undefined }), { nested: { custom: true } });
  });
}

test('ESLint consumer resolves patched minimatch and bounds globparts amplification', () => {
  // Resolve from the real consumer: upgrading a different, unused copy is insufficient.
  const consumerRequire = createRequire(require.resolve('@typescript-eslint/typescript-estree'));
  const entry = consumerRequire.resolve('minimatch');
  const version = consumerRequire('minimatch/package.json').version;
  assert.equal(version, '11.0.1');
  // A child-process timeout also bounds the test if a vulnerable version returns.
  execFileSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const { Minimatch, minimatch } = require(${JSON.stringify(entry)});
    const matcher = new Minimatch(Array(30).fill('**/../a/b').join('/'), {
      optimizationLevel: 2, braceExpandMax: 64,
    });
    assert.ok(matcher.globParts.length <= 64);
    assert.equal(minimatch('src/example.ts', '**/*.ts'), true);
    assert.equal(minimatch('src/example.js', '**/*.ts'), false);
  `], { timeout: 10000, stdio: 'pipe' });
});

test('legacy minimatch consumers retain the callable CommonJS API', () => {
  const legacy = require('minimatch');
  assert.equal(typeof legacy, 'function');
  assert.equal(legacy('src/example.ts', '**/*.ts'), true);
  assert.equal(new legacy.Minimatch('**/*.ts').match('src/example.js'), false);
});
