<a id=""></a>
# Images in the Markdown Preview

_Ideas for showing images in Markdown files, taken out of [Step 014](/work-items/step-014-all-files/requirements) in October 2026 to be taken up in a later step. Step 014 still adds the image route these ideas build on (its R7.3 and R8.3)._

<a id=""></a>
## What Is Missing

Today an image with a relative path in a Markdown file (`![Flow](images/flow.png)`) shows as a broken image in the Preview, Split and WYSIWYG views. The page's CSP allows images from Specquer's own origin, but the server has no route that returns image bytes for the preview to use. Remote `https:` images and `data:` URIs already work (Security §7).

<a id=""></a>
## The Idea

1. **Relative paths:** in the Preview, Split and WYSIWYG views, an image whose URL is a relative path (`images/flow.png`, `../shared/logo.svg`) is resolved against the Markdown file's folder. Percent-encoding in the path is decoded, and a query or fragment is ignored.
2. **Loading:** such images are loaded through `GET /api/image` from Step 014, so they follow its rules: the image types it serves, its 5 MB limit, and confinement to the listed files under the root. An image that breaks a rule, or doesn't exist, shows as the browser's broken image with its alt text.
3. **The text is unchanged.** The URL is rewritten only in what the preview pipeline (`shared/markdown`) and the WYSIWYG view render. The Markdown text keeps its own URL, and both views resolve it the same way.
4. **Other URLs are unchanged:** remote `https:` images and `data:` URIs behave as today, and other schemes are left to the CSP.
5. **Unchanged elsewhere:** chat answers and comments still show images as their alt text and URL (Step 012, R2.10), and summaries ignore images as today.
6. **Updates:** editing the Markdown shouldn't make images that are already shown load again. The image route's `Cache-Control: no-cache` with an `ETag` lets the browser revalidate cheaply. An image changed on disk shows its new content the next time the preview renders it.

<a id=""></a>
## Questions for Later

1. **Root-relative paths:** should `/docs/images/flow.png` be resolved against the root folder, as GitHub does, or against a configured folder? VitePress, which this repository's docs use, resolves it against its `public/` folder.
2. **WYSIWYG:** Milkdown renders images itself, outside the preview pipeline. The URL rewriting has to apply there too, without changing the URL saved in the Markdown.
3. **Caching:** the preview renders again as the user types. The implementation should check that the browser's cache keeps re-renders to revalidations, or that the preview keeps image elements whose URL hasn't changed.
4. **Hidden files:** an image in a folder `.gitignore` hides can't be served by the route. Is a broken image the right result, or should the preview say why?
5. **Tests:** resolving image URLs relative to a document and to the root, a relative image in the preview in component tests, and a Markdown file's relative image end-to-end.
