import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {allManifestPages, generateBook, validateGeneratedBook} from '../src/generator';
import {checkIndex} from '../src/index-check';
import {loadManifest, parseManifest} from '../src/manifest';
import type {BookManifest} from '../src/types';
import {fixtureManifest, fixtureRoot, projectRoot} from './fixtures';

test('the project manifest is valid and tracks 51 unique routes', () => {
  const {manifest} = loadManifest(path.join(projectRoot, 'book.json'));
  assert.equal(allManifestPages(manifest).length, 51);
  assert.equal(new Set(allManifestPages(manifest).map((page) => page.path)).size, 51);
  const unsafe = structuredClone(manifest);
  unsafe.source.versionFile = '../siteConfig.js';
  assert.throws(() => parseManifest(unsafe), /source\.versionFile must be a safe relative path/);
});

test('hermetic manifest matches its fixture sidebar', () => {
  const report = checkIndex(fixtureManifest, fixtureRoot);
  assert.equal(report.clean, true, JSON.stringify(report, null, 2));
  assert.equal(report.upstreamCount, 5);
});

test('custom display titles and order can remain update-clean while section moves are detected', () => {
  const customized = structuredClone(fixtureManifest);
  const quickStart = customized.sections[0]!.groups[0]!;
  quickStart.title = 'My Quick Start';
  quickStart.sourceTitle = 'Quick Start';
  quickStart.pages[0]!.title = 'My Tutorial';
  quickStart.pages[0]!.sourceTitle = 'Tutorial';
  quickStart.pages.reverse();
  customized.source.trackOrder = false;
  assert.equal(checkIndex(parseManifest(customized), fixtureRoot).clean, true);

  const moved = structuredClone(fixtureManifest);
  const page = moved.sections[0]!.groups[0]!.pages.pop();
  assert.ok(page);
  moved.sections[1]!.groups[0]!.pages.push(page);
  const movedReport = checkIndex(moved, fixtureRoot);
  assert.equal(movedReport.clean, false);
  assert.deepEqual(movedReport.moved.map((item) => item.path), ['/learn/reference-page']);
});

test('AST conversion preserves code and resolves links, images, wrappers, and heading hierarchy', async () => {
  const result = await generateBook({
    manifest: fixtureManifest, sourceRoot: fixtureRoot, revision: 'test-revision', reactVersion: '19.2',
  });
  assert.equal(result.pageCount, 5);
  assert.match(result.markdown, /title: "Fixture \\"Book\\" 19\.2"/);
  assert.match(result.markdown, /React documentation version: \*\*19\.2\*\*/);
  assert.match(result.markdown, /`<MyButton \/>`/);
  assert.match(result.markdown, /\[Same-page section\]\(#learn-components\)/);
  assert.match(result.markdown, /\[child section\]\(#learn-tutorial-setup\)/);
  assert.match(result.markdown, /\[bare child section\]\(#learn-tutorial-setup\)/);
  assert.match(result.markdown, /\[external reference\]\(https:\/\/react\.dev\/reference\/react\/useMemo\)/);
  assert.match(result.markdown, /!\[Raw screenshot\]\(images\/docs\/raw\.png\)/);
  assert.match(result.markdown, /!\[Sample diagram\]\(images\/docs\/diagrams\/sample_diagram\.png\)/);
  assert.match(result.markdown, /```sh\nnpm install react\n```/);
  assert.match(result.markdown, /\*\*File: src\/App\.js\*\*/);
  assert.match(result.markdown, /return <MyButton \/>;/);
  assert.match(result.markdown, /^### Components \{#learn-components\}$/m);
  assert.match(result.markdown, /^#### Setup \{#learn-tutorial-setup\}$/m);
  assert.match(result.markdown, /^##### Nested section \{#learn-tutorial-nested-section\}$/m);
  assert.match(result.markdown, /^###### Deep section \{#learn-tutorial-deep-section\}$/m);
  assert.deepEqual(result.warnings.get('/learn'), ['Mystery']);

  const identifiers = new Set([...result.markdown.matchAll(/\{#([^}]+)\}/g)].map((match) => match[1]));
  const targets = [...result.markdown.matchAll(/\]\(#([^)]+)\)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(targets.filter((target) => !identifiers.has(target)))], []);
  await assert.doesNotReject(validateGeneratedBook(result.markdown, fixtureRoot));
  await assert.rejects(validateGeneratedBook(`${result.markdown}\n[Broken](#missing)\n`, fixtureRoot), /unresolved/);
  await assert.rejects(validateGeneratedBook(`${result.markdown}\n![Broken](images\/missing.png)\n`, fixtureRoot), /missing local images/);
});

test('enabled false removes content without removing its tracked route', async () => {
  const custom = structuredClone(fixtureManifest) as BookManifest;
  custom.sections[0]!.groups[0]!.enabled = false;
  const result = await generateBook({manifest: custom, sourceRoot: fixtureRoot, revision: 'test', reactVersion: '19.2'});
  assert.doesNotMatch(result.markdown, /## Quick Start/);
  assert.equal(allManifestPages(custom, true).some((page) => page.path === '/learn'), true);
});
