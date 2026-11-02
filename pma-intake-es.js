'use strict';
(() => {
 const form=document.getElementById('intake-form');if(!form)return;
 const btn=document.getElementById('intake-submit'),err=document.getElementById('intake-error');
 const token=(window.crypto&&crypto.randomUUID)?crypto.randomUUID():'intake-'+Date.now()+'-'+Math.random().toString(36).slice(2,10);
 let busy=false,done=false;
 const showError=m=>{err.textContent=m;err.hidden=false;};
 form.addEventListener('submit',async e=>{
  e.preventDefault();if(busy||done)return;err.hidden=true;
  if(!form.checkValidity()){form.reportValidity();return;}
  busy=true;btn.disabled=true;btn.textContent='Enviando…';
  const v=id=>document.getElementById(id).value;
  try{
   const res=await fetch('/api/intake',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:v('name'),businessName:v('businessName'),phone:v('phone'),email:v('email'),website:v('website'),smsConsent:document.getElementById('smsConsent').checked,clientToken:token})});
   if(!res.ok)throw new Error('No pudimos enviar su solicitud. Revise sus datos e inténtelo de nuevo. Si el problema continúa, llámenos al (725) 201-0584.');
   done=true;document.getElementById('intake-form-view').hidden=true;document.getElementById('intake-success').hidden=false;
  }catch(x){showError(x.message||'Ocurrió un error. Inténtelo de nuevo.');}
  finally{busy=false;if(!done){btn.disabled=false;btn.textContent='Enviar solicitud';}}
 });
})();