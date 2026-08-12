import fs from 'node:fs';
import path from 'node:path';
import type {
  Code,
  Content,
  Emphasis,
  Heading,
  Image,
  Link,
  Paragraph,
  Parent,
  PhrasingContent,
  Root,
  RootContent,
  Strong,
  Text,
} from 'mdast';
import type {
  MdxJsxAttribute,
  MdxJsxFlowElement,
  MdxJsxTextElement,
} from 'mdast-util-mdx-jsx' with {"resolution-mode": "import"};
import type {Node} from 'unist';
import type {BookManifest, BookPage, BookSection, GeneratedBook, MdxWarnings} from './types';

export function bookId(routePath: string, fragment = ''): string {
  const clean = (value: string): string => value.replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9]+/gi, '-');
  return [clean(routePath) || 'learn', clean(fragment.replace(/^#/, ''))]
    .filter(Boolean).join('-').toLowerCase();
}

function sourceForRoute(sourceRoot: string, contentDirectory: string, routePath: string): string | undefined {
  const relative = routePath.replace(/^\//, '');
  const base = path.join(sourceRoot, contentDirectory);
  return [
    path.join(base, `${relative}.md`),
    path.join(base, `${relative}.mdx`),
    path.join(base, relative, 'index.md'),
    path.join(base, relative, 'index.mdx'),
  ].find(fs.existsSync);
}

export function enabledSections(manifest: BookManifest): BookSection[] {
  return manifest.sections
    .filter((section) => section.enabled !== false)
    .map((section) => ({
      ...section,
      groups: section.groups
        .filter((group) => group.enabled !== false)
        .map((group) => ({
          ...group,
          pages: group.pages.filter((page) => page.enabled !== false),
        })),
    }));
}

export function allManifestPages(manifest: BookManifest, includeDisabled = true): BookPage[] {
  const pages: BookPage[] = [];
  for (const section of manifest.sections) {
    for (const group of section.groups) {
      if (includeDisabled || (section.enabled !== false && group.enabled !== false)) pages.push(group);
      for (const page of group.pages) {
        if (includeDisabled || (section.enabled !== false && group.enabled !== false && page.enabled !== false)) pages.push(page);
      }
    }
  }
  return pages;
}

function rewriteUrl(url: string, routePath: string, knownRoutes: ReadonlySet<string>): string {
  if (url.startsWith('../images/')) return url.slice(3);
  if (url.startsWith('/images/')) return url.slice(1);

  let normalized = url;
  if (normalized.startsWith('learn/') || normalized.startsWith('reference/')) normalized = `/${normalized}`;
  if (normalized.startsWith('#')) return `#${bookId(routePath, normalized)}`;
  if (normalized.startsWith('/learn')) {
    const hashIndex = normalized.indexOf('#');
    const route = (hashIndex === -1 ? normalized : normalized.slice(0, hashIndex)).replace(/\/$/, '') || '/learn';
    const fragment = hashIndex === -1 ? '' : normalized.slice(hashIndex + 1);
    if (knownRoutes.has(route)) return fragment ? `#${bookId(route, fragment)}` : `#page-${bookId(route)}`;
  }
  return normalized.startsWith('/') ? `https://react.dev${normalized}` : normalized;
}

function text(value: string): Text {
  return {type: 'text', value};
}

function paragraph(children: PhrasingContent[]): Paragraph {
  return {type: 'paragraph', children};
}

function labelParagraph(value: string): Paragraph {
  const strong: Strong = {type: 'strong', children: [text(value)]};
  return paragraph([strong]);
}

function literalAttribute(node: MdxJsxFlowElement | MdxJsxTextElement, name: string): string | undefined {
  const attribute = node.attributes.find(
    (item): item is MdxJsxAttribute => item.type === 'mdxJsxAttribute' && item.name === name,
  );
  return typeof attribute?.value === 'string' ? attribute.value : undefined;
}

function nodeSource(node: Node, source: string): string {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? '' : source.slice(start, end);
}

function plainText(node: Node): string {
  if ('value' in node && typeof node.value === 'string') return node.value;
  if ('children' in node && Array.isArray(node.children)) return node.children.map((child) => plainText(child as Node)).join('');
  return '';
}

const wrapperLabels = new Map<string, string>([
  ['YouWillLearn', 'In this chapter'], ['Note', 'Note'], ['Pitfall', 'Pitfall'],
  ['DeepDive', 'Deep dive'], ['Recap', 'Recap'], ['Challenges', 'Challenges'],
  ['Hint', 'Hint'], ['Solution', 'Solution'],
]);

const transparentWrappers = new Set([
  'Intro', 'LearnMore', 'DiagramGroup', 'IllustrationBlock', 'Section', 'FullWidth',
  'Sandpack', 'SandpackRSC', 'CodeDiagram', 'PageLayout', 'Card',
]);

function convertFlowElement(
  node: MdxJsxFlowElement,
  source: string,
  routePath: string,
  knownRoutes: ReadonlySet<string>,
  unknown: Set<string>,
): RootContent[] {
  const name = node.name ?? '';
  if (name === 'Diagram') {
    const diagramName = literalAttribute(node, 'name');
    if (!diagramName) {
      unknown.add('Diagram (dynamic name)');
      return [{type: 'code', lang: 'jsx', value: nodeSource(node, source)}];
    }
    const image: Image = {
      type: 'image',
      url: `images/docs/diagrams/${diagramName}.png`,
      alt: literalAttribute(node, 'alt') ?? diagramName.replace(/_/g, ' '),
    };
    return [paragraph([image])];
  }
  if (name === 'Illustration' || name === 'img') {
    const rawUrl = literalAttribute(node, 'src');
    if (!rawUrl) {
      unknown.add(`${name} (dynamic source)`);
      return [{type: 'code', lang: 'jsx', value: nodeSource(node, source)}];
    }
    const caption = literalAttribute(node, 'caption');
    const image: Image = {
      type: 'image',
      url: rewriteUrl(rawUrl, routePath, knownRoutes),
      alt: [caption, literalAttribute(node, 'alt')].filter(Boolean).join(': ') || 'Illustration',
    };
    return [paragraph([image])];
  }
  if (name === 'TerminalBlock') {
    const command = plainText(node).trim();
    return command ? [{type: 'code', lang: 'sh', value: command}] : [];
  }
  if (name === 'ConsoleBlock') {
    const output = plainText(node).trim();
    return output ? [{type: 'code', lang: 'text', value: output}] : [];
  }

  const converted = transformBlocks(node.children as RootContent[], source, routePath, knownRoutes, unknown);
  const label = wrapperLabels.get(name);
  if (label) return [labelParagraph(label), ...converted];
  if (transparentWrappers.has(name) || name === '') return converted;

  if (name) unknown.add(name);
  if (converted.length) return converted;
  const raw = nodeSource(node, source).trim();
  return raw ? [{type: 'code', lang: 'jsx', value: raw}] : [];
}

function transformPhrasing(
  children: PhrasingContent[],
  source: string,
  routePath: string,
  knownRoutes: ReadonlySet<string>,
  unknown: Set<string>,
): PhrasingContent[] {
  const result: PhrasingContent[] = [];
  for (const child of children) {
    if (child.type === 'mdxJsxTextElement') {
      const node = child as MdxJsxTextElement;
      if (node.name === 'CodeStep' || node.name === null) {
        result.push(...transformPhrasing(node.children, source, routePath, knownRoutes, unknown));
      } else if (node.name === 'Math') {
        result.push(...transformPhrasing(node.children, source, routePath, knownRoutes, unknown));
      } else if (node.name === 'MathI') {
        const emphasis: Emphasis = {
          type: 'emphasis',
          children: transformPhrasing(node.children, source, routePath, knownRoutes, unknown),
        };
        result.push(emphasis);
      } else if (node.name && wrapperLabels.has(node.name)) {
        const label = wrapperLabels.get(node.name) ?? node.name;
        result.push({type: 'strong', children: [text(label)]}, text(': '),
          ...transformPhrasing(node.children, source, routePath, knownRoutes, unknown));
      } else if (node.name === 'img') {
        const rawUrl = literalAttribute(node, 'src');
        if (rawUrl) result.push({type: 'image', url: rewriteUrl(rawUrl, routePath, knownRoutes), alt: literalAttribute(node, 'alt') ?? ''});
      } else if (node.name && /^[a-z]/.test(node.name)) {
        result.push({type: 'html', value: nodeSource(node, source)});
      } else if (node.children.length) {
        if (node.name) unknown.add(node.name);
        result.push(...transformPhrasing(node.children, source, routePath, knownRoutes, unknown));
      } else {
        result.push({type: 'inlineCode', value: nodeSource(node, source)});
      }
      continue;
    }
    if (child.type === 'mdxTextExpression') {
      const value = 'value' in child && typeof child.value === 'string' ? child.value : '';
      if (!/^\s*\/\*[\s\S]*\*\/\s*$/.test(value)) result.push({type: 'inlineCode', value: `{${value}}`});
      continue;
    }
    if ('children' in child && Array.isArray(child.children)) {
      child.children = transformPhrasing(
        child.children as PhrasingContent[], source, routePath, knownRoutes, unknown,
      ) as never;
    }
    result.push(child);
  }
  return result;
}

function transformBlocks(
  children: RootContent[],
  source: string,
  routePath: string,
  knownRoutes: ReadonlySet<string>,
  unknown: Set<string>,
): RootContent[] {
  const result: RootContent[] = [];
  for (const child of children) {
    if (child.type === 'mdxJsxFlowElement') {
      result.push(...convertFlowElement(child as MdxJsxFlowElement, source, routePath, knownRoutes, unknown));
      continue;
    }
    if (child.type === 'mdxFlowExpression' || child.type === 'mdxjsEsm') {
      const value = 'value' in child && typeof child.value === 'string' ? child.value : '';
      if (value && !/^\s*\/\*[\s\S]*\*\/\s*$/.test(value)) result.push({type: 'code', lang: 'js', value});
      continue;
    }
    if ('children' in child && Array.isArray(child.children)) {
      const node = child as Parent;
      if (child.type === 'paragraph' || child.type === 'heading') {
        node.children = transformPhrasing(
          node.children as PhrasingContent[], source, routePath, knownRoutes, unknown,
        );
      } else {
        node.children = transformBlocks(
          node.children as RootContent[], source, routePath, knownRoutes, unknown,
        );
      }
    }
    result.push(child);
  }
  return result;
}

function headingIdentifier(heading: Heading, routePath: string): string {
  let explicit = '';
  heading.children = heading.children.filter((child) => {
    if (child.type !== 'mdxTextExpression') return true;
    const value = 'value' in child && typeof child.value === 'string' ? child.value : '';
    const match = value.match(/^\s*\/\*([\s\S]*?)\*\/\s*$/);
    if (match?.[1]) explicit = match[1].trim();
    return false;
  });
  const last = heading.children.at(-1);
  if (last?.type === 'text') last.value = last.value.trimEnd();
  return bookId(routePath, explicit || plainText(heading));
}

async function convertPage(
  rawSource: string,
  routePath: string,
  pageHeadingDepth: number,
  knownRoutes: ReadonlySet<string>,
  warnings: MdxWarnings,
): Promise<string> {
  const source = rawSource.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '');
  const [{unified}, {default: remarkParse}, {default: remarkMdx}, {default: remarkStringify}, {visit}] = await Promise.all([
    import('unified'), import('remark-parse'), import('remark-mdx'), import('remark-stringify'), import('unist-util-visit'),
  ]);
  const processor = unified().use(remarkParse).use(remarkMdx).use(remarkStringify, {
    bullet: '-', fences: true, listItemIndent: 'one', rule: '-', strong: '*', emphasis: '_',
  });
  const tree = processor.parse(source) as Root;
  const headingAnchors: string[] = [];

  visit(tree, 'heading', (node: Heading) => {
    const identifier = headingIdentifier(node, routePath);
    node.depth = Math.min(6, node.depth + pageHeadingDepth - 1) as Heading['depth'];
    const uniqueIdentifier = identifier === bookId(routePath) ? `${identifier}-section` : identifier;
    const index = headingAnchors.push(uniqueIdentifier) - 1;
    node.children.push(text(` BOOKANCHOR${index}TOKEN`));
  });
  visit(tree, 'link', (node: Link) => { node.url = rewriteUrl(node.url, routePath, knownRoutes); });
  visit(tree, 'image', (node: Image) => { node.url = rewriteUrl(node.url, routePath, knownRoutes); });
  visit(tree, 'code', (node: Code, index, parent) => {
    if (!node.meta) return;
    const match = node.meta.match(/(?:^|\s)((?:src\/|public\/)?[A-Za-z0-9_./-]+\.[A-Za-z0-9]+)(?:\s|$)/);
    node.meta = undefined;
    if (!match?.[1] || index === undefined || !parent) return;
    parent.children.splice(index, 0, labelParagraph(`File: ${match[1]}`) as Content);
    return index + 1;
  });

  const unknown = new Set<string>();
  tree.children = transformBlocks(tree.children, source, routePath, knownRoutes, unknown);
  if (unknown.size) warnings.set(routePath, [...unknown].sort());
  return processor.stringify(tree)
    .replace(/BOOKANCHOR(\d+)TOKEN/g, (_, index: string) => `{#${headingAnchors[Number(index)] ?? 'section'}}`)
    .replace(/\n{3,}/g, '\n\n').trim();
}

function attribution(manifest: BookManifest, revision: string): string {
  return [
    '# Unofficial Edition and License Notice {#license-notice}',
    '',
    `**${manifest.book.title}** is an unofficial ebook adaptation of the React documentation.`,
    '',
    'It is not produced, sponsored, or endorsed by Meta, the React team, or the React Foundation. React is a trademark of Meta Platforms, Inc.',
    '',
    `Source documentation: [react.dev](https://react.dev/) and [${manifest.source.repository}](https://github.com/${manifest.source.repository}).`,
    '',
    'The documentation content is licensed under the [Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/) (CC BY 4.0). The upstream license is available in [LICENSE-DOCS.md](https://github.com/reactjs/react.dev/blob/main/LICENSE-DOCS.md).',
    '',
    `Source revision: \`${revision || manifest.source.ref}\`.`,
    '',
    'Changes made for this edition include selecting and ordering pages, converting React-specific MDX components to static Markdown, rewriting internal links, adapting images, and applying ebook typography. No endorsement is implied.',
  ].join('\n');
}

export async function generateBook(
  {manifest, sourceRoot, revision}: {manifest: BookManifest; sourceRoot: string; revision: string},
): Promise<GeneratedBook> {
  const sections = enabledSections(manifest);
  const pages = allManifestPages({...manifest, sections}, false);
  const knownRoutes = new Set(pages.map((page) => page.path));
  const warnings: MdxWarnings = new Map();
  const output: string[] = [
    '---',
    `title: ${JSON.stringify(manifest.book.title)}`,
    `subtitle: ${JSON.stringify(manifest.book.subtitle ?? '')}`,
    `lang: ${JSON.stringify(manifest.book.language ?? 'en')}`,
    '---',
    '',
    attribution(manifest, revision),
  ];

  for (const section of sections) {
    output.push('', `# ${section.title} {#part-${bookId(section.title)}}`);
    for (const group of section.groups) {
      const groupFile = sourceForRoute(sourceRoot, manifest.source.contentDirectory, group.path);
      if (!groupFile) throw new Error(`Missing Markdown source for ${group.path}`);
      output.push('', `## ${group.title} {#page-${bookId(group.path)}}`, '',
        await convertPage(fs.readFileSync(groupFile, 'utf8'), group.path, 2, knownRoutes, warnings));
      for (const page of group.pages) {
        const pageFile = sourceForRoute(sourceRoot, manifest.source.contentDirectory, page.path);
        if (!pageFile) throw new Error(`Missing Markdown source for ${page.path}`);
        output.push('', `### ${page.title} {#page-${bookId(page.path)}}`, '',
          await convertPage(fs.readFileSync(pageFile, 'utf8'), page.path, 3, knownRoutes, warnings));
      }
    }
  }

  return {markdown: `${output.join('\n')}\n`, pageCount: pages.length, warnings};
}

export async function validateGeneratedBook(markdown: string, sourceRoot: string): Promise<void> {
  const identifiers = [...markdown.matchAll(/^#{1,6} .*\{#([^}]+)\}\s*$/gm)].map((match) => match[1] ?? '');
  const duplicate = identifiers.find((identifier, index) => identifiers.indexOf(identifier) !== index);
  if (duplicate) throw new Error(`Generated book contains duplicate identifier: ${duplicate}`);
  const identifierSet = new Set(identifiers);
  const [{unified}, {default: remarkParse}, {visit}] = await Promise.all([
    import('unified'), import('remark-parse'), import('unist-util-visit'),
  ]);
  const tree = unified().use(remarkParse).parse(markdown) as Root;
  const targets: string[] = [];
  const localImages: string[] = [];
  visit(tree, 'link', (node: Link) => {
    if (node.url.startsWith('#')) targets.push(node.url.slice(1));
  });
  visit(tree, 'image', (node: Image) => {
    if (node.url.length > 0 && !/^[a-z][a-z0-9+.-]*:/i.test(node.url)) localImages.push(node.url);
  });
  const unresolved = [...new Set(targets.filter((target) => !identifierSet.has(target)))];
  if (unresolved.length) throw new Error(`Generated book contains unresolved internal links: ${unresolved.join(', ')}`);

  const missing = [...new Set(localImages.filter((url) =>
    ![path.join(sourceRoot, 'public', url), path.join(sourceRoot, url)].some(fs.existsSync)))];
  if (missing.length) throw new Error(`Generated book references missing local images: ${missing.join(', ')}`);
}
