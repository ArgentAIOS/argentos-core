# aos-mailchimp agent harness

Python Click wrapper for the `aos-mailchimp` connector.

## Auth

The harness resolves `MAILCHIMP_API_KEY` and `MAILCHIMP_SERVER_PREFIX` from
ArgentOS operator service keys first, then falls back to process env only inside
the service-key helper. `MAILCHIMP_SERVER_PREFIX` is optional when the API key
already includes a Mailchimp data center suffix such as `us21` or `eu2`.

## Commands

- `capabilities`
- `config show`
- `health`
- `doctor`
- `account read`
- `audience list`
- `audience read [audience_id]`
- `member list [audience_id]`
- `member read [audience_id] [email]`
- `campaign list`
- `campaign read [campaign_id]`
- `report list`
- `report read [campaign_id]`
- `campaign create-draft <title>`: scaffold only, returns `scaffold_write_only`
- `member upsert [audience_id] [email]`: scaffold only, returns `scaffold_write_only`

Only the read commands call the live Mailchimp Marketing API today.
