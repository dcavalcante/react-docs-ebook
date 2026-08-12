import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {sourceRevision} from '../src/source';

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync('git', args, {cwd, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
}

test('local revisions report uncommitted and untracked source changes', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'react-docs-revision-test-'));
  try {
    git(root, 'init', '--quiet');
    git(root, 'config', 'user.name', 'Test');
    git(root, 'config', 'user.email', 'test@example.invalid');
    await fsp.writeFile(path.join(root, 'tracked.txt'), 'initial\n');
    git(root, 'add', 'tracked.txt');
    git(root, 'commit', '--quiet', '-m', 'initial');
    const clean = sourceRevision(root, 'fallback');
    assert.match(clean.revision, /^[0-9a-f]{40}$/);
    assert.equal(clean.dirty, false);
    await fsp.writeFile(path.join(root, 'untracked.txt'), 'dirty\n');
    assert.deepEqual(sourceRevision(root, 'fallback'), {revision: clean.revision, dirty: true});
  } finally {
    await fsp.rm(root, {recursive: true, force: true});
  }
});
