from __future__ import annotations

import json
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Literal
from uuid import uuid4

import httpx
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from kubernetes import client, config
from kubernetes.client.exceptions import ApiException
from pydantic import BaseModel, Field, field_validator

APP_TITLE = "Microservice Setup Portal API"
PROVISION_MODE = os.getenv("PROVISION_MODE", "dry-run").lower()
JWT_SECRET = os.getenv("JWT_SECRET", "change-me-in-production")
JWT_ALGORITHM = "HS256"
DATA_FILE = Path(os.getenv("DATA_FILE", "/app/data/requests.json"))
AZDO_ORG = os.getenv("AZDO_ORG", "")
AZDO_PROJECT = os.getenv("AZDO_PROJECT", "")
AZDO_PAT = os.getenv("AZDO_PAT", "")
DEVOPS_PASSWORD = os.getenv("DEVOPS_APPROVER_PASSWORD", "devops123")

app = FastAPI(title=APP_TITLE, version="2.2.0")
origins = [x.strip() for x in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
security = HTTPBearer()
store_lock = Lock()

WORKFLOW_STEPS = ["CREATE_AZURE_REPO", "CREATE_K8S_SERVICE", "UPDATE_INGRESS"]
TERMINAL_STEP_STATUSES = {"COMPLETED", "REUSED", "SKIPPED"}


class LoginRequest(BaseModel):
    username: str
    password: str
    role: Literal["DEVELOPER", "DEVOPS"] = "DEVELOPER"


class ServiceRequestCreate(BaseModel):
    repoName: str
    serviceName: str = ""
    folders: str = "N/A"
    storage: str = "N/A"
    cpu: str = ""
    memory: str = ""
    dbDetails: str = ""
    acls: str = "N/A"
    certificates: str = "N/A"
    architectureDiagram: str = ""
    databaseUser: str = ""
    environments: list[str] = Field(default_factory=list)
    ingressPath: str
    securityStage: bool = False
    scheduledJob: bool = False
    prodPodCount: int = Field(default=1, ge=0, le=100)
    comments: dict[str, str] = Field(default_factory=dict)
    namespace: str
    description: str = ""
    containerPort: int = Field(default=8080, ge=1, le=65535)
    servicePort: int = Field(default=8080, ge=1, le=65535)
    ingressName: str
    ingressHost: str = ""
    databaseRequired: bool = False
    databaseType: str = ""
    databaseName: str = ""
    schemaName: str = ""
    databaseUsername: str = ""

    @field_validator("environments", mode="before")
    @classmethod
    def normalize_environments(cls, value: Any) -> list[str]:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value or []


class ApprovalRequest(BaseModel):
    comment: str = "Approved"


class ResumeRequest(BaseModel):
    comment: str = "Resume provisioning"


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


def create_token(username: str, role: str) -> str:
    payload = {"sub": username, "role": role, "exp": datetime.now(timezone.utc) + timedelta(hours=8)}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict[str, str]:
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return {"username": payload["sub"], "role": payload["role"]}
    except (JWTError, KeyError) as exc:
        raise HTTPException(status_code=401, detail="Authentication required") from exc


def require_devops(user: dict[str, str] = Depends(current_user)) -> dict[str, str]:
    if user["role"] != "DEVOPS":
        raise HTTPException(status_code=403, detail="DevOps permission required")
    return user


def prepare_request(body: ServiceRequestCreate) -> dict[str, Any]:
    item = body.model_dump()
    item["repoName"] = safe_name(body.repoName)
    item["serviceName"] = safe_name(body.serviceName or body.repoName)
    item["namespace"] = safe_name(body.namespace)
    item["ingressName"] = safe_name(body.ingressName)
    item["environments"] = [safe_name(env) for env in body.environments if safe_name(env)]
    item["ingressPath"] = "/" + body.ingressPath.strip().lstrip("/")
    if not item["repoName"] or not item["serviceName"] or not item["namespace"]:
        raise HTTPException(status_code=400, detail="Valid repo name, service name and namespace are required")
    return item


def ensure_steps(item: dict[str, Any]) -> list[dict[str, Any]]:
    existing = {step.get("name"): step for step in item.get("steps", []) if step.get("name") in WORKFLOW_STEPS}
    steps: list[dict[str, Any]] = []
    for name in WORKFLOW_STEPS:
        step = existing.get(name) or {
            "name": name,
            "status": "PENDING",
            "retryCount": 0,
            "startedAt": None,
            "completedAt": None,
            "error": "",
            "details": {},
        }
        steps.append(step)
    item["steps"] = steps
    return steps


def get_step(item: dict[str, Any], name: str) -> dict[str, Any]:
    return next(step for step in ensure_steps(item) if step["name"] == name)


def mark_step_running(step: dict[str, Any]) -> None:
    step.update({"status": "RUNNING", "startedAt": now_iso(), "completedAt": None, "error": ""})


def mark_step_success(step: dict[str, Any], details: dict[str, Any], status_value: str = "COMPLETED") -> None:
    step.update({"status": status_value, "completedAt": now_iso(), "error": "", "details": details})


def mark_step_failed(step: dict[str, Any], exc: Exception) -> None:
    step.update({
        "status": "FAILED",
        "completedAt": now_iso(),
        "error": str(exc),
        "retryCount": int(step.get("retryCount", 0)) + 1,
    })


async def create_or_get_repo(name: str) -> dict[str, Any]:
    if PROVISION_MODE != "live":
        return {"url": f"https://dev.azure.com/example/project/_git/{name}", "action": "DRY_RUN"}
    if not all([AZDO_ORG, AZDO_PROJECT, AZDO_PAT]):
        raise RuntimeError("AZDO_ORG, AZDO_PROJECT and AZDO_PAT are required")
    base = f"https://dev.azure.com/{AZDO_ORG}/{AZDO_PROJECT}/_apis/git/repositories"
    async with httpx.AsyncClient(auth=("", AZDO_PAT), timeout=30.0) as http:
        response = await http.post(base, params={"api-version": "7.1"}, json={"name": name})
        if response.status_code in (200, 201):
            repo = response.json()
            return {"url": repo.get("webUrl") or repo.get("remoteUrl"), "id": repo["id"], "action": "CREATED"}
        if response.status_code != 409:
            response.raise_for_status()
        existing = await http.get(f"{base}/{name}", params={"api-version": "7.1"})
        existing.raise_for_status()
        repo = existing.json()
        return {"url": repo.get("webUrl") or repo.get("remoteUrl"), "id": repo["id"], "action": "REUSED_EXISTING"}


def k8s_clients() -> tuple[client.CoreV1Api, client.NetworkingV1Api]:
    try:
        config.load_incluster_config()
    except config.ConfigException:
        config.load_kube_config()
    return client.CoreV1Api(), client.NetworkingV1Api()


def provision_service(item: dict[str, Any]) -> dict[str, Any]:
    if PROVISION_MODE != "live":
        return {"serviceName": item["serviceName"], "serviceAction": "DRY_RUN"}
    core, _ = k8s_clients()
    service = client.V1Service(
        metadata=client.V1ObjectMeta(name=item["serviceName"], namespace=item["namespace"], labels={"app": item["serviceName"]}),
        spec=client.V1ServiceSpec(
            type="ClusterIP",
            selector={"app": item["serviceName"]},
            ports=[client.V1ServicePort(name="http", protocol="TCP", port=item["servicePort"], target_port=item["containerPort"])],
        ),
    )
    try:
        existing = core.read_namespaced_service(item["serviceName"], item["namespace"])
        service.metadata.resource_version = existing.metadata.resource_version
        service.spec.cluster_ip = existing.spec.cluster_ip
        service.spec.cluster_ips = existing.spec.cluster_ips
        service.spec.ip_families = existing.spec.ip_families
        service.spec.ip_family_policy = existing.spec.ip_family_policy
        core.replace_namespaced_service(item["serviceName"], item["namespace"], service)
        action = "UPDATED_EXISTING"
    except ApiException as exc:
        if exc.status != 404:
            raise
        core.create_namespaced_service(item["namespace"], service)
        action = "CREATED"
    return {"serviceName": item["serviceName"], "serviceAction": action}


def provision_ingress(item: dict[str, Any]) -> dict[str, Any]:
    path_value = f"{item['ingressPath']}(/|$)(.*)"
    if PROVISION_MODE != "live":
        return {"ingressName": item["ingressName"], "ingressPath": path_value, "ingressAction": "DRY_RUN"}
    _, networking = k8s_clients()
    ingress = networking.read_namespaced_ingress(item["ingressName"], item["namespace"])
    rules = ingress.spec.rules or []
    rule = next((r for r in rules if not item["ingressHost"] or r.host == item["ingressHost"]), None)
    if rule is None:
        rule = client.V1IngressRule(host=item["ingressHost"] or None, http=client.V1HTTPIngressRuleValue(paths=[]))
        rules.append(rule)
    rule.http.paths = rule.http.paths or []
    if any(p.path == path_value for p in rule.http.paths):
        action = "UNCHANGED"
    else:
        rule.http.paths.append(client.V1HTTPIngressPath(
            path=path_value,
            path_type="ImplementationSpecific",
            backend=client.V1IngressBackend(service=client.V1IngressServiceBackend(
                name=item["serviceName"], port=client.V1ServiceBackendPort(number=item["servicePort"])
            )),
        ))
        ingress.spec.rules = rules
        networking.replace_namespaced_ingress(item["ingressName"], item["namespace"], ingress)
        action = "PATH_ADDED"
    return {"ingressName": item["ingressName"], "ingressPath": path_value, "ingressAction": action}


async def run_workflow(item: dict[str, Any], items: list[dict[str, Any]]) -> dict[str, Any]:
    ensure_steps(item)
    item["status"] = "PROVISIONING"
    item["updatedAt"] = now_iso()
    write_requests(items)

    for step_name in WORKFLOW_STEPS:
        step = get_step(item, step_name)
        if step.get("status") in TERMINAL_STEP_STATUSES:
            continue
        mark_step_running(step)
        item["updatedAt"] = now_iso()
        write_requests(items)
        try:
            if step_name == "CREATE_AZURE_REPO":
                details = await create_or_get_repo(item.get("repoName") or item["serviceName"])
                item["repositoryUrl"] = details["url"]
                final_status = "REUSED" if details.get("action") == "REUSED_EXISTING" else "COMPLETED"
                mark_step_success(step, details, final_status)
            elif step_name == "CREATE_K8S_SERVICE":
                mark_step_success(step, provision_service(item))
            elif step_name == "UPDATE_INGRESS":
                mark_step_success(step, provision_ingress(item))
            item["updatedAt"] = now_iso()
            write_requests(items)
        except Exception as exc:
            mark_step_failed(step, exc)
            item["status"] = "FAILED"
            item["lastError"] = str(exc)
            item["failedStep"] = step_name
            item["updatedAt"] = now_iso()
            write_requests(items)
            raise HTTPException(status_code=500, detail={
                "error": str(exc),
                "failedStep": step_name,
                "request": item,
            }) from exc

    item["status"] = "COMPLETED" if PROVISION_MODE == "live" else "DRY_RUN_COMPLETED"
    item["lastError"] = ""
    item["failedStep"] = None
    item["updatedAt"] = now_iso()
    write_requests(items)
    return item


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "UP", "mode": PROVISION_MODE}


