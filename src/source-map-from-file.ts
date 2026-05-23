/*
 * Copyright Node.js contributors. All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */
// TODO(bcoe): this logic is ported from Node.js' internal source map
// helpers:
// https://github.com/nodejs/node/blob/master/lib/internal/source_map/source_map_cache.js
// we should to upstream and downstream fixes.

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import util from 'node:util';

const debuglog = util.debuglog('c8');

const sourceMapLineRE =
  /\/[*/]#\s+sourceMappingURL=(?<sourceMappingURL>[^\s]+)/;

/**
 * Extract the sourcemap url from a source file
 * reference: https://sourcemaps.info/spec.html
 * @param {String} filename - compilation target file
 * @returns {String} full path to source map file
 * @private
 */
export function getSourceMapFromFile(
  filename: string,
): Record<string, unknown> | null {
  const fileBody = readFileSync(filename).toString();
  const results = fileBody.match(sourceMapLineRE);
  if (results !== null && results.groups?.sourceMappingURL !== undefined) {
    const sourceMappingURL = results.groups.sourceMappingURL;
    const sourceMap = dataFromUrl(
      pathToFileURL(filename).href,
      sourceMappingURL,
    );
    return sourceMap;
  } else {
    return null;
  }
}

function dataFromUrl(
  sourceURL: string,
  sourceMappingURL: string,
): Record<string, unknown> | null {
  try {
    const url = new URL(sourceMappingURL);
    switch (url.protocol) {
      case 'data:':
        return sourceMapFromDataUrl(url.pathname);
      default:
        return null;
    }
  } catch (err) {
    debuglog(String(err));
    // If no scheme is present, we assume we are dealing with a file path.
    const mapURL = new URL(sourceMappingURL, sourceURL).href;
    return sourceMapFromFile(mapURL);
  }
}

function sourceMapFromFile(mapURL: string): Record<string, unknown> | null {
  try {
    const content = readFileSync(fileURLToPath(mapURL), 'utf8');
    return JSON.parse(content);
  } catch (err) {
    debuglog(String(err));
    return null;
  }
}

// data:[<mediatype>][;base64],<data> see:
// https://tools.ietf.org/html/rfc2397#section-2
function sourceMapFromDataUrl(url: string): Record<string, unknown> | null {
  // TODO (jg): is this really a safe cast?
  const { 0: format, 1: data } = url.split(',') as [string, string];
  const splitFormat = format.split(';');
  const contentType = splitFormat[0];
  const base64 = splitFormat[splitFormat.length - 1] === 'base64';
  if (contentType === 'application/json') {
    const decodedData = base64
      ? Buffer.from(data, 'base64').toString('utf8')
      : data;
    try {
      return JSON.parse(decodedData);
    } catch (err) {
      debuglog(String(err));
      return null;
    }
  } else {
    debuglog(`unexpected content-type ${contentType}`);
    return null;
  }
}
