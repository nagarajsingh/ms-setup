import React, {useEffect, useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, ChevronUp, Edit3, GitBranch, Globe2, Headphones, Keyboard, LayoutDashboard, LogOut, Plus, RotateCcw, Save, Server, X, XCircle} from 'lucide-react';
import './styles.css';

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? '/api' : '/ms-setup-backend/api');

const api = async (path, options={}) => {
  const token = localStorage.getItem('token');
  const response = await fetch(`${API_BASE}${path}`,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{}) ,...(options.headers||{})}});
  const data = await response.json().catch(()=>({}));
  if(!response.ok) {
    const error = new Error(typeof data.detail==='string'?data.detail:(data.detail?.error||data.error||'Request failed'));
    error.payload = data.detail || data;
    throw error;
  }
  return data;
};

const emptyForm = {
  repoName:'', serviceName:'', folders:'N/A', storage:'N/A', cpu:'', memory:'', dbDetails:'Yes (Dev, SIT, UAT, PPR, PROD)',
  acls:'N/A', certificates:'N/A', architectureDiagram:'', databaseUser:'Yes (Dev, SIT, UAT, PPR, PROD)',
  environments:'h2h-dev, ipp-sit, ipp-uat, h2h-train, ipp-prod', ingressPath:'/api/', securityStage:true,
  scheduledJob:false, prodPodCount:2, comments:{}, namespace:'h2h-dev', description:'', containerPort:8080,
  servicePort:8080, ingressName:'neocorp-mobile-ingress', ingressHost:'neocorpmob.dev.mashreqdev.com',
  databaseRequired:true, databaseType:'Oracle', databaseName:'', schemaName:'', databaseUsername:''
};

const templateRows = [
  ['repoName','Repo Name'],['folders','Folders'],['storage','Storage'],['cpu','CPU'],['memory','Memory'],['dbDetails','DB Details'],
  ['acls','ACLs'],['certificates','Certificates'],['architectureDiagram','Architecture Diagram'],['databaseUser','Database/User'],
  ['environments','Environments'],['ingressPath','Ingress (App Endpoint)'],['securityStage','Security Stage'],
  ['scheduledJob','Scheduled Job'],['prodPodCount','No. of Pods in Prod']
];

const stepLabels = {CREATE_AZURE_REPO:'Azure DevOps Repository',CREATE_K8S_SERVICE:'Kubernetes Service',UPDATE_INGRESS:'Ingress Update'};
const categoryConfig = {
  pending:{title:'Pending MS Creation Requests',description:'Requests waiting for DevOps review and approval',statuses:['PENDING_APPROVAL'],tone:'pending'},
  approved:{title:'Approved Requests',description:'Successfully provisioned microservice requests',statuses:['COMPLETED','DRY_RUN_COMPLETED'],tone:'approved'},
  partial:{title:'Partially Completed',description:'Provisioning requires attention or must be resumed',statuses:['FAILED','PROVISIONING'],tone:'partial'}
};

const displayValue = (item,key) => {
  const value = item?.[key];
  if(key==='environments') return Array.isArray(value)?value.join(', '):(value||'—');
  if(typeof value==='boolean') return value?'Yes':'No';
  return value===0?'0':(value||'—');
};

function Brand({compact=false}){
  return <div className={`mashreq-brand ${compact?'compact':''}`}>
    <div className="brand-line"><span className="mashreq-word">mashreq</span><span className="brand-mark" aria-hidden="true">✦</span><span className="arabic-word">المشرق</span></div>
    <div className="neo-line"><span>NEO</span><strong>CORP</strong></div>
  </div>;
}

