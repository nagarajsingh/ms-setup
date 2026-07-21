# Microservice Setup Portal

Clean React + FastAPI portal for requesting and approving microservice setup.

## Features

- JWT login with Developer and DevOps roles
- Request persistence in a JSON file
- Azure DevOps repository create-or-reuse
- Kubernetes Service create-or-update
- Existing Ingress path update
- In-cluster ServiceAccount authentication
- Separate frontend and backend containers

## Local development

Backend:

```bash
cd backend
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

## Container build

```bash
docker build -t ms-setup-backend:latest backend
docker build -t ms-setup-frontend:latest frontend
```

## Kubernetes

Update image names and secret values under `k8s/`, then apply:

```bash
kubectl apply -f k8s/
```

The backend pod uses `serviceAccountName: az-devops-deployment`. Deploy it in the same namespace as that ServiceAccount, or update the manifest and RBAC accordingly.
