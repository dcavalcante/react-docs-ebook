import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {spawnSync} from 'node:child_process';
import type {ReadableStream} from 'node:stream/web';
import type {BookManifest, SourceOptions} from './types';

export const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CACHE_REVISIONS = 2;

function isReactSource(candidate: string | undefined, sidebar = 'src/sidebarLearn.json'): candidate is string {
  return Boolean(candidate && fs.existsSync(path.join(candidate, sidebar)));
}

export function findLocalSource(explicit: string | undefined, sidebar: string): string | undefined {
  const candidates = [
    explicit && explicit !== 'github' ? path.resolve(explicit) : undefined,
    process.env.REACT_DEV_SOURCE ? path.resolve(process.env.REACT_DEV_SOURCE) : undefined,
    path.resolve(PROJECT_ROOT, '..', 'react.dev'),
    path.resolve(PROJECT_ROOT, '..'),
  ].filter((candidate): candidate is string => candidate !== undefined);
  const found = candidates.find((candidate) => isReactSource(candidate, sidebar));
  if (!found && explicit && explicit !== 'github') throw new Error(`Not a react.dev checkout: ${path.resolve(explicit)}`);
  return found;
}

function safeRef(ref: string): string {
  const readable = ref.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 48) || 'ref';
  const digest = createHash('sha256').update(ref).digest('hex').slice(0, 10);
  return `${readable}-${digest}`;
}

interface GitHubCommitResponse {sha: string}
interface CacheRecord {repository: string; ref: string; revision: string; directory: string}

function isGitHubCommitResponse(value: unknown): value is GitHubCommitResponse {
  return typeof value === 'object' && value !== null && 'sha' in value && typeof value.sha === 'string';
}

function isCacheRecord(value: unknown): value is CacheRecord {
  return typeof value === 'object' && value !== null
    && 'repository' in value && typeof value.repository === 'string'
    && 'ref' in value && typeof value.ref === 'string'
    && 'revision' in value && typeof value.revision === 'string'
    && 'directory' in value && typeof value.directory === 'string';
}

async function resolveGitHubRevision(repository: string, ref: string): Promise<string> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const response = await fetch(`https://api.github.com/repos/${repository}/commits/${encodeURIComponent(ref)}`, {
    headers: {
      accept: 'application/vnd.github+json', 'user-agent': 'react-docs-ebook',
      ...(token ? {authorization: `Bearer ${token}`} : {}),
    },
  });
  if (!response.ok) throw new Error(`Could not resolve ${repository}@${ref} (${response.status} ${response.statusText})`);
  const payload: unknown = await response.json();
  if (!isGitHubCommitResponse(payload)) throw new Error(`GitHub returned an invalid commit response for ${repository}@${ref}`);
  return payload.sha;
}

