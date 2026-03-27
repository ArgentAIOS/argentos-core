# aos-twilio

Agent-native Twilio connector for SMS, voice calls, and WhatsApp.

This connector provides live read and write access to Twilio's messaging and voice APIs:

- `sms.send` sends an SMS message via the Messages API.
- `sms.list` and `sms.read` expose recent SMS messages and individual message detail.
- `call.create` initiates an outbound voice call with TwiML or Say text.
- `call.list` and `call.status` expose recent calls and individual call status.
- `whatsapp.send` sends a WhatsApp message via the Messages API (WhatsApp channel).
- `whatsapp.list` lists recent WhatsApp messages.
- `lookup.phone` performs carrier and caller name lookups via the Lookup API.

## Auth

The connector expects Twilio credentials via environment variables:

- `TWILIO_ACCOUNT_SID` — Account SID from the Twilio Console.
- `TWILIO_AUTH_TOKEN` — Auth Token from the Twilio Console.

Required scope hints:

- `TWILIO_FROM_NUMBER` — A Twilio phone number owned by the account (E.164 format).

Optional scope hints:

- `TWILIO_TO_NUMBER` — Default destination number for sends.
- `TWILIO_MESSAGE` — Default message body for sends.
- `TWILIO_VOICE_URL` — Default TwiML URL or Say text for outbound calls.
- `TWILIO_STATUS_CALLBACK_URL` — Webhook URL for delivery status updates.

## Live Reads

The harness uses Twilio's REST API for message listing, call listing, and phone number lookups. If credentials are present but the API rejects requests, `health` and `doctor` report the failure instead of masking it.

## Writes

Write commands (`sms.send`, `call.create`, `whatsapp.send`) perform live mutations against the Twilio API. They require `--mode write` or higher.

## WhatsApp

WhatsApp messages are sent through the same Messages API but with `whatsapp:` prefixed numbers. The from number must be a Twilio WhatsApp-enabled sender. For testing, use the Twilio WhatsApp sandbox number (+14155238886).
