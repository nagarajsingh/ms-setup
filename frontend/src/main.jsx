import React, {useEffect, useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CheckCircle2, ChevronDown, ChevronUp, Edit3, GitBranch, LogOut, Plus, Save, Server, ShieldCheck, X, XCircle} from 'lucide-react';
import './styles.css';

const api = async (path, options={}) => {
  const token = localStorage.getItem('token');
  const response = await fetch(path,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{}) ,...(options.headers||{})}});
  const data = await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(typeof data.detail==='string'?data.detail:(data.detail?.error||data.error||'Request failed'));
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

const displayValue = (item,key) => {
  const value = item?.[key];
  if(key==='environments') return Array.isArray(value)?value.join(', '):(value||'—');
  if(typeof value==='boolean') return value?'Yes':'No';
  return value===0?'0':(value||'—');
};

function RequestForm({value,setValue,onSubmit,busy,submitLabel='Submit request',onCancel}){
  const set = (key,val)=>setValue({...value,[key]:val});
  const setComment = (key,val)=>setValue({...value,comments:{...(value.comments||{}),[key]:val}});
  return <form className="onboarding-form" onSubmit={onSubmit}>
    <div className="section-title"><span>Microservices Onboarding Template</span><small>Developer-provided information</small></div>
    <div className="template-head"><span>Information</span><span>Description</span><span>Comments</span></div>
    {templateRows.map(([key,label],index)=><div className="template-row" key={key}>
      <div className="field-name"><b>{index+1}</b><span>{label}</span></div>
      <div>
        {['securityStage','scheduledJob'].includes(key)?<select value={value[key]?'yes':'no'} onChange={e=>set(key,e.target.value==='yes')}><option value="yes">Yes</option><option value="no">No</option></select>:
        key==='prodPodCount'?<input type="number" min="0" max="100" value={value[key]} onChange={e=>set(key,+e.target.value)}/>:
        key==='architectureDiagram'?<input value={value[key]} onChange={e=>set(key,e.target.value)} placeholder="File share path or document URL"/>:
        key==='environments'?<textarea value={Array.isArray(value[key])?value[key].join(', '):value[key]} onChange={e=>set(key,e.target.value)} placeholder="Comma-separated namespaces"/>:
        <input value={value[key]} onChange={e=>set(key,e.target.value)} required={['repoName','ingressPath'].includes(key)} placeholder={key==='repoName'?'trade-enquiry-api':''}/>} 
      </div>
      <textarea className="comment-input" value={value.comments?.[key]||''} onChange={e=>setComment(key,e.target.value)} placeholder="Optional comments"/>
    </div>)}

    <details className="technical" open>
      <summary>Deployment configuration</summary>
      <div className="grid technical-grid">
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
      </div>
    </details>
    <div className="form-actions">{onCancel&&<button type="button" className="ghost" onClick={onCancel}><X size={16}/> Cancel</button>}<button disabled={busy}><Save size={16}/>{submitLabel}</button></div>
  </form>;
}

function Preview({item}){
  return <div className="preview-table">
    <div className="preview-head"><span>Sl.No</span><span>Information</span><span>Description</span><span>Comments</span></div>
    {templateRows.map(([key,label],index)=><div className="preview-row" key={key}><span>{index+1}</span><strong>{label}</strong><span>{displayValue(item,key)}</span><span>{item.comments?.[key]||'—'}</span></div>)}
    <div className="deployment-preview"><b>Deployment:</b> {item.namespace||'—'} · {item.ingressHost||'—'} · {item.ingressName||'—'} · ports {item.servicePort||'—'}/{item.containerPort||'—'}</div>
  </div>;
}

