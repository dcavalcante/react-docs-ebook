export type OutputFormat = 'epub' | 'pdf' | 'all';

export interface BookPage {
  title: string;
  sourceTitle?: string;
  path: string;
  enabled?: boolean;
}

export interface BookGroup extends BookPage {
  pages: BookPage[];
}

export interface BookSection {
  title: string;
  indexSection?: string;
  enabled?: boolean;
  groups: BookGroup[];
}

export interface BookManifest {
  schemaVersion: 1;
  book: {
    title: string;
    subtitle?: string;
    language?: string;
    slug: string;
  };
  source: {
    repository: string;
    ref: string;
    sidebar: string;
    contentDirectory: string;
    trackOrder?: boolean;
  };
  sections: BookSection[];
}

export interface SourceOptions {
  source?: string;
  ref?: string;
  refresh?: boolean;
  download?: boolean;
}

export interface BuildOptions extends SourceOptions {
  format?: OutputFormat;
  outputDir?: string;
  workDir?: string;
  pdfEngine?: string;
}

export interface CliOptions extends BuildOptions {
  manifest?: string;
  help?: boolean;
  _positionals: string[];
}

export interface SidebarRoute {
  title?: string;
  path?: string;
  hasSectionHeader?: boolean;
  sectionHeader?: string;
  routes?: SidebarRoute[];
}

export interface Sidebar {
  title?: string;
  path?: string;
  routes: SidebarRoute[];
}

export interface IndexedPage {
  title: string;
  path: string;
}

export interface IndexedSection {
  title: string | null;
  pages: IndexedPage[];
}

export type MdxWarnings = Map<string, string[]>;

export interface GeneratedBook {
  markdown: string;
  pageCount: number;
  warnings: MdxWarnings;
}

export interface BuildMetadata {
  generatedAt: string;
  generatorVersion: string;
  sourceRepository: string;
  sourceRevision: string;
  sourceDirty: boolean;
  sourceRef: string;
  pages: number;
  outputs: string[];
}

export interface BuildResult {
  outputs: string[];
  metadata: BuildMetadata;
  warnings: MdxWarnings;
  markdownFile: string;
}