function RequestForm({value,setValue,onSubmit,busy,submitLabel='Submit request',onCancel}){
  const set = (key,val)=>setValue({...value,[key]:val});
  const setComment = (key,val)=>setValue({...value,comments:{...(value.comments||{}),[key]:val}});
  return <form className="onboarding-form" onSubmit={onSubmit}>
    <div className="section-title"><span>Microservices Onboarding Template</span><small>Developer-provided information</small></div>
    <div className="template-head"><span>Information</span><span>Description</span><span>Comments</span></div>
    {templateRows.map(([key,label],index)=><div className="template-row" key={key}>
      <div className="field-name"><b>{index+1}</b><span>{label}</span></div>
      <div>{['securityStage','scheduledJob'].includes(key)?<select value={value[key]?'yes':'no'} onChange={e=>set(key,e.target.value==='yes')}><option value="yes">Yes</option><option value="no">No</option></select>:
        key==='prodPodCount'?<input type="number" min="0" max="100" value={value[key]} onChange={e=>set(key,+e.target.value)}/>:
        key==='architectureDiagram'?<input value={value[key]} onChange={e=>set(key,e.target.value)} placeholder="File share path or document URL"/>:
        key==='environments'?<textarea value={Array.isArray(value[key])?value[key].join(', '):value[key]} onChange={e=>set(key,e.target.value)} placeholder="Comma-separated namespaces"/>:
        <input value={value[key]} onChange={e=>set(key,e.target.value)} required={['repoName','ingressPath'].includes(key)} placeholder={key==='repoName'?'trade-enquiry-api':''}/>}</div>
      <textarea className="comment-input" value={value.comments?.[key]||''} onChange={e=>setComment(key,e.target.value)} placeholder="Optional comments"/>
    </div>)}
    <details className="technical" open><summary>Deployment configuration</summary><div className="grid technical-grid">
      <label>Service name<input value={value.serviceName} onChange={e=>set('serviceName',e.target.value)} placeholder="Defaults to repo name"/></label>
      <label>Primary namespace<input value={value.namespace} onChange={e=>set('namespace',e.target.value)} required/></label>
      <label>Ingress name<input value={value.ingressName} onChange={e=>set('ingressName',e.target.value)} required/></label>
      <label>Ingress host<input value={value.ingressHost} onChange={e=>set('ingressHost',e.target.value)}/></label>
      <label>Container port<input type="number" value={value.containerPort} onChange={e=>set('containerPort',+e.target.value)}/></label>
      <label>Service port<input type="number" value={value.servicePort} onChange={e=>set('servicePort',+e.target.value)}/></label>
      <label>Database type<input value={value.databaseType} onChange={e=>set('databaseType',e.target.value)}/></label>
      <label>Database name<input value={value.databaseName} onChange={e=>set('databaseName',e.target.value)}/></label>
      <label>Schema name<input value={value.schemaName} onChange={e=>set('schemaName',e.target.value)}/></label>
      <label>Database username<input value={value.databaseUsername} onChange={e=>set('databaseUsername',e.target.value)}/></label>
      <label className="wide">Description<textarea value={value.description} onChange={e=>set('description',e.target.value)}/></label>
    </div></details>
    <div className="form-actions">{onCancel&&<button type="button" className="ghost" onClick={onCancel}><X size={16}/> Cancel</button>}<button disabled={busy}><Save size={16}/>{submitLabel}</button></div>
  </form>;
}

function Preview({item}){
  return <div className="preview-table"><div className="preview-head"><span>Sl.No</span><span>Information</span><span>Description</span><span>Comments</span></div>
    {templateRows.map(([key,label],index)=><div className="preview-row" key={key}><span>{index+1}</span><strong>{label}</strong><span>{displayValue(item,key)}</span><span>{item.comments?.[key]||'—'}</span></div>)}
    <div className="deployment-preview"><b>Deployment:</b> {item.namespace||'—'} · {item.ingressHost||'—'} · {item.ingressName||'—'} · ports {item.servicePort||'—'}/{item.containerPort||'—'}</div>
  </div>;
}

function WorkflowStatus({item}){
  const steps=item.steps||[];
  if(!steps.length)return null;
  return <div className="workflow-panel"><h4>Provisioning workflow</h4>{steps.map(step=><div className={`workflow-step ${step.status.toLowerCase()}`} key={step.name}>
    <div className="step-icon">{['COMPLETED','REUSED','SKIPPED'].includes(step.status)?<CheckCircle2 size={18}/>:step.status==='FAILED'?<XCircle size={18}/>:<RotateCcw size={18}/>}</div>
    <div className="step-copy"><strong>{stepLabels[step.name]||step.name}</strong><span>{step.status.replaceAll('_',' ')}</span>{step.error&&<small>{step.error}</small>}{step.status==='REUSED'&&<small>Repository already existed and was reused.</small>}</div>
  </div>)}</div>;
}

function ResultModal({result,onClose,onResume,busy}){
  if(!result)return null;
  const request=result.request||result;
  const repoStep=request.steps?.find(s=>s.name==='CREATE_AZURE_REPO');
  const isFailure=Boolean(result.error||request.status==='FAILED');
  return <div className="modal-backdrop"><section className="card result-modal"><div className="result-icon">{isFailure?<AlertTriangle size={34}/>:<CheckCircle2 size={34}/>}</div>
    <h2>{isFailure?'Provisioning stopped':'Provisioning completed'}</h2>
    {repoStep?.status==='REUSED'&&<div className="notice">Repo is already created. Existing repository was reused.</div>}
    {isFailure&&<div className="error"><strong>{stepLabels[result.failedStep||request.failedStep]||'Provisioning'} failed.</strong><br/>{result.error||request.lastError}</div>}
    <WorkflowStatus item={request}/><div className="form-actions"><button className="ghost" onClick={onClose}>Close</button>{isFailure&&<button onClick={()=>onResume(request.id)} disabled={busy}><RotateCcw size={16}/> Resume provisioning</button>}</div>
  </section></div>;
}

