# aos-coderabbit

Agent-native CodeRabbit connector for AI-powered code review.

CodeRabbit provides automated code review on pull requests with contextual feedback, security analysis, and code quality scoring.

- `review.request` triggers a CodeRabbit review on a pull request.
- `review.status` checks the progress of an in-flight review.
- `review.get` retrieves a completed review with findings and suggestions.
- `report.list` and `report.get` expose repository-level review reports.
- `config.get` and `config.update` manage CodeRabbit settings per repository.

## Auth

The connector expects a CodeRabbit API key via `CODERABBIT_API_KEY`.

Optional scope hints:

- `CODERABBIT_REPO` to set a default repository (`owner/repo`) for worker flows.

## Live Reads

The harness uses CodeRabbit's API for review status, report retrieval, and configuration reads. If the API key is present but the backend rejects requests, `health` and `doctor` report the API failure instead of pretending the connector is ready.

## Writes

Write operations are available for triggering reviews (`review.request`) and updating repository configuration (`config.update`). Both require the connector to be in write mode.
