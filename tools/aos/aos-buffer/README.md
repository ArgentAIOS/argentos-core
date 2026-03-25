# aos-buffer

Buffer connector scaffold for ArgentOS.

This connector treats Buffer's current public REST docs as the live-read contract for:

- account metadata via `/user`
- social profile / channel metadata via `/profiles`
- profile schedules via `/profiles/:id/schedules`

Write and publish paths remain scaffolded until the current post read/write shape is confirmed against the live Buffer API.

Docs used for this scaffold:

- https://developers.buffer.com/api/authentication/
- https://developers.buffer.com/api/profiles/
- https://developers.buffer.com/examples/create-text-post.html
- https://developers.buffer.com/explorer.html
