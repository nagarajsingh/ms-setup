from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any
from urllib.parse import quote
from uuid import uuid4

import httpx
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from kubernetes import client, config
from kubernetes.client.exceptions import ApiException
from pydantic import BaseModel, Field

from app.entra_auth import current_user, require_devops

APP_TITLE = "Microservice Setup Portal API"
PROVISION_MODE = os.getenv("PROVISION_MODE", "dry-run").lower()
DATA_FILE = Path(os.getenv("DATA_FILE", "/app/data/requests.json"))
AZDO_ORG = os.getenv("AZDO_ORG", "")
AZDO_PROJECT = os.getenv("AZDO_PROJECT", "")
AZDO_PAT = os.getenv("AZDO_PAT", "")
PIPELINE_BRANCH = os.getenv("PIPELINE_BRANCH", "devops/pipeline")
PIPELINE_COPY_PATHS = [
    x.strip().lstrip("/")
    for x in os.getenv(
        "PIPELINE_COPY_PATHS",
        "azure-pipelines.yml,azure-pipelines.yaml,Dockerfile,Dockerfile.static,manifests/,shared-config/",
    ).split(",")
    if x.strip()
]

app = FastAPI(title=APP_TITLE, version="2.2.0")
origins = [x.strip() for x in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
store_lock = Lock()


class ServiceRequestCreate(BaseModel):
    serviceName: str
    namespace: str
    description: str = ""
    containerPort: int = Field(default=8080, ge=1, le=65535)
    servicePort: int = Field(default=8080, ge=1, le=65535)
    ingressName: str
    ingressHost: str = ""
    ingressPath: str
    referenceRepository: str = ""
    databaseRequired: bool = False
    databaseType: str = ""
    databaseName: str = ""
    schemaName: str = ""
    databaseUsername: str = ""


class ApprovalRequest(BaseModel):
    comment: str = "Approved"
    createPipelineBranch: bool = False


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_name(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9-]", "-", value.strip().lower())
    return re.sub(r"-+", "-", cleaned).strip("-")


def read_requests() -> list[dict[str, Any]]:
    with store_lock:
        DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
        if not DATA_FILE.exists():
            DATA_FILE.write_text("[]", encoding="utf-8")
        return json.loads(DATA_FILE.read_text(encoding="utf-8"))


def write_requests(items: list[dict[str, Any]]) -> None:
    with store_lock:
        DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
        temp = DATA_FILE.with_suffix(".tmp")
        temp.write_text(json.dumps(items, indent=2), encoding="utf-8")
        temp.replace(DATA_FILE)


def azdo_base() -> str:
    if not all([AZDO_ORG, AZDO_PROJECT, AZDO_PAT]):
        raise RuntimeError("AZDO_ORG, AZDO_PROJECT and AZDO_PAT are required")
    return f"https://dev.azure.com/{AZDO_ORG}/{AZDO_PROJECT}/_apis/git"


def normalize_branch(value: str | None, fallback: str = "main") -> str:
    branch = (value or fallback).strip()
    return branch.removeprefix("refs/heads/")


def should_copy_reference_path(path: str) -> bool:
    normalized = path.lstrip("/")
    for configured in PIPELINE_COPY_PATHS:
        if configured.endswith("/") and normalized.startswith(configured):
            return True
        if normalized == configured:
            return True
    return False


async def create_or_get_repo(name: str) -> dict[str, Any]:
    if PROVISION_MODE != "live":
        return {
            "url": f"https://dev.azure.com/example/project/_git/{name}",
            "id": name,
            "name": name,
            "defaultBranch": "refs/heads/main",
            "action": "DRY_RUN",
        }

    base = f"{azdo_base()}/repositories"
    async with httpx.AsyncClient(auth=("", AZDO_PAT), timeout=30.0) as http:
        response = await http.post(base, params={"api-version": "7.1"}, json={"name": name})
        if response.status_code in (200, 201):
            repo = response.json()
            return {
                "url": repo.get("webUrl") or repo.get("remoteUrl"),
                "id": repo["id"],
                "name": repo.get("name", name),
                "defaultBranch": repo.get("defaultBranch") or "refs/heads/main",
                "action": "CREATED",
            }
        if response.status_code != 409:
            response.raise_for_status()

        existing = await http.get(f"{base}/{quote(name, safe='')}", params={"api-version": "7.1"})
        existing.raise_for_status()
        repo = existing.json()
        return {
            "url": repo.get("webUrl") or repo.get("remoteUrl"),
            "id": repo["id"],
            "name": repo.get("name", name),
            "defaultBranch": repo.get("defaultBranch") or "refs/heads/main",
            "action": "REUSED_EXISTING",
        }


async def get_branch_object_id(http: httpx.AsyncClient, repo_id: str, branch: str) -> str:
    branch_name = normalize_branch(branch)
    response = await http.get(
        f"{azdo_base()}/repositories/{quote(repo_id, safe='')}/refs",
        params={"filter": f"heads/{branch_name}", "api-version": "7.1"},
    )
    response.raise_for_status()
    refs = response.json().get("value", [])
    exact = next((x for x in refs if x.get("name") == f"refs/heads/{branch_name}"), None)
    if not exact:
        raise RuntimeError(f"Branch '{branch_name}' was not found in repository '{repo_id}'")
    return exact["objectId"]


async def get_repository(http: httpx.AsyncClient, repository: str) -> dict[str, Any]:
    response = await http.get(
        f"{azdo_base()}/repositories/{quote(repository, safe='')}",
        params={"api-version": "7.1"},
    )
    response.raise_for_status()
    return response.json()


async def list_repository_files(http: httpx.AsyncClient, repo_id: str, branch: str) -> list[str]:
    response = await http.get(
        f"{azdo_base()}/repositories/{quote(repo_id, safe='')}/items",
        params={
            "scopePath": "/",
            "recursionLevel": "Full",
            "includeContentMetadata": "true",
            "versionDescriptor.version": normalize_branch(branch),
            "versionDescriptor.versionType": "branch",
            "api-version": "7.1",
        },
    )
    response.raise_for_status()
    return [
        item["path"]
        for item in response.json().get("value", [])
        if not item.get("isFolder", False) and item.get("path")
    ]


async def read_repository_file(http: httpx.AsyncClient, repo_id: str, branch: str, path: str) -> str:
    response = await http.get(
        f"{azdo_base()}/repositories/{quote(repo_id, safe='')}/items",
        params={
            "path": path,
            "includeContent": "true",
            "versionDescriptor.version": normalize_branch(branch),
            "versionDescriptor.versionType": "branch",
            "api-version": "7.1",
        },
    )
    response.raise_for_status()
    content_type = response.headers.get("content-type", "")
    if "application/json" in content_type:
        body = response.json()
        if isinstance(body, dict) and isinstance(body.get("content"), str):
            return body["content"]
    return response.text


def render_reference_content(content: str, item: dict[str, Any], reference_repo: str) -> str:
    replacements = {
        "__SERVICE_NAME__": item["serviceName"],
        "__REPOSITORY_NAME__": item["serviceName"],
        "__NAMESPACE__": item["namespace"],
        "__INGRESS_HOST__": item.get("ingressHost", ""),
        "__INGRESS_PATH__": item.get("ingressPath", ""),
        "__REFERENCE_REPOSITORY__": reference_repo,
    }
    rendered = content
    for token, value in replacements.items():
        rendered = rendered.replace(token, str(value))
    return rendered


async def create_pipeline_branch_from_reference(item: dict[str, Any], target_repo: dict[str, Any]) -> dict[str, Any]:
    reference_name = item.get("referenceRepository", "").strip()
    if not reference_name:
        raise RuntimeError("Reference repository is required before creating the devops/pipeline branch")

    if PROVISION_MODE != "live":
        return {
            "action": "DRY_RUN",
            "branch": PIPELINE_BRANCH,
            "referenceRepository": reference_name,
            "copyPaths": PIPELINE_COPY_PATHS,
        }

    async with httpx.AsyncClient(auth=("", AZDO_PAT), timeout=60.0) as http:
        reference_repo = await get_repository(http, reference_name)
        reference_branch = normalize_branch(reference_repo.get("defaultBranch"), "main")
        target_branch = normalize_branch(target_repo.get("defaultBranch"), "main")
        target_repo_id = target_repo["id"]
        target_base_sha = await get_branch_object_id(http, target_repo_id, target_branch)

        refs_response = await http.get(
            f"{azdo_base()}/repositories/{quote(target_repo_id, safe='')}/refs",
            params={"filter": f"heads/{PIPELINE_BRANCH}", "api-version": "7.1"},
        )
        refs_response.raise_for_status()
        refs = refs_response.json().get("value", [])
        pipeline_ref = next((x for x in refs if x.get("name") == f"refs/heads/{PIPELINE_BRANCH}"), None)

        branch_action = "REUSED_EXISTING_BRANCH"
        branch_sha = pipeline_ref.get("objectId") if pipeline_ref else None
        if not branch_sha:
            create_ref = await http.post(
                f"{azdo_base()}/repositories/{quote(target_repo_id, safe='')}/refs",
                params={"api-version": "7.1"},
                json=[
                    {
                        "name": f"refs/heads/{PIPELINE_BRANCH}",
                        "oldObjectId": "0000000000000000000000000000000000000000",
                        "newObjectId": target_base_sha,
                    }
                ],
            )
            create_ref.raise_for_status()
            result = create_ref.json().get("value", [{}])[0]
            if not result.get("success", True):
                raise RuntimeError(result.get("customMessage") or f"Failed to create branch {PIPELINE_BRANCH}")
            branch_sha = target_base_sha
            branch_action = "CREATED_BRANCH"

        source_files = await list_repository_files(http, reference_repo["id"], reference_branch)
        files_to_copy = [path for path in source_files if should_copy_reference_path(path)]
        if not files_to_copy:
            raise RuntimeError(
                f"No configured DevOps files were found in reference repository '{reference_name}'. "
                f"Configured paths: {', '.join(PIPELINE_COPY_PATHS)}"
            )

        target_files = set(await list_repository_files(http, target_repo_id, PIPELINE_BRANCH))
        changes: list[dict[str, Any]] = []
        for path in files_to_copy:
            source_content = await read_repository_file(http, reference_repo["id"], reference_branch, path)
            rendered_content = render_reference_content(source_content, item, reference_name)
            changes.append(
                {
                    "changeType": "edit" if path in target_files else "add",
                    "item": {"path": path},
                    "newContent": {"content": rendered_content, "contentType": "rawtext"},
                }
            )

        push = await http.post(
            f"{azdo_base()}/repositories/{quote(target_repo_id, safe='')}/pushes",
            params={"api-version": "7.1"},
            json={
                "refUpdates": [{"name": f"refs/heads/{PIPELINE_BRANCH}", "oldObjectId": branch_sha}],
                "commits": [
                    {
                        "comment": f"Configure DevOps pipeline from reference repository {reference_name}",
                        "changes": changes,
                    }
                ],
            },
        )
        push.raise_for_status()
        push_body = push.json()

        return {
            "action": branch_action,
            "branch": PIPELINE_BRANCH,
            "referenceRepository": reference_name,
            "referenceBranch": reference_branch,
            "filesCopied": files_to_copy,
            "pushId": push_body.get("pushId"),
        }


def k8s_clients() -> tuple[client.CoreV1Api, client.NetworkingV1Api]:
    try:
        config.load_incluster_config()
    except config.ConfigException:
        config.load_kube_config()
    return client.CoreV1Api(), client.NetworkingV1Api()


def provision_kubernetes(item: dict[str, Any]) -> dict[str, Any]:
    path_value = f"{item['ingressPath']}(/|$)(.*)"
    if PROVISION_MODE != "live":
        return {"serviceAction": "DRY_RUN", "ingressAction": "DRY_RUN", "ingressPath": path_value}
    core, networking = k8s_clients()
    service = client.V1Service(
        metadata=client.V1ObjectMeta(name=item["serviceName"], namespace=item["namespace"], labels={"app": item["serviceName"]}),
        spec=client.V1ServiceSpec(type="ClusterIP", selector={"app": item["serviceName"]}, ports=[client.V1ServicePort(name="http", protocol="TCP", port=item["servicePort"], target_port=item["containerPort"])])
    )
    try:
        existing = core.read_namespaced_service(item["serviceName"], item["namespace"])
        service.metadata.resource_version = existing.metadata.resource_version
        service.spec.cluster_ip = existing.spec.cluster_ip
        service.spec.cluster_ips = existing.spec.cluster_ips
        service.spec.ip_families = existing.spec.ip_families
        service.spec.ip_family_policy = existing.spec.ip_family_policy
        core.replace_namespaced_service(item["serviceName"], item["namespace"], service)
        service_action = "UPDATED_EXISTING"
    except ApiException as exc:
        if exc.status != 404:
            raise
        core.create_namespaced_service(item["namespace"], service)
        service_action = "CREATED"
    ingress = networking.read_namespaced_ingress(item["ingressName"], item["namespace"])
    rules = ingress.spec.rules or []
    rule = next((r for r in rules if not item["ingressHost"] or r.host == item["ingressHost"]), None)
    if rule is None:
        rule = client.V1IngressRule(host=item["ingressHost"] or None, http=client.V1HTTPIngressRuleValue(paths=[]))
        rules.append(rule)
    rule.http.paths = rule.http.paths or []
    if any(p.path == path_value for p in rule.http.paths):
        ingress_action = "UNCHANGED"
    else:
        rule.http.paths.append(client.V1HTTPIngressPath(path=path_value, path_type="ImplementationSpecific", backend=client.V1IngressBackend(service=client.V1IngressServiceBackend(name=item["serviceName"], port=client.V1ServiceBackendPort(number=item["servicePort"])))))
        ingress.spec.rules = rules
        networking.replace_namespaced_ingress(item["ingressName"], item["namespace"], ingress)
        ingress_action = "PATH_ADDED"
    return {"serviceName": item["serviceName"], "serviceAction": service_action, "ingressName": item["ingressName"], "ingressPath": path_value, "ingressAction": ingress_action}


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "UP", "mode": PROVISION_MODE, "authentication": "ENTRA_ID"}


