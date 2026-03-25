# aos-mailchimp

Agent-native Mailchimp Marketing API connector.

This first pass gives ArgentOS a truthful Mailchimp surface for:

- connector setup and health
- audience reads
- member/contact reads
- campaign reads
- report reads

Write commands remain scaffolded until we decide which Mailchimp mutations are safe enough to expose directly in worker flows.