@app.post("/api/login")
def login(body: LoginRequest) -> dict[str, Any]:
    username = body.username.strip()
    if not username or not body.password:
        raise HTTPException(status_code=400, detail="Username and password are required")
    if body.role == "DEVOPS" and body.password != DEVOPS_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid DevOps credentials")
    user = {"username": username, "role": body.role}
    return {"token": create_token(username, body.role), "user": user}


@app.get("/api/me")
def me(user: dict[str, str] = Depends(current_user)) -> dict[str, str]:
    return user


@app.get("/api/requests")
def list_requests(user: dict[str, str] = Depends(current_user)) -> list[dict[str, Any]]:
    items = read_requests()
    for item in items:
        ensure_steps(item)
    return items if user["role"] == "DEVOPS" else [x for x in items if x["requestedBy"] == user["username"]]


@app.post("/api/requests", status_code=status.HTTP_201_CREATED)
def create_request(body: ServiceRequestCreate, user: dict[str, str] = Depends(current_user)) -> dict[str, Any]:
    prepared = prepare_request(body)
    items = read_requests()
    if any(x.get("repoName", x.get("serviceName")) == prepared["repoName"] and x["status"] not in {"REJECTED", "FAILED"} for x in items):
        raise HTTPException(status_code=409, detail="An active request already exists for this repository")
    created = now_iso()
    prepared.update({
        "id": str(uuid4()),
        "status": "PENDING_APPROVAL",
        "requestedBy": user["username"],
        "approvedBy": None,
        "lastEditedBy": None,
        "approvalComment": "",
        "repositoryUrl": "",
        "steps": [],
        "lastError": "",
        "failedStep": None,
        "createdAt": created,
        "updatedAt": created,
    })
    ensure_steps(prepared)
    items.insert(0, prepared)
    write_requests(items)
    return prepared


