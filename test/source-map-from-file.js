import getSourceMapFromFile from '../src/source-map-from-file.js';
import { readFileSync } from 'node:fs';
import { suite, test } from 'node:test';

suite('source-map-from-file', () => {
  test('should parse source maps from compiled targets', (t) => {
    const sourceMap = getSourceMapFromFile(
      './test/fixtures/all/ts-compiled/main.js',
    );
    const expected = JSON.parse(
      readFileSync(
        require.resolve('./fixtures/all/ts-compiled/main.js.map'),
        'utf8',
      ),
    );
    t.assert.deepStrictEqual(sourceMap, expected);
  });
  it('should handle extra whitespace characters', (t) => {
    const sourceMap = getSourceMapFromFile(
      './test/fixtures/source-maps/padded.js',
    );
    t.assert.deepStrictEqual(sourceMap, { version: 3 });
  });
  it('should support base64 encoded inline source maps', (t) => {
    const sourceMap = getSourceMapFromFile(
      './test/fixtures/source-maps/inline.js',
    );
    t.assert.strictEqual(sourceMap.version, 3);
  });
});
