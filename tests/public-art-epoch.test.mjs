// Portable descriptor controls. Native filesystem epochs are in the explicit optional suite.
import test from 'node:test';

import assert from 'node:assert/strict';

import { readBoundedArtDescriptor } from '../tools/mobile-art-runtime.mjs';

test('registry descriptor reading is exact, bounded and rejects growth or truncation', async () => {
  assert.equal(typeof readBoundedArtDescriptor, 'function', 'Implement bounded registry reader');
  for (const [size, data, accepted] of [ [ 1, 'a', true ], [ 3, 'abc', true ], [ 3, 'abcd', false ], [ 3, 'a', false ] ]) {
    let at = 0;
    let largestBuffer = 0;
    const handle = {
      async read(buffer, offset, length) {
        largestBuffer = Math.max(largestBuffer, buffer.length);
        const bytesRead = Math.min(length, data.length - at);
        buffer.write(data.slice(at, at + bytesRead), offset);
        at += bytesRead;
        return {
          bytesRead: bytesRead
        };
      }
    };
    if (accepted) assert.equal((await readBoundedArtDescriptor(handle, size)).toString(), data); else await assert.rejects(readBoundedArtDescriptor(handle, size), /changed/);
    assert.equal(largestBuffer, size + 1, 'Growing data cannot enlarge admitted allocation');
  }
  for (const size of [ 0, -1, 1024 * 1024 + 1, NaN, Infinity ]) {
    await assert.rejects(readBoundedArtDescriptor({
      read() {
        throw Error('Must not read');
      }
    }, size), /bounded/);
  }
});
