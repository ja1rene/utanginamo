/* ============================================================
   reports.js v3 — calendar-based periods; every figure from Finance.summarize.
   Principal recovery is NEVER shown as profit. Income = interest + penalties collected.
   ============================================================ */
window.Pages.reports = async function (root) {
  const [loans, payments, borrowers] = await Promise.all([DB.listLoans(), DB.allPayments(), DB.listBorrowers({ includeArchived: true })]);
  let key = "month";
  const custom = { from: Utils.toInputDate(Date.now() - 30 * Utils.DAY), to: Utils.toInputDate(Date.now()) };
  const PERIODS = [["month","This month"],["lastMonth","Last month"],["quarter","This quarter"],["year","This year"],["all","All time"],["custom","Custom"]];

  root.innerHTML = `
    <div class="chip-row" id="rangeChips">${PERIODS.map(([k,l])=>`<button class="chip ${k===key?"active":""}" data-r="${k}">${l}</button>`).join("")}</div>
    <div id="customRange" class="field-row hidden" style="margin-bottom:12px;">
      <div class="field"><label for="rFrom">From</label><input type="date" id="rFrom" value="${custom.from}"></div>
      <div class="field"><label for="rTo">To</label><input type="date" id="rTo" value="${custom.to}"></div>
    </div>
    <div id="reportBody"></div>`;

  const nameOf = id => (borrowers.find(b => b.id === id) || {}).name || "—";

  function makeBuckets(range) {
    const now = Date.now();
    let from = range.from, to = isFinite(range.to) ? range.to : now;
    if (!from) { const ts = [...payments.map(p=>p.date), ...loans.map(l=>l.dateBorrowed)]; from = ts.length ? Math.min(...ts) : now; }
    const out = [];
    if ((to - from) / Utils.DAY <= 62) {
      for (let t = Utils.startOfDay(from); t <= to && out.length < 9; t += 7 * Utils.DAY)
        out.push({ label: new Date(t).toLocaleDateString(Utils.DATE_LOCALE, { month: "short", day: "numeric" }), from: t, to: t + 7 * Utils.DAY - 1 });
    } else {
      const d = new Date(from); d.setDate(1); d.setHours(0,0,0,0);
      while (d.getTime() <= to) { const s = d.getTime(); d.setMonth(d.getMonth() + 1); out.push({ label: new Date(s).toLocaleDateString(Utils.DATE_LOCALE, { month: "short" }), from: s, to: d.getTime() - 1 }); }
    }
    return out.slice(-12);
  }

  function build() {
    const body = document.getElementById("reportBody");
    let range = Finance.period(key, Date.now(), { from: Utils.fromInputDate(custom.from), to: Utils.fromInputDate(custom.to) });
    if (key === "custom" && range.from > range.to) { body.innerHTML = `<div class="card">${emptyState("calendar","Check your dates","The start date must be before the end date.")}</div>`; return; }
    const s = Finance.summarize(loans, payments, range);
    const inRange = ts => ts >= range.from && ts <= range.to;
    const periodLoans = loans.filter(l => l.status !== "cancelled" && inRange(l.dateBorrowed));
    const periodPays = payments.filter(p => inRange(p.date));
    const computedAll = loans.map(l => ({ loan: l, c: Utils.computeLoan(l, payments.filter(p => p.loanId === l.id)) }));
    const label = key === "all" ? "All time" : `${Utils.fmtDate(range.from)} – ${Utils.fmtDate(Math.min(range.to, Date.now() + 366 * Utils.DAY))}`;

    const byBorrower = {}; periodPays.forEach(p => { byBorrower[p.borrowerId] = (byBorrower[p.borrowerId] || 0) + Finance.toCents(p.amount); });
    const freq = {}; periodLoans.forEach(l => { freq[l.borrowerId] = (freq[l.borrowerId] || 0) + 1; });
    const topPayer = Object.entries(byBorrower).sort((a,b)=>b[1]-a[1])[0];
    const mostFreq = Object.entries(freq).sort((a,b)=>b[1]-a[1])[0];
    const biggest = periodLoans.slice().sort((a,b)=>b.principal-a.principal)[0];

    const buckets = makeBuckets(range);
    const vals = buckets.map(b => Finance.fromCents(periodPays.filter(p => p.date >= b.from && p.date <= b.to).reduce((t,p)=>t+Finance.toCents(p.amount),0)));
    const dist = { active: 0, overdue: 0, paid: 0 };
    computedAll.forEach(x => { if (dist[x.c.status] !== undefined) dist[x.c.status]++; });
    const openCount = dist.active + dist.overdue;
    const kpi = (l, v, st="") => `<div class="kpi"><div class="eyebrow">${l}</div><div class="val" style="${st}">${v}</div></div>`;

    body.innerHTML = `
      <div class="muted" style="font-size:12.5px;margin:0 4px 10px;">${label}</div>
      <div class="kpi-grid">
        ${kpi("Principal lent", Utils.moneyShort(s.lent))}
        ${kpi("Total collected", Utils.moneyShort(s.collected))}
        ${kpi("Principal recovered", Utils.moneyShort(s.principalRecovered))}
        <div class="kpi accent"><div class="eyebrow">Income received</div><div class="val">${Utils.moneyShort(s.realizedIncome)}</div></div>
      </div>
      <div class="card" style="margin-top:10px;font-size:13.5px;">
        <div class="flex-between" style="padding:3px 0;"><span class="muted">Interest collected</span><span class="num">${Utils.money(s.interestCollected)}</span></div>
        <div class="flex-between" style="padding:3px 0;"><span class="muted">Penalties collected</span><span class="num">${Utils.money(s.penaltyCollected)}</span></div>
        <div class="faint" style="font-size:11.5px;margin-top:6px;">Income counts only interest and penalties actually received. Money returned as principal is not income.</div>
      </div>

      <div class="section-title"><h2>Collections</h2></div>
      <div class="card">${vals.some(v=>v>0) ? barChart(buckets.map(b=>b.label), vals) : emptyState("chart","No collections","No payments were received in this period.")}</div>

      <div class="section-title"><h2>Owed to you today</h2><span class="muted" style="font-size:12px;">Current snapshot</span></div>
      <div class="kpi-grid">
        <div class="kpi accent"><div class="eyebrow">Total receivables</div><div class="val">${Utils.moneyShort(s.totalReceivables)}</div></div>
        ${kpi("Overdue", `${Utils.moneyShort(s.overdueAmount)}`, s.overdueAmount>0?"color:var(--red)":"")}
        ${kpi("Principal left", Utils.moneyShort(s.outstandingPrincipal))}
        ${kpi("Interest + penalty left", Utils.moneyShort(s.outstandingInterest + s.outstandingPenalty))}
      </div>

      <div class="section-title"><h2>Loan status</h2><span class="muted" style="font-size:12px;">Current snapshot</span></div>
      <div class="card" style="display:flex;align-items:center;gap:18px;">
        ${donutChart(dist)}
        <div style="flex:1;display:flex;flex-direction:column;gap:8px;">
          <div class="flex-between"><span style="font-size:13px;" class="muted">Active</span><b>${dist.active}</b></div>
          <div class="flex-between"><span style="font-size:13px;" class="muted">Overdue</span><b>${dist.overdue}</b></div>
          <div class="flex-between"><span style="font-size:13px;" class="muted">Paid</span><b>${dist.paid}</b></div>
          <div class="faint" style="font-size:11.5px;">${openCount?Math.round(dist.overdue/openCount*100):0}% of open loans are overdue</div>
        </div>
      </div>

      <div class="section-title"><h2>Highlights</h2></div>
      <div class="card">
        <div class="row" style="cursor:default;"><div class="avatar">${Icons.star}</div><div class="meta"><div class="title">${topPayer?Utils.escapeHtml(nameOf(topPayer[0])):"—"}</div><div class="sub">Paid the most${topPayer?" · "+Utils.money(Finance.fromCents(topPayer[1])):""}</div></div></div>
        <div class="row" style="cursor:default;"><div class="avatar">${Icons.users}</div><div class="meta"><div class="title">${mostFreq?Utils.escapeHtml(nameOf(mostFreq[0])):"—"}</div><div class="sub">Most new loans${mostFreq?" · "+mostFreq[1]:""}</div></div></div>
        <div class="row" style="cursor:default;"><div class="avatar">${Icons.wallet}</div><div class="meta"><div class="title">${biggest?Utils.escapeHtml(nameOf(biggest.borrowerId)):"—"}</div><div class="sub">Largest loan${biggest?" · "+Utils.money(biggest.principal):""}</div></div></div>
      </div>

      <div class="section-title"><h2>Loans in this period (${periodLoans.length})</h2></div>
      <div class="card">
        ${periodLoans.length===0?emptyState("wallet","No loans in this period","Try a different period."):
          periodLoans.slice().sort((a,b)=>b.dateBorrowed-a.dateBorrowed).slice(0,8).map(l=>loanRowHtml(l,computedAll.find(x=>x.loan.id===l.id).c,borrowers)).join("")}
      </div>`;
    body.querySelectorAll("[data-loan-row]").forEach(el => el.onclick = () => Router.go("loanDetail", { id: el.dataset.loanRow }));
  }

  build();
  root.querySelectorAll("#rangeChips .chip").forEach(chip => {
    chip.onclick = () => {
      root.querySelectorAll("#rangeChips .chip").forEach(c => c.classList.remove("active")); chip.classList.add("active");
      key = chip.dataset.r; root.querySelector("#customRange").classList.toggle("hidden", key !== "custom"); build();
    };
  });
  root.querySelector("#rFrom").onchange = e => { custom.from = e.target.value; build(); };
  root.querySelector("#rTo").onchange = e => { custom.to = e.target.value; build(); };
};

