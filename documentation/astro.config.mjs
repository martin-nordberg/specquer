import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightThemeExquisitus from 'starlight-theme-exquisitus';

// https://astro.build/config
export default defineConfig({
  // Published to GitHub Pages at https://martin-nordberg.github.io/specquer/
  site: 'https://martin-nordberg.github.io',
  base: '/specquer',
  // Fixed port; the app server owns 3000
  server: { port: 5174 },
  vite: { server: { strictPort: true } },
  integrations: [
    // https://starlight.astro.build/reference/configuration/
    starlight({
      title: 'Specquer',
      description: 'A tool for spec-driven development',
      plugins: [starlightThemeExquisitus()],
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/martin-nordberg/specquer' },
      ],
      sidebar: [
        {
          label: 'Specifications',
          items: [
            {
              label: 'Functionality',
              collapsed: true,
              items: [
                { label: 'Ideas', slug: 'specifications/functionality/ideas' },
              ],
            },
            {
              label: 'Architecture',
              collapsed: true,
              items: [
                { label: 'Overview', slug: 'specifications/architecture/overview' },
                { label: 'Technical Architecture', slug: 'specifications/architecture/technical-architecture' },
              ],
            },
          ],
        },
        {
          label: 'References',
          items: [
            { label: 'Overview', slug: 'references/overview' },
            { label: 'Spec-Driven Development', slug: 'references/spec-driven-development' },
            { label: 'Specquer Technologies', slug: 'references/specquer-technologies' },
            { label: 'Glossary', slug: 'references/glossary' },
          ],
        },
      ],
    }),
  ],
});
