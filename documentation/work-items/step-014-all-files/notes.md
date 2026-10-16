<a id="WORK-00556" data-uid="gm893vhndlka"></a>

<a id="WORK-00557" data-uid="pj01dekrat3o"></a>
# New Left Pane Option: All Files

* <a id="WORK-00558" data-uid="p14pks0ynzon"></a> Above the left pane forlder/file hierarchy a new view selection
  appears. The options are "Specs" and "All Files".
* <a id="WORK-00559" data-uid="rag3bfotifrp"></a> The appearance is much like the Text/Split/Preview/WYSIWYG options above the file edit/view pane.
* <a id="WORK-00560" data-uid="ccuhikmswylq"></a> When "Specs" is chosen, the pane acts as it does now.
* <a id="WORK-00561" data-uid="deamg423ozsy"></a> When "All Files" is chosen, the pane shows all folders in the root directory and all files in each folder, recursively

<a id="WORK-00568" data-uid="f284tih9rxbo"></a>
# New File Edit/View Pane Functionality
* <a id="WORK-00562" data-uid="zdtb9phshj9t"></a> When the user clicks a plain text file that is not .md, a new edition of the file view pane shows the file as plain text in CodeMirror.
* <a id="WORK-00563" data-uid="eqa2oldaohrt"></a> TBD: Need a list of file types for which it is easy to implement syntax highlighting in CodeMirror.
* <a id="WORK-00564" data-uid="csrwhydpljso"></a> For non-Markdown files there is no sectioning or the like and nothing in the area of code completion or navigation. The view is intended primarily for code review, not code editing. Specquer provides no help beyond basic viewing/editing with CodeMirror.
* <a id="WORK-00565" data-uid="dw8y8q3sqoeo"></a> File save timing after editing is similar to what is done now for Markdown files.
* <a id="WORK-00566" data-uid="xqtjq9f5uyp9"></a> When the user clicks an image file instead of a plain text file, the image is rendered in the file pane read-only for review.
* <a id="WORK-00567" data-uid="ksxsqxmhr4jy"></a> Other binary file types result is a placeholder message: "This file type cannot be displayed by Specquer."