import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PublicClientApplication} from '@azure/msal-browser';
import {MsalProvider, useIsAuthenticated, useMsal} from '@azure/msal-react';
import {CheckCircle2, GitBranch, LogIn, LogOut, Plus, Server, ShieldCheck, XCircle} from 'lucide-react';
import {loginRequest, msalConfig} from './authConfig';
import './styles.css';

const msalInstance = new PublicClientApplication(msalConfig);
await msalInstance.initialize();
await msalInstance.handleRedirectPromise();

function Portal(){
  const {instance, accounts} = useMsal();
  const authenticated = useIsAuthenticated();
  const account = accounts[0];
  const [items,setItems]=useState([]);
  const [profile,setProfile]=useState(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [form,setForm]=useState({serviceName:'',namespace:'mobile-orchestration-dev',description:'',containerPort:8080,servicePort:8080,ingressName:'neocorp-mobile-ingress',ingressHost:'neocorpmob.dev.mashreqdev.com',ingressPath:'/api/',referenceRepository:'',databaseRequired:false,databaseType:'Oracle',databaseName:'',schemaName:'',databaseUsername:''});

  const acquireToken = async()=>{
    if(!account) throw new Error('No signed-in Microsoft account found');
    try {
      return (await instance.acquireTokenSilent({...loginRequest,account})).accessToken;
    } catch {
      return (await instance.acquireTokenPopup({...loginRequest,account})).accessToken;
    }
  };

  const api = async(path,options={})=>{
    const token=await acquireToken();
    const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,...(options.headers||{})}});
    const data=await response.json().catch(()=>({}));
    if(response.status===401){await instance.logoutRedirect({account});throw new Error('Your session expired. Please sign in again.');}
    if(!response.ok){
      const message=typeof data.detail==='string'?data.detail:(data.detail?.message||data.detail?.error||data.error||'Request failed');
      const requestError=new Error(message);
      requestError.status=response.status;
      requestError.details=data.detail;
      throw requestError;
    }
    return data;
  };

  const load=async()=>{const [me,requests]=await Promise.all([api('/api/me'),api('/api/requests')]);setProfile(me);setItems(requests);};
  useEffect(()=>{if(authenticated&&account) load().catch(e=>setError(e.message));},[authenticated,account?.homeAccountId]);

  const submit=async e=>{e.preventDefault();setBusy(true);setError('');try{const body={...form,ingressPath:form.ingressPath.endsWith('/')?`${form.ingressPath}${form.serviceName}`:form.ingressPath};await api('/api/requests',{method:'POST',body:JSON.stringify(body)});setForm({...form,serviceName:'',description:'',referenceRepository:''});await load();}catch(e){setError(e.message)}finally{setBusy(false)}};

  const approve=async(item,createPipelineBranch=false)=>{
    return api(`/api/requests/${item.id}/approve`,{
      method:'POST',
      body:JSON.stringify({
        comment:createPipelineBranch?'Approved by DevOps; create devops/pipeline from reference repository':'Approved by DevOps',
        createPipelineBranch
      })
    });
  };

  const act=async(item,kind)=>{
    setBusy(true);
    setError('');
    try{
      if(kind==='reject'){
        await api(`/api/requests/${item.id}/reject`,{method:'POST',body:JSON.stringify({comment:'Rejected by DevOps'})});
      }else{
        try{
          await approve(item,false);
        }catch(e){
          if(e.status===409&&e.details?.code==='REPOSITORY_EXISTS'){
            const reference=e.details.referenceRepository||item.referenceRepository||'';
            const question=reference
              ? `Repository '${item.serviceName}' already exists.\n\nCreate 'devops/pipeline' and copy the required pipeline/configuration files from reference repository '${reference}'?`
              : `Repository '${item.serviceName}' already exists, but no reference repository was selected. Please reject this request and submit it again with a reference repository.`;
            if(!reference) throw new Error(question);
            const confirmed=window.confirm(question);
            if(!confirmed){
              setError('Repository already exists. devops/pipeline branch creation was cancelled.');
              await load();
              return;
            }
            await approve(item,true);
          }else{
            throw e;
          }
        }
      }
      await load();
    }catch(e){
      setError(e.message);
    }finally{
      setBusy(false);
    }
  };

  if(!authenticated)return <main className="login"><section className="card login-card"><div className="brand"><ShieldCheck/><div><h1>MS Setup</h1><p>Microservice provisioning portal</p></div></div>{error&&<div className="error">{error}</div>}<p>Sign in using your Mashreq Microsoft account.</p><button onClick={()=>instance.loginRedirect(loginRequest)}><LogIn size={17}/> Sign in with Microsoft</button></section></main>;

  const user=profile||{username:account?.username,name:account?.name,role:'DEVELOPER'};
  return <><header><div className="brand"><Server/><div><h1>Microservice Setup</h1><p>Azure DevOps + Kubernetes automation</p></div></div><div className="user"><span>{user.name||user.username} · {user.role}</span><button className="ghost" onClick={()=>instance.logoutRedirect({account})}><LogOut size={17}/> Logout</button></div></header><main className="layout">{error&&<div className="error full">{error}</div>}<section className="card"><h2><Plus/> New request</h2><form className="grid" onSubmit={submit}>{[['serviceName','Service name'],['namespace','Namespace'],['ingressName','Ingress name'],['ingressHost','Ingress host'],['ingressPath','Ingress path prefix'],['referenceRepository','Reference repository']].map(([k,l])=><label key={k}>{l}<input value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})} required={k!=='ingressHost'}/></label>)}<label>Container port<input type="number" value={form.containerPort} onChange={e=>setForm({...form,containerPort:+e.target.value})}/></label><label>Service port<input type="number" value={form.servicePort} onChange={e=>setForm({...form,servicePort:+e.target.value})}/></label><label className="wide">Description<textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label><button className="wide" disabled={busy}>Submit request</button></form></section><section className="card requests"><h2><GitBranch/> Requests</h2>{items.length===0?<p className="muted">No requests found.</p>:items.map(x=><article key={x.id}><div><h3>{x.serviceName}</h3><p>{x.namespace} · {x.ingressPath}</p>{x.referenceRepository&&<p className="muted">Reference: {x.referenceRepository}</p>}<span className={`status ${x.status.toLowerCase().replaceAll('_','-')}`}>{x.status}</span></div><div className="actions">{x.repositoryUrl&&<a href={x.repositoryUrl} target="_blank" rel="noreferrer">Repository</a>}{user.role==='DEVOPS'&&['PENDING_APPROVAL','FAILED','AWAITING_REPO_CONFIRMATION'].includes(x.status)&&<><button onClick={()=>act(x,'approve')} disabled={busy}><CheckCircle2 size={16}/> Approve</button><button className="danger" onClick={()=>act(x,'reject')} disabled={busy}><XCircle size={16}/> Reject</button></>}</div>{x.steps?.length>0&&<pre>{JSON.stringify(x.steps,null,2)}</pre>}</article>)}</section></main></>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><MsalProvider instance={msalInstance}><Portal/></MsalProvider></React.StrictMode>);
