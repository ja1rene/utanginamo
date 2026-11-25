/* ============================================================
   app.js v3 — router, top bar, tab bar, quick add, search, notifications, boot.
   Service-worker registration/updates live in updates.js.
   ============================================================ */
const TABS = [
  { key:"dashboard", label:"Home",      icon:"home",   title:"Utanginamo" },
  { key:"borrowers", label:"Borrowers", icon:"users",  title:"Borrowers"  },
  { key:"loans",     label:"Loans",     icon:"wallet", title:"Loans"      },
  { key:"reports",   label:"Reports",   icon:"chart",  title:"Reports"    },
  { key:"settings",  label:"Settings",  icon:"gear",   title:"Settings"   },
];
const TOP_LEVEL = TABS.map(t=>t.key);
const SUB_TITLES = { borrowerProfile:"Borrower", loanDetail:"Loan Details", calendar:"Calendar" };
const TAB_FOR_SUBVIEW = { borrowerProfile:"borrowers", loanDetail:"loans", calendar:"dashboard" };

const Router = {
  stack:[{view:"dashboard",params:{}}],
  current(){ return Router.stack[Router.stack.length-1]; },
  async go(view,params={},{replace=false}={}){
    if (replace) Router.stack[Router.stack.length-1]={view,params}; else Router.stack.push({view,params});
    await Router.render(); window.scrollTo({top:0});
  },
  async back(){ if (Router.stack.length>1) Router.stack.pop(); await Router.render(); },
  async refresh(){ await Router.render(); },
  async render(){
    const {view,params}=Router.current();
    const root=document.getElementById("appMain");
    const isTop=TOP_LEVEL.includes(view);
    root.innerHTML="";
    renderTopbar(view,isTop); renderTabbar(view,isTop);
    try {
      if (window.Pages[view]) await window.Pages[view](root,params);
      else root.innerHTML='<div class="card"><div class="empty"><div class="title">Page not found.</div></div></div>';
    } catch(e){
      console.error("[render]",view,e && e.message);
      root.innerHTML=`<div class="card">${emptyState("warn","Something went wrong","This screen couldn't load. Your data is safe. Try going back or reopening the app.")}</div>`;
    }
    Router.updateBadge(); schedulePushReminders();
  },
  async updateBadge(){
    try {
      const [loans,payments]=await Promise.all([DB.listLoans(),DB.allPayments()]);
      const cs=loans.map(l=>Utils.computeLoan(l,payments.filter(p=>p.loanId===l.id)));
      const overdue=cs.filter(c=>c.status==="overdue").length;
      const dueSoon=cs.filter(c=>c.status==="active"&&c.daysRemaining>=0&&c.daysRemaining<=3).length;
      const set=(id,n)=>{ const el=document.getElementById(id); if(el){ el.textContent=n>9?"9+":n; el.classList.toggle("hidden",n===0); } };
      set("homeBadge",overdue); set("loanBadge",dueSoon); set("bellBadge",overdue+cs.filter(c=>c.status==="active"&&c.daysRemaining>=0&&c.daysRemaining<=1).length);
    } catch(e){}
  },
};

function renderTopbar(view,isTop){
  const bar=document.getElementById("topbar");
  const btn=(id,icon,label,extra="")=>`<button class="icon-btn" id="${id}" aria-label="${label}">${Icons[icon]}${extra}</button>`;
  if (isTop){
    const meta=TABS.find(t=>t.key===view);
    bar.innerHTML=`<h1 class="h-display">${meta.title}</h1>
      <div class="actions">${btn("topSearch","search","Search")}${btn("topCal","calendar","Calendar")}${btn("topBell","bell","Reminders",`<span id="bellBadge" class="badge hidden"></span>`)}</div>`;
    bar.querySelector("#topCal").onclick=()=>Router.go("calendar");
  } else {
    bar.innerHTML=`${btn("topBack","back","Go back")}<h1 class="h-display" style="font-size:17px;">${SUB_TITLES[view]||""}</h1>
      <div class="actions">${btn("topSearch","search","Search")}${btn("topBell","bell","Reminders",`<span id="bellBadge" class="badge hidden"></span>`)}</div>`;
    bar.querySelector("#topBack").onclick=()=>Router.back();
  }
  bar.querySelector("#topSearch").onclick=()=>openGlobalSearch();
  bar.querySelector("#topBell").onclick=()=>openNotifications();
}

