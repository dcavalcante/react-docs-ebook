import fs from 'node:fs';
import path from 'node:path';
import {allManifestPages} from './generator';
import type {BookManifest, IndexedPage, IndexedSection, Sidebar, SidebarRoute} from './types';

export interface RenamedPage {path: string; manifestTitle: string; upstreamTitle: string}
export interface MovedPage {path: string; manifestSection: string | null; upstreamSection: string | null}
export interface IndexReport {clean: boolean; added: IndexedPage[]; removed: IndexedPage[]; renamed: RenamedPage[]; moved: MovedPage[]; addedSections: string[]; removedSections: string[]; orderChanged: boolean; upstreamCount: number; manifestCount: number}

function indexedPage(route: SidebarRoute): IndexedPage | undefined {
  return route.path && route.title ? {title: route.title, path: route.path} : undefined;
}

export function upstreamIndex(sidebar: Sidebar): IndexedSection[] {
  const sections: IndexedSection[] = [];
  let current: IndexedSection = {title: null, pages: []};
  const visitRoutes = (routes: readonly SidebarRoute[]): void => {
    for (const route of routes) {
      if (route.hasSectionHeader) {
        current = {title: route.sectionHeader ?? null, pages: []};
        sections.push(current);
      } else {
        const page = indexedPage(route);
        if (page) {
          if (!sections.includes(current)) sections.push(current);
          current.pages.push(page);
        }
      }
      if (route.routes) visitRoutes(route.routes);
    }
  };
  visitRoutes(sidebar.routes);
  return sections;
}

function isString(value: string | null | undefined): value is string {
  return typeof value === 'string';
}

export function checkIndex(manifest: BookManifest, sourceRoot: string): IndexReport {
  const sidebarPath = path.join(sourceRoot, manifest.source.sidebar);
  const parsed: unknown = JSON.parse(fs.readFileSync(sidebarPath, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || !('routes' in parsed) || !Array.isArray(parsed.routes)) {
    throw new Error(`Invalid React sidebar: ${sidebarPath}`);
  }
  const upstreamSections = upstreamIndex(parsed as Sidebar);
  const upstreamPages = upstreamSections.flatMap((section) => section.pages);
  const manifestPages = allManifestPages(manifest, true);
  const upstreamByPath = new Map(upstreamPages.map((page) => [page.path, page]));
  const manifestByPath = new Map(manifestPages.map((page) => [page.path, page]));
  const added = upstreamPages.filter((page) => !manifestByPath.has(page.path));
  const removed = manifestPages.filter((page) => !upstreamByPath.has(page.path));
  const renamed: RenamedPage[] = manifestPages.flatMap((page) => {
    const upstream = upstreamByPath.get(page.path);
    const trackedTitle = page.sourceTitle ?? page.title;
    return upstream && upstream.title !== trackedTitle ? [{path: page.path, manifestTitle: trackedTitle, upstreamTitle: upstream.title}] : [];
  });
  const upstreamSectionNames = upstreamSections.map((section) => section.title).filter(isString);
  const manifestSectionNames = manifest.sections.map((section) => section.indexSection).filter(isString);
  const addedSections = upstreamSectionNames.filter((title) => !manifestSectionNames.includes(title));
  const removedSections = manifestSectionNames.filter((title) => !upstreamSectionNames.includes(title));
  const upstreamSectionByPath = new Map(upstreamSections.flatMap((section) => section.pages.map((page) => [page.path, section.title] as const)));
  const manifestSectionByPath = new Map(manifest.sections.flatMap((section) =>
    section.groups.flatMap((group) => [group, ...group.pages].map((page) => [page.path, section.indexSection ?? null] as const))));
  const moved: MovedPage[] = manifestPages.flatMap((page) => {
    const upstreamSection = upstreamSectionByPath.get(page.path);
    const manifestSection = manifestSectionByPath.get(page.path);
    return upstreamSection !== undefined && upstreamSection !== manifestSection
      ? [{path: page.path, manifestSection: manifestSection ?? null, upstreamSection}]
      : [];
  });
  const orderChanged = manifest.source.trackOrder !== false && upstreamSections.some((upstreamSection) => {
    if (!upstreamSection.title) return false;
    const manifestSection = manifest.sections.find((section) => section.indexSection === upstreamSection.title);
    if (!manifestSection) return false;
    const upstreamOrder = upstreamSection.pages.map((page) => page.path).filter((route) => manifestByPath.has(route));
    const manifestOrder = manifestSection.groups.flatMap((group) => [group, ...group.pages])
      .map((page) => page.path).filter((route) => upstreamByPath.has(route));
    return upstreamOrder.some((route, index) => manifestOrder[index] !== route);
  });
  return {clean: !added.length && !removed.length && !renamed.length && !moved.length && !addedSections.length && !removedSections.length && !orderChanged,
    added, removed, renamed, moved, addedSections, removedSections, orderChanged,
    upstreamCount: upstreamPages.length, manifestCount: manifestPages.length};
}

export function formatIndexReport(report: IndexReport): string {
  const lines = [`Upstream index: ${report.upstreamCount} pages; manifest: ${report.manifestCount} pages.`];
  if (report.clean) return [...lines, 'The manifest matches the upstream Learn index.'].join('\n');
  if (report.addedSections.length) lines.push(`New sections: ${report.addedSections.join(', ')}`);
  if (report.removedSections.length) lines.push(`Removed sections: ${report.removedSections.join(', ')}`);
  if (report.added.length) lines.push('New pages:\n' + report.added.map((page) => `  + ${page.title} (${page.path})`).join('\n'));
  if (report.removed.length) lines.push('Missing upstream:\n' + report.removed.map((page) => `  - ${page.title} (${page.path})`).join('\n'));
  if (report.renamed.length) lines.push('Title changes:\n' + report.renamed.map((item) => `  ~ ${item.path}: "${item.manifestTitle}" → "${item.upstreamTitle}"`).join('\n'));
  if (report.moved.length) lines.push('Section changes:\n' + report.moved.map((item) => `  ~ ${item.path}: ${item.manifestSection ?? '(none)'} → ${item.upstreamSection ?? '(none)'}`).join('\n'));
  if (report.orderChanged) lines.push('Upstream page order differs from the manifest. Set source.trackOrder to false when custom ordering is intentional.');
  return lines.join('\n');
}