@app.put("/api/requests/{request_id}")
def update_request(request_id: str, body: ServiceRequestCreate, user: dict[str, str] = Depends(require_devops)) -> dict[str, Any]:
    items = read_requests()
    item = next((x for x in items if x["id"] == request_id), None)
    if not item:
        raise HTTPException(status_code=404, detail="Request not found")
    if item["status"] not in {"PENDING_APPROVAL", "FAILED"}:
        raise HTTPException(status_code=409, detail="Only pending or failed requests can be edited")
    prepared = prepare_request(body)
    preserved = {key: item.get(key) for key in ("id", "status", "requestedBy", "approvedBy", "approvalComment", "repositoryUrl", "steps", "lastError", "failedStep", "createdAt")}
    item.clear()
    item.update(prepared)
    item.update(preserved)
    item["lastEditedBy"] = user["username"]
    item["updatedAt"] = now_iso()
    write_requests(items)
    return item


@app.post("/api/requests/{request_id}/reject")
def reject_request(request_id: str, body: ApprovalRequest, user: dict[str, str] = Depends(require_devops)) -> dict[str, Any]:
    items = read_requests()
    item = next((x for x in items if x["id"] == request_id), None)
    if not item:
        raise HTTPException(status_code=404, detail="Request not found")
    item.update({"status": "REJECTED", "approvedBy": user["username"], "approvalComment": body.comment or "Rejected", "updatedAt": now_iso()})
    write_requests(items)
    return item