function renderTabbar(view,isTop){
  const bar=document.getElementById("tabbar");
  const activeKey=isTop?view:(TAB_FOR_SUBVIEW[view]||"dashboard");
  bar.innerHTML=TABS.map(t=>`
    <button class="tab ${t.key===activeKey?"active":""}" data-tab="${t.key}" ${t.key===activeKey?'aria-current="page"':""}>
      ${Icons[t.icon]}<span>${t.label}</span>
      ${t.key==="dashboard"?`<span class="badge hidden" id="homeBadge" aria-label="overdue loans">0</span>`:""}
      ${t.key==="loans"?`<span class="badge hidden" id="loanBadge" aria-label="due soon">0</span>`:""}
    </button>`).join("");
  bar.querySelectorAll("[data-tab]").forEach(el=>el.onclick=()=>{ Router.stack=[{view:el.dataset.tab,params:{}}]; Router.render(); window.scrollTo({top:0}); });
}

// ---------- Quick add ----------
function qaRow(id,icon,title,sub){ return `<div class="row" id="${id}" role="button" tabindex="0"><div class="avatar">${Icons[icon]}</div><div class="meta"><div class="title">${title}</div><div class="sub">${sub}</div></div><div class="trail faint">${Icons.chev}</div></div>`; }
function openQuickAdd(){
  Utils.vibrate();
  Sheet.open({ title:"Quick Add",
    bodyHtml:`<div style="display:flex;flex-direction:column;">
      ${qaRow("qaPayment","receipt","Record Payment","Log a payment received")}
      ${qaRow("qaLoan","wallet","New Loan","Lend money to a borrower")}
      ${qaRow("qaBorrower","users","Add Borrower","Create a borrower profile")}
      ${qaRow("qaCalendar","calendar","Calendar","Due dates and installments")}</div>`,
    onMount:(sheet)=>{
      const $=s=>sheet.querySelector(s);
      $("#qaBorrower").onclick=()=>{ Sheet.close(); openBorrowerForm(); };
      $("#qaCalendar").onclick=()=>{ Sheet.close(); Router.go("calendar"); };
      $("#qaLoan").onclick=async()=>{ Sheet.close(); if(!(await DB.listBorrowers()).length){ Toast.show("Add a borrower first",{type:"error"}); openBorrowerForm(); return; } openLoanForm(null,null); };
      $("#qaPayment").onclick=async()=>{
        Sheet.close(); const loans=await DB.listLoans(), pays=await DB.allPayments();
        const open=loans.filter(l=>{const s=Utils.computeLoan(l,pays.filter(p=>p.loanId===l.id)).status;return s==="active"||s==="overdue";});
        if(!open.length){ Toast.show("No open loans to record a payment on",{type:"error"}); return; } openPaymentForm(null,null);
      };
    } });
}

