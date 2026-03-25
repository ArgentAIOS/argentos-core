# aos-elevenlabs agent harness

Python Click wrapper for the `aos-elevenlabs` connector.

The harness exposes live read commands for voices, models, history, and user
metadata, plus a live synthesis bridge that returns inline base64 audio by
default or writes an artifact when `--output` is supplied.