@app.get("/api/me")
def me(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return user


@app.get("/api/requests")
def list_requests(user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
    items = read_requests()
    return items if user["role"] in {"DEVOPS", "ADMIN"} else [x for x in items if x["requestedBy"] == user["username"]]


@app.post("/api/requests", status_code=status.HTTP_201_CREATED)
def create_request(body: ServiceRequestCreate, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    service_name, namespace = safe_name(body.serviceName), safe_name(body.namespace)
    if not service_name or not namespace:
        raise HTTPException(status_code=400, detail="Valid service name and namespace are required")
    items = read_requests()
    if any(x["serviceName"] == service_name and x["status"] not in {"REJECTED", "FAILED"} for x in items):
        raise HTTPException(status_code=409, detail="An active request already exists for this service")
    created = now_iso()
    item = body.model_dump()
    item.update({"id": str(uuid4()), "serviceName": service_name, "namespace": namespace, "ingressName": safe_name(body.ingressName), "status": "PENDING_APPROVAL", "requestedBy": user["username"], "requestedById": user["id"], "approvedBy": None, "approvalComment": "", "repositoryUrl": "", "steps": [], "createdAt": created, "updatedAt": created})
    items.insert(0, item)
    write_requests(items)
    return item


@app.post("/api/requests/{request_id}/reject")
def reject_request(request_id: str, body: ApprovalRequest, user: dict[str, Any] = Depends(require_devops)) -> dict[str, Any]:
    items = read_requests()
    item = next((x for x in items if x["id"] == request_id), None)
    if not item:
        raise HTTPException(status_code=404, detail="Request not found")
    item.update({"status": "REJECTED", "approvedBy": user["username"], "approvalComment": body.comment or "Rejected", "updatedAt": now_iso()})
    write_requests(items)
    return item


@app.post("/api/requests/{request_id}/approve")
async def approve_request(request_id: str, body: ApprovalRequest, user: dict[str, Any] = Depends(require_devops)) -> dict[str, Any]:
    items = read_requests()
    item = next((x for x in items if x["id"] == request_id), None)
    if not item:
        raise HTTPException(status_code=404, detail="Request not found")
    if item["status"] not in {"PENDING_APPROVAL", "FAILED", "AWAITING_REPO_CONFIRMATION"}:
        raise HTTPException(status_code=409, detail="Request cannot be approved in its current status")

    item.update({"status": "PROVISIONING", "approvedBy": user["username"], "approvalComment": body.comment or "Approved", "steps": [], "updatedAt": now_iso()})
    write_requests(items)

    try:
        repo = await create_or_get_repo(item["serviceName"])
        item["repositoryUrl"] = repo["url"]
        item["steps"].append({"name": "CREATE_AZURE_REPO", "status": "COMPLETED", "details": repo})

        if repo["action"] == "REUSED_EXISTING" and not body.createPipelineBranch:
            item["status"] = "AWAITING_REPO_CONFIRMATION"
            item["updatedAt"] = now_iso()
            write_requests(items)
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "REPOSITORY_EXISTS",
                    "message": f"Repository '{item['serviceName']}' already exists.",
                    "question": f"Create '{PIPELINE_BRANCH}' and copy the required DevOps files from reference repository '{item.get('referenceRepository') or 'not selected'}'?",
                    "repository": repo,
                    "pipelineBranch": PIPELINE_BRANCH,
                    "referenceRepository": item.get("referenceRepository", ""),
                },
            )

        if repo["action"] == "REUSED_EXISTING" and body.createPipelineBranch:
            branch = await create_pipeline_branch_from_reference(item, repo)
            item["steps"].append({"name": "CREATE_PIPELINE_BRANCH", "status": "COMPLETED", "details": branch})
            write_requests(items)

        cluster = provision_kubernetes(item)
        item["steps"].append({"name": "CREATE_K8S_SERVICE_AND_UPDATE_INGRESS", "status": "COMPLETED", "details": cluster})
        item["status"] = "COMPLETED" if PROVISION_MODE == "live" else "DRY_RUN_COMPLETED"
        item["updatedAt"] = now_iso()
        write_requests(items)
        return item
    except HTTPException:
        raise
    except Exception as exc:
        item["status"] = "FAILED"
        item["steps"].append({"name": "PROVISIONING", "status": "FAILED", "error": str(exc)})
        item["updatedAt"] = now_iso()
        write_requests(items)
        raise HTTPException(status_code=500, detail={"error": str(exc), "request": item}) from exc
