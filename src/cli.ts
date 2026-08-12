import path from 'node:path';
import {build} from './build';
import {dependencyError} from './dependencies';
import {checkIndex, formatIndexReport} from './index-check';
import {loadManifest} from './manifest';
import {PROJECT_ROOT, resolveSource} from './source';
import type {CliOptions, OutputFormat} from './types';

export function usage(): string {
  return `react-docs-ebook

Commands:
  build           Build EPUB (default), PDF, or both
  check-updates   Compare book.json with React's current Learn sidebar
  doctor          Check Pandoc and optional PDF dependencies

Common options:
  --manifest PATH       Manifest path (default: book.json)
  --source PATH|github  Local react.dev checkout or GitHub archive
  --ref REF             Git branch, tag, or commit (default from manifest)
  --refresh             Redownload a GitHub source archive
  --download            Download source even when a local checkout exists

Build options:
  --format epub|pdf|all (default: epub)
  --output-dir PATH     Output directory (default: dist)
  --work-dir PATH       Intermediate directory (default: build)
  --pdf-engine COMMAND  Override PDF engine detection`;
}

const booleanOptions = new Set(['refresh', 'download', 'help']);
const valueOptions = new Set(['manifest', 'source', 'ref', 'format', 'outputDir', 'workDir', 'pdfEngine']);

function setBooleanOption(options: CliOptions, key: string): void {
  if (key === 'refresh') options.refresh = true;
  else if (key === 'download') options.download = true;
  else if (key === 'help') options.help = true;
}

function setStringOption(options: CliOptions, key: string, value: string): void {
  if (key === 'manifest') options.manifest = value;
  else if (key === 'source') options.source = value;
  else if (key === 'ref') options.ref = value;
  else if (key === 'outputDir') options.outputDir = value;
  else if (key === 'workDir') options.workDir = value;
  else if (key === 'pdfEngine') options.pdfEngine = value;
}

function camelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function isOutputFormat(value: string): value is OutputFormat {
  return value === 'epub' || value === 'pdf' || value === 'all';
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {_positionals: []};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (!arg.startsWith('--')) { options._positionals.push(arg); continue; }
    const [rawKey = '', inline] = arg.slice(2).split('=', 2);
    const key = camelCase(rawKey);
    if (booleanOptions.has(key)) {
      if (inline !== undefined) throw new Error(`--${rawKey} is a flag and does not take a value`);
      setBooleanOption(options, key);
      continue;
    }
    if (!valueOptions.has(key)) throw new Error(`Unknown option: --${rawKey}`);
    const value = inline ?? argv[++index];
    if (!value || (inline === undefined && value.startsWith('--'))) throw new Error(`Missing value for --${rawKey}`);
    if (key === 'format') {
      if (!isOutputFormat(value)) throw new Error('--format must be epub, pdf, or all');
      options.format = value;
    } else {
      setStringOption(options, key, value);
    }
  }
  if (options._positionals.length > 1) throw new Error(`Unexpected argument: ${options._positionals[1]}`);
  return options;
}

export async function main(argv: readonly string[]): Promise<void> {
  const options = parseArgs(argv);
  const command = options._positionals[0] ?? 'build';
  if (options.help || command === 'help') { console.log(usage()); return; }
  if (!['build', 'check-updates', 'doctor'].includes(command)) throw new Error(`Unknown command: ${command}\n\n${usage()}`);
  if (command === 'doctor') {
    const needPdf = options.format === 'pdf' || options.format === 'all';
    const report = dependencyError({needPdf, ...(options.pdfEngine === undefined ? {} : {requestedEngine: options.pdfEngine})});
    console.log(report.message);
    if (!report.result.hasPandoc || (needPdf && !report.result.pdfEngine)) process.exitCode = 1;
    return;
  }
  const {manifest} = loadManifest(options.manifest ?? path.join(PROJECT_ROOT, 'book.json'));
  if (command === 'check-updates') {
    const sourceRoot = await resolveSource(manifest, options);
    const report = checkIndex(manifest, sourceRoot);
    console.log(formatIndexReport(report));
    if (!report.clean) process.exitCode = 2;
    return;
  }
  if (command === 'build') {
    const result = await build(manifest, options);
    console.log(`Built ${result.metadata.pages} pages from ${result.metadata.sourceRevision}:`);
    for (const output of result.outputs) console.log(`  ${output}`);
    return;
  }
}
