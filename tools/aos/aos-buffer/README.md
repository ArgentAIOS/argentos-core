# aos-buffer

Buffer connector for ArgentOS.

This connector now treats Buffer's current public GraphQL API as the live contract for:

- account metadata and organization discovery
- channel discovery and direct channel reads
- post discovery within accessible organizations

The `profile.*` commands are retained as legacy aliases over the same channel data so existing workers can keep using a Buffer "profile" mental model while the live backend stays truthful to Buffer's current terminology.

`post.create_draft` and `post.schedule` remain explicit write-mode previews. They validate scope and show the GraphQL mutation shape, but they do not execute social publishing writes from the harness.

Docs used for this connector:

- https://developers.buffer.com/guides/introduction.html
- https://developers.buffer.com/guides/rest-migration.html
- https://developers.buffer.com/guides/posts-and-scheduling.html
- https://developers.buffer.com/examples/create-draft-post.html
- https://developers.buffer.com/examples/create-scheduled-post.html