function RequestCard({item,userRole,busy,expanded,setExpanded,beginEdit,provision,reject}){
  return <article className="request-card"><div className="request-summary"><div><h3>{item.repoName||item.serviceName}</h3><p>{item.requestedBy} · {item.namespace} · {item.ingressPath}</p><span className={`status ${item.status.toLowerCase()}`}>{item.status.replaceAll('_',' ')}</span></div>
    <div className="actions">{item.repositoryUrl&&<a href={item.repositoryUrl} target="_blank" rel="noreferrer">Repository</a>}<button className="ghost" onClick={()=>setExpanded(expanded===item.id?null:item.id)}>{expanded===item.id?<ChevronUp size={16}/>:<ChevronDown size={16}/>} Details</button>
      {userRole==='DEVOPS'&&item.status==='PENDING_APPROVAL'&&<><button className="secondary" onClick={()=>beginEdit(item)}><Edit3 size={16}/> Edit</button><button onClick={()=>provision(item.id,'approve')} disabled={busy}><CheckCircle2 size={16}/> Approve</button><button className="danger" onClick={()=>reject(item.id)} disabled={busy}><XCircle size={16}/> Reject</button></>}
      {userRole==='DEVOPS'&&item.status==='FAILED'&&<><button className="secondary" onClick={()=>beginEdit(item)}><Edit3 size={16}/> Edit</button><button onClick={()=>provision(item.id,'resume')} disabled={busy}><RotateCcw size={16}/> Resume</button></>}
    </div></div>{expanded===item.id&&<><Preview item={item}/><WorkflowStatus item={item}/></>}</article>;
}

function DevOpsDashboard({items,onOpen}){
  return <section className="devops-dashboard"><div className="dashboard-heading"><div><span className="eyebrow">DEVOPS OPERATIONS</span><h2><LayoutDashboard/> Microservice Provisioning Dashboard</h2><p>Review approval queues and provisioning progress.</p></div></div>
    <div className="dashboard-grid">{Object.entries(categoryConfig).map(([key,config])=>{const count=items.filter(x=>config.statuses.includes(x.status)).length;return <button key={key} className={`dashboard-card ${config.tone}`} onClick={()=>onOpen(key)}>
      <div className="dashboard-card-top"><span>{config.title}</span><strong>{count}</strong></div><p>{config.description}</p><span className="open-label">View requests →</span>
    </button>})}</div>
  </section>;
}

function DevOpsCategory({category,items,...actions}){
  const config=categoryConfig[category];
  const filtered=items.filter(x=>config.statuses.includes(x.status));
  return <section className="card requests category-page"><button className="back-button" onClick={actions.onBack}><ArrowLeft size={17}/> Back to Dashboard</button>
    <div className="requests-title"><div><span className="eyebrow">REQUEST QUEUE</span><h2><GitBranch/> {config.title}</h2><p className="muted">{config.description}</p></div><span className="count">{filtered.length}</span></div>
    {filtered.length===0?<div className="empty-state"><CheckCircle2 size={34}/><h3>No requests found</h3><p>This queue is currently empty.</p></div>:filtered.map(item=><RequestCard key={item.id} item={item} {...actions}/>)}</section>;
}

