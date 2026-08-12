import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {projectRoot} from './fixtures';

test('npm package contains a runnable CLI and all compiled runtime files', () => {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: projectRoot, encoding: 'utf8', env: {...process.env, npm_config_loglevel: 'silent'},
  });
  assert.equal(result.status, 0, result.stderr);
  const parsed: unknown = JSON.parse(result.stdout);
  assert.ok(Array.isArray(parsed));
  const paths = new Set((parsed[0] as {files: Array<{path: string}>}).files.map((file) => file.path));
  assert.equal(paths.has('bin/react-docs-ebook.js'), true);
  assert.equal(paths.has('lib/src/cli.js'), true);
  assert.equal(paths.has('lib/src/build.js'), true);
  assert.equal(paths.has('package.json'), true);
  assert.equal(paths.has('lib/package.json'), false);
});
