import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, readdir, rm, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as output from '../tools/build-output.mjs';

async function fixture(t) {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'heartwood-paths-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  await mkdir(join(folder, 'Project'));
  return folder;
}

test('Windows replacement retries a transient busy error and publishes exact bytes', { timeout: 2000 }, async t => {
  const folder = await fixture(t);
  const temporary = join(folder, 'tmp'), target = join(folder, 'result');
  await writeFile(temporary, 'new'); await writeFile(target, 'old');
  assert.equal(typeof output.replaceOutputFile, 'function');
  let attempts = 0;
  const { rename } = await import('node:fs/promises');
  await output.replaceOutputFile(temporary, target, { platform: 'win32',
    retryDelayMs: 1, renameFile: async (...args) => {
      if (++attempts === 1) throw Object.assign(Error('busy'), { code: 'EPERM' });
      await rename(...args);
    },
  });
  assert.equal(attempts, 2);
  assert.equal(await readFile(target, 'utf8'), 'new');
  assert.deepEqual((await readdir(folder)).sort(), ['Project', 'result']);
});

test('retry preserves a foreign target change after a failed attempt', { timeout: 2000 }, async t => {
  const folder = await fixture(t);
  const temporary = join(folder, 'tmp'), target = join(folder, 'result');
  await writeFile(temporary, 'new'); await writeFile(target, 'old');
  assert.equal(typeof output.replaceOutputFile, 'function');
  let attempts = 0;
  await assert.rejects(output.replaceOutputFile(temporary, target, { platform: 'win32', retryDelayMs: 1,
    renameFile: async () => {
      attempts++; await writeFile(target, 'changed by somebody else');
      throw Object.assign(Error('busy'), { code: 'EACCES' });
    },
  }), /changed/);
  assert.equal(attempts, 1);
  assert.equal(await readFile(target, 'utf8'), 'changed by somebody else');
  assert.equal(await readFile(temporary, 'utf8'), 'new');
});

test('Windows busy retries stop within the configured finite attempt limit', { timeout: 2000 }, async t => {
  const folder = await fixture(t);
  const temporary = join(folder, 'tmp'), target = join(folder, 'result');
  await writeFile(temporary, 'new'); await writeFile(target, 'old');
  assert.equal(typeof output.replaceOutputFile, 'function');
  let attempts = 0;
  await assert.rejects(output.replaceOutputFile(temporary, target, { platform: 'win32',
    attempts: 3, retryDelayMs: 1, renameFile: async () => {
      attempts++; throw Object.assign(Error('busy'), { code: 'EBUSY' });
    },
  }), /busy/);
  assert.equal(attempts, 3);
  assert.equal(await readFile(target, 'utf8'), 'old');
});

test('non-Windows and non-transient failures never retry', { timeout: 2000 }, async t => {
  const folder = await fixture(t);
  for (const [platform, code] of [['linux', 'EBUSY'], ['win32', 'ENOSPC']]) {
    const temporary = join(folder, 'tmp'), target = join(folder, 'result');
    await writeFile(temporary, 'new'); await writeFile(target, 'old');
    assert.equal(typeof output.replaceOutputFile, 'function');
    let attempts = 0;
    await assert.rejects(output.replaceOutputFile(temporary, target, { platform, retryDelayMs: 1,
      renameFile: async () => { attempts++; throw Object.assign(Error(code), { code }); },
    }), new RegExp(code));
    assert.equal(attempts, 1);
  }
});

test('only known OS metadata is omitted from a strict photo closure', () => {
  assert.equal(typeof output.isOperatingSystemMetadata, 'function');
  for (const name of ['.DS_Store', 'Thumbs.db', 'THUMBS.DB', 'desktop.ini', 'DESKTOP.INI']) {
    assert.equal(output.isOperatingSystemMetadata(name), true);
  }
  for (const name of ['.hidden.webp', 'Thumbs.webp', 'photo.jpg', '.ds_store', 'sub/Thumbs.db']) {
    assert.equal(output.isOperatingSystemMetadata(name), false);
  }
});

test('a failed retry does not recreate a removed output parent', { timeout: 2000 }, async t => {
  const folder = await fixture(t), parent = join(folder, 'Project');
  const temporary = join(folder, 'tmp'), target = join(parent, 'result');
  await writeFile(temporary, 'new'); await writeFile(target, 'old');
  let attempts = 0;
  await assert.rejects(output.replaceOutputFile(temporary, target, { platform: 'win32', retryDelayMs: 1,
    renameFile: async () => {
      attempts++; await rename(parent, join(folder, 'preserved'));
      throw Object.assign(Error('busy'), { code: 'EPERM' });
    },
  }), /changed or disappeared/);
  assert.equal(attempts, 1);
  assert.deepEqual((await readdir(folder)).sort(), ['preserved', 'tmp']);
  assert.equal(await readFile(join(folder, 'preserved', 'result'), 'utf8'), 'old');
});

test('generated output cannot escape its selected directory', { timeout: 2000 }, async t => {
  const folder = await fixture(t);
  await assert.rejects(output.writeOutput(join(folder, 'Project'), '../foreign.txt', 'bad'), /escaped/);
  assert.deepEqual(await readdir(folder), ['Project']);
});

test('replacement aborts promptly without publishing after a stop signal', { timeout: 2000 }, async t => {
  const folder = await fixture(t), temporary = join(folder, 'tmp'), target = join(folder, 'result');
  await writeFile(temporary, 'new'); await writeFile(target, 'old');
  const controller = new AbortController();
  let attempts = 0;
  await assert.rejects(output.replaceOutputFile(temporary, target, { platform: 'win32',
    signal: controller.signal, renameFile: async () => {
      attempts++; controller.abort(Error('stop requested'));
      throw Object.assign(Error('busy'), { code: 'EPERM' });
    },
  }), /abort|stop requested/);
  assert.equal(attempts, 1);
  assert.equal(await readFile(target, 'utf8'), 'old');
});
