'use strict';
(() => {
 const menu=document.querySelector('.menu-toggle'),nav=document.getElementById('main-nav');
 menu?.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));nav?.classList.toggle('open',open);});
})();
