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
  busy=true;btn.disabled=true;btn.textContent='Submitting…';
  const v=id=>document.getElementById(id).value;
  try{
   const res=await fetch('/api/intake',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:v('name'),businessName:v('businessName'),phone:v('phone'),email:v('email'),website:v('website'),smsConsent:document.getElementById('smsConsent').checked,clientToken:token})});
   const data=await res.json().catch(()=>({}));
   if(!res.ok)throw new Error(data.error||'Something went wrong. Please try again.');
   done=true;document.getElementById('intake-form-view').hidden=true;document.getElementById('intake-success').hidden=false;
  }catch(x){showError(x.message);}
  finally{busy=false;if(!done){btn.disabled=false;btn.textContent='Get Started';}}
 });
})();