// ---------- Global search: borrowers, loans, notes, payment references ----------
function openGlobalSearch(){
  Sheet.open({ title:"Search",
    bodyHtml:`<div class="search-bar" style="margin-bottom:6px;">${Icons.search}<input type="search" id="gSearch" aria-label="Search" placeholder="Name, phone, amount, notes, reference…"></div><div id="gResults"></div>`,
    onMount:(sheet)=>{
      const input=sheet.querySelector("#gSearch"), results=sheet.querySelector("#gResults"); input.focus();
      input.addEventListener("input",Utils.debounce(async()=>{
        const q=input.value.trim().toLowerCase();
        if(!q){ results.innerHTML=""; return; }
        const [borrowers,loans,payments]=await Promise.all([DB.listBorrowers({includeArchived:true}),DB.listLoans(),DB.allPayments()]);
        const nameOf=id=>(borrowers.find(b=>b.id===id)||{}).name||"";
        const bMatches=borrowers.filter(b=>[b.name,b.nickname,b.phone,b.facebook,b.address,b.notes].some(f=>(f||"").toLowerCase().includes(q))).slice(0,8);
        const payRefs=payments.filter(p=>[p.reference,p.notes,String(p.amount)].some(f=>(f||"").toLowerCase().includes(q)));
        const lIds=new Set(payRefs.map(p=>p.loanId));
        const lMatches=loans.filter(l=>lIds.has(l.id)||(l.notes||"").toLowerCase().includes(q)||String(l.principal).includes(q)||nameOf(l.borrowerId).toLowerCase().includes(q)).slice(0,8);
        if(!bMatches.length&&!lMatches.length){ results.innerHTML=emptyState("search","No results","Try a different search term."); return; }
        results.innerHTML=`
          ${bMatches.length?`<div class="eyebrow" style="margin:10px 4px 2px;">Borrowers</div>`+bMatches.map(b=>`<div class="row" data-go-borrower="${b.id}" role="button" tabindex="0"><div class="avatar">${avatarHtml(b)}</div><div class="meta"><div class="title">${Utils.escapeHtml(b.name)}</div><div class="sub">${Utils.escapeHtml(b.phone||b.address||"")}</div></div></div>`).join(""):""}
          ${lMatches.length?`<div class="eyebrow" style="margin:10px 4px 2px;">Loans</div>`+lMatches.map(l=>{
            const c=Utils.computeLoan(l,payments.filter(p=>p.loanId===l.id));
            return `<div class="row" data-go-loan="${l.id}" role="button" tabindex="0"><div class="avatar">${Icons.wallet}</div><div class="meta"><div class="title">${Utils.escapeHtml(nameOf(l.borrowerId)||"?")} — ${Utils.money(l.principal)}</div><div class="sub">${Utils.money(c.remaining)} left · ${c.status}</div></div></div>`;}).join(""):""}`;
        results.querySelectorAll("[data-go-borrower]").forEach(el=>el.onclick=()=>{ Sheet.close(); Router.go("borrowerProfile",{id:el.dataset.goBorrower}); });
        results.querySelectorAll("[data-go-loan]").forEach(el=>el.onclick=()=>{ Sheet.close(); Router.go("loanDetail",{id:el.dataset.goLoan}); });
      },200));
    } });
}

// ---------- Reminders panel ----------
async function openNotifications(){
  const [loans,payments,borrowers]=await Promise.all([DB.listLoans(),DB.allPayments(),DB.listBorrowers({includeArchived:true})]);
  const computed=loans.map(l=>({loan:l,c:Utils.computeLoan(l,payments.filter(p=>p.loanId===l.id))}));
  const nameOf=id=>(borrowers.find(b=>b.id===id)||{}).name||"Borrower";
  const overdue=computed.filter(x=>x.c.status==="overdue").sort((a,b)=>b.c.daysOverdue-a.c.daysOverdue);
  const dueToday=computed.filter(x=>x.c.status==="active"&&x.c.daysRemaining===0);
  const dueTomorrow=computed.filter(x=>x.c.status==="active"&&x.c.daysRemaining===1);
  const dueWeek=computed.filter(x=>x.c.status==="active"&&x.c.daysRemaining>=2&&x.c.daysRemaining<=7);
  const recent=payments.slice().sort((a,b)=>b.date-a.date).slice(0,5);
  const item=(loanId,icon,tone,title,sub)=>`<div class="row" data-n-loan="${loanId}" role="button" tabindex="0"><div class="avatar" style="${tone}">${Icons[icon]}</div><div class="meta"><div class="title">${Utils.escapeHtml(title)}</div><div class="sub">${sub}</div></div><div class="trail faint">${Icons.chev}</div></div>`;
  const section=(t,items,fn)=>items.length?`<div class="eyebrow" style="margin:14px 4px 2px;">${t} (${items.length})</div>${items.map(fn).join("")}`:"";
  const none=!overdue.length&&!dueToday.length&&!dueTomorrow.length&&!dueWeek.length;
  Sheet.open({ title:"Reminders",
    bodyHtml:`${none?emptyState("bell","All clear","Nothing is overdue or due this week."):""}
      ${section("Overdue",overdue,x=>item(x.loan.id,"warn","background:var(--red-soft);color:var(--red);",nameOf(x.loan.borrowerId),`${x.c.daysOverdue}d overdue · ${Utils.money(x.c.remaining)}`))}
      ${section("Due today",dueToday,x=>item(x.loan.id,"clock","background:var(--amber-soft);color:var(--amber);",nameOf(x.loan.borrowerId),`${Utils.money(x.c.remaining)} due today`))}
      ${section("Due tomorrow",dueTomorrow,x=>item(x.loan.id,"clock","",nameOf(x.loan.borrowerId),`${Utils.money(x.c.remaining)} due tomorrow`))}
      ${section("Due this week",dueWeek,x=>item(x.loan.id,"calendar","",nameOf(x.loan.borrowerId),`In ${x.c.daysRemaining} days · ${Utils.money(x.c.remaining)}`))}
      ${section("Recently paid",recent,p=>item(p.loanId,"check","background:var(--green-soft);color:var(--green);",nameOf(p.borrowerId),`${Utils.money(p.amount)} · ${Utils.fmtRelative(p.date)}`))}`,
    onMount:(sheet)=>sheet.querySelectorAll("[data-n-loan]").forEach(el=>el.onclick=()=>{ Sheet.close(); Router.go("loanDetail",{id:el.dataset.nLoan}); }) });
}

