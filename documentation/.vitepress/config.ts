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
                    collapsed: true,
                    items: [
                      {text: 'Section Anchor Conflicts', link: '/work-items/step-003-section-uids/section-anchor-conflicts'},
                      {text: 'Implementation Plan', link: '/work-items/step-003-section-uids/implementation-plan'},
                    ]
                  },
                  {
                    text: '004-Hierarchical Summarization',
                    collapsed: true,
                    items: [
                      {text: 'Requirements', link: '/work-items/step-004-hierarchical-summarization/requirements'},
                      {text: 'Implementation Plan', link: '/work-items/step-004-hierarchical-summarization/implementation-plan'},
                    ]
                  },
                  {
                    text: '005-Summarization Changes',
                    collapsed: false,
                    items: [
                      {text: 'Design Changes', link: '/work-items/step-005-summarization-changes/summary-design-changes'},
                      {text: 'Implementation Plan', link: '/work-items/step-005-summarization-changes/implementation-plan'},
                    ]
                  },
                  {
                    text: '006-Settings',
                    collapsed: false,
                    items: [
                      {text: 'Requirements', link: '/work-items/step-006-settings/requirements'},
                      {text: 'Implementation Plan', link: '/work-items/step-006-settings/implementation-plan'},
                    ]
                  },
                  {
                    text: '007-Without documents.yaml',
                    collapsed: false,
                    items: [
                      {text: 'Requirements', link: '/work-items/step-007-no-documents-file/requirements'},
                    ]
                  },
                  {
                    text: '008-Folder Types and Prefixes',
                    collapsed: false,
                    items: [
                      {text: 'Requirements', link: '/work-items/step-008-refactor-settings/requirements'},
                      {text: 'Implementation Plan', link: '/work-items/step-008-refactor-settings/implementation-plan'},
                    ]
                  },
                  {
                    text: '009-One Specquer per Root',
                    collapsed: false,
                    items: [
                      {text: 'Requirements', link: '/work-items/step-009-single-instance/requirements'},
                      {text: 'Implementation Plan', link: '/work-items/step-009-single-instance/implementation-plan'},
                      {text: 'Nested Specquer Folders', link: '/work-items/step-009-single-instance/nested-specquer'},
                    ]
                  },
                  {
                    text: '010-Document Chat',
                    collapsed: false,
                    items: [
                      {text: 'Requirements', link: '/work-items/step-010-document-chat/requirements'},
                      {text: 'Implementation Plan', link: '/work-items/step-010-document-chat/implementation-plan'},
                    ]
                  },
                  {
                    text: '011-Section Status',
                    collapsed: false,
                    items: [
                      {text: 'Requirements', link: '/work-items/step-011-section-status/requirements'},
                      {text: 'Implementation Plan', link: '/work-items/step-011-section-status/implementation-plan'},
                    ]
                  },
                  {
                    text: '012-Comment Threads',
                    collapsed: false,
                    items: [
                      {text: 'Requirements', link: '/work-items/step-012-comment-threads/requirements'},
                      {text: 'Implementation Plan', link: '/work-items/step-012-comment-threads/implementation-plan'},
                    ]
                  },
                  {
                    text: '013-Code Review',
                    collapsed: false,
                    items: [
                      {text: 'Code Review', link: '/work-items/step-013-code-review/code-review'},
                    ]
                  },
                  {
                    text: '014-All Files',
                    collapsed: false,
                    items: [
                      {text: 'Notes', link: '/work-items/step-014-all-files/notes'},
                      {text: 'Requirements', link: '/work-items/step-014-all-files/requirements'},
                      {text: 'Implementation Plan', link: '/work-items/step-014-all-files/implementation-plan'},
                    ]
                  },
                  {
                    text: '015-Folder Menu',
                    collapsed: false,
                    items: [
                      {text: 'Task and Plan', link: '/work-items/step-015-folder-menu/task'},
                    ]
                  },
                  {
                    text: '016-Table of Contents',
                    collapsed: false,
                    items: [
                      {text: 'Notes', link: '/work-items/step-016-right-pane-section-nav/notes'},
                      {text: 'Requirements', link: '/work-items/step-016-right-pane-section-nav/requirements'},
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
                        {text: 'PGlite and pgvector', link: '/notes/pglite-pgvector'},
                        {text: 'Traceability Links', link: '/notes/traceability-links'},
                        {text: 'Agent-Delegated Summaries', link: '/notes/agent-delegated-summaries'},
                        {text: 'LangChain or AI SDK (historical)', link: '/notes/langchain-vs-ai-sdk'},
                        {text: 'Specification Gaps', link: '/notes/specification-gaps'},
                        {text: 'Server Restart Options', link: '/notes/server-restart-options'},
                        {text: 'Minor Issues', link: '/notes/issue-backlog'},
                        {text: 'Specquer, Kiro and Spec Kit', link: '/notes/spec-driven-tools'},
                        {text: 'Coding Agents in Comment Threads', link: '/notes/agent-comments'},
                        {text: 'Specquer Driving Coding Agents', link: '/notes/agent-workflows'},
                        {text: 'Images in the Markdown Preview', link: '/notes/markdown-images'},
                    ]
                },
            ],
        },

        socialLinks: [
            {icon: 'github', link: 'https://github.com/martin-nordberg/specquer'}
        ]
    }
})
