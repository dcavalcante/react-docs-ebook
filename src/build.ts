import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {dependencyError} from './dependencies';
import {generateBook, validateGeneratedBook} from './generator';
import {PROJECT_ROOT, resolveSource, sourceRevision} from './source';
import type {BookManifest, BuildMetadata, BuildOptions, BuildResult, OutputFormat} from './types';

function isOutputFormat(value: string): value is OutputFormat {
  return value === 'epub' || value === 'pdf' || value === 'all';
}

function run(command: string, args: readonly string[]): void {
  const result = spawnSync(command, args, {stdio: 'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

function generatorVersion(): string {
  const parsed: unknown = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
  return typeof parsed === 'object' && parsed !== null && 'version' in parsed && typeof parsed.version === 'string'
    ? parsed.version
    : 'unknown';
}

async function publishOutputs(staged: ReadonlyMap<string, string>): Promise<void> {
  const backups = new Map<string, string>();
  const published: string[] = [];
  try {
    for (const destination of staged.values()) {
      if (!fs.existsSync(destination)) continue;
      const backup = `${destination}.previous-${process.pid}-${randomUUID()}`;
      await fsp.rename(destination, backup);
      backups.set(destination, backup);
    }
    for (const [temporary, destination] of staged) {
      await fsp.rename(temporary, destination);
      published.push(destination);
    }
  } catch (error) {
    await Promise.all(published.map((destination) => fsp.rm(destination, {force: true})));
    for (const [destination, backup] of backups) {
      if (fs.existsSync(backup)) await fsp.rename(backup, destination);
    }
    throw error;
  }
  await Promise.allSettled([...backups.values()].map((backup) => fsp.rm(backup, {force: true})));
}

async function copyFont(sourceRoot: string, name: string, destination: string): Promise<void> {
  const source = path.join(sourceRoot, 'public', 'fonts', name);
  if (!fs.existsSync(source)) throw new Error(`Required font is missing from react.dev: ${source}`);
  await fsp.copyFile(source, destination);
}

export async function build(manifest: BookManifest, options: BuildOptions = {}): Promise<BuildResult> {
  const requestedFormat = options.format ?? 'epub';
  if (!isOutputFormat(requestedFormat)) throw new Error('--format must be epub, pdf, or all');
  const needPdf = requestedFormat === 'pdf' || requestedFormat === 'all';
  const dependencyOptions = {needPdf, ...(options.pdfEngine === undefined ? {} : {requestedEngine: options.pdfEngine})};
  const deps = dependencyError(dependencyOptions);
  if (!deps.result.hasPandoc || (needPdf && (!deps.result.pdfEngine || deps.result.hasSvgConverter === false))) {
    throw new Error(`Missing build dependencies.\n\n${deps.message}`);
  }

  const sourceRoot = await resolveSource(manifest, options);
  const source = sourceRevision(sourceRoot, options.ref ?? manifest.source.ref);
  const outputDir = path.resolve(options.outputDir ?? path.join(PROJECT_ROOT, 'dist'));
  const workDir = path.resolve(options.workDir ?? path.join(PROJECT_ROOT, 'build'));
  await Promise.all([fsp.mkdir(outputDir, {recursive: true}), fsp.mkdir(workDir, {recursive: true})]);

  const generated = await generateBook({manifest, sourceRoot, revision: source.revision});
  await validateGeneratedBook(generated.markdown, sourceRoot);
  const markdownFile = path.join(workDir, `${manifest.book.slug}.md`);
  const temporaryMarkdown = `${markdownFile}.${process.pid}.tmp`;
  await fsp.writeFile(temporaryMarkdown, generated.markdown);
  await fsp.rename(temporaryMarkdown, markdownFile);
  for (const [route, names] of generated.warnings) console.warn(`Warning: normalized unsupported MDX wrappers in ${route}: ${names.join(', ')}`);

  const resourcePath = `${path.join(sourceRoot, 'public')}${path.delimiter}${sourceRoot}`;
  const common = [markdownFile, '--toc', '--toc-depth=3', `--resource-path=${resourcePath}`, '--no-highlight'];
  const outputs: string[] = [];
  const stagedOutputs = new Map<string, string>();

  try {
  if (requestedFormat === 'epub' || requestedFormat === 'all') {
    const fontDir = path.join(workDir, 'fonts');
    await fsp.mkdir(fontDir, {recursive: true});
    const regular = path.join(fontDir, 'Source-Code-Pro-Regular.woff2');
    const bold = path.join(fontDir, 'Source-Code-Pro-Bold.woff2');
    await Promise.all([
      copyFont(sourceRoot, 'Source-Code-Pro-Regular.woff2', regular),
      copyFont(sourceRoot, 'Source-Code-Pro-Bold.woff2', bold),
    ]);
    const output = path.join(outputDir, `${manifest.book.slug}.epub`);
    const temporary = path.join(outputDir, `.${manifest.book.slug}.${process.pid}-${randomUUID()}.tmp.epub`);
    stagedOutputs.set(temporary, output);
    run('pandoc', [...common, '--split-level=3', `--css=${path.join(PROJECT_ROOT, 'styles', 'epub.css')}`,
      `--epub-embed-font=${regular}`, `--epub-embed-font=${bold}`, `--output=${temporary}`]);
    outputs.push(output);
  }

  if (needPdf) {
    const pdfEngine = deps.result.pdfEngine;
    if (!pdfEngine) throw new Error('PDF engine disappeared after dependency validation');
    const output = path.join(outputDir, `${manifest.book.slug}.pdf`);
    const temporary = path.join(outputDir, `.${manifest.book.slug}.${process.pid}-${randomUUID()}.tmp.pdf`);
    stagedOutputs.set(temporary, output);
    const args = [...common, `--pdf-engine=${pdfEngine}`, '--variable=geometry:margin=1in',
      '--variable=fontsize:10pt', '--variable=colorlinks=true'];
    if (pdfEngine === 'xelatex' || pdfEngine === 'lualatex') args.push(`--include-in-header=${path.join(PROJECT_ROOT, 'styles', 'pdf-header.tex')}`);
    args.push(`--output=${temporary}`);
    run('pandoc', args);
    outputs.push(output);
  }

  const metadata: BuildMetadata = {
    generatedAt: new Date().toISOString(), generatorVersion: generatorVersion(),
    sourceRepository: manifest.source.repository, sourceRevision: source.revision, sourceDirty: source.dirty,
    sourceRef: options.ref ?? manifest.source.ref, pages: generated.pageCount,
    outputs: outputs.map((output) => path.basename(output)),
  };
  const metadataFile = path.join(outputDir, 'build-metadata.json');
  const temporaryMetadata = path.join(outputDir, `.build-metadata.${process.pid}.json.tmp`);
  await fsp.writeFile(temporaryMetadata, `${JSON.stringify(metadata, null, 2)}\n`);
  stagedOutputs.set(temporaryMetadata, metadataFile);
  await publishOutputs(stagedOutputs);
  return {outputs, metadata, warnings: generated.warnings, markdownFile};
  } finally {
    await Promise.all([...stagedOutputs.keys()].map((temporary) => fsp.rm(temporary, {force: true})));
  }
}
