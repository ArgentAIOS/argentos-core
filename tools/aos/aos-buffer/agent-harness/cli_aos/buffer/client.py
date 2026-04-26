from __future__ import annotations

from dataclasses import dataclass, field
import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .constants import DEFAULT_TIMEOUT_SECONDS


@dataclass(slots=True)
class BufferAPIError(RuntimeError):
    message: str
    code: str = "BUFFER_API_ERROR"
    exit_code: int = 5
    details: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class BufferResponse:
    data: dict[str, Any]
    headers: dict[str, str]


class BufferClient:
    def __init__(self, *, api_key: str, base_url: str, timeout: int = DEFAULT_TIMEOUT_SECONDS) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def _graphql(self, query: str, variables: dict[str, Any] | None = None) -> BufferResponse:
        payload = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
        request = Request(
            self.base_url,
            data=payload,
            method="POST",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
        )
        try:
            with urlopen(request, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8")
                decoded = json.loads(raw) if raw else {}
        except HTTPError as exc:
            raw = exc.read().decode("utf-8") if hasattr(exc, "read") else ""
            raise BufferAPIError(
                message=f"Buffer API request failed with HTTP {exc.code}",
                code="BUFFER_HTTP_ERROR",
                exit_code=4 if exc.code in {401, 403} else 5,
                details={"status_code": exc.code, "reason": exc.reason, "body": raw},
            ) from exc
        except URLError as exc:
            raise BufferAPIError(
                message="Buffer API request failed before a response was received",
                code="BUFFER_NETWORK_ERROR",
                exit_code=5,
                details={"reason": str(exc.reason)},
            ) from exc

        errors = decoded.get("errors") or []
        if errors:
            first = errors[0] if isinstance(errors[0], dict) else {"message": str(errors[0])}
            code = str((first.get("extensions") or {}).get("code") or "BUFFER_GRAPHQL_ERROR")
            exit_code = 4 if code in {"UNAUTHORIZED", "FORBIDDEN"} else 6 if code == "NOT_FOUND" else 5
            raise BufferAPIError(
                message=str(first.get("message") or "Buffer GraphQL request failed"),
                code=code,
                exit_code=exit_code,
                details={"errors": errors},
            )

        data = decoded.get("data")
        if not isinstance(data, dict):
            raise BufferAPIError(
                message="Buffer GraphQL response did not include a data object",
                code="BUFFER_GRAPHQL_DATA_MISSING",
                exit_code=5,
                details={"response": decoded},
            )
        return BufferResponse(data=data, headers={key: value for key, value in response.headers.items()})

    def read_account(self) -> dict[str, Any]:
        response = self._graphql(
            """
            query GetAccount {
              account {
                id
                email
                name
                timezone
                organizations {
                  id
                  name
                  channelCount
                }
              }
            }
            """
        )
        account = response.data.get("account")
        return account if isinstance(account, dict) else {}

    def list_channels(self, *, organization_id: str) -> list[dict[str, Any]]:
        response = self._graphql(
            """
            query GetChannels($organizationId: OrganizationId!) {
              channels(input: { organizationId: $organizationId }) {
                id
                name
                service
                avatar
                isQueuePaused
              }
            }
            """,
            {"organizationId": organization_id},
        )
        channels = response.data.get("channels")
        return channels if isinstance(channels, list) else []

    def read_channel(self, *, channel_id: str) -> dict[str, Any]:
        response = self._graphql(
            """
            query GetChannel($id: ChannelId!) {
              channel(input: { id: $id }) {
                id
                name
                displayName
                service
                avatar
                isQueuePaused
              }
            }
            """,
            {"id": channel_id},
        )
        channel = response.data.get("channel")
        return channel if isinstance(channel, dict) else {}

    def list_posts(
        self,
        *,
        organization_id: str,
        channel_ids: list[str] | None = None,
        statuses: list[str] | None = None,
        limit: int = 10,
        after: str | None = None,
    ) -> dict[str, Any]:
        filter_parts: list[str] = []
        variables: dict[str, Any] = {
            "organizationId": organization_id,
            "first": limit,
            "after": after,
        }
        if channel_ids:
            filter_parts.append("channelIds: $channelIds")
            variables["channelIds"] = channel_ids
        if statuses:
            filter_parts.append("status: $statuses")
            variables["statuses"] = statuses

        variable_defs = ["$organizationId: OrganizationId!", "$first: Int!", "$after: String"]
        if channel_ids:
            variable_defs.append("$channelIds: [ChannelId!]")
        if statuses:
            variable_defs.append("$statuses: [PostStatus!]")

        filter_block = f"filter: {{ {' '.join(filter_parts)} }}" if filter_parts else ""
        response = self._graphql(
            f"""
            query GetPosts({', '.join(variable_defs)}) {{
              posts(
                first: $first
                after: $after
                input: {{
                  organizationId: $organizationId
                  {filter_block}
                }}
              ) {{
                edges {{
                  cursor
                  node {{
                    id
                    text
                    status
                    dueAt
                    createdAt
                    channelId
                  }}
                }}
                pageInfo {{
                  hasNextPage
                  endCursor
                }}
              }}
            }}
            """,
            variables,
        )
        posts = response.data.get("posts")
        if not isinstance(posts, dict):
            return {"edges": [], "pageInfo": {"hasNextPage": False, "endCursor": None}}
        return posts
