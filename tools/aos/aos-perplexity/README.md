# aos-perplexity

Agent-native Perplexity AI connector for real-time web research.

Perplexity provides search-augmented LLM responses with inline citations, making it ideal for agent research tasks that need current web data.

- `search.query` runs a one-shot web search and returns an answer with citations.
- `search.chat` runs a conversational search with follow-up context.
- `chat.complete` sends a standard chat completion request.
- `chat.stream` streams a chat completion response token-by-token.

## Auth

The connector expects a Perplexity API key via `PERPLEXITY_API_KEY`.

Optional scope hints:

- `PERPLEXITY_MODEL` to override the default model (default: `llama-3.1-sonar-large-128k-online`).
- `PERPLEXITY_SEARCH_DOMAIN` to restrict search results to a specific domain.

## Live Reads

The harness uses Perplexity's chat completions API for both search and chat operations. If the API key is present but the backend rejects requests, `health` and `doctor` report the API failure instead of pretending the connector is ready.

## Writes

No write operations are available. Perplexity is a read-only search and chat API.
