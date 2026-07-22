from __future__ import annotations

import os
from functools import lru_cache
from typing import Any

import httpx
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

security = HTTPBearer()
TENANT_ID = os.getenv("ENTRA_TENANT_ID", "")
API_CLIENT_ID = os.getenv("ENTRA_API_CLIENT_ID", "")
DEVOPS_GROUP_ID = os.getenv("ENTRA_DEVOPS_GROUP_ID", "")
ADMIN_GROUP_ID = os.getenv("ENTRA_ADMIN_GROUP_ID", "")

@lru_cache(maxsize=1)
def openid_config() -> dict[str, Any]:
    if not TENANT_ID or not API_CLIENT_ID:
        raise RuntimeError("ENTRA_TENANT_ID and ENTRA_API_CLIENT_ID must be configured")
    url = f"https://login.microsoftonline.com/{TENANT_ID}/v2.0/.well-known/openid-configuration"
    return httpx.get(url, timeout=10.0).raise_for_status().json()

@lru_cache(maxsize=1)
def signing_keys() -> dict[str, Any]:
    return httpx.get(openid_config()["jwks_uri"], timeout=10.0).raise_for_status().json()

def _role(groups: list[str]) -> str:
    if ADMIN_GROUP_ID and ADMIN_GROUP_ID in groups:
        return "ADMIN"
    if DEVOPS_GROUP_ID and DEVOPS_GROUP_ID in groups:
        return "DEVOPS"
    return "DEVELOPER"

def current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict[str, Any]:
    token = credentials.credentials
    try:
        header = jwt.get_unverified_header(token)
        key = next((item for item in signing_keys().get("keys", []) if item.get("kid") == header.get("kid")), None)
        if not key:
            signing_keys.cache_clear()
            key = next((item for item in signing_keys().get("keys", []) if item.get("kid") == header.get("kid")), None)
        if not key:
            raise HTTPException(status_code=401, detail="Unable to find signing key")
        payload = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=API_CLIENT_ID,
            issuer=f"https://login.microsoftonline.com/{TENANT_ID}/v2.0",
            options={"verify_at_hash": False},
        )
        groups = payload.get("groups", [])
        return {
            "id": payload.get("oid") or payload.get("sub"),
            "name": payload.get("name", ""),
            "username": payload.get("preferred_username") or payload.get("email") or payload.get("upn") or payload.get("sub"),
            "tenantId": payload.get("tid"),
            "role": _role(groups),
            "groups": groups,
        }
    except HTTPException:
        raise
    except (JWTError, KeyError, StopIteration) as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired Microsoft access token") from exc

def require_devops(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    if user["role"] not in {"DEVOPS", "ADMIN"}:
        raise HTTPException(status_code=403, detail="DevOps permission required")
    return user
