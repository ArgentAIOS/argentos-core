# aos-mailchimp

Agent-native Mailchimp Marketing API connector.

This connector is live read-only and uses operator-controlled service keys for auth
before falling back to process env in the harness service-key helper.

Real today:

- connector setup and health
- audience reads
- member/contact reads
- campaign reads
- report reads

Mailchimp write actions are not advertised until approval, compliance, and
campaign safety rules are verified.
