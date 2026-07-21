import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CheckCircle2, GitBranch, LogOut, Plus, Server, ShieldCheck, XCircle} from 'lucide-react';
import './styles.css';

const api = async (path, options={}) => {
  const token = localStorage.getItem('token');
  const response = await fetch(path,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{}) ,...(options.headers||{})}});
  const data = await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(typeof data.detail==='string'?data.detail:(data.detail?.error||data.error||'Request failed'));
  return data;
};

function App(){
  const [user,setUser]=useState(JSON.parse(localStorage.getItem('user')||'null'));
  const [items,setItems]=useState([]); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  const [login,setLogin]=useState({username:'',password:'',role:'DEVELOPER'});
  const [form,setForm]=useState({serviceName:'',namespace:'mobile-orchestration-dev',description:'',containerPort:8080,servicePort:8080,ingressName:'neocorp-mobile-ingress',ingressHost:'neocorpmob.dev.mashreqdev.com',ingressPath:'/api/',databaseRequired:false,databaseType:'Oracle',databaseName:'',schemaName:'',databaseUsername:''});
  const load=()=>api('/api/requests').then(setItems).catch(e=>setError(e.message));
  useEffect(()=>{if(user) load();},[user]);
  const signIn=async e=>{e.preventDefault();setError('');try{const r=await api('/api/login',{method:'POST',body:JSON.stringify(login)});localStorage.setItem('token',r.token);localStorage.setItem('user',JSON.stringify(r.user));setUser(r.user);}catch(e){setError(e.message)}};
  const logout=()=>{localStorage.clear();setUser(null);setItems([])};
  const submit=async e=>{e.preventDefault();setBusy(true);setError('');try{const body={...form,ingressPath:form.ingressPath.endsWith('/')?`${form.ingressPath}${form.serviceName}`:form.ingressPath};await api('/api/requests',{method:'POST',body:JSON.stringify(body)});setForm({...form,serviceName:'',description:''});await load();}catch(e){setError(e.message)}finally{setBusy(false)}};
  const act=async(id,kind)=>{setBusy(true);setError('');try{await api(`/api/requests/${id}/${kind}`,{method:'POST',body:JSON.stringify({comment:kind==='approve'?'Approved by DevOps':'Rejected by DevOps'})});await load();}catch(e){setError(e.message)}finally{setBusy(false)}};
  if(!user)return <main className="login"><section className="card login-card"><div className="brand"><ShieldCheck/><div><h1>MS Setup</h1><p>Microservice provisioning portal</p></div></div>{error&&<div className="error">{error}</div>}<form onSubmit={signIn}><label>Username<input value={login.username} onChange={e=>setLogin({...login,username:e.target.value})} required/></label><label>Password<input type="password" value={login.password} onChange={e=>setLogin({...login,password:e.target.value})} required/></label><label>Role<select value={login.role} onChange={e=>setLogin({...login,role:e.target.value})}><option>DEVELOPER</option><option>DEVOPS</option></select></label><button>Sign in</button></form></section></main>;
  return <><header><div className="brand"><Server/><div><h1>Microservice Setup</h1><p>Azure DevOps + Kubernetes automation</p></div></div><div className="user"><span>{user.username} · {user.role}</span><button className="ghost" onClick={logout}><LogOut size={17}/> Logout</button></div></header><main className="layout">{error&&<div className="error full">{error}</div>}<section className="card"><h2><Plus/> New request</h2><form className="grid" onSubmit={submit}>{[['serviceName','Service name'],['namespace','Namespace'],['ingressName','Ingress name'],['ingressHost','Ingress host'],['ingressPath','Ingress path prefix']].map(([k,l])=><label key={k}>{l}<input value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})} required/></label>)}<label>Container port<input type="number" value={form.containerPort} onChange={e=>setForm({...form,containerPort:+e.target.value})}/></label><label>Service port<input type="number" value={form.servicePort} onChange={e=>setForm({...form,servicePort:+e.target.value})}/></label><label className="wide">Description<textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label><button className="wide" disabled={busy}>Submit request</button></form></section><section className="card requests"><h2><GitBranch/> Requests</h2>{items.length===0?<p className="muted">No requests found.</p>:items.map(x=><article key={x.id}><div><h3>{x.serviceName}</h3><p>{x.namespace} · {x.ingressPath}</p><span className={`status ${x.status.toLowerCase()}`}>{x.status}</span></div><div className="actions">{x.repositoryUrl&&<a href={x.repositoryUrl} target="_blank">Repository</a>}{user.role==='DEVOPS'&&['PENDING_APPROVAL','FAILED'].includes(x.status)&&<><button onClick={()=>act(x.id,'approve')} disabled={busy}><CheckCircle2 size={16}/> Approve</button><button className="danger" onClick={()=>act(x.id,'reject')} disabled={busy}><XCircle size={16}/> Reject</button></>}</div>{x.steps?.length>0&&<pre>{JSON.stringify(x.steps,null,2)}</pre>}</article>)}</section></main></>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
