import assert from 'node:assert/strict';
import test from 'node:test';
import {parseArgs} from '../src/cli';
import {parseManifest} from '../src/manifest';
import {fixtureManifest} from './fixtures';

test('parses typed build and source options', () => {
  assert.deepEqual(parseArgs(['build', '--source', '../react.dev', '--output-dir=out', '--refresh']), {
    _positionals: ['build'], source: '../react.dev', outputDir: 'out', refresh: true,
  });
});

test('rejects unknown, malformed, and ambiguous CLI arguments', () => {
  assert.throws(() => parseArgs(['build', '--formta', 'epub']), /Unknown option/);
  assert.throws(() => parseArgs(['build', '--format', 'pdf']), /Unknown option/);
  assert.throws(() => parseArgs(['build', '--refresh=false']), /does not take a value/);
  assert.throws(() => parseArgs(['build', '--source', '--refresh']), /Missing value/);
  assert.throws(() => parseArgs(['build', 'extra']), /Unexpected argument/);
});

test('enforces the manifest schema at the runtime boundary', () => {
  assert.deepEqual(parseManifest(fixtureManifest), fixtureManifest);
  assert.throws(() => parseManifest({...fixtureManifest, extra: true}), /unknown property/);
  assert.throws(() => parseManifest({...fixtureManifest, book: {...fixtureManifest.book, slug: '../escape'}}), /book\.slug/);
  const unsafe = structuredClone(fixtureManifest) as unknown as {sections: Array<{groups: Array<{path: string}>}>};
  unsafe.sections[0]!.groups[0]!.path = '/learn/../../escape';
  assert.throws(() => parseManifest(unsafe), /safe \/learn route/);
  const duplicate = structuredClone(fixtureManifest);
  duplicate.sections[0]!.groups[0]!.pages[1]!.path = '/learn/tutorial';
  assert.throws(() => parseManifest(duplicate), /duplicate route/);
});
