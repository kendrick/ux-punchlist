# UX Punchlist

A review session where a reviewer walks a running app, comments on what they see, and signs off on what changed.

## Language

### What Gets Reviewed

**Item**:
One entry in the manifest: a page URL plus what changed there, which the reviewer approves.
_Avoid_: Manifest item, change

**Page**:
Any page of the reviewed app, keyed by its path and hash, with the query string ignored. A page doesn't need to be an item.
_Avoid_: Route, screen, URL

**Comment**:
A note a reviewer attaches to one element on one page.
_Avoid_: Pin (that's the marker), note

### What the Reviewer Sees

**Tray**:
The punchlist UI injected into the reviewed page.
_Avoid_: Toolbar, panel, widget

**Overlay**:
The layer the tray draws over the reviewed page, which holds pins and the highlight.
_Avoid_: Annotation layer

**Pin**:
The outline and comment-count badge on one commented element.
_Avoid_: Overlay, marker, annotation

**Highlight**:
The box drawn around the element under the pointer in select mode.
_Avoid_: Hover outline, selection
