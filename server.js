require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const k8s = require('@kubernetes/client-node');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'requests.json');
const PROVISION_MODE = (process.env.PROVISION_MODE || 'dry-run').toLowerCase();

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function ensureStore() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');
}
function readRequests() {
  ensureStore();
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}
function writeRequests(items) {
  ensureStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify(items, null, 2));
}
function safeName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}
function signUser(user) {
  return jwt.sign(user, JWT_SECRET, { expiresIn: '8h' });
}
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Authentication required' }); }
}
function requireRole(...roles) {
  return (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Insufficient permission' });
}
function errorStatus(error) {
  return error?.response?.status || error?.statusCode || error?.status || error?.body?.code;
}

app.post('/api/login', (req, res) => {
  const { username, password, role } = req.body;
  const approverPassword = process.env.DEVOPS_APPROVER_PASSWORD || 'devops123';
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  const selectedRole = role === 'DEVOPS' ? 'DEVOPS' : 'DEVELOPER';
  if (selectedRole === 'DEVOPS' && password !== approverPassword) return res.status(401).json({ error: 'Invalid DevOps credentials' });
  const user = { username: String(username).trim(), role: selectedRole };
  res.json({ token: signUser(user), user });
});

app.get('/api/me', auth, (req, res) => res.json(req.user));

app.get('/api/requests', auth, (req, res) => {
  const all = readRequests();
  res.json(req.user.role === 'DEVOPS' ? all : all.filter(x => x.requestedBy === req.user.username));
});

app.post('/api/requests', auth, requireRole('DEVELOPER', 'DEVOPS'), (req, res) => {
  const serviceName = safeName(req.body.serviceName);
  const namespace = safeName(req.body.namespace);
  if (!serviceName || !namespace) return res.status(400).json({ error: 'Valid service name and namespace are required' });
  const all = readRequests();
  if (all.some(x => x.serviceName === serviceName && !['REJECTED', 'FAILED'].includes(x.status))) {
    return res.status(409).json({ error: 'An active request already exists for this service' });
  }
  const now = new Date().toISOString();
  const item = {
    id: uuidv4(), serviceName, namespace,
    description: String(req.body.description || '').trim(),
    containerPort: Number(req.body.containerPort || 8080),
    servicePort: Number(req.body.servicePort || 8080),
    ingressName: safeName(req.body.ingressName || `${namespace}-ingress`),
    ingressHost: String(req.body.ingressHost || '').trim(),
    ingressPath: String(req.body.ingressPath || `/${serviceName}`).trim(),
    databaseRequired: Boolean(req.body.databaseRequired),
    databaseType: String(req.body.databaseType || '').trim(),
    databaseName: String(req.body.databaseName || '').trim(),
    schemaName: String(req.body.schemaName || '').trim(),
    databaseUsername: String(req.body.databaseUsername || '').trim(),
    status: 'PENDING_APPROVAL', requestedBy: req.user.username,
    approvedBy: null, approvalComment: '', repositoryUrl: '',
    steps: [], createdAt: now, updatedAt: now
  };
  all.unshift(item); writeRequests(all); res.status(201).json(item);
});

app.post('/api/requests/:id/reject', auth, requireRole('DEVOPS'), (req, res) => {
  const all = readRequests(); const item = all.find(x => x.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Request not found' });
  item.status = 'REJECTED'; item.approvedBy = req.user.username;
  item.approvalComment = String(req.body.comment || 'Rejected by DevOps'); item.updatedAt = new Date().toISOString();
  writeRequests(all); res.json(item);
});

async function createAzureRepo(item) {
  if (PROVISION_MODE !== 'live') return { url: `https://dev.azure.com/example/project/_git/${item.serviceName}`, dryRun: true };
  const org = process.env.AZDO_ORG; const project = process.env.AZDO_PROJECT; const pat = process.env.AZDO_PAT;
  if (!org || !project || !pat) throw new Error('AZDO_ORG, AZDO_PROJECT and AZDO_PAT are required');
  const baseUrl = `https://dev.azure.com/${org}/${project}/_apis/git/repositories`;
  const config = { auth: { username: 'portal', password: pat }, headers: { 'Content-Type': 'application/json' } };
  try {
    const response = await axios.post(`${baseUrl}?api-version=7.1`, { name: item.serviceName }, config);
    return { url: response.data.webUrl || response.data.remoteUrl, id: response.data.id, action: 'CREATED' };
  } catch (error) {
    if (errorStatus(error) !== 409) throw error;
    const existing = await axios.get(`${baseUrl}/${encodeURIComponent(item.serviceName)}?api-version=7.1`, config);
    return {
      url: existing.data.webUrl || existing.data.remoteUrl || `https://dev.azure.com/${org}/${project}/_git/${item.serviceName}`,
      id: existing.data.id,
      action: 'REUSED_EXISTING'
    };
  }
}

async function createKubernetesResources(item) {
  const service = {
    apiVersion: 'v1', kind: 'Service', metadata: { name: item.serviceName, namespace: item.namespace, labels: { app: item.serviceName } },
    spec: { type: 'ClusterIP', selector: { app: item.serviceName }, ports: [{ name: 'http', protocol: 'TCP', port: item.servicePort, targetPort: item.containerPort }] }
  };
  const ingressPath = { path: `${item.ingressPath}(/|$)(.*)`, pathType: 'ImplementationSpecific', backend: { service: { name: item.serviceName, port: { number: item.servicePort } } } };
  if (PROVISION_MODE !== 'live') return { service, ingressPath, dryRun: true };

  const kc = new k8s.KubeConfig();
  process.env.KUBECONFIG ? kc.loadFromFile(process.env.KUBECONFIG) : kc.loadFromDefault();
  const core = kc.makeApiClient(k8s.CoreV1Api);
  const networking = kc.makeApiClient(k8s.NetworkingV1Api);

  let serviceAction = 'CREATED';
  try {
    await core.createNamespacedService({ namespace: item.namespace, body: service });
  } catch (error) {
    if (errorStatus(error) !== 409) throw error;
    const existingService = await core.readNamespacedService({ name: item.serviceName, namespace: item.namespace });
    const current = existingService.body || existingService;
    service.metadata.resourceVersion = current.metadata.resourceVersion;
    service.spec.clusterIP = current.spec.clusterIP;
    service.spec.clusterIPs = current.spec.clusterIPs;
    service.spec.ipFamilies = current.spec.ipFamilies;
    service.spec.ipFamilyPolicy = current.spec.ipFamilyPolicy;
    service.spec.internalTrafficPolicy = current.spec.internalTrafficPolicy;
    await core.replaceNamespacedService({ name: item.serviceName, namespace: item.namespace, body: service });
    serviceAction = 'UPDATED_EXISTING';
  }

  const ingressResp = await networking.readNamespacedIngress({ name: item.ingressName, namespace: item.namespace });
  const ingress = ingressResp.body || ingressResp;
  const rules = ingress.spec.rules || [];
  let rule = rules.find(r => !item.ingressHost || r.host === item.ingressHost);
  if (!rule) { rule = { host: item.ingressHost || undefined, http: { paths: [] } }; rules.push(rule); }
  rule.http = rule.http || { paths: [] };
  let ingressAction = 'UNCHANGED';
  if (!rule.http.paths.some(p => p.path === ingressPath.path)) {
    rule.http.paths.push(ingressPath);
    ingress.spec.rules = rules;
    await networking.replaceNamespacedIngress({ name: item.ingressName, namespace: item.namespace, body: ingress });
    ingressAction = 'PATH_ADDED';
  }

  return {
    serviceName: item.serviceName,
    serviceAction,
    ingressName: item.ingressName,
    ingressPath: item.ingressPath,
    ingressAction
  };
}

app.post('/api/requests/:id/approve', auth, requireRole('DEVOPS'), async (req, res) => {
  const all = readRequests(); const item = all.find(x => x.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Request not found' });
  if (item.status !== 'PENDING_APPROVAL' && item.status !== 'FAILED') return res.status(409).json({ error: 'Request cannot be approved in its current status' });
  item.status = 'PROVISIONING'; item.approvedBy = req.user.username; item.approvalComment = String(req.body.comment || 'Approved');
  item.steps = []; item.updatedAt = new Date().toISOString(); writeRequests(all);
  try {
    const repo = await createAzureRepo(item);
    item.repositoryUrl = repo.url; item.steps.push({ name: 'CREATE_AZURE_REPO', status: 'COMPLETED', details: repo }); writeRequests(all);
    const cluster = await createKubernetesResources(item);
    item.steps.push({ name: 'CREATE_K8S_SERVICE_AND_UPDATE_INGRESS', status: 'COMPLETED', details: cluster });
    item.status = PROVISION_MODE === 'live' ? 'COMPLETED' : 'DRY_RUN_COMPLETED'; item.updatedAt = new Date().toISOString(); writeRequests(all); res.json(item);
  } catch (error) {
    const details = error?.response?.data || error?.body || undefined;
    item.status = 'FAILED'; item.steps.push({ name: 'PROVISIONING', status: 'FAILED', error: error.message, details }); item.updatedAt = new Date().toISOString(); writeRequests(all);
    res.status(500).json({ error: error.message, details, request: item });
  }
});

app.get('/api/health', (_req, res) => res.json({ status: 'UP', mode: PROVISION_MODE }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

ensureStore();
app.listen(PORT, () => console.log(`Microservice Setup Portal listening on ${PORT} (${PROVISION_MODE})`));