function App(){
  const [user,setUser]=useState(JSON.parse(localStorage.getItem('user')||'null'));
  const [items,setItems]=useState([]); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  const [login,setLogin]=useState({username:'',password:'',role:'DEVELOPER'});
  const [form,setForm]=useState({...emptyForm,comments:{}});
  const [expanded,setExpanded]=useState(null); const [editing,setEditing]=useState(null); const [editForm,setEditForm]=useState(null);
  const load=()=>api('/api/requests').then(setItems).catch(e=>setError(e.message));
  useEffect(()=>{if(user) load();},[user]);
  const signIn=async e=>{e.preventDefault();setError('');try{const r=await api('/api/login',{method:'POST',body:JSON.stringify(login)});localStorage.setItem('token',r.token);localStorage.setItem('user',JSON.stringify(r.user));setUser(r.user);}catch(e){setError(e.message)}};
  const logout=()=>{localStorage.clear();setUser(null);setItems([])};
  const payload = data=>({...data,environments:Array.isArray(data.environments)?data.environments:data.environments.split(',').map(x=>x.trim()).filter(Boolean),serviceName:data.serviceName||data.repoName,databaseRequired:Boolean(data.dbDetails&&data.dbDetails.toLowerCase()!=='na')});
  const submit=async e=>{e.preventDefault();setBusy(true);setError('');try{const body=payload(form);body.ingressPath=body.ingressPath.endsWith('/')?`${body.ingressPath}${body.repoName}`:body.ingressPath;await api('/api/requests',{method:'POST',body:JSON.stringify(body)});setForm({...emptyForm,comments:{}});await load();}catch(e){setError(e.message)}finally{setBusy(false)}};
  const saveEdit=async e=>{e.preventDefault();setBusy(true);setError('');try{await api(`/api/requests/${editing}`,{method:'PUT',body:JSON.stringify(payload(editForm))});setEditing(null);setEditForm(null);await load();}catch(e){setError(e.message)}finally{setBusy(false)}};
  const beginEdit=item=>{setEditing(item.id);setEditForm({...emptyForm,...item,environments:Array.isArray(item.environments)?item.environments.join(', '):(item.environments||''),comments:item.comments||{}})};
  const act=async(id,kind)=>{setBusy(true);setError('');try{await api(`/api/requests/${id}/${kind}`,{method:'POST',body:JSON.stringify({comment:kind==='approve'?'Approved by DevOps':'Rejected by DevOps'})});await load();}catch(e){setError(e.message)}finally{setBusy(false)}};
  const requestCount=useMemo(()=>items.length,[items]);

  if(!user)return <main className="login"><section className="card login-card"><div className="brand"><ShieldCheck/><div><h1>MS Setup</h1><p>Microservice provisioning portal</p></div></div>{error&&<div className="error">{error}</div>}<form onSubmit={signIn}><label>Username<input value={login.username} onChange={e=>setLogin({...login,username:e.target.value})} required/></label><label>Password<input type="password" value={login.password} onChange={e=>setLogin({...login,password:e.target.value})} required/></label><label>Role<select value={login.role} onChange={e=>setLogin({...login,role:e.target.value})}><option>DEVELOPER</option><option>DEVOPS</option></select></label><button>Sign in</button></form></section></main>;

  return <><header><div className="brand"><Server/><div><h1>Microservice Setup</h1><p>Azure DevOps + Kubernetes automation</p></div></div><div className="user"><span>{user.username} · {user.role}</span><button className="ghost" onClick={logout}><LogOut size={17}/> Logout</button></div></header>
  <main className="page">{error&&<div className="error">{error}</div>}
    {user.role==='DEVELOPER'&&<section className="card onboarding-card"><h2><Plus/> New onboarding request</h2><RequestForm value={form} setValue={setForm} onSubmit={submit} busy={busy}/></section>}
    <section className="card requests"><div className="requests-title"><h2><GitBranch/> {user.role==='DEVOPS'?'DevOps approval portal':'My requests'}</h2><span className="count">{requestCount}</span></div>
      {items.length===0?<p className="muted">No requests found.</p>:items.map(x=><article key={x.id} className="request-card">
        <div className="request-summary"><div><h3>{x.repoName||x.serviceName}</h3><p>{x.requestedBy} · {x.namespace} · {x.ingressPath}</p><span className={`status ${x.status.toLowerCase()}`}>{x.status}</span></div>
          <div className="actions">{x.repositoryUrl&&<a href={x.repositoryUrl} target="_blank" rel="noreferrer">Repository</a>}<button className="ghost" onClick={()=>setExpanded(expanded===x.id?null:x.id)}>{expanded===x.id?<ChevronUp size={16}/>:<ChevronDown size={16}/>} Preview</button>
          {user.role==='DEVOPS'&&['PENDING_APPROVAL','FAILED'].includes(x.status)&&<><button className="secondary" onClick={()=>beginEdit(x)}><Edit3 size={16}/> Edit</button><button onClick={()=>act(x.id,'approve')} disabled={busy}><CheckCircle2 size={16}/> Approve</button><button className="danger" onClick={()=>act(x.id,'reject')} disabled={busy}><XCircle size={16}/> Reject</button></>}</div></div>
        {expanded===x.id&&<Preview item={x}/>} {x.steps?.length>0&&expanded===x.id&&<pre>{JSON.stringify(x.steps,null,2)}</pre>}
      </article>)}
    </section>
  </main>
  {editing&&<div className="modal-backdrop"><section className="card modal"><div className="modal-title"><div><h2>Edit onboarding request</h2><p className="muted">Review and correct details before approval.</p></div><button className="icon ghost" onClick={()=>setEditing(null)}><X/></button></div><RequestForm value={editForm} setValue={setEditForm} onSubmit={saveEdit} busy={busy} submitLabel="Save changes" onCancel={()=>setEditing(null)}/></section></div>}
  </>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
