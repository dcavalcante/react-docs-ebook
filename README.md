# React Docs Ebook

Build an unofficial, versioned EPUB edition of the React Learn documentation without modifying the
`react.dev` repository.

**[Download the latest published edition](https://github.com/dcavalcante/react-docs-ebook/releases/latest)**

The generator reads the documentation version from the selected React source revision. That version appears
in the book title, release filename, and build metadata automatically. The current React documentation declares
version `19.2`, so its generated filename is `learn-react-19.2.epub`.

This project is designed to live beside a React documentation checkout:

```text
projects/
├── react.dev/
└── react-docs-ebook/
```

The generated edition is unofficial and is not produced, sponsored, or endorsed by Meta, the React team,
or the React Foundation. React is a trademark of Meta Platforms, Inc. React documentation content is
licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); see
[NOTICE.md](NOTICE.md) and the upstream
[LICENSE-DOCS.md](https://github.com/reactjs/react.dev/blob/main/LICENSE-DOCS.md). Every generated book
places attribution and adaptation details at its beginning.

## Requirements

- Node.js 18 or newer.
- Pandoc.
- `tar` when downloading the React source from GitHub.

## Run with npx

Once the package is published to npm, run it from the directory where `dist/` should be created:

```bash
npx react-docs-ebook
```

The command uses a local React checkout when it finds one in the current directory, an ancestor, or a
workspace `react.dev/` directory. Otherwise, it downloads the current source from GitHub. Override discovery
from any directory with `--source /path/to/react.dev`, `--source github`, or `REACT_DEV_SOURCE`.

Relative source, manifest, output, and work paths are resolved from the invocation directory—not npm's
temporary package directory. The default output is `./dist`, and intermediate files go under
`./.react-docs-ebook/work`.

## Local development

TypeScript is installed as a project development dependency.

Install the project and compile the strict TypeScript sources:

```bash
npm install
npm run typecheck
```

Check your machine:

```bash
npm run doctor
```

If Pandoc is absent, the command prints installation instructions tailored to Windows, macOS, Termux,
Debian/Ubuntu, Fedora/RHEL, Arch, or Alpine. The official Pandoc installation guide is
<https://pandoc.org/installing.html>.

## Build

With a sibling checkout:

```bash
npm run build
```

With an explicit checkout:

```bash
node bin/react-docs-ebook.js build --source /path/to/react.dev
```

Without a checkout, download and cache a GitHub source archive:

```bash
node bin/react-docs-ebook.js build --source github --ref main
```

Outputs go to `dist/` beneath the invocation directory. The EPUB filename includes the version declared by
upstream's configured `source.versionFile`; `build-metadata.json` records that React version, the exact upstream
revision, and a `sourceDirty` flag for local checkouts. Pass `--output-dir PATH` to change the destination.
Downloaded GitHub archives are stored in the operating system's user cache (or `REACT_DOCS_EBOOK_CACHE`);
cached sources can be reused offline, the two newest revisions per ref are retained, and `--refresh` forces a
redownload.

## Select, remove, and reorder content

[`book.json`](book.json) is the complete, declarative table of contents. It includes every page currently in
both the `GET STARTED` and `LEARN REACT` sidebar sections—including Installation, Setup, and React Compiler,
which the original in-repository script omitted.

- Reorder section, group, or page objects to reorder the book.
- Set `"enabled": false` to omit any section, group, or page without deleting it.
- Edit titles to customize the book-facing labels.
- Pin `source.ref` to a tag or commit for reproducible remote builds.

The manifest has an accompanying [`book.schema.json`](book.schema.json) for editor and runtime validation.
If a displayed title intentionally differs from upstream, store the upstream label in `sourceTitle`. Manual
order is authoritative; set `source.trackOrder` to `false` when custom ordering should not trigger update
reports. Section membership is always checked.

## Check React's Learn index for changes

Against a sibling checkout:

```bash
npm run check-updates
```

Against current GitHub `main`:

```bash
node bin/react-docs-ebook.js check-updates --source github --ref main --refresh
```

The command compares every route, title, sidebar section, and upstream order. It exits with status `2` when
new, removed, renamed, or reordered entries need review. Disabled manifest entries still count as tracked,
so intentionally omitted pages do not create false update alerts.

## Automation

- `upstream-check.yml` runs daily and on demand. It opens or updates a tracking issue if React's Learn index
  changes, and closes that issue when the manifest matches again.
- `build-release.yml` tests pull requests and pushes to `main`, and builds the EPUB on demand, weekly, and for
  version tags. Tags matching `v*` create a GitHub Release containing the versioned EPUB and build metadata.

Set no secrets beyond the default `GITHUB_TOKEN`. The workflows download a pinned GitHub archive during each
job and record the resolved source revision in the output.

## Conversion behavior

The generator converts diagrams and illustrations to static images, retains Sandpack source files, rewrites
internal Learn links, and normalizes React-specific layout wrappers. Unsupported MDX wrappers are reported
while retaining their inner prose. The conversion uses an MDX syntax tree so fenced and inline code, internal
fragments, headings, and static images remain structurally intact.

The generator software is MIT-licensed. Generated documentation remains subject to CC BY 4.0 and applicable
third-party rights.