function barChart(labels, values) {
  const max = Math.max(1, ...values), w = 320, h = 140, pad = 12, bw = (w - pad * 2) / values.length;
  const bars = values.map((v, i) => {
    const bh = (v / max) * (h - 44), x = pad + i * bw + bw * 0.18, y = h - 22 - bh;
    return `<rect x="${x}" y="${y}" width="${bw * 0.64}" height="${Math.max(v>0?2:0,bh)}" rx="4" fill="var(--green)" opacity="${i===values.length-1?1:0.6}"/>
      ${v>0?`<text x="${x+bw*0.32}" y="${y-4}" font-size="8.5" fill="var(--text-dim)" text-anchor="middle">${Utils.moneyShort(v).replace("₱","")}</text>`:""}
      <text x="${x+bw*0.32}" y="${h-6}" font-size="9" fill="var(--text-faint)" text-anchor="middle">${Utils.escapeHtml(labels[i])}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;" role="img" aria-label="Collections by period">${bars}</svg>`;
}

function donutChart(dist) {
  const total = Object.values(dist).reduce((a, b) => a + b, 0);
  const colors = { active: "var(--green)", overdue: "var(--red)", paid: "var(--text-faint)" };
  if (!total) return `<svg width="76" height="76" viewBox="0 0 76 76"><circle cx="38" cy="38" r="30" fill="none" stroke="var(--surface-3)" stroke-width="12"/></svg>`;
  let acc = 0; const r = 30, cx = 38, cy = 38, c = 2 * Math.PI * r;
  const segs = Object.entries(dist).filter(([,v])=>v>0).map(([k, v]) => {
    const len = (v / total) * c;
    const seg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${colors[k]}" stroke-width="12" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-acc}" transform="rotate(-90 ${cx} ${cy})"/>`;
    acc += len; return seg;
  }).join("");
  return `<svg width="76" height="76" viewBox="0 0 76 76" role="img" aria-label="Loan status distribution">${segs}</svg>`;
}
