from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any
from urllib import error, request


@dataclass(slots=True)
class MondayApiError(Exception):
    code: str
    message: str
    status_code: int = 200
    details: dict[str, Any] = field(default_factory=dict)


class MondayClient:
    def __init__(self, *, token: str, api_version: str, api_url: str, timeout_seconds: float = 20.0) -> None:
        self._token = token
        self._api_version = api_version
        self._api_url = api_url.rstrip("/")
        self._timeout_seconds = timeout_seconds

    def _post(self, payload: dict[str, Any]) -> dict[str, Any]:
        headers = {
            "Accept": "application/json",
            "Authorization": self._token,
            "API-Version": self._api_version,
            "Content-Type": "application/json",
        }
        req = request.Request(
            self._api_url,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with request.urlopen(req, timeout=self._timeout_seconds) as resp:
                raw = resp.read().decode("utf-8")
                response_headers = dict(resp.headers.items())
        except error.HTTPError as exc:
            raw = exc.read().decode("utf-8", "replace") if hasattr(exc, "read") else ""
            details: dict[str, Any] = {"url": self._api_url, "status_code": exc.code}
            if raw:
                details["body"] = raw[:2000]
                try:
                    details["response"] = json.loads(raw)
                except json.JSONDecodeError:
                    pass
            if exc.code in {401, 403}:
                raise MondayApiError(
                    "MONDAY_AUTH_ERROR",
                    "Monday token is configured but authentication or authorization failed.",
                    exc.code,
                    details,
                ) from exc
            raise MondayApiError(
                "MONDAY_HTTP_ERROR",
                f"Monday API request failed with HTTP {exc.code}",
                exc.code,
                details,
            ) from exc
        except error.URLError as exc:
            raise MondayApiError(
                "MONDAY_UNREACHABLE",
                f"Unable to reach the monday API: {exc.reason}",
                12,
                {"url": self._api_url},
            ) from exc

        if not raw:
            response: dict[str, Any] = {}
        else:
            try:
                response = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise MondayApiError(
                    "MONDAY_BAD_JSON",
                    "Monday API returned invalid JSON.",
                    12,
                    {"url": self._api_url, "body": raw[:2000]},
                ) from exc

        if "errors" in response and response["errors"]:
            first_error = response["errors"][0]
            extensions = first_error.get("extensions") or {}
            request_id = (response.get("extensions") or {}).get("request_id")
            details = {
                "errors": response["errors"],
                "request_id": request_id,
                "response_headers": response_headers,
            }
            status_code = int(extensions.get("status_code") or extensions.get("statusCode") or 200)
            raise MondayApiError(
                str(extensions.get("code") or "MONDAY_API_ERROR"),
                str(first_error.get("message") or "Monday API query failed"),
                status_code,
                details,
            )

        return response

    def query(self, query: str, *, variables: dict[str, Any] | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {"query": query}
        if variables is not None:
            payload["variables"] = variables
        return self._post(payload)

    def me(self) -> dict[str, Any]:
        payload = self.query(
            """
            query {
              me {
                id
                name
                email
                title
              }
            }
            """
        )
        return payload.get("data", {}).get("me") or {}

    def list_workspaces(self) -> list[dict[str, Any]]:
        payload = self.query(
            """
            query {
              workspaces {
                id
                name
                is_default_workspace
              }
            }
            """
        )
        return list(payload.get("data", {}).get("workspaces") or [])

    def list_boards(self) -> list[dict[str, Any]]:
        payload = self.query(
            """
            query {
              boards {
                id
                name
                items_count
              }
            }
            """
        )
        return list(payload.get("data", {}).get("boards") or [])

    def read_board(self, board_id: str, *, limit: int) -> dict[str, Any]:
        payload = self.query(
            """
            query ($board_id: [ID!]!, $limit: Int!) {
              boards(ids: $board_id) {
                id
                name
                items_page(limit: $limit) {
                  cursor
                  items {
                    id
                    name
                  }
                }
                updates(limit: $limit, board_updates_only: true) {
                  id
                  body
                  created_at
                }
              }
            }
            """,
            variables={"board_id": [board_id], "limit": limit},
        )
        boards = list(payload.get("data", {}).get("boards") or [])
        return boards[0] if boards else {}

    def read_item(self, item_id: str) -> dict[str, Any]:
        payload = self.query(
            """
            query ($item_id: [ID!]!) {
              items(ids: $item_id) {
                id
                name
                board {
                  id
                  name
                }
              }
            }
            """,
            variables={"item_id": [item_id]},
        )
        items = list(payload.get("data", {}).get("items") or [])
        return items[0] if items else {}

    def list_updates(self, *, limit: int) -> list[dict[str, Any]]:
        payload = self.query(
            """
            query ($limit: Int!) {
              updates(limit: $limit) {
                id
                body
                created_at
                creator {
                  id
                  name
                }
              }
            }
            """,
            variables={"limit": limit},
        )
        return list(payload.get("data", {}).get("updates") or [])

    def create_item(
        self,
        *,
        board_id: str,
        item_name: str,
        group_id: str | None = None,
        column_values: str | None = None,
    ) -> dict[str, Any]:
        payload = self.query(
            """
            mutation ($board_id: ID!, $item_name: String!, $group_id: String, $column_values: JSON) {
              create_item(
                board_id: $board_id,
                item_name: $item_name,
                group_id: $group_id,
                column_values: $column_values
              ) {
                id
                name
                board {
                  id
                  name
                }
              }
            }
            """,
            variables={
                "board_id": board_id,
                "item_name": item_name,
                "group_id": group_id,
                "column_values": column_values,
            },
        )
        return payload.get("data", {}).get("create_item") or {}

    def change_simple_column_value(
        self,
        *,
        board_id: str,
        item_id: str,
        column_id: str,
        value: str,
    ) -> dict[str, Any]:
        payload = self.query(
            """
            mutation ($board_id: ID!, $item_id: ID!, $column_id: String!, $value: String!) {
              change_simple_column_value(
                board_id: $board_id,
                item_id: $item_id,
                column_id: $column_id,
                value: $value
              ) {
                id
                name
              }
            }
            """,
            variables={
                "board_id": board_id,
                "item_id": item_id,
                "column_id": column_id,
                "value": value,
            },
        )
        return payload.get("data", {}).get("change_simple_column_value") or {}

    def change_multiple_column_values(
        self,
        *,
        board_id: str,
        item_id: str,
        column_values: str,
    ) -> dict[str, Any]:
        payload = self.query(
            """
            mutation ($board_id: ID!, $item_id: ID!, $column_values: JSON!) {
              change_multiple_column_values(
                board_id: $board_id,
                item_id: $item_id,
                column_values: $column_values
              ) {
                id
                name
              }
            }
            """,
            variables={
                "board_id": board_id,
                "item_id": item_id,
                "column_values": column_values,
            },
        )
        return payload.get("data", {}).get("change_multiple_column_values") or {}

    def create_update(self, *, item_id: str, body: str) -> dict[str, Any]:
        payload = self.query(
            """
            mutation ($item_id: ID!, $body: String!) {
              create_update(item_id: $item_id, body: $body) {
                id
                body
                created_at
              }
            }
            """,
            variables={"item_id": item_id, "body": body},
        )
        return payload.get("data", {}).get("create_update") or {}
