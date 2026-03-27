from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.pinecone.cli import cli
import cli_aos.pinecone.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakePineconeClient:
    def list_indexes(self, *, limit: int = 50) -> dict[str, Any]:
        indexes = [
            {"name": "articles", "dimension": 1536, "metric": "cosine", "status": "ready", "host": "articles.svc.us-east-1.pinecone.io"},
            {"name": "notes", "dimension": 768, "metric": "dotproduct", "status": "ready", "host": "notes.svc.us-east-1.pinecone.io"},
        ]
        return {"indexes": indexes[:limit], "count": min(limit, len(indexes)), "raw": {"indexes": indexes}}

    def create_index(self, *, index_name: str, dimension: int, metric: str = "cosine", cloud: str = "aws", region: str = "us-east-1") -> dict[str, Any]:
        return {"index": {"name": index_name, "dimension": dimension, "metric": metric, "spec": {"serverless": {"cloud": cloud, "region": region}}}, "raw": {}}

    def describe_index(self, index_name: str) -> dict[str, Any]:
        return {"name": index_name, "dimension": 1536, "metric": "cosine", "status": "ready", "host": f"{index_name}.svc.us-east-1.pinecone.io"}

    def delete_index(self, index_name: str) -> dict[str, Any]:
        return {"deleted": True, "raw": {"name": index_name}}

    def upsert_vectors(self, *, index_name: str | None, vectors: list[dict[str, Any]], namespace: str | None = None) -> dict[str, Any]:
        return {"upserted_count": len(vectors), "raw": {"index_name": index_name, "namespace": namespace, "vectors": vectors}}

    def query_vectors(self, *, index_name: str | None, vector: list[float], top_k: int = 10, namespace: str | None = None, filter: dict[str, Any] | None = None, include_values: bool = False) -> dict[str, Any]:
        return {
            "matches": [
                {"id": "vec-1", "score": 0.98, "values": vector if include_values else None, "metadata": {"source": "doc-1"}},
            ],
            "raw": {"index_name": index_name, "namespace": namespace, "top_k": top_k, "filter": filter},
        }

    def fetch_vectors(self, *, index_name: str | None, ids: list[str], namespace: str | None = None) -> dict[str, Any]:
        return {
            "vectors": {ids[0]: {"id": ids[0], "values": [0.1, 0.2, 0.3], "metadata": {"source": "doc-1"}}},
            "raw": {"index_name": index_name, "namespace": namespace},
        }

    def delete_vectors(self, *, index_name: str | None, ids: list[str] | None = None, delete_all: bool = False, namespace: str | None = None, filter: dict[str, Any] | None = None) -> dict[str, Any]:
        return {"deleted": True, "raw": {"index_name": index_name, "ids": ids, "delete_all": delete_all, "namespace": namespace, "filter": filter}}

    def list_namespaces(self, *, index_name: str | None, prefix: str | None = None, limit: int = 50) -> dict[str, Any]:
        namespaces = [{"name": "production", "vector_count": 42}, {"name": "staging", "vector_count": 3}]
        return {"namespaces": namespaces[:limit], "count": min(limit, len(namespaces)), "raw": {"index_name": index_name, "prefix": prefix}}


def invoke_json(args: list[str]) -> dict[str, Any]:
    result = CliRunner().invoke(cli, ["--json", *args])
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def invoke_json_with_mode(mode: str, args: list[str]) -> dict[str, Any]:
    result = CliRunner().invoke(cli, ["--json", "--mode", mode, *args])
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def test_manifest_and_permissions_are_in_sync():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    command_ids = [command["id"] for command in manifest["commands"]]
    assert set(command_ids) == set(permissions.keys())
    assert manifest["scope"]["kind"] == "vector-database"


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-pinecone"
    assert payload["data"]["backend"] == "pinecone-api"
    assert "vector.upsert" in json.dumps(payload["data"])
    assert "namespace.list" in json.dumps(payload["data"])


def test_health_requires_credentials(monkeypatch):
    monkeypatch.delenv("PINECONE_API_KEY", raising=False)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "PINECONE_API_KEY" in json.dumps(payload["data"])


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setenv("PINECONE_API_KEY", "pcsk-test-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakePineconeClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["ok"] is True
    assert payload["data"]["probe"]["details"]["index_count"] == 1


def test_config_show_redacts_credentials(monkeypatch):
    monkeypatch.setenv("PINECONE_API_KEY", "pcsk-super-secret")
    monkeypatch.setenv("PINECONE_INDEX_NAME", "articles")
    monkeypatch.setenv("PINECONE_NAMESPACE", "production")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakePineconeClient())
    payload = invoke_json(["config", "show"])
    data = payload["data"]
    assert "pcsk-super-secret" not in json.dumps(data)
    assert data["auth"]["api_key_present"] is True
    assert data["runtime"]["implementation_mode"] == "live_read_write"


def test_index_list_requires_read_mode(monkeypatch):
    monkeypatch.setenv("PINECONE_API_KEY", "pcsk-test-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakePineconeClient())
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "index", "list"])
    payload = json.loads(result.output)
    assert payload["ok"] is True
    assert payload["data"]["count"] == 2


def test_index_create_requires_write_mode(monkeypatch):
    monkeypatch.setenv("PINECONE_API_KEY", "pcsk-test-123")
    monkeypatch.setenv("PINECONE_INDEX_DIMENSION", "1536")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakePineconeClient())
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "index", "create", "--index-name", "articles"])
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "PERMISSION_DENIED"


def test_index_create_succeeds_in_write_mode(monkeypatch):
    monkeypatch.setenv("PINECONE_API_KEY", "pcsk-test-123")
    monkeypatch.setenv("PINECONE_INDEX_DIMENSION", "1536")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakePineconeClient())
    payload = invoke_json_with_mode("write", ["index", "create", "--index-name", "articles", "--dimension", "1536"])
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["index"]["name"] == "articles"


def test_vector_query_returns_read_payload(monkeypatch):
    monkeypatch.setenv("PINECONE_API_KEY", "pcsk-test-123")
    monkeypatch.setenv("PINECONE_INDEX_NAME", "articles")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakePineconeClient())
    payload = invoke_json(["vector", "query", "--query-vector-json", "[0.1, 0.2, 0.3]"])
    assert payload["data"]["status"] == "live_read"
    assert payload["data"]["query"]["matches"][0]["id"] == "vec-1"


def test_vector_upsert_succeeds_in_write_mode(monkeypatch):
    monkeypatch.setenv("PINECONE_API_KEY", "pcsk-test-123")
    monkeypatch.setenv("PINECONE_INDEX_NAME", "articles")
    monkeypatch.setenv("PINECONE_VECTOR_ID", "vec-1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakePineconeClient())
    payload = invoke_json_with_mode("write", ["vector", "upsert", "--values-json", "[0.1, 0.2, 0.3]", "--metadata-json", '{"source":"doc-1"}'])
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["upsert"]["upserted_count"] == 1


def test_namespace_list_returns_read_payload(monkeypatch):
    monkeypatch.setenv("PINECONE_API_KEY", "pcsk-test-123")
    monkeypatch.setenv("PINECONE_INDEX_NAME", "articles")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakePineconeClient())
    payload = invoke_json(["namespace", "list"])
    assert payload["data"]["status"] == "live_read"
    assert payload["data"]["count"] == 2
