import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "Specquer",
  description: "A tool for spec-driven development",
  // Published to GitHub Pages at https://martin-nordberg.github.io/specquer/
  base: "/specquer/",
  vite: {
    // Fixed port; the client dev server owns 5173
    server: { port: 5174, strictPort: true },
  },
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Specifications', link: '/specifications/architecture/overview' },
    ],

    sidebar: {
      '/specifications/': [
        {
          text: 'Architecture',
          collapsed: true,
          items: [
            {text: 'Overview', link: '/specifications/architecture/overview'},
            {text: 'Technical Architecture', link: '/specifications/architecture/technical-architecture'},
          ]
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/martin-nordberg/specquer' }
    ]
  }
})
