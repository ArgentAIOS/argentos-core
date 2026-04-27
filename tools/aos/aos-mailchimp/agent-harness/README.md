# aos-mailchimp agent harness

Python Click wrapper for the `aos-mailchimp` connector.

## Auth

The harness resolves Mailchimp service keys from ArgentOS operator service keys
first, then falls back to process env only inside the service-key helper.
`MAILCHIMP_SERVER_PREFIX` is optional when the API key already includes a
Mailchimp data center suffix such as `us21` or `eu2`.

Operator-controlled service keys:

- `MAILCHIMP_API_KEY`
- `MAILCHIMP_SERVER_PREFIX`
- `MAILCHIMP_AUDIENCE_ID`
- `MAILCHIMP_CAMPAIGN_ID`
- `MAILCHIMP_MEMBER_EMAIL`

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

The connector is live read-only today. Mailchimp write actions are not advertised
until approval, compliance, and campaign safety rules are verified.
