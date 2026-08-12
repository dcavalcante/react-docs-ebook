import path from 'node:path';
import type {BookManifest} from '../src/types';

export const projectRoot = path.resolve(__dirname, '../..');
export const fixtureRoot = path.join(projectRoot, 'test', 'fixtures', 'react.dev');

export const fixtureManifest: BookManifest = {
  schemaVersion: 1,
  book: {title: 'Fixture "Book"', subtitle: 'Conversion tests', language: 'en', slug: 'fixture-book'},
  source: {
    repository: 'reactjs/react.dev', ref: 'fixture', sidebar: 'src/sidebarLearn.json',
    contentDirectory: 'src/content', trackOrder: true,
  },
  sections: [
    {
      title: 'Get Started', indexSection: 'GET STARTED', groups: [
        {
          title: 'Quick Start', path: '/learn', pages: [
            {title: 'Tutorial', path: '/learn/tutorial'},
            {title: 'Reference Page', path: '/learn/reference-page'},
          ],
        },
      ],
    },
    {
      title: 'Learn', indexSection: 'LEARN REACT', groups: [
        {title: 'Advanced', path: '/learn/advanced', pages: [{title: 'Details', path: '/learn/details'}]},
      ],
    },
  ],
};