async function cachedSource(cacheRoot: string, repository: string, ref: string, sidebar: string): Promise<CacheRecord | undefined> {
  const indexPath = path.join(cacheRoot, 'index', `${safeRef(`${repository}@${ref}`)}.json`);
  try {
    const parsed: unknown = JSON.parse(await fsp.readFile(indexPath, 'utf8'));
    if (!isCacheRecord(parsed) || parsed.repository !== repository || parsed.ref !== ref || path.basename(parsed.directory) !== parsed.directory) return undefined;
    const sourceRoot = path.join(cacheRoot, parsed.directory);
    return isReactSource(sourceRoot, sidebar) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function writeCacheRecord(cacheRoot: string, record: CacheRecord): Promise<void> {
  const indexDir = path.join(cacheRoot, 'index');
  await fsp.mkdir(indexDir, {recursive: true});
  const indexPath = path.join(indexDir, `${safeRef(`${record.repository}@${record.ref}`)}.json`);
  const temporary = `${indexPath}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`);
  await fsp.rename(temporary, indexPath);
}

async function acquireLock(lockPath: string): Promise<() => Promise<void>> {
  const deadline = Date.now() + 60_000;
  while (true) {
    try {
      const handle = await fsp.open(lockPath, 'wx');
      await handle.writeFile(`${process.pid}\n`);
      await handle.close();
      return async () => fsp.rm(lockPath, {force: true});
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
      try {
        const stat = await fsp.stat(lockPath);
        if (Date.now() - stat.mtimeMs > 10 * 60_000) {
          await fsp.rm(lockPath, {force: true});
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for source cache lock: ${lockPath}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

async function pruneCache(cacheRoot: string, prefix: string, keep: string): Promise<void> {
  const entries = await fsp.readdir(cacheRoot, {withFileTypes: true});
  const candidates = await Promise.all(entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix) && entry.name !== keep)
    .map(async (entry) => ({name: entry.name, mtimeMs: (await fsp.stat(path.join(cacheRoot, entry.name))).mtimeMs})));
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  for (const candidate of candidates.slice(Math.max(0, CACHE_REVISIONS - 1))) {
    await fsp.rm(path.join(cacheRoot, candidate.name), {recursive: true, force: true});
  }
}

async function downloadSource(manifest: BookManifest, {ref, refresh = false}: SourceOptions = {}): Promise<string> {
  const selectedRef = ref ?? manifest.source.ref;
  const cacheRoot = path.join(PROJECT_ROOT, '.cache');
  await fsp.mkdir(cacheRoot, {recursive: true});
  const existing = await cachedSource(cacheRoot, manifest.source.repository, selectedRef, manifest.source.sidebar);

  let revision: string;
  try {
    revision = await resolveGitHubRevision(manifest.source.repository, selectedRef);
  } catch (error) {
    if (!refresh && existing) {
      console.warn(`Warning: GitHub is unavailable; using cached ${manifest.source.repository}@${existing.revision.slice(0, 12)}.`);
      return path.join(cacheRoot, existing.directory);
    }
    throw error;
  }

  const repositoryKey = safeRef(manifest.source.repository);
  const refKey = safeRef(selectedRef);
  const prefix = `${repositoryKey}-${refKey}-`;
  const directory = `${prefix}${revision.slice(0, 12)}`;
  const destination = path.join(cacheRoot, directory);
  if (!refresh && isReactSource(destination, manifest.source.sidebar)) {
    await writeCacheRecord(cacheRoot, {repository: manifest.source.repository, ref: selectedRef, revision, directory});
    return destination;
  }
  if (spawnSync('tar', ['--version'], {stdio: 'ignore'}).status !== 0) throw new Error('Downloading source requires the `tar` command.');

  const releaseLock = await acquireLock(path.join(cacheRoot, `${directory}.lock`));
  try {
    if (!refresh && isReactSource(destination, manifest.source.sidebar)) return destination;
    const stageRoot = await fsp.mkdtemp(path.join(cacheRoot, '.source-stage-'));
    try {
      const archive = path.join(stageRoot, 'source.tar.gz');
      const extracted = path.join(stageRoot, 'source');
      await fsp.mkdir(extracted);
      const url = `https://codeload.github.com/${manifest.source.repository}/tar.gz/${revision}`;
      console.log(`Downloading ${manifest.source.repository}@${selectedRef} (${revision.slice(0, 12)})...`);
      const response = await fetch(url, {headers: {'user-agent': 'react-docs-ebook'}});
      if (!response.ok || !response.body) throw new Error(`GitHub download failed (${response.status} ${response.statusText})`);
      await pipeline(Readable.fromWeb(response.body as ReadableStream), fs.createWriteStream(archive, {flags: 'wx'}));
      const extractedResult = spawnSync('tar', ['-xzf', archive, '-C', extracted, '--strip-components=1'], {stdio: 'inherit'});
      if (extractedResult.error) throw extractedResult.error;
      if (extractedResult.status !== 0) throw new Error('Could not extract the GitHub source archive.');
      if (!isReactSource(extracted, manifest.source.sidebar)) throw new Error('Downloaded archive is not a valid react.dev source tree.');
      await fsp.writeFile(path.join(extracted, '.ebook-source-ref'), `${revision}\n`);

      const previous = `${destination}.previous-${process.pid}`;
      if (fs.existsSync(destination)) await fsp.rename(destination, previous);
      try {
        await fsp.rename(extracted, destination);
      } catch (error) {
        if (fs.existsSync(previous)) await fsp.rename(previous, destination);
        throw error;
      }
      await fsp.rm(previous, {recursive: true, force: true});
      await writeCacheRecord(cacheRoot, {repository: manifest.source.repository, ref: selectedRef, revision, directory});
      await pruneCache(cacheRoot, prefix, directory);
      return destination;
    } finally {
      await fsp.rm(stageRoot, {recursive: true, force: true});
    }
  } finally {
    await releaseLock();
  }
}

export async function resolveSource(manifest: BookManifest, options: SourceOptions = {}): Promise<string> {
  if (options.source === 'github' || options.download) return downloadSource(manifest, options);
  const local = findLocalSource(options.source, manifest.source.sidebar);
  if (local) return local;
  console.log('No sibling react.dev checkout found; falling back to GitHub.');
  return downloadSource(manifest, options);
}

export interface SourceRevision {revision: string; dirty: boolean}

export function sourceRevision(sourceRoot: string, fallback: string): SourceRevision {
  if (fs.existsSync(path.join(sourceRoot, '.git'))) {
    const result = spawnSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], {encoding: 'utf8'});
    if (result.status === 0) {
      const status = spawnSync('git', ['-C', sourceRoot, 'status', '--porcelain', '--untracked-files=normal'], {encoding: 'utf8'});
      return {revision: result.stdout.trim(), dirty: status.status !== 0 || status.stdout.trim().length > 0};
    }
  }
  const marker = path.join(sourceRoot, '.ebook-source-ref');
  return {revision: fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').trim() : fallback, dirty: false};
}