// ---------- Boot ----------
async function bootApp(){
  try { await DB.init(); } catch(e){
    document.getElementById("appMain").innerHTML=`<div class="card" style="margin:20px 0;">${emptyState("warn","Can't open local storage","Utanginamo needs browser storage to keep your records. Check that private browsing is off and storage isn't blocked, then reload.")}</div>`; return;
  }
  Toast.init(); Sheet.init();
  applyTheme(await DB.getSetting("theme","system"));
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change",async()=>{ if((await DB.getSetting("theme","system"))==="system") applyTheme("system"); });
  document.getElementById("fab").onclick=openQuickAdd;

  // keyboard: Enter/Space activates role="button" rows
  document.addEventListener("keydown",(e)=>{
    if((e.key==="Enter"||e.key===" ")&&e.target.matches&&e.target.matches('[role="button"],[role="link"]')){ e.preventDefault(); e.target.click(); }
  });
  // offline indicator
  const offline=()=>{ let el=document.getElementById("offlineBar"); if(!navigator.onLine){ if(!el){ el=document.createElement("div"); el.id="offlineBar"; el.setAttribute("role","status"); el.style.cssText="position:fixed;top:0;left:0;right:0;z-index:90;text-align:center;font-size:12px;font-weight:600;padding:calc(4px + var(--safe-top)) 8px 4px;background:var(--surface-3);color:var(--text-dim);"; el.textContent="Offline — everything still works; data is saved on this device."; document.body.appendChild(el);} } else if(el) el.remove(); };
  window.addEventListener("online",offline); window.addEventListener("offline",offline); offline();

  await checkPin();                                   // PIN gate (security.js)
  const action=new URLSearchParams(location.search).get("action");
  await Router.render();
  if (action==="add-loan") openQuickAddLoan(); if (action==="add-payment") openPaymentForm(null,null);
  setupInstallPrompt(); schedulePushReminders();
}
async function openQuickAddLoan(){ if(!(await DB.listBorrowers()).length){ Toast.show("Add a borrower first",{type:"error"}); openBorrowerForm(); } else openLoanForm(null,null); }

let deferredInstallPrompt=null;
function setupInstallPrompt(){
  window.addEventListener("beforeinstallprompt",(e)=>{ e.preventDefault(); deferredInstallPrompt=e; showInstallBanner(); });
  window.addEventListener("appinstalled",()=>{ deferredInstallPrompt=null; const b=document.getElementById("installBanner"); if(b) b.remove(); });
}
function showInstallBanner(){
  if (document.getElementById("installBanner")) return;
  const el=document.createElement("div"); el.id="installBanner";
  el.style.cssText="position:fixed;left:14px;right:14px;bottom:calc(140px + var(--safe-bottom));max-width:530px;margin:0 auto;background:var(--surface);border:1px solid var(--border-strong);border-radius:16px;padding:12px 14px;display:flex;align-items:center;gap:12px;box-shadow:var(--sh-2);z-index:70;";
  el.innerHTML=`<div class="avatar">${Icons.coin}</div><div style="flex:1;"><div style="font-weight:650;font-size:13.5px;">Install Utanginamo</div><div class="muted" style="font-size:12px;">Open it like an app, even offline.</div></div>
    <button class="btn btn-primary btn-sm" id="installNow">Install</button><button class="icon-btn" id="dismissInstall" style="width:36px;height:36px;" aria-label="Dismiss">${Icons.x}</button>`;
  document.body.appendChild(el);
  el.querySelector("#installNow").onclick=async()=>{ if(deferredInstallPrompt){ deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; } el.remove(); };
  el.querySelector("#dismissInstall").onclick=()=>el.remove();
}
document.addEventListener("DOMContentLoaded",bootApp);
