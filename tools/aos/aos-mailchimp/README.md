# aos-mailchimp

Agent-native Mailchimp Marketing API connector.

This connector is live-read-first and uses operator-controlled service keys for auth
before falling back to process env in the harness service-key helper.

Real today:

- connector setup and health
- audience reads
- member/contact reads
- campaign reads
- report reads

Still scaffolded:

- `campaign.create_draft`
- `member.upsert`

Those write commands are intentionally present as scaffold placeholders and return
`scaffold_write_only` instead of performing live Mailchimp mutations.