@app.post("/api/requests/{request_id}/approve")
async def approve_request(request_id: str, body: ApprovalRequest, user: dict[str, str] = Depends(require_devops)) -> dict[str, Any]:
    items = read_requests()
    item = next((x for x in items if x["id"] == request_id), None)
    if not item:
        raise HTTPException(status_code=404, detail="Request not found")
    if item["status"] not in {"PENDING_APPROVAL", "FAILED"}:
        raise HTTPException(status_code=409, detail="Request cannot be approved in its current status")
    item.update({"approvedBy": user["username"], "approvalComment": body.comment or "Approved", "updatedAt": now_iso()})
    return await run_workflow(item, items)


@app.post("/api/requests/{request_id}/resume")
async def resume_request(request_id: str, body: ResumeRequest, user: dict[str, str] = Depends(require_devops)) -> dict[str, Any]:
    items = read_requests()
    item = next((x for x in items if x["id"] == request_id), None)
    if not item:
        raise HTTPException(status_code=404, detail="Request not found")
    if item["status"] != "FAILED":
        raise HTTPException(status_code=409, detail="Only failed requests can be resumed")
    item["approvalComment"] = body.comment or item.get("approvalComment") or "Resume provisioning"
    item["approvedBy"] = user["username"]
    return await run_workflow(item, items)
