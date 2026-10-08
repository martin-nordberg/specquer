import {defineConfig} from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
    title: "Specquer",
    description: "A tool for spec-driven development",
    // Published to GitHub Pages at https://martin-nordberg.github.io/specquer/
    base: "/specquer/",
    // Head links don't get the base prefix. The file is docsFaviconSvg from client/src/theme/logo.ts.
    head: [['link', {rel: 'icon', type: 'image/svg+xml', href: '/specquer/favicon.svg'}]],
    vite: {
        // Fixed port; the client dev server owns 5173
        server: {port: 5174, strictPort: true},
    },
    themeConfig: {
        // https://vitepress.dev/reference/default-theme-config
        nav: [
            {text: 'Home', link: '/'},
            {text: 'Specifications', link: '/specifications/overview'},
            {text: 'Work Items', link: '/work-items/step-001-doc-editing/requirements'},
            {text: 'Notes', link: '/notes/platform-choice'},
        ],

        sidebar: {
            '/specifications/': [
                {
                    text: 'Specifications',
                    items: [
                        {text: 'Overview', link: '/specifications/overview'},
                        {text: 'Client Requirements', link: '/specifications/client-requirements'},
                        {text: 'Information Architecture', link: '/specifications/info-architecture'},
                        {text: 'Server Requirements', link: '/specifications/server-requirements'},
                        {text: 'Technical Architecture', link: '/specifications/technical-architecture'},
                        {text: 'Security', link: '/specifications/security'},
                        {text: 'Data Architecture', link: '/specifications/data-architecture'},
                    ]
                }
            ],
            '/work-items/': [
              {
                text: 'Work Items',
                items: [
                  {
                    text: '001-Document Editing',
                    collapsed: true,
                    items: [
                      {text: 'Requirements', link: '/work-items/step-001-doc-editing/requirements'},
                      {text: 'Implementation Plan', link: '/work-items/step-001-doc-editing/implementation-plan'},
                      {text: 'New File and Folder', link: '/work-items/step-001-doc-editing/new-file-folder'},
                    ]
                  },
                  {
                    text: '002-Sections',
                    collapsed: true,
                    items: [
                      {text: 'Requirements', link: '/work-items/step-002-sections/requirements'},
                      {text: 'Implementation Plan', link: '/work-items/step-002-sections/implementation-plan'},
                      {text: 'Simpler Prefix Configuration', link: '/work-items/step-002-sections/simpler-prefix-config'},
                    ]
                  },
                  {
                    text: '003-Section UIDs',
                    collapsed: false,
                    items: [
                      {text: 'Section Anchor Conflicts', link: '/work-items/step-003-section-uids/section-anchor-conflicts'},
                      {text: 'Implementation Plan', link: '/work-items/step-003-section-uids/implementation-plan'},
                    ]
                  }
                ]
              }
            ],
            '/notes/': [
                {
                    text: 'Notes',
                    items: [
                        {text: 'Ideas', link: '/notes/ideas'},
                        {text: 'Platform Choice', link: '/notes/platform-choice'},
                        {text: 'Database Choice', link: '/notes/database-choice'},
                        {text: 'Traceability Links', link: '/notes/traceability-links'},
                    ]
                },
            ],
        },

        socialLinks: [
            {icon: 'github', link: 'https://github.com/martin-nordberg/specquer'}
        ]
    }
})
