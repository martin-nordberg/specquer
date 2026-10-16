<a id="WORK-00621" data-uid="c83px8zd0chr"></a>

<a id="WORK-00622" data-uid="hguncl5afpps"></a>
# New right pane for document navigation

* A new "Table of Contents" icon is added left of the comments icon in the top nav bar.
* The icon has the look of a table of contents visually.
* Toggling this icon on shows a new third pane view consisting of a table of
  contents (TOC) for the document shown in the middle pane.
* This new third pane and its icon participates with chat and comments to keep at most one of the three visible (now a three-way toggle).
* The toggled state is save in uistate.yaml.

<a id="WORK-00623" data-uid="l0bn7astbq2h"></a>
# Table of Contents Tree View

* The TOC view is a tree view of sections within the document.
* Each tree view item consists of an icon and the section's heading text
* The icon for each section in the tree is the same as the section badge used in preview and WYSIWYG views
* Sections can be expanded and collapsed by clicking the icon or the empty space in a row left of the icon
* Clicking the section text or the empty space to its right causes the middle pane to scroll to that section.
* The section becomes highlighted after clicking.
* If the user scrolls the middle pane by normal means, the highlighted tree view item changes to match the topmost section heading
  that is visible in the middle pane.
* Section items in the tree view include list item sections. In that case the tree view text is the section ID rather than the entire list item text.
* Tree state (expanded/collapsed) is stored per document in uistate.yaml
* If the document in the middle pane is not Markdown, the view shows "(Not Markdown)" as plain text.
* Just below the tree view is a link "Add section acnhors..." which has the same meaning as right clicking that option in the left pane file context menu.