function App(){
  const [user,setUser]=useState(JSON.parse(localStorage.getItem('user')||'null'));
  const [items,setItems]=useState([]); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  const [login,setLogin]=useState({username:'',password:'',role:'DEVELOPER'});
  const [form,setForm]=useState({...emptyForm,comments:{}});
  const [expanded,setExpanded]=useState(null); const [editing,setEditing]=useState(null); const [editForm,setEditForm]=useState(null);
  const [result,setResult]=useState(null); const [devopsView,setDevopsView]=useState('dashboard');
  const load=()=>api('/requests').then(setItems).catch(e=>setError(e.message));
  useEffect(()=>{if(user) load();},[user]);
  const signIn=async e=>{e.preventDefault();setError('');try{const r=await api('/login',{method:'POST',body:JSON.stringify(login)});localStorage.setItem('token',r.token);localStorage.setItem('user',JSON.stringify(r.user));setUser(r.user);setDevopsView('dashboard');}catch(e){setError(e.message)}};
  const logout=()=>{localStorage.clear();setUser(null);setItems([]);setDevopsView('dashboard')};
  const payload = data=>({...data,environments:Array.isArray(data.environments)?data.environments:data.environments.split(',').map(x=>x.trim()).filter(Boolean),serviceName:data.serviceName||data.repoName,databaseRequired:Boolean(data.dbDetails&&data.dbDetails.toLowerCase()!=='na')});
  const submit=async e=>{e.preventDefault();setBusy(true);setError('');try{const body=payload(form);body.ingressPath=body.ingressPath.endsWith('/')?`${body.ingressPath}${body.repoName}`:body.ingressPath;await api('/requests',{method:'POST',body:JSON.stringify(body)});setForm({...emptyForm,comments:{}});await load();}catch(e){setError(e.message)}finally{setBusy(false)}};
  const saveEdit=async e=>{e.preventDefault();setBusy(true);setError('');try{await api(`/requests/${editing}`,{method:'PUT',body:JSON.stringify(payload(editForm))});setEditing(null);setEditForm(null);await load();}catch(e){setError(e.message)}finally{setBusy(false)}};
  const beginEdit=item=>{setEditing(item.id);setEditForm({...emptyForm,...item,environments:Array.isArray(item.environments)?item.environments.join(', '):(item.environments||''),comments:item.comments||{}})};
  const provision=async(id,kind)=>{setBusy(true);setError('');try{const response=await api(`/requests/${id}/${kind}`,{method:'POST',body:JSON.stringify({comment:kind==='approve'?'Approved by DevOps':'Resume provisioning'})});setResult(response);await load();}catch(e){setResult(e.payload||{error:e.message});await load();}finally{setBusy(false)}};
  const reject=async id=>{setBusy(true);setError('');try{await api(`/requests/${id}/reject`,{method:'POST',body:JSON.stringify({comment:'Rejected by DevOps'})});await load();}catch(e){setError(e.message)}finally{setBusy(false)}};
  const requestCount=useMemo(()=>items.length,[items]);

  if(!user)return <main className="login-shell"><div className="login-topbar"><span><Globe2 size={18}/> English <ChevronDown size={15}/></span><span><Headphones size={19}/> Customer Care</span></div><div className="wave wave-one"/><div className="wave wave-two"/><div className="skyline" aria-hidden="true"/>
    <section className="login-panel"><Brand/><div className="login-copy"><h1>NeoCorp MS Setup Portal</h1><p>Automated Microservice Onboarding &amp; Infrastructure Provisioning</p></div>{error&&<div className="error">{error}</div>}
      <form onSubmit={signIn}><label>User ID<div className="input-with-icon"><input value={login.username} onChange={e=>setLogin({...login,username:e.target.value})} required/><Keyboard size={25}/></div></label><label>Password<input type="password" value={login.password} onChange={e=>setLogin({...login,password:e.target.value})} required/></label><label>Role<select value={login.role} onChange={e=>setLogin({...login,role:e.target.value})}><option>DEVELOPER</option><option>DEVOPS</option></select></label><button className="continue-button" disabled={busy}>{busy?'Signing in…':'Continue'}</button></form>
      <div className="login-footer"><strong>Microservice Onboarding / Self Service</strong><span>Azure DevOps, Kubernetes and Database Provisioning</span></div></section></main>;

  const cardActions={userRole:user.role,busy,expanded,setExpanded,beginEdit,provision,reject};
  return <><header><Brand compact/><div className="portal-title"><Server/><div><h1>NeoCorp MS Setup Portal</h1><p>Automated Microservice Onboarding &amp; Infrastructure Provisioning</p></div></div><div className="user"><span>{user.username} · {user.role}</span><button className="ghost" onClick={logout}><LogOut size={17}/> Logout</button></div></header>
    <main className="page">{error&&<div className="error">{error}</div>}
      {user.role==='DEVOPS' ? (devopsView==='dashboard'?<DevOpsDashboard items={items} onOpen={view=>{setExpanded(null);setDevopsView(view)}}/>:<DevOpsCategory category={devopsView} items={items} {...cardActions} onBack={()=>{setExpanded(null);setDevopsView('dashboard')}}/>) : <>
        <section className="card onboarding-card"><h2><Plus/> New onboarding request</h2><RequestForm value={form} setValue={setForm} onSubmit={submit} busy={busy}/></section>
        <section className="card requests"><div className="requests-title"><h2><GitBranch/> My requests</h2><span className="count">{requestCount}</span></div>{items.length===0?<p className="muted">No requests found.</p>:items.map(item=><RequestCard key={item.id} item={item} {...cardActions}/>)}</section>
      </>}
    </main>
    {editing&&<div className="modal-backdrop"><section className="card modal"><div className="modal-title"><div><h2>Edit onboarding request</h2><p className="muted">Review and correct details before approval.</p></div><button className="icon ghost" onClick={()=>setEditing(null)}><X/></button></div><RequestForm value={editForm} setValue={setEditForm} onSubmit={saveEdit} busy={busy} submitLabel="Save changes" onCancel={()=>setEditing(null)}/></section></div>}
    <ResultModal result={result} onClose={()=>setResult(null)} onResume={id=>provision(id,'resume')} busy={busy}/>
  </>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);