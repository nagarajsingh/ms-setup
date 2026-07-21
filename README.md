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

## Run using Docker

No local Node.js installation is required. Only Docker is needed.

Clone and switch to the branch:

```bash
git clone https://github.com/nagarajsingh/ms-setup.git
cd ms-setup
git checkout feature/initial-test
```

Build the image:

```bash
docker build -t ms-setup-portal:latest .
```

Run in dry-run mode:

```bash
docker run -d \
  --name ms-setup-portal \
  -p 3000:3000 \
  -e JWT_SECRET=change-this-secret \
  -e DEVOPS_APPROVER_PASSWORD=devops123 \
  -e PROVISION_MODE=dry-run \
  -v ms-setup-data:/app/data \
  ms-setup-portal:latest
```

Open:

```text
http://localhost:3000
```

Check container status and logs:

```bash
docker ps
docker logs -f ms-setup-portal
```

Stop and remove the container:

```bash
docker stop ms-setup-portal
docker rm ms-setup-portal
```

The named Docker volume `ms-setup-data` keeps submitted requests after the container is recreated.

## Test login

For a developer login, enter any username and password and select the Developer role.

For DevOps approval login:

```text
Role: DevOps
Password: devops123
```

Change `DEVOPS_APPROVER_PASSWORD` before using the portal outside local testing.

## Provisioning modes

### Dry-run

```text
PROVISION_MODE=dry-run
```

Approval generates the intended Azure DevOps repository URL, Kubernetes Service object and Ingress path without changing external systems.

### Live mode

Create an environment file named `.env`:

```env
JWT_SECRET=replace-with-a-long-random-value
DEVOPS_APPROVER_PASSWORD=replace-with-a-secure-password
PROVISION_MODE=live
AZDO_ORG=your-organization
AZDO_PROJECT=your-project
AZDO_PAT=your-personal-access-token
```

Run the container with the environment file:

```bash
docker run -d \
  --name ms-setup-portal \
  -p 3000:3000 \
  --env-file .env \
  -v ms-setup-data:/app/data \
  -v "$HOME/.kube/config:/app/.kube/config:ro" \
  -e KUBECONFIG=/app/.kube/config \
  ms-setup-portal:latest
```

In live mode, the backend:

1. Creates an Azure DevOps Git repository.
2. Creates a Kubernetes ClusterIP Service.
3. Reads the configured existing Ingress.
4. Adds the service path when it is not already present.
5. Replaces the Ingress with the updated rules.

Use a restricted Azure DevOps PAT and Kubernetes service account. Do not provide cluster-admin access to the portal.

## Production hardening still required

- Replace local login with Microsoft Entra ID / OIDC.
- Replace JSON persistence with PostgreSQL.
- Store Azure DevOps and Kubernetes credentials in a secret manager.
- Add audit logs and approval history.
- Prefer generating a pull request to a Kubernetes configuration repository instead of directly modifying production clusters.
- Add database-team approval and approved database automation.
