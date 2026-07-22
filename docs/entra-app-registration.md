# Microsoft Entra ID setup

The portal uses a single-tenant Microsoft Entra ID application and accepts only identities from the configured Mashreq tenant.

## 1. Register the application

1. Open Microsoft Entra admin center.
2. Go to **Identity > Applications > App registrations > New registration**.
3. Name it `MS Service Setup Portal`.
4. Select **Accounts in this organizational directory only**.
5. Add a **Single-page application (SPA)** redirect URI:
   - Local: `http://localhost:5173`
   - Kubernetes: the exact portal URL, including any path prefix if used.

## 2. Expose the backend API

1. Open **Expose an API**.
2. Set the Application ID URI to `api://<application-client-id>`.
3. Add a delegated scope named `access_as_user`.
4. Allow admins and users to consent according to Mashreq policy.

The frontend requests this scope:

`api://<application-client-id>/access_as_user`

## 3. Token claims and groups

Create or identify Entra groups for DevOps approvers and administrators. Copy their group object IDs into:

- `ENTRA_DEVOPS_GROUP_ID`
- `ENTRA_ADMIN_GROUP_ID`

Add the `groups` optional claim to access tokens. Users who do not belong to either privileged group are assigned the `DEVELOPER` role.

## 4. Frontend configuration

Copy `frontend/.env.example` to `frontend/.env` for local development and set:

- `VITE_ENTRA_TENANT_ID`
- `VITE_ENTRA_CLIENT_ID`
- `VITE_ENTRA_API_CLIENT_ID`
- `VITE_ENTRA_REDIRECT_URI`

Do not create or place a client secret in the React application.

## 5. Backend configuration

Update `k8s/configmap.yaml` with:

- `ENTRA_TENANT_ID`
- `ENTRA_API_CLIENT_ID`
- `ENTRA_DEVOPS_GROUP_ID`
- `ENTRA_ADMIN_GROUP_ID`
- `CORS_ORIGINS`

The FastAPI backend validates Microsoft access tokens using the tenant OpenID configuration and signing keys. No client secret is required for token validation.

## 6. Required API permissions

For sign-in and the protected portal API, configure delegated permission for the exposed `access_as_user` scope. Microsoft Graph `User.Read` is optional and is not currently required by the portal code.

## 7. Validation

After deployment:

```bash
curl -s https://<portal-host>/api/health
```

The response should include:

```json
{"status":"UP","mode":"live","authentication":"ENTRA_ID"}
```

Calling `/api/me` without a bearer token should return HTTP 401. After Microsoft login, `/api/me` should return the user's name, username, tenant ID and mapped portal role.
