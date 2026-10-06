import {defineConfig} from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
    title: "Specquer",
    description: "A tool for spec-driven development",
    // Published to GitHub Pages at https://martin-nordberg.github.io/specquer/
    base: "/specquer/",
    vite: {
        // Fixed port; the client dev server owns 5173
        server: {port: 5174, strictPort: true},
    },
    themeConfig: {
        // https://vitepress.dev/reference/default-theme-config
        nav: [
            {text: 'Home', link: '/'},
            {text: 'Specifications', link: '/specifications/overview'},
            {text: 'Notes', link: '/notes/platform-choice'},
        ],

        sidebar: {
            '/specifications/': [
                {
                    text: 'Specifications',
                    items: [
                        {text: 'Overview', link: '/specifications/overview'},
                        {text: 'Technical Architecture', link: '/specifications/technical-architecture'},
                    ]
                }
            ],
            '/work-items/': [
              {
                text: 'Work Items',
                items: [
                  {text: 'Step 001', link: '/work-items/step-001/todo'}
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
