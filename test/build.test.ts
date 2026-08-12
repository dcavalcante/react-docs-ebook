import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {build} from '../src/build';
import {fixtureManifest, fixtureRoot} from './fixtures';

test('build publishes outputs and metadata only after Pandoc succeeds', async () => {
  const temporaryRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'react-docs-ebook-build-test-'));
  const binDir = path.join(temporaryRoot, 'bin');
  const outputDir = path.join(temporaryRoot, 'dist');
  const workDir = path.join(temporaryRoot, 'work');
  await fsp.mkdir(binDir);
  const pandoc = path.join(binDir, 'pandoc');
  const xelatex = path.join(binDir, 'xelatex');
  await fsp.writeFile(pandoc, `#!/bin/sh
if [ "$1" = "--version" ]; then exit 0; fi
for argument in "$@"; do
  case "$argument" in
    --no-highlight) no_highlight=1 ;;
    --syntax-highlighting=*) exit 7 ;;
    --output=*) output="\${argument#--output=}" ;;
  esac
done
test -n "$no_highlight" || exit 7
test -n "$output" || exit 8
printf 'fixture ebook\n' > "$output"
if [ -n "$FAKE_PANDOC_FAIL" ]; then printf 'partial output\n' > "$output"; exit 9; fi
`);
  await fsp.writeFile(xelatex, '#!/bin/sh\nexit 0\n');
  await fsp.chmod(pandoc, 0o700);
  await fsp.chmod(xelatex, 0o700);
  const previousPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ''}`;
  try {
    const result = await build(fixtureManifest, {source: fixtureRoot, outputDir, workDir, format: 'all'});
    assert.deepEqual(result.outputs, [path.join(outputDir, 'fixture-book.epub'), path.join(outputDir, 'fixture-book.pdf')]);
    assert.equal(await fsp.readFile(result.outputs[0]!, 'utf8'), 'fixture ebook\n');
    assert.equal(await fsp.readFile(result.outputs[1]!, 'utf8'), 'fixture ebook\n');
    assert.equal(result.metadata.sourceDirty, false);
    assert.equal(result.metadata.sourceRevision, 'fixture');
    assert.equal(fs.existsSync(path.join(outputDir, 'build-metadata.json')), true);

    await fsp.writeFile(result.outputs[0]!, 'previous good output\n');
    await fsp.writeFile(result.outputs[1]!, 'previous good PDF\n');
    process.env.FAKE_PANDOC_FAIL = '1';
    await assert.rejects(build(fixtureManifest, {source: fixtureRoot, outputDir, workDir, format: 'all'}), /status 9/);
    assert.equal(await fsp.readFile(result.outputs[0]!, 'utf8'), 'previous good output\n');
    assert.equal(await fsp.readFile(result.outputs[1]!, 'utf8'), 'previous good PDF\n');
    assert.deepEqual((await fsp.readdir(outputDir)).filter((name) => name.includes('.tmp')), []);
  } finally {
    delete process.env.FAKE_PANDOC_FAIL;
    process.env.PATH = previousPath;
    await fsp.rm(temporaryRoot, {recursive: true, force: true});
  }
});
