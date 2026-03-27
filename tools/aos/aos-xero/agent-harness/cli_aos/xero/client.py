from __future__ import annotations

import base64
import json
import time
from dataclasses import dataclass
from typing import Any
from urllib import error, parse, request

from .constants import DEFAULT_API_BASE_URL, DEFAULT_TIMEOUT_SECONDS, DEFAULT_TOKEN_URL


@dataclass(slots=True)
class XeroApiError(Exception):
    status_code: int | None
    code: str
    message: str
    details: dict[str, Any] | None = None


def _load_json(payload: bytes) -> Any:
    if not payload:
        return {}
    text = payload.decode("utf-8")
    if not text.strip():
        return {}
    return json.loads(text)


def _dict_or_empty(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _list_or_empty(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


class XeroClient:
    def __init__(
        self,
        *,
        client_id: str,
        client_secret: str,
        refresh_token: str,
        tenant_id: str,
        api_base_url: str = DEFAULT_API_BASE_URL,
        token_url: str = DEFAULT_TOKEN_URL,
    ) -> None:
        self._client_id = client_id.strip()
        self._client_secret = client_secret.strip()
        self._refresh_token = refresh_token.strip()
        self._tenant_id = tenant_id.strip()
        self._api_base_url = api_base_url.rstrip("/")
        self._token_url = token_url
        self._access_token: str | None = None
        self._token_expires_at = 0.0

    def _request(
        self,
        method: str,
        url: str,
        *,
        query: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        expect_json: bool = True,
        headers: dict[str, str] | None = None,
    ) -> Any:
        if query:
            url = f"{url}?{parse.urlencode([(k, str(v)) for k, v in query.items() if v is not None])}"
        req_headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self.access_token()}",
            "xero-tenant-id": self._tenant_id,
        }
        if headers:
            req_headers.update(headers)
        payload: bytes | None = None
        if json_body is not None:
            payload = json.dumps(json_body).encode("utf-8")
            req_headers["Content-Type"] = "application/json"
        req = request.Request(url, data=payload, method=method.upper(), headers=req_headers)
        try:
            with request.urlopen(req, timeout=DEFAULT_TIMEOUT_SECONDS) as resp:
                data = resp.read()
                if expect_json:
                    return _dict_or_empty(_load_json(data))
                return {"content_type": resp.headers.get("Content-Type"), "bytes": data, "final_url": resp.geturl()}
        except error.HTTPError as err:
            details: dict[str, Any] = {}
            try:
                details = _dict_or_empty(_load_json(err.read()))
            except Exception:
                details = {}
            code = str(details.get("error") or details.get("code") or "XERO_API_ERROR")
            message = str(details.get("message") or err.reason or "Xero API request failed")
            raise XeroApiError(
                status_code=err.code,
                code=code,
                message=message,
                details=details or {"url": url},
            ) from err
        except error.URLError as err:
            raise XeroApiError(
                status_code=None,
                code="XERO_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"url": url},
            ) from err

    def refresh_access_token(self) -> dict[str, Any]:
        payload = parse.urlencode(
            {
                "grant_type": "refresh_token",
                "refresh_token": self._refresh_token,
                "client_id": self._client_id,
                "client_secret": self._client_secret,
            }
        ).encode("utf-8")
        req = request.Request(
            self._token_url,
            data=payload,
            method="POST",
            headers={
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
            },
        )
        try:
            with request.urlopen(req, timeout=DEFAULT_TIMEOUT_SECONDS) as resp:
                data = _dict_or_empty(_load_json(resp.read()))
                token = str(data.get("access_token") or "")
                if not token:
                    raise XeroApiError(status_code=None, code="XERO_TOKEN_ERROR", message="Missing access_token in token response", details=data)
                self._access_token = token
                expires_in = int(data.get("expires_in") or 1800)
                self._token_expires_at = time.time() + max(60, expires_in - 30)
                return data
        except error.HTTPError as err:
            details = {}
            try:
                details = _dict_or_empty(_load_json(err.read()))
            except Exception:
                details = {}
            raise XeroApiError(status_code=err.code, code="XERO_TOKEN_ERROR", message=str(details.get("error_description") or err.reason or "Xero token refresh failed"), details=details) from err
        except error.URLError as err:
            raise XeroApiError(status_code=None, code="XERO_NETWORK_ERROR", message=str(getattr(err, "reason", err)), details={"url": self._token_url}) from err

    def access_token(self) -> str:
        if self._access_token and time.time() < self._token_expires_at:
            return self._access_token
        data = self.refresh_access_token()
        return str(data.get("access_token") or self._access_token or "")

    def connections(self) -> dict[str, Any]:
        return self._request("GET", "https://api.xero.com/connections")

    def list_invoices(self, *, limit: int = 25, statuses: list[str] | None = None) -> dict[str, Any]:
        query: dict[str, Any] = {"pageSize": max(1, limit)}
        if statuses:
            query["Statuses"] = ",".join(statuses)
        return self._request("GET", f"{self._api_base_url}/Invoices", query=query)

    def get_invoice(self, invoice_id: str) -> dict[str, Any]:
        return self._request("GET", f"{self._api_base_url}/Invoices/{parse.quote(invoice_id, safe='')}")

    def list_contacts(self, *, limit: int = 25) -> dict[str, Any]:
        return self._request("GET", f"{self._api_base_url}/Contacts", query={"pageSize": max(1, limit)})

    def get_contact(self, contact_id: str) -> dict[str, Any]:
        return self._request("GET", f"{self._api_base_url}/Contacts/{parse.quote(contact_id, safe='')}")

    def list_payments(self, *, limit: int = 25) -> dict[str, Any]:
        return self._request("GET", f"{self._api_base_url}/Payments", query={"pageSize": max(1, limit)})

    def get_payment(self, payment_id: str) -> dict[str, Any]:
        return self._request("GET", f"{self._api_base_url}/Payments/{parse.quote(payment_id, safe='')}")

    def list_accounts(self, *, limit: int = 100) -> dict[str, Any]:
        return self._request("GET", f"{self._api_base_url}/Accounts", query={"pageSize": max(1, limit)})

    def list_bank_transactions(self, *, limit: int = 25) -> dict[str, Any]:
        return self._request("GET", f"{self._api_base_url}/BankTransactions", query={"pageSize": max(1, limit)})

    def profit_and_loss_report(self, *, date: str | None = None) -> dict[str, Any]:
        query: dict[str, Any] = {}
        if date:
            query["date"] = date
        return self._request("GET", f"{self._api_base_url}/Reports/ProfitAndLoss", query=query)

    def balance_sheet_report(self, *, date: str | None = None) -> dict[str, Any]:
        query: dict[str, Any] = {}
        if date:
            query["date"] = date
        return self._request("GET", f"{self._api_base_url}/Reports/BalanceSheet", query=query)

    def list_quotes(self, *, limit: int = 25) -> dict[str, Any]:
        return self._request("GET", f"{self._api_base_url}/Quotes", query={"pageSize": max(1, limit)})
