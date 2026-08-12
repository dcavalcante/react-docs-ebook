import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {findLocalSource, reactVersion, sourceCacheRoot, sourceRevision} from '../src/source';

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

test('reads the React documentation version from the selected source', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'react-docs-version-test-'));
  try {
    await fsp.mkdir(path.join(root, 'src'));
    const versionFile = path.join(root, 'src', 'siteConfig.js');
    await fsp.writeFile(versionFile, "exports.siteConfig = {version: '27.4'};\n");
    assert.equal(reactVersion(root, 'src/siteConfig.js'), '27.4');
    await fsp.writeFile(versionFile, "exports.siteConfig = {version: 'latest'};\n");
    assert.throws(() => reactVersion(root, 'src/siteConfig.js'), /valid React version/);
  } finally {
    await fsp.rm(root, {recursive: true, force: true});
  }
});

async function createReactSource(root: string): Promise<void> {
  await fsp.mkdir(path.join(root, 'src'), {recursive: true});
  await fsp.writeFile(path.join(root, 'src', 'sidebarLearn.json'), '{"routes":[]}\n');
}

test('discovers react.dev from the invocation directory and workspace ancestors', async () => {
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'react-docs-discovery-test-'));
  const reactRoot = path.join(workspace, 'react.dev');
  const nestedTool = path.join(workspace, 'tools', 'ebook', 'scripts');
  try {
    await Promise.all([createReactSource(reactRoot), fsp.mkdir(nestedTool, {recursive: true})]);
    const sidebar = 'src/sidebarLearn.json';
    assert.equal(findLocalSource(undefined, sidebar, workspace, {}), reactRoot);
    assert.equal(findLocalSource(undefined, sidebar, nestedTool, {}), reactRoot);
    assert.equal(findLocalSource(undefined, sidebar, path.join(reactRoot, 'src'), {}), reactRoot);
    assert.equal(findLocalSource('../../../react.dev', sidebar, nestedTool, {}), reactRoot);
    assert.equal(findLocalSource(undefined, sidebar, nestedTool, {REACT_DEV_SOURCE: '../../../react.dev'}), reactRoot);
    assert.throws(() => findLocalSource('./missing', sidebar, workspace, {}), /Not a react\.dev checkout/);
    assert.throws(
      () => findLocalSource(undefined, sidebar, workspace, {REACT_DEV_SOURCE: './missing'}),
      /REACT_DEV_SOURCE is not a react\.dev checkout/,
    );
  } finally {
    await fsp.rm(workspace, {recursive: true, force: true});
  }
});

test('places downloaded sources in a persistent user cache', () => {
  assert.equal(
    sourceCacheRoot({XDG_CACHE_HOME: '/var/cache/example'}, 'linux', '/home/example'),
    path.join('/var/cache/example', 'react-docs-ebook'),
  );
  assert.equal(
    sourceCacheRoot({}, 'darwin', '/Users/example'),
    path.join('/Users/example', 'Library', 'Caches', 'react-docs-ebook'),
  );
  assert.equal(
    sourceCacheRoot({}, 'linux', '/home/example'),
    path.join('/home/example', '.cache', 'react-docs-ebook'),
  );
  assert.equal(
    sourceCacheRoot({REACT_DOCS_EBOOK_CACHE: '/custom/cache'}, 'linux', '/home/example'),
    '/custom/cache',
  );
});
