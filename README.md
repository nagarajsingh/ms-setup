# Microservice Setup Portal

A lightweight portal where developers request a new microservice and DevOps approves the request before provisioning begins.

## Current capabilities

- Developer and DevOps login
- Microservice request form
- Namespace, ports, ingress and database details
- DevOps approval or rejection
- Azure DevOps repository creation adapter
- Kubernetes Service creation adapter
- Existing Ingress path update adapter
- Dry-run mode enabled by default
- JSON file persistence for the MVP
- Docker support

## Run locally

```bash
cp .env.example .env
npm install
npm start
```

Open `http://localhost:3000`.

For local testing, choose the DevOps role and use the password configured in `DEVOPS_APPROVER_PASSWORD`. The example value is `devops123`.

## Provisioning modes

### Dry-run

```env
PROVISION_MODE=dry-run
```

Approval generates the intended Azure DevOps repository URL, Kubernetes Service object and Ingress path without changing external systems.

### Live

```env
PROVISION_MODE=live
AZDO_ORG=your-organization
AZDO_PROJECT=your-project
AZDO_PAT=your-pat
KUBECONFIG=/path/to/kubeconfig
```

In live mode, the backend:

1. Creates an Azure DevOps Git repository.
2. Creates a Kubernetes ClusterIP Service.
3. Reads the configured existing Ingress.
4. Adds the service path when it is not already present.
5. Replaces the Ingress with the updated rules.

Use a restricted Azure DevOps PAT and Kubernetes service account. Do not provide cluster-admin access to the portal.

## Docker

```bash
docker build -t ms-setup-portal:latest .
docker run --rm -p 3000:3000 --env-file .env ms-setup-portal:latest
```

## Production hardening still required

- Replace local login with Microsoft Entra ID / OIDC.
- Replace JSON persistence with PostgreSQL.
- Store Azure DevOps and Kubernetes credentials in a secret manager.
- Add audit logs and approval history.
- Prefer generating a pull request to a Kubernetes configuration repository instead of directly modifying production clusters.
- Add database-team approval and approved database automation.
