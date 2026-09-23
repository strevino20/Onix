/* ============================================================
   Onix Finance — Admin Portal Live Console
   Renders a real-data overlay on top of the static admin design.
   All data comes from Supabase via OnixDB.
   ============================================================ */
(function () {
  'use strict';

  if (!window.OnixDB) {
    console.error('[onix-admin] supabase.js not loaded');
    return;
  }

  // ---------- helpers ----------
  const fmt = {
    money: n => (n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })),
    pct:   n => (n == null ? '—' : Number(n).toFixed(1) + '%'),
    date:  s => (s == null ? '—' : new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }))
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[c]));
  // Client names render in ALL CAPS throughout the admin portal (display
  // only — never touches what's actually stored in profiles.full_name, so
  // exports, search matching, and edit forms all keep the real value).
  const up = s => (s ? String(s).toUpperCase() : s);
  // Loan-type breakdown charts (Dashboard + Reports) only ever show
  // Personal, Simple, or Other — never a raw loan_type value. See the
  // comment at loanTypeChart's grouping code for why a raw value can't be
  // trusted even though server.js normalizes it at sync time.
  const LOAN_TYPE_DISPLAY = { PERSONAL: 'Personal', SIMPLE: 'Simple' };

  // ---------- styles for the live console overlay ----------
  function injectStyles() {
    if (document.getElementById('onix-admin-styles')) return;
    const s = document.createElement('style');
    s.id = 'onix-admin-styles';
    s.textContent = `
      /* Reports tab is retired — hide the sidebar button and the view. */
      [data-view="reports"],
      [onclick*="showView('reports')"],
      #view-reports { display: none !important; }

      /* Mobile: kill horizontal overflow (the "zoomed in" symptom), make the
         drawer full-height, scroll wide tables, and stack the KPI grids. */
      html,body{max-width:100%;overflow-x:hidden}
      @media(max-width:680px){
        .sidebar{height:100vh;height:100dvh;overflow-y:auto}
        .${LIVE_MARKER} .oac-table{display:block;overflow-x:auto;-webkit-overflow-scrolling:touch;white-space:nowrap}
        .${LIVE_MARKER} [style*="grid-template-columns:repeat(4"]{grid-template-columns:1fr 1fr !important}
        .${LIVE_MARKER} [style*="grid-template-columns:repeat(3"]{grid-template-columns:1fr !important}
        .${LIVE_MARKER} [style*="padding:32px 40px"]{padding:18px 16px !important}
      }
      #onix-admin-toggle{position:fixed;bottom:20px;right:20px;z-index:99998;background:#C0392B;color:#fff;padding:12px 18px;border:none;border-radius:2px;font:600 .75rem/1 'DM Sans',sans-serif;text-transform:uppercase;letter-spacing:.1em;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.18)}
      #onix-admin-toggle:hover{background:#a93226}
      #onix-admin-panel{position:fixed;inset:0;background:#F8F7F5;z-index:99999;overflow-y:auto;display:none;padding:32px 40px 80px;font-family:'DM Sans',sans-serif;color:#1A1A1A}
      #onix-admin-panel.open{display:block}
      .oac-hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #E8E8E8}
      .oac-hd h1{font-family:'Cormorant Garamond',serif;font-style:italic;font-weight:500;font-size:2rem;margin:0}
      .oac-hd .sub{font-size:.72rem;color:#888;text-transform:uppercase;letter-spacing:.12em;margin-top:4px}
      .oac-close{background:#1A1A1A;color:#fff;padding:8px 16px;border:none;border-radius:2px;font:600 .72rem/1 'DM Sans',sans-serif;text-transform:uppercase;letter-spacing:.1em;cursor:pointer}
      .oac-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}
      .oac-card{background:#fff;border:1px solid #E8E8E8;border-top:3px solid #C0392B;padding:20px 24px}
      .oac-card.full{grid-column:1/-1}
      .oac-card h2{font-family:'Cormorant Garamond',serif;font-style:italic;font-weight:500;font-size:1.3rem;margin:0 0 4px}
      .oac-card .ttl-sub{font-size:.65rem;color:#888;text-transform:uppercase;letter-spacing:.12em;margin-bottom:16px}
      .oac-kpi-row{display:flex;gap:24px;margin-bottom:12px}
      .oac-kpi{flex:1}
      .oac-kpi .l{font-size:.62rem;color:#888;text-transform:uppercase;letter-spacing:.1em;font-weight:600;margin-bottom:4px}
      .oac-kpi .v{font-family:'Cormorant Garamond',serif;font-size:1.6rem;color:#C0392B;font-weight:500;line-height:1}
      .oac-table{width:100%;border-collapse:collapse;font-size:.82rem}
      .oac-table th{background:#C0392B;color:#fff;text-align:left;padding:8px 10px;font-size:.65rem;letter-spacing:.1em;text-transform:uppercase;font-weight:700}
      .oac-table td{padding:10px;border-bottom:1px solid #f4f4f4;vertical-align:middle}
      .oac-table tr:nth-child(even) td{background:#FAE8E8}
      .oac-empty{text-align:center;padding:24px;color:#888;font-style:italic}
      .oac-badge{display:inline-block;padding:2px 8px;font-size:.62rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;border-radius:2px}
      .oac-badge.active{background:#EBF5EB;color:#2D6A2D}
      .oac-badge.pending{background:#FDF5E6;color:#A07818}
      .oac-badge.rejected{background:#FDF0EE;color:#C0392B}
      .oac-badge.open{background:#EBF5EB;color:#2D6A2D}
      .oac-badge.closed{background:#f4f4f4;color:#888}
      .oac-btn{padding:6px 12px;font:600 .68rem/1 'DM Sans',sans-serif;text-transform:uppercase;letter-spacing:.08em;border:1px solid transparent;border-radius:2px;cursor:pointer;margin-right:4px}
      .oac-btn.red{background:#C0392B;color:#fff;border-color:#C0392B}.oac-btn.red:hover{background:#a93226}
      .oac-btn.outline{background:#fff;color:#1A1A1A;border-color:#E8E8E8}.oac-btn.outline:hover{border-color:#C0392B;color:#C0392B}
      .oac-btn.danger{background:#fff;color:#C0392B;border-color:#C0392B}.oac-btn.danger:hover{background:#FDF0EE}
      .oac-btn:disabled{opacity:.5;cursor:default}
      .oac-tabs{display:flex;gap:0;margin-bottom:18px;border-bottom:1px solid #E8E8E8}
      .oac-tab{padding:10px 18px;font:600 .72rem/1 'DM Sans',sans-serif;text-transform:uppercase;letter-spacing:.1em;color:#888;cursor:pointer;background:none;border:none;border-bottom:2px solid transparent;margin-bottom:-1px}
      .oac-tab.active{color:#C0392B;border-bottom-color:#C0392B}
      .oac-section{display:none}
      .oac-section.active{display:block}
      .oac-modal-backdrop{position:fixed;inset:0;background:rgba(26,26,26,.55);z-index:100000;display:none;align-items:center;justify-content:center;padding:24px}
      .oac-modal-backdrop.open{display:flex}
      .oac-modal{background:#fff;max-width:720px;width:100%;max-height:88vh;overflow-y:auto;border:1px solid #E8E8E8;border-top:3px solid #C0392B;padding:28px 32px}
      .oac-modal h2{font-family:'Cormorant Garamond',serif;font-style:italic;font-weight:500;font-size:1.6rem;margin:0 0 4px}
      .oac-modal .sub{font-size:.7rem;color:#888;text-transform:uppercase;letter-spacing:.12em;margin-bottom:18px}
      .oac-modal-row{display:grid;grid-template-columns:1fr 1fr;gap:14px 24px;margin-bottom:18px}
      .oac-modal-row .k{font-size:.62rem;color:#888;letter-spacing:.1em;text-transform:uppercase;font-weight:700;margin-bottom:2px}
      .oac-modal-row .v{font-size:.92rem;color:#1A1A1A;font-weight:500}
      .oac-modal-docs h3{font-size:.7rem;letter-spacing:.12em;text-transform:uppercase;color:#1A1A1A;font-weight:700;margin:8px 0 10px;padding-top:14px;border-top:1px solid #E8E8E8}
      .oac-modal-docs .row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f4f4f4}
      .oac-modal-docs a{color:#C0392B;font-weight:600;font-size:.85rem;text-decoration:none}
      .oac-modal-foot{margin-top:20px;display:flex;justify-content:flex-end;gap:8px;padding-top:14px;border-top:1px solid #E8E8E8}
    `;
    document.head.appendChild(s);
  }

  // ---------- detail modal ----------
  function ensureModal() {
    let m = document.getElementById('oac-modal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'oac-modal';
    m.className = 'oac-modal-backdrop';
    m.innerHTML = `<div class="oac-modal" role="dialog" aria-modal="true">
      <div data-modal-body></div>
      <div class="oac-modal-foot">
        <button class="oac-btn outline" data-modal-close>Close</button>
      </div>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => {
      if (e.target === m || e.target.hasAttribute('data-modal-close')) m.classList.remove('open');
    });
    return m;
  }

  function openModal(html) {
    const m = ensureModal();
    m.querySelector('[data-modal-body]').innerHTML = html;
    wireMoneyInputs(m);
    m.classList.add('open');
  }

  // ---------- live thousands-separator on money inputs ----------
  // Any <input data-money="1"> gets reformatted on every keystroke into
  // "1,234,567.89" form. Submission handlers (numOrNull etc.) already strip
  // commas before parsing, so the underlying numeric value is unchanged.
  function formatMoneyString(raw) {
    const cleaned = String(raw == null ? '' : raw).replace(/[^0-9.]/g, '');
    const dot = cleaned.indexOf('.');
    const intRaw = dot === -1 ? cleaned : cleaned.slice(0, dot);
    const decRaw = dot === -1 ? null : cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2);
    const intClean = intRaw.replace(/^0+(?=\d)/, ''); // strip leading zeros but keep a single "0"
    const intFormatted = intClean.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return intFormatted + (decRaw == null ? '' : '.' + decRaw);
  }

  function wireMoneyInput(input) {
    if (!input || input.__moneyWired) return;
    input.__moneyWired = true;
    // Some places still emit type=number which forbids commas — switch to text.
    if (input.type === 'number') {
      input.type = 'text';
      if (!input.getAttribute('inputmode')) input.setAttribute('inputmode', 'decimal');
    }
    // Pre-format any initial value (edit modals)
    if (input.value) input.value = formatMoneyString(input.value);
    input.addEventListener('input', () => {
      const raw = input.value;
      const caret = input.selectionStart != null ? input.selectionStart : raw.length;
      const beforeCaret = (raw.slice(0, caret).match(/[0-9.]/g) || []).length;
      const formatted = formatMoneyString(raw);
      if (formatted !== raw) {
        input.value = formatted;
        let pos = 0, seen = 0;
        while (pos < formatted.length && seen < beforeCaret) {
          if (/[0-9.]/.test(formatted[pos])) seen++;
          pos++;
        }
        try { input.setSelectionRange(pos, pos); } catch (_) {}
      }
    });
  }

  function wireMoneyInputs(scope) {
    (scope || document).querySelectorAll('input[data-money]').forEach(wireMoneyInput);
  }

  function detailRow(k, v) {
    return `<div><div class="k">${esc(k)}</div><div class="v">${v == null || v === '' ? '—' : esc(v)}</div></div>`;
  }

  function docsBlock(title, docs) {
    if (!docs || !docs.length) return '';
    return `<div class="oac-modal-docs"><h3>${esc(title)}</h3>${docs.map(d => `
      <div class="row">
        <div>${esc(d.name)}</div>
        ${d.dropbox_url ? `<a href="${esc(d.dropbox_url)}" target="_blank" rel="noopener">Open ↗</a>` : '<span style="color:#888;font-size:.8rem">—</span>'}
      </div>`).join('')}</div>`;
  }

  function viewLoan(loan) {
    const c = loan.profiles || {};
    // Shared with the Active Deposits tab (paintActiveDepositsView), whose
    // rows are OUS-synced deposits, not loans — label the modal accordingly
    // so it doesn't call a client's deposit a "Loan".
    const isDeposit = loan.data_source === 'ous_pasiva';
    openModal(`
      <h2>${isDeposit ? 'Deposit' : 'Loan'} ${esc(loan.loan_id_display || loan.id.slice(0,8))}</h2>
      <div class="sub">${esc(up(c.full_name) || c.email || 'Unknown client')}</div>
      <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
        <a href="#" data-add-payment style="display:inline-block;background:#fff;color:#1A1A1A;padding:8px 14px;font:600 .7rem/1 'DM Sans',sans-serif;text-transform:uppercase;letter-spacing:.08em;border:1px solid #E8E8E8;border-radius:2px;text-decoration:none">+ Add Payment</a>
      </div>
      <div class="oac-modal-row">
        ${detailRow('Balance', fmt.money(loan.balance))}
        ${detailRow('Interest Rate', fmt.pct(loan.interest_rate))}
        ${detailRow('Monthly Payment', fmt.money(loan.monthly_payment))}
        ${detailRow('Next Due', fmt.date(loan.next_due_date))}
        ${detailRow('Origination Date', fmt.date(loan.origination_date))}
        ${detailRow('Maturity Date', fmt.date(loan.maturity_date))}
        ${detailRow('Term (months)', loan.term_months)}
        ${detailRow('Origination Fee', loan.origination_fee != null ? loan.origination_fee + '%' : null)}
        ${detailRow('Status', loan.status)}
        ${detailRow('Created', fmt.date(loan.created_at))}
      </div>
      <div class="oac-modal-row" style="grid-template-columns:1fr">
        ${detailRow('Collateral Address', loan.collateral_address)}
      </div>
      ${docsManagerHtml(loan.loan_documents, 'loan')}
      ${loan.application_id ? `
        <div style="margin-top:18px">
          <h3 style="font-size:.7rem;letter-spacing:.14em;text-transform:uppercase;color:#1A1A1A;font-weight:700;margin:0 0 10px;padding-top:14px;border-top:1px solid #E8E8E8">Application Documents</h3>
          <div id="oac-loan-app-docs" style="display:flex;flex-direction:column;gap:6px"></div>
        </div>` : ''}
    `);
    const m = document.getElementById('oac-modal');
    m.querySelector('[data-add-payment]').addEventListener('click', (e) => { e.preventDefault(); openAddPaymentModal(loan); });
    wireDocsManager(m, 'loan_documents', 'loan_id', loan.id);
    if (loan.application_id) {
      loadAndRenderAppDocs(m.querySelector('#oac-loan-app-docs'), loan.application_id);
    }
  }

  function viewInvestment(inv) {
    const c = inv.profiles || {};
    const clientName = up(c.full_name) || c.email || 'Unknown client';
    openModal(`
      <h2>${esc(inv.venture_name)}</h2>
      <div class="sub">${esc(clientName)}</div>
      <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
        <a href="#" data-edit-inv style="display:inline-block;background:#C0392B;color:#fff;padding:8px 14px;font:600 .7rem/1 'DM Sans',sans-serif;text-transform:uppercase;letter-spacing:.08em;border:1px solid #C0392B;border-radius:2px;text-decoration:none">Edit Investment</a>
        <a href="#" data-add-dist style="display:inline-block;background:#fff;color:#1A1A1A;padding:8px 14px;font:600 .7rem/1 'DM Sans',sans-serif;text-transform:uppercase;letter-spacing:.08em;border:1px solid #E8E8E8;border-radius:2px;text-decoration:none">+ Add Distribution</a>
      </div>
      <div class="oac-tabs">
        <button type="button" class="oac-tab active" data-inv-tab="investment">Investment</button>
        <button type="button" class="oac-tab" data-inv-tab="investor">Investor Profile</button>
      </div>
      <div class="oac-section active" data-inv-section="investment">
        <div class="oac-modal-row">
          ${detailRow('Type', inv.venture_type)}
          ${detailRow('Amount Invested', fmt.money(inv.amount_invested))}
          ${detailRow('Ownership', inv.ownership_pct != null ? fmt.pct(inv.ownership_pct) : null)}
          ${detailRow('Expected Return', inv.expected_return != null ? fmt.pct(inv.expected_return) : null)}
          ${detailRow('Start Date', fmt.date(inv.start_date))}
          ${detailRow('Status', inv.status)}
          ${detailRow('Created', fmt.date(inv.created_at))}
        </div>
        ${docsManagerHtml(inv.investment_documents, 'investment')}
      </div>
      <div class="oac-section" data-inv-section="investor">
        <div id="oac-inv-investor-body" style="padding:10px 0;color:#9B9590;font-size:.84rem">Loading investor profile…</div>
      </div>
    `);
    const m = document.getElementById('oac-modal');
    m.querySelector('[data-edit-inv]').addEventListener('click', (e) => { e.preventDefault(); openEditInvestmentModal(inv); });
    m.querySelector('[data-add-dist]').addEventListener('click', (e) => { e.preventDefault(); openAddDistributionModal(inv); });
    wireDocsManager(m, 'investment_documents', 'investment_id', inv.id);

    // Tab switching — toggle .active on tab buttons and .oac-section panes
    m.querySelectorAll('[data-inv-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        const key = tab.dataset.invTab;
        m.querySelectorAll('[data-inv-tab]').forEach(t => t.classList.toggle('active', t === tab));
        m.querySelectorAll('[data-inv-section]').forEach(s => s.classList.toggle('active', s.dataset.invSection === key));
      });
    });

    loadInvestorProfileInto(m.querySelector('#oac-inv-investor-body'), inv.user_id, inv.id);
  }

  // Render an investor profile block inside the Investor tab of the investment
  // modal: profile info + an aggregated portfolio summary across all of that
  // user's investments, plus distribution totals from public.distributions.
  async function loadInvestorProfileInto(container, userId, currentInvId) {
    if (!container || !userId) return;
    const [pRes, iRes] = await Promise.all([
      OnixDB.client.from('profiles').select('id, full_name, email, status, created_at').eq('id', userId).single(),
      OnixDB.client.from('investments').select('id, venture_name, venture_type, amount_invested, status, expected_return, ownership_pct').eq('user_id', userId).order('created_at', { ascending: false })
    ]);
    if (pRes.error) {
      container.innerHTML = '<div style="color:#C0392B;font-size:.84rem">Could not load profile: ' + esc(pRes.error.message) + '</div>';
      return;
    }
    const p    = pRes.data || {};
    const invs = iRes.data || [];
    const activeInvs = invs.filter(x => x.status !== 'exited');
    const committed  = activeInvs.reduce((s, x) => s + Number(x.amount_invested || 0), 0);

    let totalDistributions = 0;
    let ytdDistributions   = 0;
    const invIds = invs.map(x => x.id);
    if (invIds.length) {
      const { data: dist } = await OnixDB.client
        .from('distributions')
        .select('amount, paid_at')
        .in('investment_id', invIds);
      const yearStart = new Date(new Date().getFullYear(), 0, 1);
      (dist || []).forEach(d => {
        const amt = Number(d.amount || 0);
        totalDistributions += amt;
        if (d.paid_at && new Date(d.paid_at) >= yearStart) ytdDistributions += amt;
      });
    }

    const statusLabel = p.status ? (p.status.charAt(0).toUpperCase() + p.status.slice(1)) : '—';
    const since = p.created_at ? String(new Date(p.created_at).getFullYear()) : '—';

    container.innerHTML = `
      <div class="oac-modal-row">
        ${detailRow('Name', up(p.full_name) || '—')}
        ${detailRow('Email', p.email || '—')}
        ${detailRow('Status', statusLabel)}
        ${detailRow('Investor Since', since)}
        ${detailRow('Capital Committed', fmt.money(committed))}
        ${detailRow('Active Deals', String(activeInvs.length))}
        ${detailRow('Total Distributions', fmt.money(totalDistributions))}
        ${detailRow('YTD Distributions', fmt.money(ytdDistributions))}
      </div>
      <h3 style="font-size:.7rem;letter-spacing:.14em;text-transform:uppercase;color:#1A1A1A;font-weight:700;margin:18px 0 10px;padding-top:14px;border-top:1px solid #E8E8E8">All Investments (${invs.length})</h3>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${invs.length ? invs.map(x => {
          const isCurrent = x.id === currentInvId;
          return `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;background:${isCurrent ? '#FDF0EE' : '#F8F7F5'};border-left:3px solid #C0392B">
            <div style="min-width:0">
              <div style="font-size:.86rem;font-weight:600">${esc(x.venture_name || '—')}${isCurrent ? ' <span style="font-size:.62rem;letter-spacing:.12em;text-transform:uppercase;color:#C0392B;font-weight:700;margin-left:6px">Viewing</span>' : ''}</div>
              <div style="font-size:.7rem;color:#9B9590;margin-top:2px">${esc(x.venture_type || '—')} · ${esc(x.status || '—')}${x.expected_return != null ? ' · ' + fmt.pct(x.expected_return) + ' expected' : ''}</div>
            </div>
            <div style="font-size:.84rem;font-weight:700;white-space:nowrap">${fmt.money(x.amount_invested)}</div>
          </div>`;
        }).join('') : '<div style="color:#9B9590;font-style:italic;font-size:.84rem;padding:8px 0">No investments on file.</div>'}
      </div>
    `;
  }

  // Shared block: render client_documents rows tied to a given application_id.
  // Used by both viewApplication and viewLoan so the supporting docs the
  // applicant uploaded follow the application into the loan.
  async function loadAndRenderAppDocs(container, applicationId) {
    if (!container || !applicationId) return;
    container.innerHTML = '<div style="padding:10px 0;color:#9B9590;font-size:.8rem">Loading documents…</div>';
    const { data, error } = await OnixDB.client
      .from('client_documents')
      .select('id, name, storage_path, dropbox_url, uploaded_at, category')
      .eq('application_id', applicationId)
      .order('uploaded_at', { ascending: false });
    if (error) {
      container.innerHTML = '<div style="padding:10px 0;color:#C0392B;font-size:.8rem">Could not load documents: ' + esc(error.message) + '</div>';
      return;
    }
    const docs = data || [];
    if (!docs.length) {
      container.innerHTML = '<div style="padding:10px 0;color:#9B9590;font-style:italic;font-size:.8rem">No supporting documents attached.</div>';
      return;
    }
    const linkStyle = 'font-size:.66rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#C0392B;text-decoration:none;border:1px solid #C0392B;padding:6px 12px;border-radius:2px;cursor:pointer';
    container.innerHTML = docs.map(d => {
      let meta = '';
      try { meta = new Date(d.uploaded_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); } catch(_){}
      const action = d.storage_path
        ? `<a href="#" data-storage-path="${esc(d.storage_path)}" style="${linkStyle}">View ↗</a>`
        : (d.dropbox_url
            ? `<a href="${esc(d.dropbox_url)}" target="_blank" rel="noopener" style="${linkStyle}">View ↗</a>`
            : '<span style="font-size:.66rem;color:#9B9590">No link</span>');
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;background:#F8F7F5;border-left:3px solid #C0392B">
        <div style="min-width:0">
          <div style="font-size:.84rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(d.name)}</div>
          <div style="font-size:.7rem;color:#9B9590;margin-top:2px">${esc(meta)}${d.storage_path ? ' · Uploaded' : (d.dropbox_url ? ' · Dropbox' : '')}</div>
        </div>
        ${action}
      </div>`;
    }).join('');

    // Wire the storage-backed links to generate signed URLs on click.
    container.querySelectorAll('[data-storage-path]').forEach(a => {
      a.addEventListener('click', async (e) => {
        e.preventDefault();
        const path = a.getAttribute('data-storage-path');
        const orig = a.textContent;
        a.textContent = 'Opening…';
        const r = await OnixDB.client.storage.from('client-documents').createSignedUrl(path, 3600);
        a.textContent = orig;
        if (r.error || !r.data) { alert('Could not open file: ' + (r.error && r.error.message || 'unknown error')); return; }
        window.open(r.data.signedUrl, '_blank', 'noopener');
      });
    });
  }

  function viewApplication(app) {
    const c = app.profiles || {};
    const isDeposit = app.application_type === 'deposit';
    const statusBtn = (label, status, color) => `
      <a href="#" data-app-status="${esc(status)}" style="display:inline-block;background:${color === 'red' ? '#C0392B' : '#fff'};color:${color === 'red' ? '#fff' : '#1A1A1A'};padding:8px 14px;font:600 .7rem/1 'DM Sans',sans-serif;text-transform:uppercase;letter-spacing:.08em;border:1px solid ${color === 'red' ? '#C0392B' : '#E8E8E8'};border-radius:2px;text-decoration:none">${esc(label)}</a>`;
    openModal(`
      <h2>${isDeposit ? 'Deposit' : 'Loan'} Application</h2>
      <div class="sub">${esc(up(c.full_name) || c.email || 'Unknown client')} · ${fmt.date(app.submitted_at)}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
        ${statusBtn('Approve', 'approved', 'red')}
        ${statusBtn('Mark Reviewed', 'reviewed')}
        ${statusBtn('Reject', 'rejected')}
        ${statusBtn('Reset to Pending', 'pending')}
      </div>
      ${isDeposit ? `<div style="padding:10px 12px;background:#F8F7F5;border-left:3px solid #C0392B;font-size:.78rem;color:#6B6560;margin-bottom:14px">Deposit application — approving does not auto-create a loan record. Set up the deposit through your normal process, same as any other deposit.</div>` : ''}
      <div class="oac-modal-row">
        ${detailRow(isDeposit ? 'Deposit Amount' : 'Amount Requested', fmt.money(app.amount_requested))}
        ${detailRow('Applicant Type', app.applicant_type)}
        ${detailRow('Status', app.status)}
        ${detailRow('Submitted', fmt.date(app.submitted_at))}
      </div>
      ${isDeposit ? '' : `<div class="oac-modal-row" style="grid-template-columns:1fr">
        ${detailRow('Purpose', app.purpose)}
      </div>`}
      <div class="oac-modal-row" style="grid-template-columns:1fr">
        ${detailRow('Notes', app.notes)}
      </div>
      <div class="oac-modal-row" style="grid-template-columns:1fr">
        ${detailRow('Client Email', c.email)}
      </div>
      <div style="margin-top:18px">
        <h3 style="font-size:.7rem;letter-spacing:.14em;text-transform:uppercase;color:#1A1A1A;font-weight:700;margin:0 0 10px;padding-top:14px;border-top:1px solid #E8E8E8">Supporting Documents</h3>
        <div id="oac-app-docs" style="display:flex;flex-direction:column;gap:6px"></div>
      </div>
    `);
    const m = document.getElementById('oac-modal');
    loadAndRenderAppDocs(m.querySelector('#oac-app-docs'), app.id);
    m.querySelectorAll('[data-app-status]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const newStatus = btn.dataset.appStatus;
        const prevStatus = app.status;
        btn.style.opacity = '.5';

        // Approving an application should also create an active loan record —
        // but only for loan applications. A deposit application has no such
        // record to create (deposits normally arrive via the OUS Activa/
        // Pasiva sync, not a manual "Add Loan" flow); approving one just
        // updates its status below so the team knows to follow up manually.
        const isDeposit = app.application_type === 'deposit';
        if (!isDeposit && newStatus === 'approved' && prevStatus !== 'approved') {
          const created = await ensureLoanFromApplication(app);
          if (created === false) { btn.style.opacity = '1'; return; }
        }

        // Un-approving (pending/reviewed/rejected) should remove the loan that
        // was created by the previous approve, so Active Loans stays accurate.
        if (!isDeposit && prevStatus === 'approved' && newStatus !== 'approved') {
          const removed = await removeLoanFromApplication(app);
          if (removed === false) { btn.style.opacity = '1'; return; }
        }

        const { error } = await OnixDB.client.from('loan_applications').update({ status: newStatus }).eq('id', app.id);
        if (error) { alert(error.message); btn.style.opacity = '1'; return; }
        // Keep the local copy in sync so a follow-up click in the same modal
        // sees the latest status (prevents accidental duplicate work).
        app.status = newStatus;
        m.classList.remove('open');
        refreshAll();
      });
    });
  }

  // Create an Active Loan row from an approved application, if one doesn't
  // already exist. Returns true on success (or skipped because a loan already
  // exists), false on hard failure so the caller can stop.
  async function ensureLoanFromApplication(app) {
    try {
      const { data: existing, error: lookupErr } = await OnixDB.client
        .from('loans')
        .select('id')
        .eq('application_id', app.id)
        .limit(1);
      if (lookupErr) { alert('Loan lookup failed: ' + lookupErr.message); return false; }
      if (existing && existing.length) return true; // already created on a previous approve — no-op

      // Generate a human-friendly loan id like ONX-YYYY-NNNN.
      const year = new Date().getFullYear();
      const { count: yearCount, error: countErr } = await OnixDB.client
        .from('loans')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', year + '-01-01T00:00:00Z')
        .lt('created_at',  (year + 1) + '-01-01T00:00:00Z');
      if (countErr) { /* non-fatal — fall back to a uuid-based id */ }
      const seq = String((yearCount || 0) + 1).padStart(4, '0');
      const loan_id_display = 'ONX-' + year + '-' + seq;

      const today = new Date().toISOString().slice(0, 10);
      const insertRow = {
        application_id:   app.id,
        user_id:          app.user_id,
        loan_id_display,
        principal_amount: app.amount_requested,
        balance:          app.amount_requested,
        status:           'active',
        origination_date: today,
        data_source:      'manual'
      };

      const { error: insertErr } = await OnixDB.client.from('loans').insert(insertRow);
      if (insertErr) {
        alert('Loan creation failed: ' + insertErr.message + '\n\nApplication was not approved.');
        return false;
      }
      // Soft confirmation so the admin knows the loan exists and where to finish it
      console.log('[onix] Created loan ' + loan_id_display + ' from approved application ' + app.id);
      return true;
    } catch (err) {
      alert('Unexpected error creating loan: ' + (err && err.message ? err.message : err));
      return false;
    }
  }

  // Reverse of ensureLoanFromApplication: when admin moves an approved
  // application back to pending / reviewed / rejected, remove the auto-created
  // loan so Active Loans reflects reality. If the loan already has recorded
  // payments, refuse to delete and surface a clear warning — those payments
  // represent real money movement and should be handled deliberately by admin.
  async function removeLoanFromApplication(app) {
    try {
      const { data: loans, error: lookupErr } = await OnixDB.client
        .from('loans')
        .select('id, loan_id_display')
        .eq('application_id', app.id);
      if (lookupErr) { alert('Loan lookup failed: ' + lookupErr.message); return false; }
      if (!loans || !loans.length) return true; // nothing to remove

      // Check for payment activity on any of those loans
      const loanIds = loans.map(l => l.id);
      const { count: paymentCount, error: payErr } = await OnixDB.client
        .from('loan_payments')
        .select('id', { count: 'exact', head: true })
        .in('loan_id', loanIds);
      if (payErr) { alert('Payment check failed: ' + payErr.message); return false; }

      if (paymentCount && paymentCount > 0) {
        alert(
          'Cannot change status — the loan created from this application already has ' +
          paymentCount + ' payment record' + (paymentCount === 1 ? '' : 's') + '.\n\n' +
          'Delete the payments or close the loan manually first.'
        );
        return false;
      }

      const { error: delErr } = await OnixDB.client.from('loans').delete().in('id', loanIds);
      if (delErr) { alert('Loan removal failed: ' + delErr.message); return false; }
      console.log('[onix] Removed ' + loans.length + ' loan(s) tied to application ' + app.id);
      return true;
    } catch (err) {
      alert('Unexpected error removing loan: ' + (err && err.message ? err.message : err));
      return false;
    }
  }

  function viewRaise(r) {
    openModal(`
      <h2>${esc(r.venture_name)}</h2>
      <div class="sub">${esc(r.venture_type || '—')}${r.investment_horizon ? ' · ' + esc(r.investment_horizon) : ''}</div>
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <a href="#" data-edit-raise style="display:inline-block;background:#fff;color:#1A1A1A;padding:8px 14px;font:600 .7rem/1 'DM Sans',sans-serif;text-transform:uppercase;letter-spacing:.08em;border:1px solid #E8E8E8;border-radius:2px;text-decoration:none">Edit Raise</a>
        ${r.status === 'open'
          ? `<a href="#" data-close-raise style="display:inline-block;background:#C0392B;color:#fff;padding:8px 14px;font:600 .7rem/1 'DM Sans',sans-serif;text-transform:uppercase;letter-spacing:.08em;border:1px solid #C0392B;border-radius:2px;text-decoration:none">Close Raise</a>`
          : `<a href="#" data-reopen-raise style="display:inline-block;background:#fff;color:#1A1A1A;padding:8px 14px;font:600 .7rem/1 'DM Sans',sans-serif;text-transform:uppercase;letter-spacing:.08em;border:1px solid #E8E8E8;border-radius:2px;text-decoration:none">Reopen Raise</a>`}
      </div>
      <div style="font-size:.9rem;line-height:1.55;color:#1A1A1A;margin-bottom:18px">${esc(r.description || 'No description provided.')}</div>
      <div class="oac-modal-row">
        ${detailRow('Total Raise', fmt.money(r.total_raise_target))}
        ${detailRow('Amount Raised', fmt.money(r.amount_raised))}
        ${detailRow('Minimum', fmt.money(r.minimum_investment))}
        ${detailRow('Projected Return', (r.projected_return_min != null && r.projected_return_max != null) ? r.projected_return_min + '–' + r.projected_return_max + '%' : null)}
        ${detailRow('Investment Horizon', r.investment_horizon)}
        ${detailRow('Structure', r.structure)}
        ${detailRow('Status', r.status)}
        ${detailRow('Created', fmt.date(r.created_at))}
      </div>
      ${docsManagerHtml(r.raise_documents, 'raise')}
    `);
    const m = document.getElementById('oac-modal');
    m.querySelector('[data-edit-raise]').addEventListener('click', (e) => { e.preventDefault(); openEditRaiseModal(r); });
    const close = m.querySelector('[data-close-raise]');
    if (close) close.addEventListener('click', async (e) => {
      e.preventDefault();
      if (!confirm('Close this raise? Clients will no longer see it in Opportunities.')) return;
      const { error } = await OnixDB.client.from('raises').update({ status: 'closed' }).eq('id', r.id);
      if (error) return alert(error.message);
      document.getElementById('oac-modal').classList.remove('open');
      refreshAll();
    });
    const reopen = m.querySelector('[data-reopen-raise]');
    if (reopen) reopen.addEventListener('click', async (e) => {
      e.preventDefault();
      const { error } = await OnixDB.client.from('raises').update({ status: 'open' }).eq('id', r.id);
      if (error) return alert(error.message);
      document.getElementById('oac-modal').classList.remove('open');
      refreshAll();
    });
    wireDocsManager(m, 'raise_documents', 'raise_id', r.id);
  }

  function contactBtn(email, label) {
    if (!email) return '<button class="oac-btn outline" disabled>No email</button>';
    return `<a class="oac-btn outline" href="mailto:${esc(email)}${label ? '?subject=' + encodeURIComponent(label) : ''}">Contact</a>`;
  }

  // ---------- panel scaffold ----------
  // The Live Admin Console drawer has been retired. Every drawer tab was a
  // duplicate of a static admin tab that we already paint live. The Pending
  // Approvals queue is the one piece of unique functionality, and it now lives
  // as a banner at the top of the Clients tab (see paintClientsView).
  // This function and the related render*() helpers below are kept as no-ops
  // so any stray references don't throw — they can be deleted in a later sweep.
  function buildPanel() {
    // Clean up any drawer artifacts that may exist from a previous load
    const t = document.getElementById('onix-admin-toggle'); if (t) t.remove();
    const p = document.getElementById('onix-admin-panel');  if (p) p.remove();
  }

  // ---------- renderers ----------
  function renderOverview(data) {
    const { clients, pending, loans, investments, raises, applications } = data;
    const activeLoanBal = loans.filter(l => l.status === 'active').reduce((s, l) => s + Number(l.balance || 0), 0);
    const totalInvested = investments.filter(i => i.status === 'active').reduce((s, i) => s + Number(i.amount_invested || 0), 0);
    const totalRaiseGoal = raises.filter(r => r.status === 'open').reduce((s, r) => s + Number(r.total_raise_target || 0), 0);
    const totalRaised = raises.filter(r => r.status === 'open').reduce((s, r) => s + Number(r.amount_raised || 0), 0);

    document.getElementById('oac-overview').innerHTML = `
      <div class="oac-card">
        <h2>Loan Portfolio</h2><div class="ttl-sub">Active loans</div>
        <div class="oac-kpi-row">
          <div class="oac-kpi"><div class="l">Outstanding</div><div class="v">${fmt.money(activeLoanBal)}</div></div>
          <div class="oac-kpi"><div class="l">Active loans</div><div class="v">${loans.filter(l => l.status === 'active').length}</div></div>
        </div>
      </div>
      <div class="oac-card">
        <h2>Investments</h2><div class="ttl-sub">Active client positions</div>
        <div class="oac-kpi-row">
          <div class="oac-kpi"><div class="l">Total invested</div><div class="v">${fmt.money(totalInvested)}</div></div>
          <div class="oac-kpi"><div class="l">Positions</div><div class="v">${investments.filter(i => i.status === 'active').length}</div></div>
        </div>
      </div>
      <div class="oac-card">
        <h2>Open Raises</h2><div class="ttl-sub">Capital being raised right now</div>
        <div class="oac-kpi-row">
          <div class="oac-kpi"><div class="l">Goal</div><div class="v">${fmt.money(totalRaiseGoal)}</div></div>
          <div class="oac-kpi"><div class="l">Raised</div><div class="v">${fmt.money(totalRaised)}</div></div>
          <div class="oac-kpi"><div class="l">Active raises</div><div class="v">${raises.filter(r => r.status === 'open').length}</div></div>
        </div>
      </div>
      <div class="oac-card">
        <h2>Clients</h2><div class="ttl-sub">Account status snapshot</div>
        <div class="oac-kpi-row">
          <div class="oac-kpi"><div class="l">Total</div><div class="v">${clients.length}</div></div>
          <div class="oac-kpi"><div class="l">Pending</div><div class="v">${pending.length}</div></div>
          <div class="oac-kpi"><div class="l">Applications</div><div class="v">${applications.length}</div></div>
        </div>
      </div>`;
  }

  // Render the Investment Interest tab in the Live Admin Console.
  // Shows every row from raise_interests joined with the client + raise,
  // newest first. For status='new' rows, Approve / Decline buttons appear
  // and dispatch to OnixDB.setRaiseInterestStatus.
  function renderInterests(interests) {
    const el = document.getElementById('oac-interests');
    if (!el) return;
    const list = Array.isArray(interests) ? interests : [];

    // Tab label: count of NEW (un-actioned) interests, surfaced as a red pill
    const tabBtn = document.getElementById('oac-tab-interests');
    if (tabBtn) {
      const newCount = list.filter(i => i.status === 'new').length;
      tabBtn.innerHTML = 'Investment Interest' +
        (newCount > 0
          ? ` <span style="display:inline-block;margin-left:6px;padding:1px 7px;background:#C0392B;color:#fff;border-radius:10px;font-size:.6rem;font-weight:700;letter-spacing:.04em">${newCount} new</span>`
          : '');
    }

    if (!list.length) { el.innerHTML = '<div class="oac-empty">No expressed interests yet.</div>'; return; }

    const statusBadge = (s) => {
      const map = {
        new:      ['#FAE8E8', '#C0392B', 'New'],
        approved: ['#EBF5EB', '#3B8B3B', 'Approved'],
        declined: ['#F0F0F0', '#888',    'Declined']
      };
      const [bg, fg, label] = map[s] || ['#F0F0F0', '#888', s || '—'];
      return `<span style="display:inline-block;padding:2px 8px;background:${bg};color:${fg};font-size:.62rem;letter-spacing:.1em;text-transform:uppercase;font-weight:700;border-radius:2px">${label}</span>`;
    };

    el.innerHTML = `
      <table class="oac-table"><thead><tr>
        <th>Client</th><th>Raise</th><th>Amount</th><th>Contact</th><th>Notes</th><th>Expressed</th><th>Status</th><th style="text-align:right">Actions</th>
      </tr></thead><tbody>${list.map(i => {
        const p = i.profiles || {};
        const r = i.raises || {};
        const canAct = i.status === 'new';
        const contactBits = [i.contact_method, i.best_time].filter(Boolean).join(' · ');
        return `
        <tr data-int-id="${esc(i.id)}">
          <td><div style="font-weight:600">${esc(up(p.full_name) || '—')}</div><div style="font-size:.74rem;color:#888">${esc(p.email || '—')}</div></td>
          <td>${esc(r.venture_name || '—')}${r.venture_type ? `<div style="font-size:.74rem;color:#888">${esc(r.venture_type)}</div>` : ''}</td>
          <td>${i.amount != null ? fmt.money(i.amount) : '—'}${r.minimum_investment != null ? `<div style="font-size:.74rem;color:#888">min ${fmt.money(r.minimum_investment)}</div>` : ''}</td>
          <td style="font-size:.82rem">${contactBits ? esc(contactBits) : '<span style="color:#9B9590">—</span>'}</td>
          <td style="font-size:.82rem;max-width:240px">${i.notes ? esc(i.notes) : '<span style="color:#9B9590">—</span>'}</td>
          <td>${fmt.date(i.submitted_at)}</td>
          <td>${statusBadge(i.status)}</td>
          <td style="text-align:right;white-space:nowrap">
            ${p.email ? `<a class="oac-btn outline" style="font-size:.66rem" href="mailto:${esc(p.email)}?subject=${encodeURIComponent('Onix Finance · ' + (r.venture_name || 'investment opportunity'))}">Contact</a>` : ''}
            ${canAct
              ? `<button class="oac-btn red"    data-int-act="approve" data-int-id="${esc(i.id)}">Approve</button>
                 <button class="oac-btn danger" data-int-act="decline" data-int-id="${esc(i.id)}">Decline</button>`
              : ''}
          </td>
        </tr>`;
      }).join('')}</tbody></table>`;

    // Build an id->interest lookup so the click handler has the full row
    // (raise + amount + previous status), not just the id.
    const byId = new Map(list.map(i => [i.id, i]));

    el.querySelectorAll('[data-int-act]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id  = btn.dataset.intId;
        const act = btn.dataset.intAct;
        const interest = byId.get(id);
        if (!interest) return;
        const newStatus  = act === 'approve' ? 'approved' : 'declined';
        const prevStatus = interest.status;
        const row = el.querySelector(`tr[data-int-id="${id}"]`);
        if (row) row.querySelectorAll('button').forEach(b => b.disabled = true);

        // Approving creates the matching Investment row (parallel to how
        // approving a loan application creates an Active Loan).
        if (newStatus === 'approved' && prevStatus !== 'approved') {
          const created = await ensureInvestmentFromInterest(interest);
          if (created === false) {
            if (row) row.querySelectorAll('button').forEach(b => b.disabled = false);
            return;
          }
        }
        // Un-approving (decline) removes the auto-created investment, unless
        // it already has distribution activity — in which case refuse so the
        // admin handles it deliberately.
        if (prevStatus === 'approved' && newStatus !== 'approved') {
          const removed = await removeInvestmentFromInterest(interest);
          if (removed === false) {
            if (row) row.querySelectorAll('button').forEach(b => b.disabled = false);
            return;
          }
        }

        const ok = await OnixDB.setRaiseInterestStatus(id, newStatus);
        if (ok) { refreshAll(); }
        else { alert('Could not ' + act + ' interest.'); if (row) row.querySelectorAll('button').forEach(b => b.disabled = false); }
      });
    });
  }

  // Create an Investment row from an approved interest, if one doesn't
  // already exist. Returns true on success or skip-because-exists, false on
  // hard failure so the caller can stop.
  async function ensureInvestmentFromInterest(interest) {
    try {
      const { data: existing, error: lookupErr } = await OnixDB.client
        .from('investments')
        .select('id')
        .eq('interest_id', interest.id)
        .limit(1);
      if (lookupErr) { alert('Investment lookup failed: ' + lookupErr.message); return false; }
      if (existing && existing.length) return true;

      const r = interest.raises || {};
      // Use the high end of the projected range as the expected return; fall
      // back to the low end, then null. The admin can edit this later via the
      // existing Edit modal on the investments table.
      const expected =
        r.projected_return_max != null ? r.projected_return_max :
        r.projected_return_min != null ? r.projected_return_min : null;

      const insertRow = {
        interest_id:     interest.id,
        user_id:         interest.user_id,
        venture_name:    r.venture_name || 'Unnamed Investment',
        venture_type:    r.venture_type || null,
        amount_invested: interest.amount != null ? interest.amount : null,
        expected_return: expected,
        start_date:      new Date().toISOString().slice(0, 10),
        status:          'active'
      };

      const { error: insertErr } = await OnixDB.client.from('investments').insert(insertRow);
      if (insertErr) {
        alert('Investment creation failed: ' + insertErr.message + '\n\nInterest was not approved.');
        return false;
      }
      console.log('[onix] Created investment from approved interest ' + interest.id);
      return true;
    } catch (err) {
      alert('Unexpected error creating investment: ' + (err && err.message ? err.message : err));
      return false;
    }
  }

  // Reverse: when admin moves an approved interest to declined (or back to
  // 'new'), drop the investment that was created. Safety guard: refuse if
  // that investment has any distribution activity.
  async function removeInvestmentFromInterest(interest) {
    try {
      const { data: invs, error: lookupErr } = await OnixDB.client
        .from('investments')
        .select('id, venture_name')
        .eq('interest_id', interest.id);
      if (lookupErr) { alert('Investment lookup failed: ' + lookupErr.message); return false; }
      if (!invs || !invs.length) return true;

      const invIds = invs.map(i => i.id);
      // distributions table exists in this schema — check for any rows tied to these investments
      const { count: distCount, error: distErr } = await OnixDB.client
        .from('distributions')
        .select('id', { count: 'exact', head: true })
        .in('investment_id', invIds);
      if (distErr) { alert('Distribution check failed: ' + distErr.message); return false; }
      if (distCount && distCount > 0) {
        alert(
          'Cannot change status — the investment created from this interest already has ' +
          distCount + ' distribution record' + (distCount === 1 ? '' : 's') + '.\n\n' +
          'Delete the distributions or close the investment manually first.'
        );
        return false;
      }

      const { error: delErr } = await OnixDB.client.from('investments').delete().in('id', invIds);
      if (delErr) { alert('Investment removal failed: ' + delErr.message); return false; }
      console.log('[onix] Removed ' + invs.length + ' investment(s) tied to interest ' + interest.id);
      return true;
    } catch (err) {
      alert('Unexpected error removing investment: ' + (err && err.message ? err.message : err));
      return false;
    }
  }

  function renderApprovals(pending) {
    const el = document.getElementById('oac-approvals');
    if (!pending.length) { el.innerHTML = '<div class="oac-empty">No pending approvals.</div>'; return; }
    const bulkBar = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px">
        <label style="font-size:.78rem;color:#1A1A1A;display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="oac-pending-selectall" style="width:16px;height:16px;cursor:pointer">
          <span><span id="oac-pending-count">0</span> selected</span>
        </label>
        <div style="display:flex;gap:8px">
          <button class="oac-btn red"    id="oac-bulk-approve" disabled>Approve Selected</button>
          <button class="oac-btn danger" id="oac-bulk-reject"  disabled>Reject Selected</button>
        </div>
      </div>`;
    el.innerHTML = bulkBar + `
      <table class="oac-table"><thead><tr>
        <th style="width:32px"></th><th>Name</th><th>Email</th><th>Submitted</th><th style="text-align:right">Actions</th>
      </tr></thead><tbody>${pending.map(p => `
        <tr data-id="${esc(p.id)}">
          <td><input type="checkbox" class="oac-pending-check" data-id="${esc(p.id)}" style="width:16px;height:16px;cursor:pointer"></td>
          <td>${esc(up(p.full_name) || '—')}</td>
          <td>${esc(p.email)}</td>
          <td>${fmt.date(p.created_at)}</td>
          <td style="text-align:right">
            <button class="oac-btn red"     data-act="approve" data-id="${esc(p.id)}">Approve</button>
            <button class="oac-btn danger"  data-act="reject"  data-id="${esc(p.id)}">Reject</button>
          </td>
        </tr>`).join('')}</tbody></table>`;

    // Bulk selection wiring
    const selectAll = el.querySelector('#oac-pending-selectall');
    const countEl   = el.querySelector('#oac-pending-count');
    const bulkApprove = el.querySelector('#oac-bulk-approve');
    const bulkReject  = el.querySelector('#oac-bulk-reject');
    const checkboxes  = () => Array.from(el.querySelectorAll('.oac-pending-check'));
    const updateCount = () => {
      const n = checkboxes().filter(c => c.checked).length;
      countEl.textContent = String(n);
      bulkApprove.disabled = n === 0;
      bulkReject.disabled  = n === 0;
      // Update select-all state
      const all = checkboxes();
      selectAll.checked = n > 0 && n === all.length;
      selectAll.indeterminate = n > 0 && n < all.length;
    };
    selectAll.addEventListener('change', () => {
      checkboxes().forEach(c => { c.checked = selectAll.checked; });
      updateCount();
    });
    checkboxes().forEach(c => c.addEventListener('change', updateCount));

    async function bulkProcess(action) {
      const ids = checkboxes().filter(c => c.checked).map(c => c.dataset.id);
      if (!ids.length) return;
      if (!confirm(`${action === 'approve' ? 'Approve' : 'Reject'} ${ids.length} client${ids.length === 1 ? '' : 's'}?`)) return;
      bulkApprove.disabled = true; bulkReject.disabled = true;
      let ok = 0, failed = 0;
      const fn = action === 'approve' ? OnixDB.approveClient : OnixDB.rejectClient;
      for (const id of ids) {
        const clientRow = pending.find(p => p.id === id);
        const success = await fn(id);
        if (success) {
          ok++;
          if (action === 'approve' && clientRow && clientRow.email) {
            OnixDB.client.functions.invoke('send-account-activated-email', {
              body: { full_name: clientRow.full_name || '', email: clientRow.email }
            }).catch(err => console.error('[onix-admin] activation email failed:', err));
          }
        } else {
          failed++;
        }
      }
      if (failed > 0) alert(`${ok} succeeded, ${failed} failed. See console for details.`);
      refreshAll();
    }
    bulkApprove.addEventListener('click', () => bulkProcess('approve'));
    bulkReject.addEventListener('click', () => bulkProcess('reject'));

    el.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const act = btn.dataset.act;
        const fn  = act === 'approve' ? OnixDB.approveClient : OnixDB.rejectClient;
        const row = el.querySelector(`tr[data-id="${id}"]`);
        if (row) row.querySelectorAll('button').forEach(b => b.disabled = true);
        const clientRow = pending.find(p => p.id === id);
        const ok = await fn(id);
        if (ok) {
          // Notify the client by email that their account is now active.
          if (act === 'approve' && clientRow && clientRow.email) {
            OnixDB.client.functions.invoke('send-account-activated-email', {
              body: { full_name: clientRow.full_name || '', email: clientRow.email }
            }).catch(err => console.error('[onix-admin] activation email failed:', err));
          }
          if (row) row.remove();
          refreshAll();
        }
        else { alert('Could not ' + act + ' client.'); if (row) row.querySelectorAll('button').forEach(b => b.disabled = false); }
      });
    });
  }

  function renderClients(clients) {
    const el = document.getElementById('oac-clients');
    if (!clients.length) { el.innerHTML = '<div class="oac-empty">No clients yet.</div>'; return; }
    el.innerHTML = `
      <table class="oac-table"><thead><tr>
        <th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Joined</th>
      </tr></thead><tbody>${clients.map(c => `
        <tr>
          <td>${esc(up(c.full_name) || '—')}</td>
          <td>${esc(c.email)}</td>
          <td>${esc(c.role)}</td>
          <td><span class="oac-badge ${esc(c.status || '')}">${esc(c.status || '—')}</span></td>
          <td>${fmt.date(c.created_at)}</td>
        </tr>`).join('')}</tbody></table>`;
  }

  function renderApplications(apps) {
    const el = document.getElementById('oac-applications');
    if (!apps.length) { el.innerHTML = '<div class="oac-empty">No applications submitted yet.</div>'; return; }
    el.innerHTML = `
      <table class="oac-table"><thead><tr>
        <th>Submitted</th><th>Client</th><th>Amount</th><th>Type</th><th>Purpose</th><th>Status</th>
      </tr></thead><tbody>${apps.map(a => `
        <tr>
          <td>${fmt.date(a.submitted_at)}</td>
          <td>${esc((a.profiles && (up(a.profiles.full_name) || a.profiles.email)) || a.user_id)}</td>
          <td>${fmt.money(a.amount_requested)}</td>
          <td>${esc(a.applicant_type || '—')}</td>
          <td>${esc(a.purpose || '—')}</td>
          <td><span class="oac-badge ${esc(a.status || '')}">${esc(a.status || '—')}</span></td>
        </tr>`).join('')}</tbody></table>`;
  }

  function renderLoans(loans) {
    const el = document.getElementById('oac-loans');
    if (!loans.length) { el.innerHTML = '<div class="oac-empty">No loans yet.</div>'; return; }
    el.innerHTML = `
      <table class="oac-table"><thead><tr>
        <th>Loan ID</th><th>Client</th><th>Balance</th><th>Rate</th><th>Payment</th><th>Next Due</th><th>Status</th><th style="text-align:right">Actions</th>
      </tr></thead><tbody>${loans.map((l, i) => `
        <tr>
          <td>${esc(l.loan_id_display || l.id.slice(0,8))}</td>
          <td>${esc((l.profiles && (up(l.profiles.full_name) || l.profiles.email)) || l.user_id)}</td>
          <td>${fmt.money(l.balance)}</td>
          <td>${fmt.pct(l.interest_rate)}</td>
          <td>${fmt.money(l.monthly_payment)}</td>
          <td>${fmt.date(l.next_due_date)}</td>
          <td><span class="oac-badge ${esc(l.status || '')}">${esc(l.status || '—')}</span></td>
          <td style="text-align:right;white-space:nowrap">
            <button class="oac-btn red" data-view-loan="${i}">View</button>
            ${contactBtn(l.profiles && l.profiles.email, 'Onix Finance · Loan ' + (l.loan_id_display || ''))}
          </td>
        </tr>`).join('')}</tbody></table>`;
    el.querySelectorAll('[data-view-loan]').forEach(b => {
      b.addEventListener('click', () => viewLoan(loans[Number(b.dataset.viewLoan)]));
    });
  }

  function renderInvestments(invs) {
    const el = document.getElementById('oac-investments');
    if (!invs.length) { el.innerHTML = '<div class="oac-empty">No investments yet.</div>'; return; }
    el.innerHTML = `
      <table class="oac-table"><thead><tr>
        <th>Client</th><th>Venture</th><th>Type</th><th>Invested</th><th>Ownership</th><th>Return</th><th>Status</th><th style="text-align:right">Actions</th>
      </tr></thead><tbody>${invs.map((i, idx) => `
        <tr>
          <td>${esc((i.profiles && (up(i.profiles.full_name) || i.profiles.email)) || i.user_id)}</td>
          <td>${esc(i.venture_name)}</td>
          <td>${esc(i.venture_type || '—')}</td>
          <td>${fmt.money(i.amount_invested)}</td>
          <td>${i.ownership_pct != null ? fmt.pct(i.ownership_pct) : '—'}</td>
          <td>${i.expected_return != null ? fmt.pct(i.expected_return) : '—'}</td>
          <td><span class="oac-badge ${esc(i.status || '')}">${esc(i.status || '—')}</span></td>
          <td style="text-align:right;white-space:nowrap">
            <button class="oac-btn red" data-view-inv="${idx}">View</button>
            ${contactBtn(i.profiles && i.profiles.email, 'Onix Finance · ' + (i.venture_name || ''))}
          </td>
        </tr>`).join('')}</tbody></table>`;
    el.querySelectorAll('[data-view-inv]').forEach(b => {
      b.addEventListener('click', () => viewInvestment(invs[Number(b.dataset.viewInv)]));
    });
  }

  function renderRaises(raises) {
    const el = document.getElementById('oac-raises');
    if (!raises.length) { el.innerHTML = '<div class="oac-empty">No raises yet.</div>'; return; }
    el.innerHTML = `
      <table class="oac-table"><thead><tr>
        <th>Venture</th><th>Type</th><th>Goal</th><th>Raised</th><th>Min</th><th>IRR</th><th>Horizon</th><th>Status</th><th style="text-align:right">Actions</th>
      </tr></thead><tbody>${raises.map((r, idx) => `
        <tr>
          <td>${esc(r.venture_name)}</td>
          <td>${esc(r.venture_type || '—')}</td>
          <td>${fmt.money(r.total_raise_target)}</td>
          <td>${fmt.money(r.amount_raised)}</td>
          <td>${fmt.money(r.minimum_investment)}</td>
          <td>${r.projected_return_min != null && r.projected_return_max != null ? r.projected_return_min + '–' + r.projected_return_max + '%' : '—'}</td>
          <td>${esc(r.investment_horizon || '—')}</td>
          <td><span class="oac-badge ${esc(r.status || '')}">${esc(r.status || '—')}</span></td>
          <td style="text-align:right;white-space:nowrap">
            <button class="oac-btn red" data-view-raise="${idx}">View</button>
            <a class="oac-btn outline" href="mailto:info@onixfinance.com?subject=${encodeURIComponent('Onix Finance · ' + r.venture_name)}">Contact</a>
          </td>
        </tr>`).join('')}</tbody></table>`;
    el.querySelectorAll('[data-view-raise]').forEach(b => {
      b.addEventListener('click', () => viewRaise(raises[Number(b.dataset.viewRaise)]));
    });
  }

  // ---------- bootstrap ----------
  // ---------- replace demo content in static admin tabs with live data ----------
  // Strategy: for each known view container, wipe its inner HTML and render
  // a clean Onix-styled table populated from Supabase.

  // The admin design uses these real view IDs (confirmed by grepping the source):
  //   view-dashboard, view-clients, view-investors, view-loans, view-raises,
  //   view-applications, view-review, view-documents, view-reports, view-users
  const STATIC_VIEWS = {
    dashboard:      ['view-dashboard'],
    clients:        ['view-clients', 'view-users'],
    loans:          ['view-loans'],
    investments:    ['view-investors'],
    activeDeposits: ['view-active-deposits'],
    raises:         ['view-raises'],
    applications:   ['view-applications']
  };

  // Marker so we know we've already painted a view (and to detect when the
  // admin's own code has re-rendered it back to demo content).
  const LIVE_MARKER = 'oac-live-painted';

  function findView(idList) {
    for (const id of idList) {
      const el = document.getElementById(id);
      if (el) return el;
    }
    return null;
  }

  function viewShell(title, subtitle, innerHtml) {
    return `
      <div class="${LIVE_MARKER}" style="padding:32px 40px;font-family:'DM Sans',sans-serif;color:#1A1A1A">
        <div style="font-size:.7rem;letter-spacing:.18em;text-transform:uppercase;color:#C0392B;font-weight:600">Live · Supabase</div>
        <h1 style="font-family:'Cormorant Garamond',serif;font-style:italic;font-weight:500;font-size:2rem;margin:6px 0 6px">${esc(title)}</h1>
        <div style="width:40px;height:2px;background:#C0392B;margin-bottom:18px"></div>
        ${subtitle ? `<div style="font-size:.85rem;color:#888;margin-bottom:18px">${esc(subtitle)}</div>` : ''}
        <div style="background:#fff;border:1px solid #E8E8E8;border-top:3px solid #C0392B;padding:18px">
          ${innerHtml}
        </div>
      </div>`;
  }

  function alreadyPainted(viewEl) {
    return !!(viewEl && viewEl.querySelector('.' + LIVE_MARKER));
  }

  function findDashboardView() {
    // Try the known id list first
    const direct = findView(STATIC_VIEWS.dashboard);
    if (direct) return direct;
    // Fallback: scan visible .view elements whose heading mentions Dashboard / Overview
    const views = document.querySelectorAll('.view, [id^="view-"], main, section');
    for (const v of views) {
      const h = v.querySelector('h1, h2, .page-title, .eyebrow');
      if (h && /dashboard|overview|welcome/i.test((h.textContent || ''))) return v;
    }
    return null;
  }

  function paintDashboardView(data) {
    const v = findDashboardView();
    if (!v) { console.warn('[onix-admin] dashboard view not found in DOM'); return false; }
    // Surgical updates only — preserve the original demo layout, just swap numbers + activity.
    const { clients, loans, investments, raises, applications, payments, distributions } = data;
    // "Active Deposits" = OUS Pasiva rows (Onix's deposit book).
    // "Active Loans" = real loan rows (manual or OUS Activa).
    const activeLoans       = loans.filter(l => l.status === 'active' && l.data_source !== 'ous_pasiva');
    const activeDeposits    = loans.filter(l => l.status === 'active' && l.data_source === 'ous_pasiva');
    const activeInvestments = investments.filter(i => i.status === 'active');
    const openRaises        = raises.filter(r => r.status === 'open');
    const pendingApps       = applications.filter(a => !a.status || a.status === 'pending');
    // Loan Portfolio = sum of real-loan balances (manual or OUS Activa)
    // PLUS the balance sitting in every not-yet-verified OUS Activa credit
    // in the Loan Match Review queue (activaMatches, loaded by
    // wireLoanMatchReviewTab — see LMR_SELECT_COLS). Those credits are
    // real money OUS reports as outstanding; they just aren't tied to a
    // specific client account yet (most never will be — no email on that
    // feed to match against), so they can't become a `loans` row (see
    // runOUSActivaSync's verified-gate), but the dashboard total would
    // otherwise silently miss them entirely. Total Deposits = sum of OUS
    // Pasiva credit balances (Onix's deposit book) plus any true
    // deposit-type investments.
    const pendingActivaMatches = (activaMatches || []).filter(m => !m.verified);
    const pendingLoanValue = pendingActivaMatches.reduce((s, m) => s + Number(m.balance || 0), 0);
    const verifiedLoanValue = activeLoans.reduce((s, l) => s + Number(l.balance || 0), 0);
    const loanPortfolio = verifiedLoanValue + pendingLoanValue;
    const depositInvestments = activeInvestments
      .filter(i => i.venture_type === 'deposit')
      .reduce((s, i) => s + Number(i.amount_invested || 0), 0);
    const totalDeposits = activeDeposits.reduce((s, l) => s + Number(l.balance || 0), 0) + depositInvestments;
    const ltv = (loanPortfolio + totalDeposits > 0)
      ? Math.round((loanPortfolio / (loanPortfolio + totalDeposits)) * 100) + '%'
      : '—';
    const updates = {
      'Loan Portfolio':       fmt.money(loanPortfolio),
      'Total Deposits':       fmt.money(totalDeposits),
      'Portfolio LTV':        ltv,
      'Active Clients':       String(clients.filter(c => c.role === 'client' && c.status === 'active').length),
      'Active Loans':         String(activeLoans.length),
      'Pending Applications': String(pendingApps.length),
      'Open Raises':          String(openRaises.length)
    };

    // Robust KPI updater: find by data-en attribute (stable, set by the
    // original Claude-design HTML and never modified), then locate the value
    // cell as a sibling — try nextElementSibling first, then any sibling
    // that doesn't itself carry data-en.
    function setKpiSurgically(label, value) {
      // 1. Try by data-en attribute (most reliable)
      let label_el = v.querySelector('[data-en="' + label + '"]');
      // 2. Fallback: find by text content
      if (!label_el) {
        const candidates = v.querySelectorAll('div, span');
        for (const el of candidates) {
          if (el.children.length === 0 && el.textContent.trim() === label) { label_el = el; break; }
        }
      }
      if (!label_el) return false;
      // Find the value cell: prefer nextElementSibling, fall back to scanning parent siblings.
      const parent = label_el.parentElement;
      const candidates = parent ? Array.from(parent.children) : [];
      for (const sib of candidates) {
        if (sib === label_el) continue;
        if (sib.hasAttribute('data-en')) continue; // skip other labels
        if (sib.tagName !== 'DIV' && sib.tagName !== 'SPAN') continue;
        // First non-label sibling — assume it's the value
        if (sib.textContent !== value) sib.textContent = value;
        return true;
      }
      // Last resort — use immediate nextElementSibling
      const next = label_el.nextElementSibling;
      if (next) { if (next.textContent !== value) next.textContent = value; return true; }
      return false;
    }
    const updated = {};
    Object.entries(updates).forEach(([label, value]) => {
      updated[label] = setKpiSurgically(label, value);
    });

    // Relabel "Portfolio LTV" -> "Loan / Deposit Ratio". The formula
    // is loans / (loans + deposits) — that's actually a Loan/Deposit
    // Ratio (a bank health indicator), not a Loan-to-Value ratio (a
    // per-loan collateral metric). The bundled HTML uses "Portfolio LTV"
    // as the anchor so we keep that for lookup, then swap the visible
    // text + data-en / data-es so the language toggle keeps working.
    (function relabelLtv() {
      const el = v.querySelector('[data-en="Portfolio LTV"]');
      if (!el) return;
      const newEn = 'Loan / Deposit Ratio';
      const newEs = 'Ratio Préstamos / Depósitos';
      el.setAttribute('data-en', newEn);
      el.setAttribute('data-es', newEs);
      const lang = (window.OnixLang && OnixLang.getLang && OnixLang.getLang()) || 'en';
      el.textContent = lang === 'es' ? newEs : newEn;
    })();

    // Small caption under the Loan Portfolio number breaking out how much
    // of it is still unverified/unattributed (see loanPortfolio above) —
    // without this, a huge total with no context about how much of it
    // isn't tied to a real client account would be misleading on a
    // financial dashboard. Injected once, then just its text is updated
    // on every repaint (idempotent, matches the rest of this function's
    // surgical-update style — no bundle edit).
    (function injectPortfolioCaption(text) {
      const label_el = v.querySelector('[data-en="Loan Portfolio"]');
      if (!label_el) return;
      const parent = label_el.parentElement;
      if (!parent) return;
      let valueEl = null;
      for (const sib of Array.from(parent.children)) {
        if (sib === label_el || sib.hasAttribute('data-en')) continue;
        if (sib.tagName !== 'DIV' && sib.tagName !== 'SPAN') continue;
        valueEl = sib; break;
      }
      if (!valueEl) valueEl = label_el.nextElementSibling;
      if (!valueEl) return;
      let caption = parent.querySelector('#onix-portfolio-caption');
      if (!caption) {
        caption = document.createElement('div');
        caption.id = 'onix-portfolio-caption';
        caption.style.cssText = 'font-size:.68rem;color:#9B9590;margin-top:2px;line-height:1.3';
        valueEl.after(caption);
      }
      caption.textContent = text;
      caption.style.display = text ? '' : 'none';
    })(pendingLoanValue > 0
      ? `Includes ${fmt.money(pendingLoanValue)} across ${pendingActivaMatches.length} loan${pendingActivaMatches.length === 1 ? '' : 's'} pending client match`
      : '');

    // Log every run (no once-only flag) so cache busting is obvious in DevTools —
    // but only when explicitly opted in, since this repaints every ~600ms and
    // would otherwise spam the console for the entire session by default.
    // Enable with: localStorage.setItem('onix-debug', '1')
    if (localStorage.getItem('onix-debug') === '1') {
      console.log('[onix-admin] dashboard updates:', updated);
    }

    // Replace activity-item rows with live events (preserve container + card chrome).
    const firstActivity = v.querySelector('.activity-item');
    if (firstActivity) {
      const container = firstActivity.parentElement;
      const events = [];
      applications.slice(0, 6).forEach(a => events.push({
        ts: new Date(a.submitted_at),
        title: 'New application from ' + ((a.profiles && (up(a.profiles.full_name) || a.profiles.email)) || 'a client'),
        meta:  fmt.money(a.amount_requested) + ' · ' + fmt.date(a.submitted_at),
        dot:   ''
      }));
      payments.filter(p => p.paid_at).slice(0, 6).forEach(p => events.push({
        ts: new Date(p.paid_at),
        title: 'Payment received — ' + ((p.loans && p.loans.loan_id_display) || 'loan'),
        meta:  fmt.money(p.amount_due) + ' · ' + ((p.loans && p.loans.profiles && up(p.loans.profiles.full_name)) || 'client') + ' · ' + fmt.date(p.paid_at),
        dot:   ''
      }));
      distributions.slice(0, 6).forEach(d => events.push({
        ts: new Date(d.paid_at),
        title: 'Distribution paid — ' + ((d.investments && d.investments.venture_name) || 'venture'),
        meta:  fmt.money(d.amount) + ' · ' + ((d.investments && d.investments.profiles && up(d.investments.profiles.full_name)) || 'client') + ' · ' + fmt.date(d.paid_at),
        dot:   'gray'
      }));
      clients.slice(0, 6).forEach(c => events.push({
        ts: new Date(c.created_at),
        title: c.status === 'pending' ? 'Signup pending approval — ' + (up(c.full_name) || c.email)
                                      : 'Client added — ' + (up(c.full_name) || c.email),
        meta:  c.email + ' · ' + fmt.date(c.created_at),
        dot:   c.status === 'pending' ? '' : 'gray'
      }));
      events.sort((a, b) => b.ts - a.ts);
      const top = events.slice(0, 10);
      container.querySelectorAll('.activity-item').forEach(el => el.remove());
      top.forEach(e => {
        const item = document.createElement('div');
        item.className = 'activity-item';
        item.innerHTML = `<div class="activity-dot${e.dot ? ' ' + e.dot : ''}"></div><div><div class="activity-title">${esc(e.title)}</div><div class="activity-meta">${esc(e.meta)}</div></div>`;
        container.appendChild(item);
      });
      if (!top.length) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:14px 0;color:#888;font-size:.85rem;font-style:italic';
        empty.textContent = 'No recent activity.';
        container.appendChild(empty);
      }
    }
    return true;
  }

  function paintClientsView(clients, loans, investments, pending, clientDocuments) {
    const v = findView(STATIC_VIEWS.clients); if (!v) return false;
    if (alreadyPainted(v)) return true;
    pending = pending || (clients || []).filter(c => c.status === 'pending');
    // Which doc categories does each profile have? Used by the
    // "Missing document" filter dropdown next to Export CSV. A row's
    // data-onix-docs attribute is a comma-separated list of categories
    // present for that client — the filter hides rows that CONTAIN the
    // selected category so admins see only clients who are missing it.
    const docsByProfile = {};
    (clientDocuments || []).forEach(d => {
      if (!d || !d.profile_id) return;
      (docsByProfile[d.profile_id] = docsByProfile[d.profile_id] || new Set()).add(d.category || 'other');
    });
    // Per-client loan balances, counts, and investment counts. Excludes
    // OUS-synced rows (data_source: 'ous_pasiva') from Loans — those are
    // deposits, not loans — and folds them into the Investments count
    // instead, so a depositor still shows an active position here rather
    // than disappearing from both columns.
    const loanCounts = {}, loanBalances = {}, invCounts = {};
    (loans || []).forEach(l => {
      if (l.status !== 'active') return;
      if (l.data_source === 'ous_pasiva') {
        invCounts[l.user_id] = (invCounts[l.user_id] || 0) + 1;
        return;
      }
      loanCounts[l.user_id] = (loanCounts[l.user_id] || 0) + 1;
      loanBalances[l.user_id] = (loanBalances[l.user_id] || 0) + Number(l.balance || 0);
    });
    (investments || []).forEach(i => { invCounts[i.user_id] = (invCounts[i.user_id] || 0) + 1; });
    // Live per-client document counts — both the icon and the number shown
    // come from this same live count, so they can never contradict each other.
    const docCounts = {};
    (clientDocuments || []).forEach(d => { docCounts[d.profile_id] = (docCounts[d.profile_id] || 0) + 1; });
    // Text-form of the Borrower / LP state — splitRoleColumn (admin-portal.html)
    // reads this textContent to seed the checkbox state when it rewrites the
    // Role column into two click-to-toggle cells.
    const roleText = (c) => {
      const b = !!c.is_borrower, l = !!c.is_lp;
      if (b && l) return 'Borrower + LP';
      if (b) return 'Borrower';
      if (l) return 'LP';
      return '—';
    };
    const rows = clients.length ? clients.map(c => `
      <tr data-profile-id="${esc(c.id)}" data-onix-docs="${esc(Array.from(docsByProfile[c.id] || []).join(','))}">
        <td>${esc(up(c.full_name) || '—')}</td>
        <td>${esc(c.email)}</td>
        <td>${esc(roleText(c))}</td>
        <td>${loanBalances[c.id] ? fmt.money(loanBalances[c.id]) : '—'}</td>
        <td>${loanCounts[c.id] || '—'}</td>
        <td>${invCounts[c.id] || '—'}</td>
        <td><span class="oac-badge ${esc(c.status || '')}">${esc(c.status || '—')}</span></td>
        <td>${fmt.date(c.created_at)}</td>
        <td style="text-align:center">${(docCounts[c.id] || 0) === 0
          ? '<span title="No documents" style="display:inline-flex;align-items:center;gap:5px;color:#B4B2A9"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="3" y1="3" x2="21" y2="21"/></svg></span>'
          : `<span title="${docCounts[c.id]} document${docCounts[c.id] === 1 ? '' : 's'}" style="display:inline-flex;align-items:center;gap:5px;color:#6B6560"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span style="font-size:.8rem">${docCounts[c.id]}</span></span>`}</td>
        <td style="white-space:nowrap">
          <button class="oac-btn outline" data-cl-view="1" type="button">View</button>
          <button class="oac-btn outline" data-cl-docs="1" type="button">Documents</button>
        </td>
      </tr>`).join('') : '<tr><td colspan="10" class="oac-empty">No clients yet.</td></tr>';
    // Pending Approvals banner — split into "new sign-ups" (just signed up,
    // need an in-person meeting) and "ready to activate" (admin has met with
    // them and is ready to flip the account on).
    const newSignups   = pending.filter(p => p.status === 'pending');
    const readyToAct   = pending.filter(p => p.status === 'met');
    function rowHtml(p) {
      const isReady = p.status === 'met';
      const activateBtn = `<button class="oac-btn red"     data-pending-act="approve" data-id="${esc(p.id)}">Activate Account</button>`;
      const metBtn      = `<button class="oac-btn outline" data-pending-act="met"     data-id="${esc(p.id)}">Mark as Met</button>`;
      const rejectBtn   = `<button class="oac-btn danger"  data-pending-act="reject"  data-id="${esc(p.id)}">Reject</button>`;
      return `
        <tr data-pending-id="${esc(p.id)}">
          <td style="width:32px"><input type="checkbox" class="oac-pending-check" data-id="${esc(p.id)}" data-stage="${isReady ? 'met' : 'pending'}" style="width:16px;height:16px;cursor:pointer"></td>
          <td>${esc(up(p.full_name) || '—')}</td>
          <td>${esc(p.email)}</td>
          <td>${fmt.date(p.created_at)}</td>
          <td style="text-align:right;white-space:nowrap">
            ${isReady ? activateBtn : metBtn} ${isReady ? '' : activateBtn} ${rejectBtn}
          </td>
        </tr>`;
    }
    function sectionHtml(title, sub, rows) {
      if (!rows.length) return '';
      return `
        <div style="padding:12px 18px;border-bottom:1px solid #f4f4f4;background:#FAFAFA">
          <div style="font-size:.62rem;letter-spacing:.14em;text-transform:uppercase;color:#1A1A1A;font-weight:700">${esc(title)}</div>
          <div style="font-size:.78rem;color:#888;margin-top:2px">${esc(sub)}</div>
        </div>
        <table class="oac-table" style="width:100%"><tbody>${rows.map(rowHtml).join('')}</tbody></table>`;
    }
    const pendingBanner = pending.length ? `
      <div id="oac-pending-banner" style="background:#fff;border:1px solid #E8E8E8;border-top:3px solid #C0392B;margin-bottom:18px">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid #f4f4f4">
          <div>
            <div style="font-size:.65rem;letter-spacing:.14em;text-transform:uppercase;color:#C0392B;font-weight:700">Pending Approvals</div>
            <div style="font-family:'Cormorant Garamond',serif;font-style:italic;font-weight:500;font-size:1.2rem;margin-top:2px">${pending.length} awaiting review · ${newSignups.length} new · ${readyToAct.length} ready to activate</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <label style="font-size:.78rem;color:#1A1A1A;display:flex;align-items:center;gap:8px;cursor:pointer;margin-right:4px">
              <input type="checkbox" id="oac-pending-selectall" style="width:16px;height:16px;cursor:pointer">
              <span><span id="oac-pending-count">0</span> selected</span>
            </label>
            <button class="oac-btn red"     id="oac-bulk-approve" disabled>Activate Selected</button>
            <button class="oac-btn outline" id="oac-bulk-met"     disabled>Mark Selected as Met</button>
            <button class="oac-btn danger"  id="oac-bulk-reject"  disabled>Reject Selected</button>
          </div>
        </div>
        ${sectionHtml('New sign-ups', 'Met with the client in person first, then mark as Met or Activate directly.', newSignups)}
        ${sectionHtml('Ready to activate', 'Already met with — click Activate Account to send the welcome email.', readyToAct)}
      </div>` : '';

    // Filter dropdown — pick a document category to hide clients who
    // already have it, leaving only the ones you need to chase. Options
    // mirror the display groups in the Client Documents modal (admin-
    // portal.html DOC_DISPLAY_GROUPS). Kept in sync manually. ID and
    // Passport are one combined option — a client only needs one of the
    // two identity docs, so separate "Missing: ID" / "Missing: Passport"
    // options would incorrectly flag a client who has the other one.
    const MISSING_DOC_OPTIONS = [
      { value: '',                  label: 'Missing doc: (all clients)' },
      { value: '__any_identity__',  label: 'Missing: ID/Passport' },
      { value: 'proof_of_address',  label: 'Missing: Proof of Address' },
      { value: 'tax',               label: 'Missing: RFC / Tax ID' },
      { value: 'loan_application',  label: 'Missing: Loan Application Docs' },
      { value: 'loan_doc',          label: 'Missing: Loan Documents' },
      { value: 'promissory_note',   label: 'Missing: Promissory Notes' }
    ];
    const missingOptsHtml = MISSING_DOC_OPTIONS.map(o =>
      '<option value="' + esc(o.value) + '">' + esc(o.label) + '</option>'
    ).join('');
    const newClientBtn = `
      <div style="display:flex;justify-content:flex-end;align-items:center;margin-bottom:14px;gap:8px;flex-wrap:wrap">
        <select id="oac-clients-missing-doc" style="padding:9px 30px 9px 12px;font:600 .72rem/1 'DM Sans',sans-serif;letter-spacing:.06em;border:1px solid #E8E8E8;background:#fff;color:#1A1A1A;border-radius:2px;cursor:pointer;appearance:none;background-image:url(&quot;data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%236B6560' stroke-width='2.5'><polyline points='6 9 12 15 18 9'/></svg>&quot;);background-repeat:no-repeat;background-position:right 10px center">${missingOptsHtml}</select>
        <span id="oac-clients-missing-count" style="font-size:.72rem;color:#888;margin-right:4px"></span>
        <a href="#" id="oac-export-clients" style="display:inline-block;background:#fff;color:#1A1A1A;padding:10px 18px;font:600 .72rem/1 'DM Sans',sans-serif;text-transform:uppercase;letter-spacing:.1em;border:1px solid #E8E8E8;border-radius:2px;text-decoration:none">Export CSV</a>
        <a href="#" id="oac-new-client-btn" style="display:inline-block;background:#C0392B;color:#fff;padding:10px 18px;font:600 .72rem/1 'DM Sans',sans-serif;text-transform:uppercase;letter-spacing:.1em;border:1px solid #C0392B;border-radius:2px;text-decoration:none">+ New Client</a>
      </div>`;
    v.innerHTML = viewShell('Clients', 'All accounts in the system',
      pendingBanner +
      newClientBtn +
      `<table class="oac-table" style="width:100%"><thead><tr>
        <th>Name</th><th>Email</th><th>Role</th><th>Loan Balance</th><th>Loans</th><th>Investments</th><th>Status</th><th>Joined</th><th style="text-align:center">Documents</th><th></th>
      </tr></thead><tbody>${rows}</tbody></table>`);
    const btn = v.querySelector('#oac-new-client-btn');
    if (btn) btn.addEventListener('click', (e) => { e.preventDefault(); openNewClientModal(); });

    // Wire the Pending Approvals banner (only present if pending.length > 0)
    const banner = v.querySelector('#oac-pending-banner');
    if (banner) {
      const checkboxes = () => Array.from(banner.querySelectorAll('.oac-pending-check'));
      const selectAll  = banner.querySelector('#oac-pending-selectall');
      const countEl    = banner.querySelector('#oac-pending-count');
      const bulkApprove = banner.querySelector('#oac-bulk-approve');
      const bulkMet     = banner.querySelector('#oac-bulk-met');
      const bulkReject  = banner.querySelector('#oac-bulk-reject');
      const updateCount = () => {
        const n = checkboxes().filter(c => c.checked).length;
        countEl.textContent = String(n);
        bulkApprove.disabled = n === 0;
        bulkMet.disabled     = n === 0;
        bulkReject.disabled  = n === 0;
        const all = checkboxes();
        selectAll.checked = n > 0 && n === all.length;
        selectAll.indeterminate = n > 0 && n < all.length;
      };
      selectAll.addEventListener('change', () => {
        checkboxes().forEach(c => { c.checked = selectAll.checked; });
        updateCount();
      });
      checkboxes().forEach(c => c.addEventListener('change', updateCount));

      async function actOne(id, action) {
        const clientRow = pending.find(p => p.id === id);
        let ok = false;
        if (action === 'approve') {
          ok = await OnixDB.approveClient(id);
          if (ok && clientRow && clientRow.email) {
            OnixDB.client.functions.invoke('send-account-activated-email', {
              body: { full_name: clientRow.full_name || '', email: clientRow.email }
            }).catch(err => console.error('[onix-admin] activation email failed:', err));
          }
        } else if (action === 'met') {
          ok = !!(OnixDB.markClientMet && await OnixDB.markClientMet(id));
        } else if (action === 'reject') {
          if (window.OnixPerms && !OnixPerms.can('removeClients')) {
            alert('Your role does not have permission to remove clients.');
            return false;
          }
          ok = await OnixDB.rejectClient(id);
        }
        return ok;
      }
      async function bulk(action) {
        if (action === 'reject' && window.OnixPerms && !OnixPerms.can('removeClients')) {
          alert('Your role does not have permission to remove clients.');
          return;
        }
        const ids = checkboxes().filter(c => c.checked).map(c => c.dataset.id);
        if (!ids.length) return;
        const label = action === 'approve' ? 'activate' : action === 'met' ? 'mark as met' : 'reject';
        if (!confirm(`${label.charAt(0).toUpperCase() + label.slice(1)} ${ids.length} client${ids.length === 1 ? '' : 's'}?`)) return;
        bulkApprove.disabled = true; bulkMet.disabled = true; bulkReject.disabled = true;
        let ok = 0, failed = 0;
        for (const id of ids) (await actOne(id, action)) ? ok++ : failed++;
        if (failed > 0) alert(`${ok} succeeded, ${failed} failed.`);
        refreshAll();
      }
      bulkApprove.addEventListener('click', () => bulk('approve'));
      bulkMet.addEventListener('click',     () => bulk('met'));
      bulkReject.addEventListener('click',  () => bulk('reject'));
      banner.querySelectorAll('[data-pending-act]').forEach(b => {
        b.addEventListener('click', async () => {
          b.disabled = true;
          const ok = await actOne(b.dataset.id, b.dataset.pendingAct);
          if (ok) refreshAll();
          else { b.disabled = false; alert('Action failed.'); }
        });
      });
    }

    wireExport(v, 'oac-export-clients', () => {
      downloadCsv('onix-clients-' + isoDate(new Date().toISOString()) + '.csv',
        ['full_name', 'email', 'role', 'status', 'phone', 'address', 'created_at'],
        clients.map(c => ({
          full_name: c.full_name,
          email: c.email,
          role: c.role,
          status: c.status,
          phone: c.phone,
          address: c.address,
          created_at: isoDate(c.created_at)
        })));
    });

    // Wire the "Missing document" filter dropdown. When a category is
    // picked, hide rows whose data-onix-docs already contains it. The
    // special value "__any_identity__" hides rows that have EITHER id
    // or passport (a client only needs one of the two identity docs).
    //
    // Selection persists across re-renders via
    // window.__onixClientsMissingDocFilter so the admin's pick survives
    // the periodic refreshAll paint (used to reset to "all clients"
    // every few minutes).
    //
    // The visible client rows are actually CLONES of the original ones —
    // splitClientsBySection() (in admin-portal.html) copies each row into
    // one or both of a Borrowers / LPs section table and hides the
    // original table. Because the clone happens after our filter runs
    // (via a MutationObserver), we must re-apply the filter whenever the
    // section tables' contents change; otherwise our display:none is
    // thrown away by the fresh clone. To avoid an infinite loop, we
    // dedupe by comparing the sorted list of currently-hidden ids
    // against the desired set and only touch rows that need changing.
    const filterSel   = v.querySelector('#oac-clients-missing-doc');
    const countLabel  = v.querySelector('#oac-clients-missing-count');
    if (filterSel && countLabel) {
      const prior = window.__onixClientsMissingDocFilter;
      if (prior && Array.from(filterSel.options).some(o => o.value === prior)) {
        filterSel.value = prior;
      }
      const applyFilter = () => {
        const cat = filterSel.value;
        window.__onixClientsMissingDocFilter = cat;
        // Both the original (hidden mainTable) rows AND the cloned rows
        // in the Borrowers / LPs section tables carry data-profile-id
        // and data-onix-docs. Hiding on both is fine — the hidden set is
        // invisible either way, and the visible clones are what the
        // admin actually sees.
        const trs = Array.from(v.querySelectorAll('tr[data-profile-id]'));
        // Deduplicate visible-row COUNT by profile id so the "N of M
        // missing" total matches the eye (a borrower + LP client appears
        // in both section tables as two <tr> elements).
        const visibleByProfile = new Set();
        const totalProfiles    = new Set();
        trs.forEach(tr => {
          const pid = tr.getAttribute('data-profile-id') || '';
          totalProfiles.add(pid);
          const docs = (tr.getAttribute('data-onix-docs') || '').split(',').filter(Boolean);
          let hasIt;
          if (cat === '')                     hasIt = false; // show all
          else if (cat === '__any_identity__') hasIt = docs.indexOf('id') >= 0 || docs.indexOf('passport') >= 0;
          else                                 hasIt = docs.indexOf(cat) >= 0;
          const hide = cat !== '' && hasIt;
          const desired = hide ? 'none' : '';
          if (tr.style.display !== desired) tr.style.display = desired;
          if (!hide) visibleByProfile.add(pid);
        });
        countLabel.textContent = cat === ''
          ? ''
          : visibleByProfile.size + ' of ' + totalProfiles.size + ' missing';
      };
      filterSel.addEventListener('change', applyFilter);
      applyFilter();

      // Re-apply whenever splitClientsBySection re-clones rows into the
      // section tables. Only react to added/removed <tr data-profile-id>
      // nodes — NOT to any other subtree mutation. In particular, the
      // count label's textContent update inside applyFilter itself is a
      // childList mutation (replaces the text node), so a naive
      // subtree/childList observer would fire on its own writes and
      // infinite-loop. Debounced via requestAnimationFrame so a burst
      // of clone insertions collapses to a single re-filter.
      if (v.__onixClientsFilterMO) v.__onixClientsFilterMO.disconnect();
      let rafId = 0;
      v.__onixClientsFilterMO = new MutationObserver(muts => {
        for (const m of muts) {
          const touched = [...m.addedNodes, ...m.removedNodes].some(n =>
            n && n.nodeType === 1 &&
            (n.matches?.('tr[data-profile-id]') || n.querySelector?.('tr[data-profile-id]'))
          );
          if (!touched) continue;
          if (rafId) return; // already scheduled
          rafId = requestAnimationFrame(() => { rafId = 0; applyFilter(); });
          return;
        }
      });
      v.__onixClientsFilterMO.observe(v, { subtree: true, childList: true });
    }
    return true;
  }

  // ---------- shared form helpers ----------
  const INPUT_STYLE = "width:100%;padding:10px 12px;border:1px solid #E8E8E8;font-size:.9rem;font-family:inherit;outline:none;background:#fff";

  function field(label, name, opts) {
    opts = opts || {};
    // Any dollar field (label ending in "($)") becomes a text input with
    // live thousands-separator formatting. type=number is dropped because
    // browsers reject commas in number inputs.
    const isMoney = opts.money === true || /\(\$\)\s*$/.test(label);
    const type = isMoney ? 'text' : (opts.type || 'text');
    const required = opts.required ? 'required' : '';
    const placeholder = opts.placeholder ? `placeholder="${esc(opts.placeholder)}"` : '';
    const step = (opts.step && !isMoney) ? `step="${esc(opts.step)}"` : '';
    const moneyAttrs = isMoney ? 'data-money="1" inputmode="decimal"' : '';
    const displayValue = (opts.value != null)
      ? (isMoney ? formatMoneyString(opts.value) : opts.value)
      : null;
    const value = displayValue != null ? `value="${esc(displayValue)}"` : '';
    if (opts.textarea) {
      return `<div><div class="k">${esc(label)}</div><textarea name="${esc(name)}" ${required} ${placeholder} rows="3" style="${INPUT_STYLE};resize:vertical;min-height:60px"></textarea></div>`;
    }
    if (opts.select) {
      const options = opts.select.map(o =>
        typeof o === 'string'
          ? `<option value="${esc(o)}">${esc(o)}</option>`
          : `<option value="${esc(o.value)}"${o.selected ? ' selected' : ''}>${esc(o.label)}</option>`
      ).join('');
      const disabled = opts.disabled ? 'disabled' : '';
      return `<div><div class="k">${esc(label)}</div><select name="${esc(name)}" ${required} ${disabled} style="${INPUT_STYLE}">${options}</select></div>`;
    }
    return `<div><div class="k">${esc(label)}</div><input name="${esc(name)}" type="${type}" ${required} ${placeholder} ${step} ${value} ${moneyAttrs} style="${INPUT_STYLE}"></div>`;
  }

  function clientOptions(clients) {
    return [{ value: '', label: '— Select client —' }]
      .concat((clients || [])
        .filter(c => c.role === 'client')
        .map(c => ({ value: c.id, label: (up(c.full_name) || c.email) + ' · ' + c.email })));
  }

  // Venture Name on Add Investment / Add Deposit is populated from open
  // raises only (matches the existing plain-text-copy pattern already used
  // by ensureInvestmentFromInterest() — no raise_id FK, just the name).
  function openRaiseOptions(raises) {
    return (raises || [])
      .filter(r => r.status === 'open')
      .map(r => ({ value: r.venture_name, label: r.venture_name }));
  }

  function submitBar(submitLabel) {
    return `<div id="oac-form-err" style="color:#C0392B;font-size:.85rem;margin-bottom:10px;display:none"></div>
      <div class="oac-modal-foot" style="margin-top:0">
        <button type="button" class="oac-btn outline" data-modal-close>Cancel</button>
        <button type="submit" class="oac-btn red" data-form-submit>${esc(submitLabel)}</button>
      </div>`;
  }

  async function handleFormSubmit(form, payloadFn, table) {
    const submitBtn = form.querySelector('[data-form-submit]');
    const errEl = form.querySelector('#oac-form-err');
    errEl.style.display = 'none';
    const origLabel = submitBtn.textContent;
    submitBtn.disabled = true; submitBtn.textContent = 'Saving…';
    try {
      const payload = payloadFn();
      const { error } = await OnixDB.client.from(table).insert(payload);
      if (error) throw error;
      document.getElementById('oac-modal').classList.remove('open');
      refreshAll();
    } catch (ex) {
      errEl.style.display = 'block';
      errEl.textContent = ex.message || 'Could not save.';
      submitBtn.disabled = false;
      submitBtn.textContent = origLabel;
    }
  }

  function numOrNull(v) {
    const n = Number(String(v || '').replace(/[^0-9.\-]/g, ''));
    return isFinite(n) && String(v || '').trim() !== '' ? n : null;
  }
  function strOrNull(v) { const s = String(v || '').trim(); return s.length ? s : null; }
  function dateInput(v) { return v ? String(v).slice(0,10) : ''; }

  async function handleUpdateSubmit(form, table, id, payloadFn) {
    const submitBtn = form.querySelector('[data-form-submit]');
    const errEl = form.querySelector('#oac-form-err');
    errEl.style.display = 'none';
    if (window.OnixPerms && !OnixPerms.can('editContent')) {
      errEl.style.display = 'block';
      errEl.textContent = 'Your role does not have permission to edit content.';
      return;
    }
    const origLabel = submitBtn.textContent;
    submitBtn.disabled = true; submitBtn.textContent = 'Saving…';
    try {
      const payload = payloadFn();
      const { error } = await OnixDB.client.from(table).update(payload).eq('id', id);
      if (error) throw error;
      document.getElementById('oac-modal').classList.remove('open');
      refreshAll();
    } catch (ex) {
      errEl.style.display = 'block';
      errEl.textContent = ex.message || 'Could not save.';
      submitBtn.disabled = false;
      submitBtn.textContent = origLabel;
    }
  }

  // ---------- Document management (loan_documents / investment_documents / raise_documents) ----------
  // table: name of the docs table; parentCol: e.g. 'loan_id'; parentId: row id
  // Common document types per the PRD, by record kind. Used as datalist
  // suggestions so admins can pick a standard name or type their own.
  const DOC_NAME_SUGGESTIONS = {
    loan:       ['Promissory Note', 'Deed of Trust', 'Appraisal Report', 'Title Insurance', 'Amortization Schedule', 'Loan Agreement', 'Insurance Certificate'],
    investment: ['Operating Agreement', 'Subscription Agreement', 'Pitch Deck', 'K-1 Tax Form', 'Financial Statement', 'Distribution Notice', 'Capital Call Notice'],
    raise:      ['Pitch Deck', 'Financial Model', 'Operating Agreement', 'Offering Memorandum', 'Term Sheet', 'Subscription Agreement']
  };

  function docsManagerHtml(docs, kind) {
    kind = kind || 'loan';
    const listId = 'oac-doc-names-' + kind;
    const suggestions = (DOC_NAME_SUGGESTIONS[kind] || [])
      .map(n => `<option value="${esc(n)}"></option>`).join('');
    const list = (docs || []).map(d => `
      <div class="row" data-doc-id="${esc(d.id)}" style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid #f4f4f4">
        <div style="flex:1">
          <div class="doc-name" style="font-weight:600;font-size:.88rem">${esc(d.name)}</div>
          ${d.dropbox_url ? `<a href="${esc(d.dropbox_url)}" target="_blank" rel="noopener" style="font-size:.78rem;color:#C0392B;text-decoration:none;word-break:break-all">View ↗</a>` : '<span style="color:#888;font-size:.78rem">No link</span>'}
          <span style="font-size:.72rem;color:#9B9590;margin-left:8px">${d.uploaded_at ? esc(fmt.date(d.uploaded_at)) : ''}</span>
        </div>
        <a href="#" data-doc-remove="${esc(d.id)}" style="color:#C0392B;font-size:.78rem;text-decoration:none;font-weight:600;margin-left:10px;white-space:nowrap">Remove</a>
      </div>`).join('');
    return `
      <div class="oac-modal-docs" data-docs-manager>
        <h3>Documents</h3>
        <div data-docs-list>${list || '<div style="color:#888;font-size:.85rem;font-style:italic;padding:6px 0">No documents yet.</div>'}</div>
        <datalist id="${listId}">${suggestions}</datalist>
        <form data-doc-add-form style="margin-top:14px;display:grid;grid-template-columns:1.2fr 2fr auto;gap:8px;align-items:end">
          <div>
            <div class="k">Document name</div>
            <input name="name" required list="${listId}" placeholder="Pick or type…" autocomplete="off" style="${INPUT_STYLE}">
          </div>
          <div>
            <div class="k">Google Drive share link</div>
            <input name="dropbox_url" type="url" required placeholder="https://drive.google.com/file/d/..." style="${INPUT_STYLE}">
          </div>
          <button type="submit" class="oac-btn red" style="padding:10px 14px">Add</button>
        </form>
        <div data-doc-warn style="display:none;font-size:.76rem;color:#A07818;margin-top:6px"></div>
        <div style="font-size:.72rem;color:#9B9590;margin-top:8px;line-height:1.5">
          Upload the file to Google Drive, click <b>Share → General access → Anyone with the link</b>, then <b>Copy link</b> and paste it here. Clients see a <b>View</b> link to open it.
        </div>
      </div>`;
  }

  function isLikelyGoogleDriveLink(url) {
    return /^https?:\/\/(www\.)?(drive|docs)\.google\.com\//i.test(String(url || ''));
  }

  function wireDocsManager(scope, table, parentCol, parentId, onChange) {
    const root = scope.querySelector('[data-docs-manager]');
    if (!root) return;
    const warn = root.querySelector('[data-doc-warn]');
    // Remove
    root.querySelectorAll('[data-doc-remove]').forEach(a => {
      a.addEventListener('click', async (e) => {
        e.preventDefault();
        if (window.OnixPerms && !OnixPerms.can('editContent')) {
          alert('Your role does not have permission to edit content.');
          return;
        }
        if (!confirm('Remove this document?')) return;
        const id = a.dataset.docRemove;
        const { error } = await OnixDB.client.from(table).delete().eq('id', id);
        if (error) { alert(error.message); return; }
        if (typeof onChange === 'function') onChange();
        refreshAll();
      });
    });
    // Add
    const form = root.querySelector('[data-doc-add-form]');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (window.OnixPerms && !OnixPerms.can('editContent')) {
          alert('Your role does not have permission to edit content.');
          return;
        }
        const fd = new FormData(form);
        const name = strOrNull(fd.get('name'));
        const url  = strOrNull(fd.get('dropbox_url'));
        // Validate it looks like a Google Drive link; warn but allow other share links.
        if (url && !isLikelyGoogleDriveLink(url)) {
          warn.style.display = 'block';
          warn.textContent = "That doesn't look like a Google Drive link. Click Add again to use it anyway, or paste a drive.google.com share link.";
          if (form.dataset.warned !== url) { form.dataset.warned = url; return; }
        }
        warn.style.display = 'none';
        const row = { name: name, dropbox_url: url };
        row[parentCol] = parentId;
        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true; submitBtn.textContent = 'Adding…';
        const { error } = await OnixDB.client.from(table).insert(row);
        if (error) { alert(error.message); submitBtn.disabled = false; submitBtn.textContent = 'Add'; return; }
        if (typeof onChange === 'function') onChange();
        refreshAll();
      });
    }
  }

  // ---------- Add Loan modal ----------
  function openAddLoanModal() {
    const clients = (window.__onixAdminData && window.__onixAdminData.clients) || [];
    openModal(`
      <h2>Add Loan</h2>
      <div class="sub">Attach a loan to an existing client</div>
      <form id="oac-add-loan-form">
        <div class="oac-modal-row" style="grid-template-columns:1fr">
          ${field('Client', 'user_id', { required: true, select: clientOptions(clients) })}
        </div>
        <div class="oac-modal-row">
          ${field('Loan ID',           'loan_id_display',  { placeholder: 'ONX-2026-0123' })}
          ${field('Status',            'status',           { required: true, select: [{value:'active',label:'Active',selected:true},'paid','review'] })}
          ${field('Outstanding Balance ($)', 'balance',    { type: 'number', step: '0.01', placeholder: '142500' })}
          ${field('Interest Rate (%)', 'interest_rate',    { type: 'number', step: '0.01', placeholder: '13.0' })}
          ${field('Monthly Payment ($)','monthly_payment', { type: 'number', step: '0.01', placeholder: '4218' })}
          ${field('Term (months)',     'term_months',      { type: 'number', placeholder: '24' })}
          ${field('Origination Date',  'origination_date', { type: 'date' })}
          ${field('Maturity Date',     'maturity_date',    { type: 'date' })}
          ${field('Next Due',          'next_due_date',    { type: 'date' })}
          ${field('Origination Fee (%)', 'origination_fee',{ type: 'number', step: '0.01', placeholder: '1.5' })}
        </div>
        <div class="oac-modal-row" style="grid-template-columns:1fr">
          ${field('Collateral Address', 'collateral_address', { placeholder: '1842 Montrose Blvd, Houston, TX 77006' })}
        </div>
        ${submitBar('Create Loan')}
      </form>`);
    const form = document.getElementById('oac-add-loan-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      handleFormSubmit(form, () => ({
        user_id:            String(fd.get('user_id')),
        loan_id_display:    strOrNull(fd.get('loan_id_display')),
        balance:            numOrNull(fd.get('balance')),
        interest_rate:      numOrNull(fd.get('interest_rate')),
        monthly_payment:    numOrNull(fd.get('monthly_payment')),
        term_months:        numOrNull(fd.get('term_months')),
        origination_date:   strOrNull(fd.get('origination_date')),
        maturity_date:      strOrNull(fd.get('maturity_date')),
        next_due_date:      strOrNull(fd.get('next_due_date')),
        origination_fee:    numOrNull(fd.get('origination_fee')),
        collateral_address: strOrNull(fd.get('collateral_address')),
        status:             String(fd.get('status'))
      }), 'loans');
    });
  }

  // ---------- Add Investment modal ----------
  function openAddInvestmentModal() {
    const clients = (window.__onixAdminData && window.__onixAdminData.clients) || [];
    const openRaises = openRaiseOptions((window.__onixAdminData && window.__onixAdminData.raises) || []);
    const hasOpenRaises = openRaises.length > 0;
    openModal(`
      <h2>Add Investment</h2>
      <div class="sub">Record a client position in a venture</div>
      ${hasOpenRaises ? '' : `<div style="margin-bottom:14px;padding:10px 12px;background:#FDF5E6;color:#A07818;font-size:.82rem;border-left:3px solid #A07818">No open raises available — open a raise first before recording a new investment.</div>`}
      <form id="oac-add-inv-form">
        <div class="oac-modal-row" style="grid-template-columns:1fr">
          ${field('Client', 'user_id', { required: true, select: clientOptions(clients) })}
        </div>
        <div class="oac-modal-row">
          ${field('Venture Name',      'venture_name',      { required: true, disabled: !hasOpenRaises,
              select: hasOpenRaises ? [{ value: '', label: '— Select raise —' }].concat(openRaises) : [{ value: '', label: 'No open raises' }] })}
          ${field('Type',              'venture_type',      { required: true, select: [{value:'equity',label:'Equity'},{value:'deposit',label:'Deposit'}] })}
          ${field('Amount Invested ($)','amount_invested',  { type: 'number', step: '0.01', required: true, placeholder: '50000' })}
          ${field('Ownership (%)',     'ownership_pct',     { type: 'number', step: '0.01', placeholder: 'Optional' })}
          ${field('Start Date',        'start_date',        { type: 'date' })}
          ${field('Status',            'status',            { required: true, select: [{value:'active',label:'Active',selected:true},'pending','exited'] })}
        </div>
        ${submitBar('Create Investment')}
      </form>`);
    const form = document.getElementById('oac-add-inv-form');
    if (!hasOpenRaises) {
      const submitBtn = form.querySelector('[data-form-submit]');
      if (submitBtn) submitBtn.disabled = true;
    }
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      handleFormSubmit(form, () => ({
        user_id:         String(fd.get('user_id')),
        venture_name:    strOrNull(fd.get('venture_name')),
        venture_type:    strOrNull(fd.get('venture_type')),
        amount_invested: numOrNull(fd.get('amount_invested')),
        ownership_pct:   numOrNull(fd.get('ownership_pct')),
        start_date:      strOrNull(fd.get('start_date')),
        status:          String(fd.get('status'))
      }), 'investments');
    });
  }

  // ---------- Add Raise modal ----------
  function openAddRaiseModal() {
    openModal(`
      <h2>Add Raise</h2>
      <div class="sub">Open a new investment opportunity to clients</div>
      <form id="oac-add-raise-form">
        <div class="oac-modal-row">
          ${field('Venture Name',           'venture_name',         { required: true, placeholder: 'Bari — Houston Heights' })}
          ${field('Type',                   'venture_type',         { required: true, select: [{value:'equity',label:'Equity'},{value:'deposit',label:'Deposit'}] })}
          ${field('Total Raise Target ($)', 'total_raise_target',   { type: 'number', step: '1', required: true, placeholder: '3500000' })}
          ${field('Amount Raised ($)',      'amount_raised',        { type: 'number', step: '1', placeholder: '0' })}
          ${field('Minimum Investment ($)', 'minimum_investment',   { type: 'number', step: '1', placeholder: '25000' })}
          ${field('Investment Horizon',     'investment_horizon',   { placeholder: '24-36 months' })}
          ${field('Projected Return Min (%)','projected_return_min',{ type: 'number', step: '0.01', placeholder: '14' })}
          ${field('Projected Return Max (%)','projected_return_max',{ type: 'number', step: '0.01', placeholder: '18' })}
          ${field('Status',                 'status',               { required: true, select: [{value:'open',label:'Open',selected:true},{value:'closed',label:'Closed'}] })}
        </div>
        <div class="oac-modal-row" style="grid-template-columns:1fr">
          ${field('Structure', 'structure', { placeholder: 'Preferred equity with 9% pref + 70/30 split above' })}
          ${field('Description', 'description', { textarea: true, placeholder: 'Short overview clients see on the opportunity card' })}
        </div>
        ${submitBar('Create Raise')}
      </form>`);
    const form = document.getElementById('oac-add-raise-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      handleFormSubmit(form, () => ({
        venture_name:         strOrNull(fd.get('venture_name')),
        venture_type:         strOrNull(fd.get('venture_type')),
        description:          strOrNull(fd.get('description')),
        total_raise_target:   numOrNull(fd.get('total_raise_target')),
        amount_raised:        numOrNull(fd.get('amount_raised')) ?? 0,
        minimum_investment:   numOrNull(fd.get('minimum_investment')),
        projected_return_min: numOrNull(fd.get('projected_return_min')),
        projected_return_max: numOrNull(fd.get('projected_return_max')),
        investment_horizon:   strOrNull(fd.get('investment_horizon')),
        structure:            strOrNull(fd.get('structure')),
        status:               String(fd.get('status'))
      }), 'raises');
    });
  }

  // ---------- Edit Investment modal ----------
  function openEditInvestmentModal(inv) {
    const clients = (window.__onixAdminData && window.__onixAdminData.clients) || [];
    const clientOpts = clientOptions(clients).map(o => ({ ...o, selected: o.value === inv.user_id }));
    openModal(`
      <h2>Edit Investment</h2>
      <div class="sub">${esc(inv.venture_name)}</div>
      <form id="oac-edit-inv-form">
        <div class="oac-modal-row" style="grid-template-columns:1fr">
          ${field('Client', 'user_id', { required: true, select: clientOpts })}
        </div>
        <div class="oac-modal-row">
          ${field('Venture Name',      'venture_name',      { required: true, value: inv.venture_name })}
          ${field('Type',              'venture_type',      { required: true, select: [
              { value: 'equity',  label: 'Equity',  selected: inv.venture_type === 'equity' },
              { value: 'deposit', label: 'Deposit', selected: inv.venture_type === 'deposit' }] })}
          ${field('Amount Invested ($)','amount_invested',  { type: 'number', step: '0.01', required: true, value: inv.amount_invested })}
          ${field('Ownership (%)',     'ownership_pct',     { type: 'number', step: '0.01', value: inv.ownership_pct })}
          ${field('Expected Return (%)','expected_return',  { type: 'number', step: '0.01', value: inv.expected_return })}
          ${field('Start Date',        'start_date',        { type: 'date', value: dateInput(inv.start_date) })}
          ${field('Status',            'status',            { required: true, select: [
              { value: 'active',  label: 'Active',  selected: inv.status === 'active' },
              { value: 'pending', label: 'Pending', selected: inv.status === 'pending' },
              { value: 'exited',  label: 'Exited',  selected: inv.status === 'exited' }] })}
        </div>
        ${submitBar('Save Changes')}
      </form>`);
    const form = document.getElementById('oac-edit-inv-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      handleUpdateSubmit(form, 'investments', inv.id, () => ({
        user_id:         String(fd.get('user_id')),
        venture_name:    strOrNull(fd.get('venture_name')),
        venture_type:    strOrNull(fd.get('venture_type')),
        amount_invested: numOrNull(fd.get('amount_invested')),
        ownership_pct:   numOrNull(fd.get('ownership_pct')),
        expected_return: numOrNull(fd.get('expected_return')),
        start_date:      strOrNull(fd.get('start_date')),
        status:          String(fd.get('status'))
      }));
    });
  }

  // ---------- Edit Raise modal ----------
  function openEditRaiseModal(r) {
    openModal(`
      <h2>Edit Raise</h2>
      <div class="sub">${esc(r.venture_name)}</div>
      <form id="oac-edit-raise-form">
        <div class="oac-modal-row">
          ${field('Venture Name',           'venture_name',         { required: true, value: r.venture_name })}
          ${field('Type',                   'venture_type',         { required: true, select: [
              { value: 'equity',  label: 'Equity',  selected: r.venture_type === 'equity' },
              { value: 'deposit', label: 'Deposit', selected: r.venture_type === 'deposit' }] })}
          ${field('Total Raise Target ($)', 'total_raise_target',   { type: 'number', step: '1', required: true, value: r.total_raise_target })}
          ${field('Amount Raised ($)',      'amount_raised',        { type: 'number', step: '1', value: r.amount_raised })}
          ${field('Minimum Investment ($)', 'minimum_investment',   { type: 'number', step: '1', value: r.minimum_investment })}
          ${field('Investment Horizon',     'investment_horizon',   { value: r.investment_horizon })}
          ${field('Projected Return Min (%)','projected_return_min',{ type: 'number', step: '0.01', value: r.projected_return_min })}
          ${field('Projected Return Max (%)','projected_return_max',{ type: 'number', step: '0.01', value: r.projected_return_max })}
          ${field('Status',                 'status',               { required: true, select: [
              { value: 'open',   label: 'Open',   selected: r.status === 'open' },
              { value: 'closed', label: 'Closed', selected: r.status === 'closed' }] })}
        </div>
        <div class="oac-modal-row" style="grid-template-columns:1fr">
          ${field('Structure', 'structure', { value: r.structure })}
        </div>
        <div class="oac-modal-row" style="grid-template-columns:1fr">
          <div><div class="k">Description</div><textarea name="description" rows="3" style="${INPUT_STYLE};resize:vertical;min-height:60px">${esc(r.description || '')}</textarea></div>
        </div>
        ${submitBar('Save Changes')}
      </form>`);
    const form = document.getElementById('oac-edit-raise-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      handleUpdateSubmit(form, 'raises', r.id, () => ({
        venture_name:         strOrNull(fd.get('venture_name')),
        venture_type:         strOrNull(fd.get('venture_type')),
        description:          strOrNull(fd.get('description')),
        total_raise_target:   numOrNull(fd.get('total_raise_target')),
        amount_raised:        numOrNull(fd.get('amount_raised')) ?? 0,
        minimum_investment:   numOrNull(fd.get('minimum_investment')),
        projected_return_min: numOrNull(fd.get('projected_return_min')),
        projected_return_max: numOrNull(fd.get('projected_return_max')),
        investment_horizon:   strOrNull(fd.get('investment_horizon')),
        structure:            strOrNull(fd.get('structure')),
        status:               String(fd.get('status'))
      }));
    });
  }

  // ---------- Add Payment modal (scoped to a single loan) ----------
  function openAddPaymentModal(loan) {
    openModal(`
      <h2>Add Payment</h2>
      <div class="sub">Loan ${esc(loan.loan_id_display || loan.id.slice(0,8))}</div>
      <form id="oac-add-payment-form">
        <div class="oac-modal-row">
          ${field('Due Date',        'due_date',      { type: 'date', required: true, value: new Date().toISOString().slice(0,10) })}
          ${field('Status',          'status',        { required: true, select: [
              { value: 'paid',      label: 'Paid',      selected: true },
              { value: 'scheduled', label: 'Scheduled' },
              { value: 'late',      label: 'Late' },
              { value: 'missed',    label: 'Missed' }
          ] })}
          ${field('Amount Due ($)',   'amount_due',    { type: 'number', step: '0.01', placeholder: '4218' })}
          ${field('Paid Date',        'paid_at',       { type: 'date' })}
          ${field('Principal ($)',    'principal',     { type: 'number', step: '0.01' })}
          ${field('Interest ($)',     'interest',      { type: 'number', step: '0.01' })}
          ${field('Balance After ($)','balance_after', { type: 'number', step: '0.01' })}
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:.82rem;color:#1A1A1A;margin:4px 0 4px;cursor:pointer">
          <input type="checkbox" name="send_email" checked style="width:16px;height:16px;cursor:pointer">
          Email a confirmation to the client and Onix staff
        </label>
        ${submitBar('Record Payment')}
      </form>`);
    const form = document.getElementById('oac-add-payment-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const submitBtn = form.querySelector('[data-form-submit]');
      const errEl = form.querySelector('#oac-form-err');
      errEl.style.display = 'none';
      submitBtn.disabled = true; submitBtn.textContent = 'Saving…';
      const payload = {
        loan_id:        loan.id,
        due_date:       strOrNull(fd.get('due_date')),
        status:         String(fd.get('status')),
        amount_due:     numOrNull(fd.get('amount_due')),
        paid_at:        strOrNull(fd.get('paid_at')),
        principal:      numOrNull(fd.get('principal')),
        interest:       numOrNull(fd.get('interest')),
        balance_after:  numOrNull(fd.get('balance_after'))
      };
      const { error } = await OnixDB.client.from('loan_payments').insert(payload);
      if (error) {
        errEl.style.display = 'block';
        errEl.textContent = error.message || 'Could not save.';
        submitBtn.disabled = false; submitBtn.textContent = 'Record Payment';
        return;
      }
      // Send confirmation email when the payment is marked Paid and the box is ticked.
      const wantEmail = fd.get('send_email') === 'on';
      if (wantEmail && payload.status === 'paid') {
        OnixDB.client.functions.invoke('send-payment-confirmation-email', {
          body: {
            client_name:     (loan.profiles && loan.profiles.full_name) || '',
            client_email:    (loan.profiles && loan.profiles.email) || '',
            amount:          payload.amount_due,
            paid_at:         payload.paid_at || payload.due_date,
            loan_id_display: loan.loan_id_display || '',
            balance_after:   payload.balance_after
          }
        }).catch(err => console.error('[onix-admin] payment email failed:', err));
      }
      document.getElementById('oac-modal').classList.remove('open');
      refreshAll();
    });
  }

  // ---------- Add Distribution modal (scoped to a single investment) ----------
  function openAddDistributionModal(inv) {
    openModal(`
      <h2>Add Distribution</h2>
      <div class="sub">${esc(inv.venture_name)}</div>
      <form id="oac-add-dist-form">
        <div class="oac-modal-row">
          ${field('Paid Date', 'paid_at', { type: 'date', required: true, value: new Date().toISOString().slice(0,10) })}
          ${field('Amount ($)','amount',  { type: 'number', step: '0.01', required: true })}
          ${field('Kind',     'kind',    { required: true, select: [
              { value: 'distribution',      label: 'Distribution', selected: true },
              { value: 'interest',          label: 'Interest' },
              { value: 'dividend',          label: 'Dividend' },
              { value: 'return_of_capital', label: 'Return of Capital' },
              { value: 'other',             label: 'Other' }
          ] })}
        </div>
        <div class="oac-modal-row" style="grid-template-columns:1fr">
          ${field('Notes', 'notes', { textarea: true, placeholder: 'Optional context for this distribution' })}
        </div>
        ${submitBar('Record Distribution')}
      </form>`);
    const form = document.getElementById('oac-add-dist-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      handleFormSubmit(form, () => ({
        investment_id: inv.id,
        paid_at:       strOrNull(fd.get('paid_at')),
        amount:        numOrNull(fd.get('amount')),
        kind:          String(fd.get('kind')),
        notes:         strOrNull(fd.get('notes'))
      }), 'distributions');
    });
  }

  // ---------- New Client modal ----------
  function openNewClientModal() {
    openModal(`
      <h2>Add New Client</h2>
      <div class="sub">Creates an Onix Finance account immediately</div>
      <form id="oac-new-client-form">
        <div class="oac-modal-row">
          <div>
            <div class="k">Full Name</div>
            <input name="full_name" required style="width:100%;padding:10px 12px;border:1px solid #E8E8E8;font-size:.9rem;font-family:inherit;outline:none" placeholder="Carlos Mendoza">
          </div>
          <div>
            <div class="k">Email</div>
            <input name="email" type="email" required style="width:100%;padding:10px 12px;border:1px solid #E8E8E8;font-size:.9rem;font-family:inherit;outline:none" placeholder="client@onixfinance.com">
          </div>
          <div>
            <div class="k">Temporary Password</div>
            <input name="password" type="text" required minlength="6" style="width:100%;padding:10px 12px;border:1px solid #E8E8E8;font-size:.9rem;font-family:inherit;outline:none" placeholder="At least 6 characters">
          </div>
          <div>
            <div class="k">Role</div>
            <select name="role" style="width:100%;padding:10px 12px;border:1px solid #E8E8E8;font-size:.9rem;font-family:inherit;outline:none;background:#fff">
              <option value="client" selected>Client (default)</option>
              <option value="client">Client · Investor</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div>
            <div class="k">Status</div>
            <select name="status" style="width:100%;padding:10px 12px;border:1px solid #E8E8E8;font-size:.9rem;font-family:inherit;outline:none;background:#fff">
              <option value="active" selected>Active (can sign in immediately)</option>
              <option value="pending">Pending (needs approval)</option>
            </select>
          </div>
        </div>
        <div id="oac-new-client-err" style="color:#C0392B;font-size:.85rem;margin-bottom:10px;display:none"></div>
        <div class="oac-modal-foot" style="margin-top:0">
          <button type="button" class="oac-btn outline" data-modal-close>Cancel</button>
          <button type="submit" class="oac-btn red" id="oac-new-client-submit">Create Client</button>
        </div>
      </form>
    `);
    const form = document.getElementById('oac-new-client-form');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const submitBtn = document.getElementById('oac-new-client-submit');
      const errEl = document.getElementById('oac-new-client-err');
      errEl.style.display = 'none';
      submitBtn.disabled = true; submitBtn.textContent = 'Creating…';
      const { data, error } = await OnixDB.client.rpc('admin_create_client', {
        p_email:     String(fd.get('email')).trim().toLowerCase(),
        p_password:  String(fd.get('password')),
        p_full_name: String(fd.get('full_name')).trim(),
        p_role:      String(fd.get('role')),
        p_status:    String(fd.get('status'))
      });
      if (error) {
        errEl.style.display = 'block';
        errEl.textContent = error.message || 'Could not create client.';
        submitBtn.disabled = false; submitBtn.textContent = 'Create Client';
        return;
      }
      // Close modal and reload data
      document.getElementById('oac-modal').classList.remove('open');
      refreshAll();
    });
  }

  function actionBarBtn(label, id, exportId) {
    const exportBtn = exportId
      ? `<a href="#" id="${esc(exportId)}" style="display:inline-block;background:#fff;color:#1A1A1A;padding:10px 18px;font:600 .72rem/1 'DM Sans',sans-serif;text-transform:uppercase;letter-spacing:.1em;border:1px solid #E8E8E8;border-radius:2px;text-decoration:none;margin-right:8px">Export CSV</a>`
      : '';
    return `<div style="display:flex;justify-content:flex-end;margin-bottom:14px;gap:0">${exportBtn}
      <a href="#" id="${esc(id)}" style="display:inline-block;background:#C0392B;color:#fff;padding:10px 18px;font:600 .72rem/1 'DM Sans',sans-serif;text-transform:uppercase;letter-spacing:.1em;border:1px solid #C0392B;border-radius:2px;text-decoration:none">${esc(label)}</a>
    </div>`;
  }

  // ---------- CSV export ----------
  function csvEscape(v) {
    if (v == null) return '';
    const s = String(v).replace(/"/g, '""');
    return /[",\n\r]/.test(s) ? '"' + s + '"' : s;
  }
  function downloadCsv(filename, headers, rows) {
    const lines = [headers.map(csvEscape).join(',')];
    rows.forEach(r => lines.push(headers.map(h => csvEscape(r[h])).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function isoDate(s) { return s ? String(s).slice(0, 10) : ''; }
  function wireExport(scope, id, onClick) {
    const btn = scope.querySelector('#' + id);
    if (btn) btn.addEventListener('click', e => { e.preventDefault(); onClick(); });
  }

  function paintLoansView(loansAll) {
    const v = findView(STATIC_VIEWS.loans); if (!v) return false;
    if (alreadyPainted(v)) return true;
    // Rows synced in from OUS Pasiva are deposits, not real loans made by
    // Onix — those live under the Active Deposits tab. Active Loans shows
    // everything else (manually-created rows and OUS Activa-synced loans).
    const loans = (loansAll || []).filter(l => l.data_source !== 'ous_pasiva');
    const rows = loans.length ? loans.map((l, i) => `
      <tr>
        <td>${esc(l.loan_id_display || l.id.slice(0,8))}</td>
        <td>${esc((l.profiles && (up(l.profiles.full_name) || l.profiles.email)) || l.user_id)}</td>
        <td>${fmt.money(l.balance)}</td>
        <td>${fmt.pct(l.interest_rate)}</td>
        <td>${fmt.money(l.monthly_payment)}</td>
        <td>${fmt.date(l.next_due_date)}</td>
        <td><span class="oac-badge ${esc(l.status || '')}">${esc(l.status || '—')}</span></td>
        <td style="text-align:right;white-space:nowrap">
          <a href="#" data-view-static-loan="${i}" style="display:inline-block;background:#C0392B;color:#fff;padding:6px 12px;font:600 .68rem/1 'DM Sans',sans-serif;text-transform:uppercase;letter-spacing:.08em;border:1px solid #C0392B;border-radius:2px;margin-right:4px;text-decoration:none">View</a>
          ${contactAnchor(l.profiles && l.profiles.email, 'Loan ' + (l.loan_id_display || ''))}
        </td>
      </tr>`).join('') : '<tr><td colspan="8" class="oac-empty">No loans yet.</td></tr>';
    v.innerHTML = viewShell('Loans', 'Active and historical loans',
      actionBarBtn('+ Add Loan', 'oac-add-loan-btn', 'oac-export-loans') +
      `<table class="oac-table" style="width:100%"><thead><tr>
        <th>Loan ID</th><th>Client</th><th>Balance</th><th>Rate</th><th>Payment</th><th>Next Due</th><th>Status</th><th style="text-align:right">Actions</th>
      </tr></thead><tbody>${rows}</tbody></table>`);
    v.querySelectorAll('[data-view-static-loan]').forEach(b => {
      b.addEventListener('click', (e) => { e.preventDefault(); viewLoan(loans[Number(b.dataset.viewStaticLoan)]); });
    });
    const addBtn = v.querySelector('#oac-add-loan-btn');
    if (addBtn) addBtn.addEventListener('click', (e) => { e.preventDefault(); openAddLoanModal(); });
    wireExport(v, 'oac-export-loans', () => {
      downloadCsv('onix-loans-' + isoDate(new Date().toISOString()) + '.csv',
        ['loan_id', 'client_name', 'client_email', 'balance', 'interest_rate', 'monthly_payment', 'next_due_date', 'origination_date', 'maturity_date', 'term_months', 'collateral_address', 'status'],
        loans.map(l => ({
          loan_id: l.loan_id_display || l.id,
          client_name: (l.profiles && l.profiles.full_name) || '',
          client_email: (l.profiles && l.profiles.email) || '',
          balance: l.balance,
          interest_rate: l.interest_rate,
          monthly_payment: l.monthly_payment,
          next_due_date: isoDate(l.next_due_date),
          origination_date: isoDate(l.origination_date),
          maturity_date: isoDate(l.maturity_date),
          term_months: l.term_months,
          collateral_address: l.collateral_address,
          status: l.status
        })));
    });
    return true;
  }

  // ---------- Active Deposits view -----------------------------------
  // Mirrors the Active Loans tab exactly — same columns, actions, and
  // export shape. The only real difference is what the "+ Add" button
  // opens (openAddInvestmentModal for a deposit-type investment) and
  // the exported filename. Rows source directly from data.loans so
  // every real client shows up here the same as they do under Active
  // Loans; when real deposit records (investments with
  // venture_type='deposit') exist they're appended after the loans.
  function paintActiveDepositsView(loans, investments) {
    const v = findView(STATIC_VIEWS.activeDeposits); if (!v) return false;
    if (alreadyPainted(v)) return true;
    // Only pull rows sourced from OUS Pasiva — those are the real deposits.
    // Manual and OUS Activa loan rows stay under Active Loans.
    const loanRows = (loans || []).filter(l => l.data_source === 'ous_pasiva').map(l => ({
      _kind: 'loan',
      _src: l,
      deposit_id: l.loan_id_display || l.id.slice(0,8),
      client: (l.profiles && (up(l.profiles.full_name) || l.profiles.email)) || l.user_id,
      client_email: (l.profiles && l.profiles.email) || '',
      balance: l.balance,
      rate: l.interest_rate,
      payment: l.monthly_payment,
      next_due: l.next_due_date,
      status: l.status || '—'
    }));
    const depositInvRows = (investments || [])
      .filter(i => (i.venture_type || '').toLowerCase() === 'deposit')
      .map(d => ({
        _kind: 'inv',
        _src: d,
        deposit_id: d.venture_name || d.id.slice(0,8),
        client: (d.profiles && (up(d.profiles.full_name) || d.profiles.email)) || d.user_id,
        client_email: (d.profiles && d.profiles.email) || '',
        balance: d.amount_invested,
        rate: d.expected_return,
        payment: null,
        next_due: null,
        status: d.status || '—'
      }));
    const all = loanRows.concat(depositInvRows);
    const rows = all.length ? all.map((r, i) => `
      <tr>
        <td>${esc(r.deposit_id)}</td>
        <td>${esc(r.client)}</td>
        <td>${fmt.money(r.balance)}</td>
        <td>${r.rate != null ? fmt.pct(r.rate) : '—'}</td>
        <td>${r.payment != null ? fmt.money(r.payment) : '—'}</td>
        <td>${r.next_due ? fmt.date(r.next_due) : '—'}</td>
        <td><span class="oac-badge ${esc(r.status)}">${esc(r.status)}</span></td>
        <td style="text-align:right;white-space:nowrap">
          <a href="#" data-view-static-dep="${i}" style="display:inline-block;background:#C0392B;color:#fff;padding:6px 12px;font:600 .68rem/1 'DM Sans',sans-serif;text-transform:uppercase;letter-spacing:.08em;border:1px solid #C0392B;border-radius:2px;margin-right:4px;text-decoration:none">View</a>
          ${contactAnchor(r.client_email, 'Deposit ' + r.deposit_id)}
        </td>
      </tr>`).join('') : '<tr><td colspan="8" class="oac-empty">No deposits yet.</td></tr>';
    v.innerHTML = viewShell('Deposits', 'Active and historical client deposits',
      actionBarBtn('+ Add Deposit', 'oac-add-deposit-btn', 'oac-export-deposits') +
      `<table class="oac-table" style="width:100%"><thead><tr>
        <th>Deposit ID</th><th>Client</th><th>Balance</th><th>Rate</th><th>Payment</th><th>Next Due</th><th>Status</th><th style="text-align:right">Actions</th>
      </tr></thead><tbody>${rows}</tbody></table>`);
    v.querySelectorAll('[data-view-static-dep]').forEach(b => {
      b.addEventListener('click', (e) => {
        e.preventDefault();
        const r = all[Number(b.dataset.viewStaticDep)];
        if (!r) return;
        if (r._kind === 'loan') viewLoan(r._src);
        else                    viewInvestment(r._src);
      });
    });
    const addBtn = v.querySelector('#oac-add-deposit-btn');
    if (addBtn) addBtn.addEventListener('click', (e) => { e.preventDefault(); openAddInvestmentModal(); });
    wireExport(v, 'oac-export-deposits', () => {
      downloadCsv('onix-deposits-' + isoDate(new Date().toISOString()) + '.csv',
        ['deposit_id', 'client_name', 'client_email', 'balance', 'rate', 'payment', 'next_due', 'status'],
        all.map(r => ({
          deposit_id: r.deposit_id,
          client_name: r.client,
          client_email: r.client_email,
          balance: r.balance,
          rate: r.rate,
          payment: r.payment,
          next_due: isoDate(r.next_due),
          status: r.status
        })));
    });
    return true;
  }

  // Inject the "Active Deposits" sidebar item + view container. Same
  // dynamic-inject pattern the Calendar tab uses (see
  // ensureCalendarSidebarAndView) because the Bolt bundler swaps the
  // <head>/sidebar out after first load — every tick we make sure the
  // button + view are still present. Idempotent.
  function ensureActiveDepositsSidebarAndView() {
    if (document.getElementById('view-active-deposits') &&
        document.querySelector('[data-view="active-deposits"]')) return true;
    const sidebar = document.querySelector('.sidebar');
    const main    = document.querySelector('.main');
    if (!sidebar || !main) return false;

    if (!sidebar.querySelector('[data-view="active-deposits"]')) {
      // Anchor right after the "Active Loans" sidebar button so the new
      // item sits under Lending.
      const anchor = sidebar.querySelector('[data-view="loans"]');
      const btn = document.createElement('button');
      btn.className = 'sidebar-item';
      btn.setAttribute('data-view', 'active-deposits');
      btn.setAttribute('onclick', "showView('active-deposits')");
      btn.innerHTML =
        // Piggy-bank / deposit-style icon — coin drop into a slot.
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<rect x="3" y="7" width="18" height="14" rx="2" ry="2"/>' +
          '<path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' +
          '<line x1="12" y1="11" x2="12" y2="17"/>' +
          '<line x1="9" y1="14" x2="15" y2="14"/>' +
        '</svg>' +
        '<span data-en="Active Deposits" data-es="Depósitos Activos">Active Deposits</span>';
      if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(btn, anchor.nextSibling);
      } else {
        sidebar.appendChild(btn);
      }
    }

    if (!document.getElementById('view-active-deposits')) {
      const v = document.createElement('div');
      v.className = 'view';
      v.id = 'view-active-deposits';
      main.appendChild(v);
    }
    return true;
  }

  function paintInvestmentsView(invs) {
    const v = findView(STATIC_VIEWS.investments); if (!v) return false;
    if (alreadyPainted(v)) return true;
    const rows = invs.length ? invs.map((it, i) => `
      <tr>
        <td>${esc((it.profiles && (up(it.profiles.full_name) || it.profiles.email)) || it.user_id)}</td>
        <td>${esc(it.venture_name)}</td>
        <td>${esc(it.venture_type || '—')}</td>
        <td>${fmt.money(it.amount_invested)}</td>
        <td>${it.ownership_pct != null ? fmt.pct(it.ownership_pct) : '—'}</td>
        <td>${it.expected_return != null ? fmt.pct(it.expected_return) : '—'}</td>
        <td><span class="oac-badge ${esc(it.status || '')}">${esc(it.status || '—')}</span></td>
        <td style="text-align:right;white-space:nowrap">
          <a href="#" data-view-static-inv="${i}" style="display:inline-block;background:#C0392B;color:#fff;padding:6px 12px;font:600 .68rem/1 'DM Sans',sans-serif;text-transform:uppercase;letter-spacing:.08em;border:1px solid #C0392B;border-radius:2px;margin-right:4px;text-decoration:none">View</a>
          ${contactAnchor(it.profiles && it.profiles.email, it.venture_name)}
        </td>
      </tr>`).join('') : '<tr><td colspan="8" class="oac-empty">No investments yet.</td></tr>';
    v.innerHTML = viewShell('Investments', 'Client positions across every venture',
      actionBarBtn('+ Add Investment', 'oac-add-inv-btn', 'oac-export-investments') +
      `<table class="oac-table" style="width:100%"><thead><tr>
        <th>Client</th><th>Venture</th><th>Type</th><th>Invested</th><th>Ownership</th><th>Return</th><th>Status</th><th style="text-align:right">Actions</th>
      </tr></thead><tbody>${rows}</tbody></table>`);
    v.querySelectorAll('[data-view-static-inv]').forEach(b => {
      b.addEventListener('click', (e) => { e.preventDefault(); viewInvestment(invs[Number(b.dataset.viewStaticInv)]); });
    });
    const addBtn = v.querySelector('#oac-add-inv-btn');
    if (addBtn) addBtn.addEventListener('click', (e) => { e.preventDefault(); openAddInvestmentModal(); });
    wireExport(v, 'oac-export-investments', () => {
      downloadCsv('onix-investments-' + isoDate(new Date().toISOString()) + '.csv',
        ['client_name', 'client_email', 'venture_name', 'venture_type', 'amount_invested', 'ownership_pct', 'expected_return', 'start_date', 'status'],
        invs.map(i => ({
          client_name: (i.profiles && i.profiles.full_name) || '',
          client_email: (i.profiles && i.profiles.email) || '',
          venture_name: i.venture_name,
          venture_type: i.venture_type,
          amount_invested: i.amount_invested,
          ownership_pct: i.ownership_pct,
          expected_return: i.expected_return,
          start_date: isoDate(i.start_date),
          status: i.status
        })));
    });
    return true;
  }

  function paintRaisesView(raises) {
    const v = findView(STATIC_VIEWS.raises); if (!v) return false;
    if (alreadyPainted(v)) return true;
    const rows = raises.length ? raises.map((r, i) => `
      <tr>
        <td>${esc(r.venture_name)}</td>
        <td>${esc(r.venture_type || '—')}</td>
        <td>${fmt.money(r.total_raise_target)}</td>
        <td>${fmt.money(r.amount_raised)}</td>
        <td>${fmt.money(r.minimum_investment)}</td>
        <td>${(r.projected_return_min != null && r.projected_return_max != null) ? r.projected_return_min + '–' + r.projected_return_max + '%' : '—'}</td>
        <td><span class="oac-badge ${esc(r.status || '')}">${esc(r.status || '—')}</span></td>
        <td style="text-align:right;white-space:nowrap">
          <a href="#" data-view-static-raise="${i}" style="display:inline-block;background:#C0392B;color:#fff;padding:6px 12px;font:600 .68rem/1 'DM Sans',sans-serif;text-transform:uppercase;letter-spacing:.08em;border:1px solid #C0392B;border-radius:2px;margin-right:4px;text-decoration:none">View</a>
          <a href="mailto:info@onixfinance.com?subject=${encodeURIComponent('Onix Finance · ' + r.venture_name)}" style="display:inline-block;background:#fff;color:#1A1A1A;padding:6px 12px;font:600 .68rem/1 'DM Sans',sans-serif;text-transform:uppercase;letter-spacing:.08em;border:1px solid #E8E8E8;border-radius:2px;text-decoration:none">Contact</a>
        </td>
      </tr>`).join('') : '<tr><td colspan="8" class="oac-empty">No raises yet.</td></tr>';
    v.innerHTML = viewShell('Raises', 'Active and historical investment opportunities',
      actionBarBtn('+ Add Raise', 'oac-add-raise-btn', 'oac-export-raises') +
      `<table class="oac-table" style="width:100%"><thead><tr>
        <th>Venture</th><th>Type</th><th>Goal</th><th>Raised</th><th>Min</th><th>IRR</th><th>Status</th><th style="text-align:right">Actions</th>
      </tr></thead><tbody>${rows}</tbody></table>`);
    v.querySelectorAll('[data-view-static-raise]').forEach(b => {
      b.addEventListener('click', (e) => { e.preventDefault(); viewRaise(raises[Number(b.dataset.viewStaticRaise)]); });
    });
    const addBtn = v.querySelector('#oac-add-raise-btn');
    if (addBtn) addBtn.addEventListener('click', (e) => { e.preventDefault(); openAddRaiseModal(); });
    wireExport(v, 'oac-export-raises', () => {
      downloadCsv('onix-raises-' + isoDate(new Date().toISOString()) + '.csv',
        ['venture_name', 'venture_type', 'total_raise_target', 'amount_raised', 'minimum_investment', 'projected_return_min', 'projected_return_max', 'investment_horizon', 'structure', 'status'],
        raises.map(r => ({
          venture_name: r.venture_name,
          venture_type: r.venture_type,
          total_raise_target: r.total_raise_target,
          amount_raised: r.amount_raised,
          minimum_investment: r.minimum_investment,
          projected_return_min: r.projected_return_min,
          projected_return_max: r.projected_return_max,
          investment_horizon: r.investment_horizon,
          structure: r.structure,
          status: r.status
        })));
    });
    return true;
  }

  function paintApplicationsView(applications) {
    const v = findView(STATIC_VIEWS.applications); if (!v) return false;
    if (alreadyPainted(v)) return true;
    const rows = applications.length ? applications.map((a, i) => {
      const isDeposit = a.application_type === 'deposit';
      return `
      <tr>
        <td>${fmt.date(a.submitted_at)}</td>
        <td>${esc((a.profiles && (up(a.profiles.full_name) || a.profiles.email)) || a.user_id)}</td>
        <td><span class="oac-badge ${isDeposit ? 'active' : 'pending'}">${isDeposit ? 'Deposit' : 'Loan'}</span></td>
        <td>${fmt.money(a.amount_requested)}</td>
        <td>${esc(a.applicant_type || '—')}</td>
        <td>${esc(isDeposit ? '—' : (a.purpose || '—'))}</td>
        <td><span class="oac-badge ${esc(a.status || '')}">${esc(a.status || '—')}</span></td>
        <td style="text-align:right;white-space:nowrap">
          <a href="#" data-view-static-app="${i}" style="display:inline-block;background:#C0392B;color:#fff;padding:6px 12px;font:600 .68rem/1 'DM Sans',sans-serif;text-transform:uppercase;letter-spacing:.08em;border:1px solid #C0392B;border-radius:2px;margin-right:4px;text-decoration:none">View</a>
          ${contactAnchor(a.profiles && a.profiles.email, (isDeposit ? 'Deposit' : 'Loan') + ' Application')}
        </td>
      </tr>`;
    }).join('') : '<tr><td colspan="8" class="oac-empty">No applications submitted yet.</td></tr>';
    const exportBar = `<div style="display:flex;justify-content:flex-end;margin-bottom:14px"><a href="#" id="oac-export-apps" style="display:inline-block;background:#fff;color:#1A1A1A;padding:10px 18px;font:600 .72rem/1 'DM Sans',sans-serif;text-transform:uppercase;letter-spacing:.1em;border:1px solid #E8E8E8;border-radius:2px;text-decoration:none">Export CSV</a></div>`;
    v.innerHTML = viewShell('Applications', 'Loan and deposit applications submitted via the client portal',
      exportBar +
      `<table class="oac-table" style="width:100%"><thead><tr>
        <th>Submitted</th><th>Client</th><th>Product</th><th>Amount</th><th>Type</th><th>Purpose</th><th>Status</th><th style="text-align:right">Actions</th>
      </tr></thead><tbody>${rows}</tbody></table>`);
    v.querySelectorAll('[data-view-static-app]').forEach(b => {
      b.addEventListener('click', (e) => { e.preventDefault(); viewApplication(applications[Number(b.dataset.viewStaticApp)]); });
    });
    wireExport(v, 'oac-export-apps', () => {
      downloadCsv('onix-applications-' + isoDate(new Date().toISOString()) + '.csv',
        ['submitted_at', 'client_name', 'client_email', 'application_type', 'amount_requested', 'applicant_type', 'purpose', 'status', 'notes'],
        applications.map(a => ({
          submitted_at: isoDate(a.submitted_at),
          client_name: (a.profiles && a.profiles.full_name) || '',
          client_email: (a.profiles && a.profiles.email) || '',
          application_type: a.application_type || 'loan',
          amount_requested: a.amount_requested,
          applicant_type: a.applicant_type,
          purpose: a.purpose,
          status: a.status,
          notes: a.notes
        })));
    });
    return true;
  }

  function contactAnchor(email, label) {
    const baseStyle = "display:inline-block;background:#fff;color:#1A1A1A;padding:6px 12px;font:600 .68rem/1 'DM Sans',sans-serif;text-transform:uppercase;letter-spacing:.08em;border:1px solid #E8E8E8;border-radius:2px;text-decoration:none";
    if (!email) return `<span style="${baseStyle};opacity:.5">No email</span>`;
    return `<a href="mailto:${esc(email)}?subject=${encodeURIComponent('Onix Finance · ' + (label || ''))}" style="${baseStyle}">Contact</a>`;
  }

  // Persistent painter: the admin design renders async AND may re-render
  // when the user switches tabs. We poll every 600ms for the lifetime of the
  // session — paint functions are no-ops once a view is already painted, so
  // the cost is one querySelector per tab per tick.
  // ---------- Global search (top bar) ----------
  function wireGlobalSearch(data) {
    const input = document.querySelector('input[data-ph-en*="Search clients"], input[placeholder*="Search clients"]');
    if (!input || input.dataset.oacSearchWired === '1') return;
    input.dataset.oacSearchWired = '1';

    // Results dropdown anchored under the input.
    const box = document.createElement('div');
    box.id = 'oac-search-results';
    box.style.cssText = 'position:absolute;z-index:9500;background:#fff;border:1px solid #E8E8E8;border-top:3px solid #C0392B;box-shadow:0 16px 48px rgba(0,0,0,.18);max-height:60vh;overflow-y:auto;display:none;font-family:"DM Sans",sans-serif;min-width:340px';
    document.body.appendChild(box);

    function positionBox() {
      const r = input.getBoundingClientRect();
      box.style.left = r.left + 'px';
      box.style.top = (r.bottom + 6) + 'px';
      box.style.width = Math.max(r.width, 340) + 'px';
    }

    function hide() { box.style.display = 'none'; }

    function run(q) {
      q = q.trim().toLowerCase();
      if (q.length < 2) { hide(); return; }
      const d = window.__onixAdminData || data;
      const hit = (s) => String(s || '').toLowerCase().includes(q);
      const results = [];
      (d.clients || []).forEach(c => {
        if (hit(c.full_name) || hit(c.email)) results.push({ type: 'Client', label: up(c.full_name) || c.email, sub: c.email + ' · ' + (c.status || ''), act: null });
      });
      (d.loans || []).forEach((l, i) => {
        const cn = (l.profiles && (up(l.profiles.full_name) || l.profiles.email)) || '';
        // OUS Pasiva rows are deposits, not loans — see Active Deposits tab
        // and CAL_TYPES.deposit_closing for the same distinction elsewhere.
        const isDeposit = l.data_source === 'ous_pasiva';
        if (hit(l.loan_id_display) || hit(cn)) results.push({ type: isDeposit ? 'Deposit' : 'Loan', label: l.loan_id_display || l.id.slice(0,8), sub: cn + ' · ' + fmt.money(l.balance), act: () => viewLoan(l) });
      });
      (d.investments || []).forEach(inv => {
        const cn = (inv.profiles && (up(inv.profiles.full_name) || inv.profiles.email)) || '';
        if (hit(inv.venture_name) || hit(cn)) results.push({ type: 'Investment', label: inv.venture_name, sub: cn + ' · ' + fmt.money(inv.amount_invested), act: () => viewInvestment(inv) });
      });
      (d.raises || []).forEach(r => {
        if (hit(r.venture_name)) results.push({ type: 'Raise', label: r.venture_name, sub: (r.status || '') + ' · ' + fmt.money(r.total_raise_target), act: () => viewRaise(r) });
      });
      (d.applications || []).forEach(a => {
        const cn = (a.profiles && (up(a.profiles.full_name) || a.profiles.email)) || '';
        if (hit(cn) || hit(a.purpose)) results.push({ type: 'Application', label: cn || 'Application', sub: fmt.money(a.amount_requested) + ' · ' + (a.status || 'pending'), act: () => viewApplication(a) });
      });

      const top = results.slice(0, 20);
      if (!top.length) {
        box.innerHTML = '<div style="padding:16px 18px;color:#9B9590;font-size:.85rem;font-style:italic">No matches for “' + esc(q) + '”.</div>';
      } else {
        box.innerHTML = top.map((r, i) => `
          <div data-search-idx="${i}" style="padding:11px 16px;border-bottom:1px solid #f6f6f6;cursor:${r.act ? 'pointer' : 'default'};display:flex;justify-content:space-between;gap:12px;align-items:center">
            <div><div style="font-size:.86rem;font-weight:600;color:#1A1A1A">${esc(r.label)}</div>
            <div style="font-size:.74rem;color:#888;margin-top:1px">${esc(r.sub)}</div></div>
            <span style="font-size:.6rem;letter-spacing:.1em;text-transform:uppercase;color:#C0392B;font-weight:700;white-space:nowrap">${esc(r.type)}</span>
          </div>`).join('');
        box.querySelectorAll('[data-search-idx]').forEach(el => {
          const r = top[Number(el.dataset.searchIdx)];
          if (r.act) el.addEventListener('click', () => { hide(); input.value = ''; r.act(); });
          el.addEventListener('mouseenter', () => el.style.background = '#FAFAFA');
          el.addEventListener('mouseleave', () => el.style.background = '#fff');
        });
      }
      positionBox();
      box.style.display = 'block';
    }

    let t;
    input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => run(input.value), 150); });
    input.addEventListener('focus', () => { if (input.value.trim().length >= 2) run(input.value); });
    document.addEventListener('click', (e) => {
      if (e.target !== input && !box.contains(e.target)) hide();
    });
    window.addEventListener('resize', () => { if (box.style.display === 'block') positionBox(); });
  }

  // ── Chart helpers ─────────────────────────────────────────────────────────

  // Return the last N months as 'Mon' labels ending at today.
  function lastNMonthLabels(n) {
    const labels = [];
    const d = new Date();
    d.setDate(1);
    for (let i = n - 1; i >= 0; i--) {
      const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
      labels.push(m.toLocaleString('en-US', { month: 'short' }));
    }
    return labels;
  }

  // Sum `field` on items grouped by the calendar month of `dateField`,
  // returning an array aligned to the last N months (0 for missing months).
  function sumByMonth(items, dateField, field, n) {
    const now = new Date();
    const buckets = {};
    for (let i = n - 1; i >= 0; i--) {
      const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets[m.getFullYear() + '-' + m.getMonth()] = 0;
    }
    items.forEach(item => {
      if (!item[dateField]) return;
      const d = new Date(item[dateField]);
      const key = d.getFullYear() + '-' + d.getMonth();
      if (key in buckets) buckets[key] += Number(item[field] || 0);
    });
    return Object.values(buckets);
  }

  // Earliest calendar month across `items`, keyed off `dateField` (falling
  // back to `fallbackField` when that's null) — null if no item has either.
  // Used to find where a chart's real data actually starts, instead of
  // always rendering a fixed trailing window that pads with meaningless
  // leading zero months.
  function earliestMonth(items, dateField, fallbackField) {
    let earliest = null;
    items.forEach(item => {
      const raw = item[dateField] || (fallbackField && item[fallbackField]);
      if (!raw) return;
      const d = new Date(raw);
      if (isNaN(d)) return;
      const m = new Date(d.getFullYear(), d.getMonth(), 1);
      if (!earliest || m < earliest) earliest = m;
    });
    return earliest;
  }

  // Month labels from `start` (a Date; day-of-month ignored) through `now`,
  // inclusive. Adds a "'YY" suffix once the range crosses a calendar year —
  // plain 'Mon' labels (as lastNMonthLabels() uses for its fixed <=12-month
  // windows) would otherwise repeat ambiguously, e.g. two "Jan" ticks, once
  // a chart's window is allowed to span multiple years.
  function monthLabelsFrom(start, now) {
    const labels = [];
    const d = new Date(start.getFullYear(), start.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 1);
    const spansYears = start.getFullYear() !== end.getFullYear();
    while (d <= end) {
      const label = d.toLocaleString('en-US', { month: 'short' });
      labels.push(spansYears ? label + " '" + String(d.getFullYear()).slice(2) : label);
      d.setMonth(d.getMonth() + 1);
    }
    return labels;
  }

  // Sum `field` on items grouped by calendar month of `dateField` (falling
  // back to `fallbackField` when that's null), for every month from `start`
  // through `now` inclusive — a dynamic-width counterpart to sumByMonth()'s
  // fixed trailing-N-month window.
  function sumByMonthFrom(items, start, dateField, fallbackField, field, now) {
    const buckets = {};
    const d = new Date(start.getFullYear(), start.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 1);
    while (d <= end) {
      buckets[d.getFullYear() + '-' + d.getMonth()] = 0;
      d.setMonth(d.getMonth() + 1);
    }
    items.forEach(item => {
      const raw = item[dateField] || (fallbackField && item[fallbackField]);
      if (!raw) return;
      const dt = new Date(raw);
      if (isNaN(dt)) return;
      const key = dt.getFullYear() + '-' + dt.getMonth();
      if (key in buckets) buckets[key] += Number(item[field] || 0);
    });
    return Object.values(buckets);
  }

  // Update a Chart.js instance's labels + first dataset data in place.
  // Mutates the existing arrays rather than replacing them — Chart.js's
  // option-scope resolver proxies wrap these objects, and wholesale
  // replacement on a recurring timer is what caused runaway "Object.set"
  // recursion (see CLAUDE.md investigation notes).
  function setChartData(chart, labels, data) {
    chart.data.labels.length = 0;
    chart.data.labels.push(...labels);
    chart.data.datasets[0].data.length = 0;
    chart.data.datasets[0].data.push(...data);
    chart.update('none');
  }

  // Find a Chart.js instance by canvas ID (works with Chart.js v3+).
  function getChart(id) {
    const canvas = document.getElementById(id);
    if (!canvas) return null;
    if (typeof Chart === 'undefined') return null;
    return typeof Chart.getChart === 'function'
      ? Chart.getChart(canvas)
      : (Chart.instances && Object.values(Chart.instances).find(c => c.canvas === canvas)) || null;
  }

  // Chart.js only shows tooltips on hover by default. Clicking anywhere
  // along the X axis finds the nearest point and shows its tooltip too —
  // handy on touch devices, or for anyone who'd rather click than hover.
  // Guarded by a flag on the instance since chart instances can get
  // destroyed/recreated (see `wired` tracking above) and this gets called
  // again each time that happens.
  function enableClickToShowValue(chart) {
    if (!chart || chart.__onixClickWired) return;
    chart.__onixClickWired = true;
    chart.canvas.addEventListener('click', (evt) => {
      const points = chart.getElementsAtEventForMode(evt, 'index', { intersect: false }, true);
      if (!points.length) return;
      chart.tooltip.setActiveElements(points, { x: evt.offsetX, y: evt.offsetY });
      chart.update();
    });
  }

  // Format a raw dollar value as $1.2M or $450K for chart tooltips.
  function fmtChartDollars(v) {
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(v).toLocaleString('en-US');
  }

  // `wired` is the { orig, loanType, deposit } chart-instance snapshot from
  // the last successful wiring (or null before the first one). Returning it
  // unchanged when the same instances are still attached lets the caller
  // skip redundant chart.update() calls; returning a fresh snapshot when an
  // instance's identity changed (initDashCharts() destroyed + recreated it)
  // makes re-wiring automatic instead of permanently skipping that canvas.
  function updateDashboardCharts(loans, investments, wired) {
    const labels12 = lastNMonthLabels(12);

    const origChart = getChart('origChart');
    const loanTypeChart = getChart('loanTypeChart');
    const depositChart = getChart('depositChart');
    if (!origChart || !loanTypeChart || !depositChart) return wired || null;

    const unchanged = wired && wired.orig === origChart &&
      wired.loanType === loanTypeChart && wired.deposit === depositChart;
    if (unchanged) return wired;

    // origChart — loan originations by month (original loan amount, $M).
    // Excludes OUS Pasiva rows, which are deposits, not loans — same
    // exclusion as the "Active Loans" KPI above.
    //
    // Grouped by origination_date (when the loan was actually made), not
    // created_at (when this row was synced into Onix's own database) —
    // confirmed live that these are very different things for OUS Activa
    // loans: created_at is crammed into a ~6-week window (when the
    // integration was built and matches got verified), while real
    // origination_date spans back to January 2022. Grouping by created_at
    // made the chart look like an $8M origination spike in a single
    // month that was actually years of real lending history landing in
    // this database all at once. Summed by principal_amount (the real
    // amount lent at origination), not balance (today's partially-paid-
    // down amount) — balance would understate an older loan's real
    // origination size.
    const origLoans = loans.filter(l => l.data_source !== 'ous_pasiva');
    const origVals = sumByMonth(origLoans, 'origination_date', 'principal_amount', 12)
      .map(v => parseFloat((v / 1e6).toFixed(2)));
    setChartData(origChart, labels12, origVals);
    enableClickToShowValue(origChart);

    // loanTypeChart — active LOAN portfolio by type (real $ amounts).
    // Excludes OUS Pasiva rows, which are deposits, not loans — same
    // exclusion the "Active Loans" KPI above already applies.
    //
    // Only Personal, Simple, and Other are ever shown — server.js's
    // mapActivaLoanType() normalizes OUS Activa's loan_type at sync time,
    // but a loan can still carry a stale/dirty value here if it hasn't been
    // touched by a sync since that normalization was added (confirmed live:
    // 4 loans briefly showed raw Spanish payment-description text — e.g.
    // "Pagos fijos a lo largo del periodo" — leaked from OUS's own segmento
    // field before self-correcting on their next sync). This client-side
    // allowlist is the actual safety net so the chart can never show
    // anything else, regardless of what ends up in the database — a
    // relied-on backend fix landing eventually isn't the same guarantee.
    const activeLoans = loans.filter(l => l.status === 'active' && l.data_source !== 'ous_pasiva');
    const typeTotals = {};
    activeLoans.forEach(l => {
      const key = String(l.loan_type || '').trim().toUpperCase();
      const t = LOAN_TYPE_DISPLAY[key] || 'Other';
      typeTotals[t] = (typeTotals[t] || 0) + Number(l.balance || 0);
    });
    const total = Object.values(typeTotals).reduce((s, v) => s + v, 0);
    const types = Object.keys(typeTotals).sort((a, b) => typeTotals[b] - typeTotals[a]);
    const vals = types.map(t => typeTotals[t]);
    loanTypeChart.data.labels.length = 0;
    loanTypeChart.data.labels.push(...types);
    loanTypeChart.data.datasets[0].data.length = 0;
    loanTypeChart.data.datasets[0].data.push(...vals);
    // Tooltip: "CRE: $1.20M (58%)" — mutate the existing plugin objects in
    // place rather than replacing options.plugins wholesale (see setChartData).
    const plugins = loanTypeChart.options.plugins || (loanTypeChart.options.plugins = {});
    if (!plugins.tooltip) plugins.tooltip = {};
    if (!plugins.tooltip.callbacks) plugins.tooltip.callbacks = {};
    plugins.tooltip.callbacks.label = c => {
      const val = c.parsed;
      const pct = total > 0 ? Math.round((val / total) * 100) : 0;
      return ` ${c.label}: ${fmtChartDollars(val)} (${pct}%)`;
    };
    // Custom legend below the chart (#loanTypeLegend) replaces Chart.js's
    // own legend so we can show a clear "no loans yet" state instead of an
    // empty legend when there's nothing to break down.
    if (!plugins.legend) plugins.legend = {};
    plugins.legend.display = false;
    loanTypeChart.update('none');
    const legendColors = ['#C0392B', '#a93226', '#d56b5e', '#e8a39a'];
    const legendEl = document.getElementById('loanTypeLegend');
    if (legendEl) {
      if (!types.length) {
        legendEl.innerHTML = '<div style="padding:5px 0;color:#9B9590;font-style:italic">No active loans yet</div>';
      } else {
        legendEl.innerHTML = types.map((t, i) => {
          const pct = total > 0 ? Math.round((typeTotals[t] / total) * 100) : 0;
          const color = legendColors[i % legendColors.length];
          const last = i === types.length - 1;
          return '<div style="display:flex;justify-content:space-between;padding:5px 0' + (last ? '' : ';border-bottom:1px solid #f4f4f4') + '">' +
                   '<span><span style="display:inline-block;width:8px;height:8px;background:' + color + ';border-radius:50%;margin-right:8px"></span>' + esc(t) + '</span>' +
                   '<strong>' + pct + '%</strong>' +
                 '</div>';
        }).join('');
      }
    }

    // depositChart — cumulative deposit portfolio growth by month ($M).
    // Same two sources as the "Total Deposits" KPI above: OUS Pasiva loan
    // balances (the real deposit book) plus any true deposit-type
    // investments. This chart previously only looked at investments, so it
    // stayed flat at zero even though Total Deposits showed $40M+.
    //
    // Bucketed by origination_date (loans) / start_date (investments) — the
    // real date the deposit/position started — not created_at (the
    // Supabase row-insert/sync timestamp). Same class of fix as origChart's
    // origination_date switch above (PR #202's Originations-chart fix,
    // never applied here). created_at is used only as a fallback when the
    // real date is missing (confirmed live elsewhere in this file — see the
    // Calendar cashflow query's `.not('origination_date', 'is', null)` on
    // ous_pasiva loans — that some do lack it), so a real dollar never goes
    // missing from the running total just because its start date wasn't
    // synced; it's bucketed by when the row appeared instead.
    const depositLoans = loans.filter(l => l.status === 'active' && l.data_source === 'ous_pasiva');
    const depositInvestments = investments.filter(i => (i.venture_type || '').toLowerCase() === 'deposit');

    // Start the x-axis at the earliest real month instead of a fixed
    // trailing-12-month window, which padded the chart with meaningless
    // leading zero months before the portfolio existed. If real data spans
    // less than 12 months, the chart just renders fewer points — correct,
    // there's nothing before that to show. If it spans more than 12, the
    // window extends to cover the full history rather than capping at 12:
    // capping would silently contradict "start at the real earliest month"
    // once that month is more than 12 months back, and this chart's whole
    // purpose is portfolio growth since inception (unlike revChart in
    // updateReportsCharts, which is intentionally a fixed recent-months
    // view). DEPOSIT_CHART_MAX_MONTHS is a sanity cap only — it guards
    // against a corrupted/garbage origination_date or start_date (e.g. a
    // stray year-1900 value) blowing the axis out to thousands of empty
    // months; not expected to ever trigger on real data.
    const DEPOSIT_CHART_MAX_MONTHS = 120;
    const now = new Date();
    const earliestLoanMonth = earliestMonth(depositLoans, 'origination_date', 'created_at');
    const earliestInvMonth = earliestMonth(depositInvestments, 'start_date', 'created_at');
    let start = [earliestLoanMonth, earliestInvMonth].filter(Boolean).sort((a, b) => a - b)[0];
    // No dated real data at all (empty book) — anchor on the current month
    // rather than rendering an axis with nothing to start from.
    if (!start) start = new Date(now.getFullYear(), now.getMonth(), 1);
    const oldestAllowed = new Date(now.getFullYear(), now.getMonth() - (DEPOSIT_CHART_MAX_MONTHS - 1), 1);
    if (start < oldestAllowed) start = oldestAllowed;

    const depositLabels = monthLabelsFrom(start, now);
    const loanMonthly = sumByMonthFrom(depositLoans, start, 'origination_date', 'created_at', 'balance', now);
    const invMonthly = sumByMonthFrom(depositInvestments, start, 'start_date', 'created_at', 'amount_invested', now);
    const monthly = loanMonthly.map((v, i) => v + (invMonthly[i] || 0));
    let cumulative = 0;
    const depositVals = monthly.map(v => {
      cumulative += v;
      return parseFloat((cumulative / 1e6).toFixed(2));
    });
    setChartData(depositChart, depositLabels, depositVals);
    enableClickToShowValue(depositChart);

    return { orig: origChart, loanType: loanTypeChart, deposit: depositChart };
  }

  // See updateDashboardCharts() for what `wired` tracks and why.
  function updateReportsCharts(loans, payments, wired) {
    const labels6 = lastNMonthLabels(6);

    const revChart = getChart('revChart');
    const typeChart = getChart('typeChart');
    if (!revChart || !typeChart) return wired || null;

    const unchanged = wired && wired.rev === revChart && wired.type === typeChart;
    if (unchanged) return wired;

    // revChart — monthly revenue from collected loan payments ($K)
    const paidPayments = payments.filter(p => p.paid_at);
    const revVals = sumByMonth(paidPayments, 'paid_at', 'amount_due', 6)
      .map(v => parseFloat((v / 1e3).toFixed(1)));
    setChartData(revChart, labels6, revVals);

    // typeChart — active loan portfolio by type ($M, horizontal bar).
    // Grouped by loan_type (the real column on this table — venture_type
    // belongs to investments and never matched here, so this previously
    // always rendered a single dead "Other" bucket). Excludes OUS Pasiva
    // rows, which are deposits, not loans — same exclusion as loanTypeChart
    // on the Dashboard. Same Personal/Simple/Other allowlist as that chart
    // too — see its comment for why a raw loan_type value can't be trusted
    // here either.
    const activeLoans = loans.filter(l => l.status === 'active' && l.data_source !== 'ous_pasiva');
    const typeTotals = {};
    activeLoans.forEach(l => {
      const key = String(l.loan_type || '').trim().toUpperCase();
      const t = LOAN_TYPE_DISPLAY[key] || 'Other';
      typeTotals[t] = (typeTotals[t] || 0) + Number(l.balance || 0);
    });
    const types = Object.keys(typeTotals).sort((a, b) => typeTotals[b] - typeTotals[a]);
    const vals = types.map(t => parseFloat((typeTotals[t] / 1e6).toFixed(2)));
    typeChart.data.labels.length = 0;
    typeChart.data.labels.push(...types);
    typeChart.data.datasets[0].data.length = 0;
    typeChart.data.datasets[0].data.push(...vals);
    typeChart.update('none');

    return { rev: revChart, type: typeChart };
  }

  // ── /Chart helpers ─────────────────────────────────────────────────────────

  function paintStaticAdmin(data) {
    // Invalidate any previously-painted markers so we re-paint with fresh data
    document.querySelectorAll('.' + LIVE_MARKER).forEach(el => el.classList.remove(LIVE_MARKER));

    // Chart-instance snapshots (not plain booleans) so a destroy+recreate
    // cycle in initDashCharts()/initReportsCharts() (admin-portal.html)
    // triggers automatic re-wiring instead of permanently skipping a canvas
    // that no longer matches the instance we last wired.
    let dashChartsWired = null;
    let reportsChartsWired = null;

    function tryAll() {
      try {
        // The Bolt bundler replaces the entire <head> on first unpack, which
        // wipes our injected style sheets. Re-inject whenever they're missing.
        if (!document.getElementById('onix-admin-styles')) injectStyles();
        if (!document.getElementById('cal-styles')) injectCalendarStyles();

        // Calendar: ensureCalendarSidebarAndView() is idempotent and safe to
        // call on every tick. If the bundler wiped the sidebar item + view-calendar
        // div we previously injected, this recreates them so the calendar is
        // visible again. renderCalendar() is called only when the grid is empty
        // (first render or after a bundler wipe) to avoid flickering.
        if (ensureCalendarSidebarAndView() && calEvents.length) {
          const grid = document.getElementById('cal-month-grid');
          if (grid && !grid.firstChild) renderCalendar();
        }

        paintDashboardView(data);
        paintClientsView(data.clients, data.loans, data.investments, data.pending, data.clientDocuments);
        paintLoansView(data.loans);
        // Active Deposits — sidebar item + view are injected dynamically
        // (same pattern as Calendar) because they're not in the Bolt-
        // bundled template. Ensure() is idempotent and safe every tick.
        if (ensureActiveDepositsSidebarAndView()) paintActiveDepositsView(data.loans, data.investments);
        // Loan Match Review — same injected-tab pattern. Paint is gated on
        // activaMatchesLoaded (set once loadActivaMatchesData() resolves)
        // so this never flashes an empty table before the first fetch
        // completes — same guard Calendar uses via calEvents.length.
        if (ensureLoanMatchReviewSidebarAndView() && activaMatchesLoaded) paintLoanMatchReviewView();
        paintInvestmentsView(data.investments);
        paintRaisesView(data.raises);
        paintApplicationsView(data.applications);
        wireGlobalSearch(data);
        dashChartsWired = updateDashboardCharts(data.loans, data.investments, dashChartsWired);
        reportsChartsWired = updateReportsCharts(data.loans, data.payments, reportsChartsWired);
      } catch (e) {
        console.error('[onix-admin] paint error (will retry):', e);
      }
    }
    tryAll();
    window.__onixAdminData = data;
    if (window.__onixAdminPainter) clearInterval(window.__onixAdminPainter);
    window.__onixAdminPainter = setInterval(tryAll, 600);
  }

  // (legacy helper kept for backwards compat — no longer used)
  function findStaticAppsTable() {
    const views = [
      document.getElementById('view-applications'),
      document.getElementById('view-loans-app')
    ];
    for (const v of views) {
      if (v) {
        const t = v.querySelector('table');
        if (t && t.querySelector('tbody')) return t;
      }
    }
    return null;
  }

  function buildLiveRow(app, columnCount) {
    const tr = document.createElement('tr');
    tr.setAttribute('data-onix-live-app', app.id);
    tr.style.background = '#FDF0EE';
    const submitted = fmt.date(app.submitted_at);
    const client    = (app.profiles && (up(app.profiles.full_name) || app.profiles.email)) || app.user_id;
    const email     = app.profiles && app.profiles.email;
    const amount    = fmt.money(app.amount_requested);
    const purpose   = app.purpose || '—';
    const applicantType = app.applicant_type || '—';
    const status    = app.status || 'pending';

    const viewBtnStyle = "display:inline-block;background:#C0392B;color:#fff;padding:6px 12px;font:600 .68rem/1 'DM Sans',sans-serif;text-transform:uppercase;letter-spacing:.08em;border:1px solid #C0392B;border-radius:2px;cursor:pointer;margin-right:4px;text-decoration:none";
    const contactBtnStyle = "display:inline-block;background:#fff;color:#1A1A1A;padding:6px 12px;font:600 .68rem/1 'DM Sans',sans-serif;text-transform:uppercase;letter-spacing:.08em;border:1px solid #E8E8E8;border-radius:2px;cursor:pointer;text-decoration:none";
    const actionsHtml =
      `<a href="#" role="button" data-view-live-app="${esc(app.id)}" style="${viewBtnStyle}">View</a>` +
      (email
        ? `<a href="mailto:${esc(email)}?subject=${encodeURIComponent('Onix Finance · Loan Application')}" style="${contactBtnStyle}">Contact</a>`
        : `<span style="${contactBtnStyle};opacity:.5">No email</span>`);

    // Data cells in display order; actions occupy the last column.
    const data = [
      `<span style="display:inline-block;background:#C0392B;color:#fff;padding:2px 6px;font-size:.55rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;border-radius:2px;margin-right:6px">Live</span>${esc(submitted)}`,
      esc(client),
      esc(amount),
      esc(purpose),
      esc(applicantType),
      `<span style="display:inline-block;padding:2px 8px;font-size:.62rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;border-radius:2px;background:#FDF5E6;color:#A07818">${esc(status)}</span>`
    ];

    let cells;
    if (columnCount >= 2) {
      // Reserve last column for actions, fit data in the first (columnCount-1)
      const dataLen = Math.min(data.length, columnCount - 1);
      cells = data.slice(0, dataLen);
      while (cells.length < columnCount - 1) cells.push('');
      cells.push(actionsHtml);
    } else {
      cells = [data.join(' · ') + ' ' + actionsHtml];
    }
    tr.innerHTML = cells.map((c, idx) => {
      const style = (idx === cells.length - 1) ? ' style="text-align:right;white-space:nowrap"' : '';
      return `<td${style}>${c}</td>`;
    }).join('');
    return tr;
  }

  function paintStaticApplicationsView(applications) {
    const table = findStaticAppsTable();
    if (!table) return false;
    const tbody = table.querySelector('tbody');
    if (!tbody) return false;
    // Remove any rows we previously inserted
    tbody.querySelectorAll('tr[data-onix-live-app]').forEach(r => r.remove());
    if (!applications || !applications.length) return true;
    // Determine column count from the first existing row (or thead)
    let columnCount = 0;
    const firstRow = tbody.querySelector('tr:not([data-onix-live-app])');
    if (firstRow) columnCount = firstRow.children.length;
    else {
      const headRow = table.querySelector('thead tr');
      if (headRow) columnCount = headRow.children.length;
    }
    if (columnCount < 1) columnCount = 6;
    // Prepend live rows, newest first
    applications.forEach(app => {
      tbody.insertBefore(buildLiveRow(app, columnCount), tbody.firstChild);
    });
    // Wire View buttons (Contact uses a native mailto: anchor, no JS needed)
    tbody.querySelectorAll('[data-view-live-app]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.getAttribute('data-view-live-app');
        const app = applications.find(a => a.id === id);
        if (app) viewApplication(app);
      });
    });
    return true;
  }

  function wireStaticApplicationsView(applications) {
    if (paintStaticApplicationsView(applications)) return;
    let attempts = 0;
    const iv = setInterval(() => {
      attempts++;
      if (paintStaticApplicationsView(applications) || attempts > 60) clearInterval(iv);
    }, 500);
  }

  // Update the small count badges next to sidebar items (e.g. the "7" next
  // to Applications) so they reflect real data, not the demo number baked
  // into the bundled HTML. The bundle injects the sidebar asynchronously
  // and can re-render it later, so we (1) retry a few times after refreshAll
  // and (2) install a MutationObserver that re-applies whenever a new
  // .sidebar-item-badge appears in the DOM.
  let __onixBadgeData = null;
  let __onixBadgeObserver = null;

  function applyBadges() {
    if (!__onixBadgeData) return;
    const data = __onixBadgeData;
    const counts = {
      'Applications':      (data.applications || []).length,
      'Pending Approvals': (data.pending      || []).length,
      'Approvals':         (data.pending      || []).length
    };
    document.querySelectorAll('.sidebar-item-badge').forEach(badge => {
      const parent = badge.closest('button, a');
      if (!parent) return;
      const labelEl = parent.querySelector('[data-en]');
      const key = labelEl ? labelEl.getAttribute('data-en') : '';
      if (!(key in counts)) return;
      const n = counts[key];
      const desired = String(n);
      if (badge.textContent !== desired) badge.textContent = desired;
      badge.style.display = n > 0 ? '' : 'none';
    });
  }

  function paintSidebarBadges(data) {
    __onixBadgeData = data;
    applyBadges();
    // Retry — the sidebar may not be in the DOM yet when refreshAll first runs
    let attempts = 0;
    const retry = setInterval(() => {
      applyBadges();
      if (++attempts >= 8) clearInterval(retry); // ~4s
    }, 500);
    // Keep badges accurate if the bundle re-renders the sidebar later
    if (!__onixBadgeObserver && document.body) {
      __onixBadgeObserver = new MutationObserver(muts => {
        for (const m of muts) {
          for (const n of m.addedNodes) {
            if (n.nodeType !== 1) continue;
            if ((n.classList && n.classList.contains('sidebar-item-badge')) ||
                (n.querySelector && n.querySelector('.sidebar-item-badge'))) {
              applyBadges();
              return;
            }
          }
        }
      });
      __onixBadgeObserver.observe(document.body, { subtree: true, childList: true });
    }
  }

  // ---------- Live admin notification bell ----------
  // Builds a feed from real activity and takes over the top-bar bell icon.
  // Marks items read once viewed (persisted in localStorage by timestamp).
  function renderAdminNotifications(data) {
    const READ_KEY = 'onix-admin-notif-read-at';
    const lastReadAt = Number(localStorage.getItem(READ_KEY) || 0);

    const items = [];
    (data.applications || []).forEach(a => items.push({
      ts: new Date(a.submitted_at).getTime(),
      msg: 'New loan application from <b>' + esc((a.profiles && (up(a.profiles.full_name) || a.profiles.email)) || 'a client') + '</b> · ' + fmt.money(a.amount_requested)
    }));
    (data.payments || []).filter(p => p.paid_at).forEach(p => items.push({
      ts: new Date(p.paid_at).getTime(),
      msg: 'Payment received from <b>' + esc((p.loans && p.loans.profiles && up(p.loans.profiles.full_name)) || 'a client') + '</b> · ' + fmt.money(p.amount_due)
    }));
    (data.distributions || []).forEach(d => items.push({
      ts: new Date(d.paid_at).getTime(),
      msg: 'Distribution paid to <b>' + esc((d.investments && d.investments.profiles && up(d.investments.profiles.full_name)) || 'a client') + '</b> · ' + fmt.money(d.amount) + ((d.investments && d.investments.venture_name) ? ' · ' + esc(d.investments.venture_name) : '')
    }));
    (data.pending || []).forEach(c => items.push({
      ts: new Date(c.created_at).getTime(),
      msg: (c.status === 'met' ? 'Client ready to activate: <b>' : 'New client signed up: <b>') + esc(up(c.full_name) || c.email) + '</b>'
    }));
    (data.interests || []).forEach(i => items.push({
      ts: new Date(i.created_at || i.submitted_at || Date.now()).getTime(),
      msg: 'Investment interest from <b>' + esc((i.profiles && (up(i.profiles.full_name) || i.profiles.email)) || 'a client') + '</b>' + ((i.raises && i.raises.venture_name) ? ' · ' + esc(i.raises.venture_name) : '')
    }));

    items.sort((a, b) => b.ts - a.ts);
    const top = items.slice(0, 15);
    top.forEach(i => { i.read = i.ts <= lastReadAt; });
    const unread = top.filter(i => !i.read).length;

    // Build (once) my own panel; remove the static demo panel if present.
    const staticPanel = document.getElementById('__onix_admin_notif');
    if (staticPanel) staticPanel.remove();

    let panel = document.getElementById('oac-live-notif');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'oac-live-notif';
      panel.style.cssText = 'position:fixed;top:68px;right:18px;width:360px;max-height:70vh;overflow-y:auto;background:#fff;border:1px solid #E8E8E8;border-top:3px solid #C0392B;box-shadow:0 16px 48px rgba(0,0,0,.2);z-index:9000;display:none;font-family:"DM Sans",-apple-system,sans-serif';
      document.body.appendChild(panel);
      document.addEventListener('click', (e) => {
        if (!panel.contains(e.target) && !(e.target.closest && e.target.closest('[data-oac-bell]'))) {
          panel.style.display = 'none';
        }
      });
    }
    const rowsHtml = top.length ? top.map(n => `
      <div style="padding:13px 18px;border-bottom:1px solid #f6f6f6;display:flex;gap:12px;align-items:flex-start">
        <div style="width:8px;height:8px;border-radius:50%;background:${n.read ? '#E8E8E8' : '#C0392B'};flex-shrink:0;margin-top:5px"></div>
        <div><div style="font-size:.82rem;line-height:1.45;color:#1A1A1A">${n.msg}</div>
        <div style="font-size:.68rem;color:#9B9590;margin-top:3px">${esc(fmt.date(new Date(n.ts)))}</div></div>
      </div>`).join('') : '<div style="padding:24px 18px;color:#9B9590;font-size:.85rem;font-style:italic;text-align:center">No activity yet.</div>';
    panel.innerHTML =
      `<div style="padding:14px 18px;border-bottom:1px solid #E8E8E8;display:flex;justify-content:space-between;align-items:center">
         <span style="font-size:.68rem;letter-spacing:.14em;text-transform:uppercase;font-weight:700;color:#6B6560">Notifications${unread ? ' <span style="background:#C0392B;color:#fff;border-radius:10px;padding:1px 7px;font-size:.6rem">' + unread + '</span>' : ''}</span>
         <button id="oac-notif-clear" style="font-size:.64rem;color:#C0392B;font-weight:700;background:none;border:none;cursor:pointer;letter-spacing:.06em;text-transform:uppercase">Mark all read</button>
       </div>` + rowsHtml;

    panel.querySelector('#oac-notif-clear').addEventListener('click', () => {
      localStorage.setItem(READ_KEY, String(Date.now()));
      renderAdminNotifications(data); // re-render to clear dots
    });

    // Take over the bell icon (clone to strip the static script's listeners).
    document.querySelectorAll('.icon-btn').forEach(b => {
      const svgPath = b.querySelector('path');
      const isBell = svgPath && /M18 8A6 6/.test(svgPath.getAttribute('d') || '');
      if (!isBell) return;
      if (b.getAttribute('data-oac-bell') === '1') return; // already taken over
      const fresh = b.cloneNode(true);
      fresh.setAttribute('data-oac-bell', '1');
      b.replaceWith(fresh);
      fresh.addEventListener('click', (e) => {
        e.stopPropagation();
        const showing = panel.style.display === 'block';
        panel.style.display = showing ? 'none' : 'block';
      });
      // Manage the unread dot on the bell
      let dot = fresh.querySelector('.icon-btn-dot');
      if (unread > 0) {
        if (!dot) { dot = document.createElement('span'); dot.className = 'icon-btn-dot'; fresh.appendChild(dot); }
        dot.style.display = '';
      } else if (dot) {
        dot.style.display = 'none';
      }
    });
  }

  async function refreshAll() {
    const greeting = document.getElementById('oac-greeting');
    if (greeting) greeting.textContent = 'Loading data…';
    try {
      const [clients, pending, loans, investments, raises, applications, payments, distributions, interests, clientDocuments] = await Promise.all([
        OnixDB.getAllClients(),
        OnixDB.getPendingClients(),
        OnixDB.getAllLoans(),
        OnixDB.getAllInvestments(),
        OnixDB.getAllRaises(),
        OnixDB.getAllApplications(),
        OnixDB.getAllPayments         ? OnixDB.getAllPayments()         : Promise.resolve([]),
        OnixDB.getAllDistributions    ? OnixDB.getAllDistributions()    : Promise.resolve([]),
        OnixDB.getAllRaiseInterests   ? OnixDB.getAllRaiseInterests()   : Promise.resolve([]),
        OnixDB.getAllClientDocuments  ? OnixDB.getAllClientDocuments()  : Promise.resolve([])
      ]);
      // The Live Admin Console drawer is retired; everything renders inside
      // the static admin tabs now. Pending Approvals appears as a banner on
      // the Clients tab (driven by data.pending).
      paintStaticAdmin({ clients, loans, investments, raises, applications, payments, distributions, pending, clientDocuments });
      paintSidebarBadges({ applications, pending, interests });
      renderAdminNotifications({ applications, payments, distributions, pending, interests });
      const newInterest = (interests || []).filter(i => i.status === 'new').length;
      if (greeting) greeting.textContent = `Loaded · ${clients.length} clients · ${pending.length} pending · ${loans.length} loans · ${applications.length} applications${newInterest ? ' · ' + newInterest + ' new interest' + (newInterest === 1 ? '' : 's') : ''}`;
    } catch (ex) {
      console.error('[onix-admin]', ex);
      if (greeting) greeting.textContent = 'Error loading data — see console';
    }
  }

  function computeInitials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '';
    const first = parts[0][0] || '';
    const last  = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (first + last).toUpperCase();
  }

  function renderSidebarUser(profile) {
    const name = (profile && (profile.full_name || profile.email)) || 'Admin';
    const initials = computeInitials(profile && (profile.full_name || profile.email));
    let attempts = 0;
    (function apply() {
      const nameEls   = document.querySelectorAll('.sidebar-user-name');
      const avatarEls = document.querySelectorAll('.sidebar-avatar');
      if (nameEls.length || avatarEls.length) {
        nameEls.forEach(el => el.textContent = name);
        avatarEls.forEach(el => el.textContent = initials);
        return;
      }
      if (++attempts < 30) setTimeout(apply, 100);
    })();
  }

  // ============================================================
  // CALENDAR TAB
  // Injects a Calendar sidebar item + view-calendar div into the
  // unpacked Bolt bundle. Month grid, color-coded events, add/remove.
  // ============================================================
  const CAL_TYPES = {
    birthday:         { label: 'Birthday',             color: '#C58FB8' },
    payment:          { label: 'Payment Due',          color: '#3B8B3B' },
    interest_due:     { label: 'Interest Due',          color: '#2F9E8F' },
    deposit_closing:  { label: 'Deposit Closing',      color: '#C0392B' },
    deposit_opened:   { label: 'New Deposit',          color: '#4A6FA5' },
    loan_closing:     { label: 'Loan Closing',         color: '#7A2A20' },
    loan_renewal:     { label: 'Client Loan Renewal',  color: '#C9952B' },
    // 'other' is kept as the fallback for CAL_TYPES[ev.type] || CAL_TYPES.other
    // below, but deliberately excluded from the legend and the Add Event
    // type dropdown (see the .filter() calls at both usage sites) — it's
    // not offered as a selectable category, same as the removed
    // Quarterly Report / Meeting types.
    other:            { label: 'Other',                color: '#6B6560' }
  };
  let calMonth   = new Date().getMonth();
  let calYear    = new Date().getFullYear();
  let calEvents  = [];
  let calClients = [];
  let calLoans   = [];
  // Active loans + deposits (with balance, interest_rate, origination /
  // maturity dates) — the source the monthly Cashflow summary uses to
  // compute expected interest income vs. interest expense per month.
  let calActiveLoans = [];

  function injectCalendarStyles() {
    if (document.getElementById('cal-styles')) return;
    const s = document.createElement('style');
    s.id = 'cal-styles';
    s.textContent = `
      /* .main is a 1fr track in the outer .app grid (admin-portal.html).
         Grid tracks default to min-width:auto, so a long unbreakable event
         title below could force this track — and the whole page — wider
         than the viewport. This override can't live in admin-portal.html
         itself (that rule is inside the JSON-encoded bundler blob), so we
         add it here via the same JS-injected-stylesheet pattern already
         used elsewhere in this file (e.g. hiding the retired Reports tab). */
      .main{min-width:0}
      #view-calendar{padding:32px 40px;font-family:'DM Sans',sans-serif;color:#1A1A1A}
      .cal-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:18px;flex-wrap:wrap}
      .cal-head h1{font-family:'Cormorant Garamond',serif;font-style:italic;font-weight:500;font-size:2rem;margin:0}
      .cal-head .cal-eyebrow{font-size:.7rem;letter-spacing:.18em;text-transform:uppercase;color:#C0392B;font-weight:600;margin-bottom:6px}
      .cal-rule{width:40px;height:2px;background:#C0392B;margin-bottom:0}
      .cal-nav{display:flex;gap:6px;align-items:center}
      .cal-nav button{background:#fff;border:1px solid #E8E8E8;cursor:pointer;padding:8px 12px;font:600 .72rem/1 'DM Sans',sans-serif;text-transform:uppercase;letter-spacing:.1em;color:#1A1A1A;border-radius:2px}
      .cal-nav button:hover{border-color:#C0392B;color:#C0392B}
      .cal-nav .cal-today-btn{background:#1A1A1A;color:#fff;border-color:#1A1A1A}
      .cal-nav .cal-today-btn:hover{background:#333;color:#fff;border-color:#333}
      .cal-add{background:#C0392B;color:#fff;border:1px solid #C0392B;padding:10px 16px;cursor:pointer;font:600 .74rem/1 'DM Sans',sans-serif;text-transform:uppercase;letter-spacing:.1em;border-radius:2px}
      .cal-add:hover{background:#a93226}
      .cal-add:disabled{opacity:.6;cursor:not-allowed}
      /* Safety net: if a future long/unbreakable event title still forces
         the grid wider than its container despite min-width:0 below, this
         wrapper scrolls locally instead of the whole page. */
      .cal-month-grid-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
      .cal-month-grid{display:grid;grid-template-columns:repeat(7,1fr);background:#E8E8E8;gap:1px;border:1px solid #E8E8E8;border-top:3px solid #C0392B}
      .cal-dow{background:#F8F7F5;padding:10px 12px;font-size:.62rem;letter-spacing:.12em;text-transform:uppercase;color:#888;font-weight:700}
      /* min-width:0 lets a grid cell shrink below its content's intrinsic
         width so .cal-event-title's ellipsis-truncation actually takes
         effect, instead of forcing this column (and the page) wider. */
      .cal-cell{background:#fff;min-height:110px;min-width:0;padding:8px 8px 6px;display:flex;flex-direction:column;gap:4px;cursor:pointer;transition:background .12s;position:relative}
      .cal-cell:hover{background:#FAFAFA}
      .cal-cell.other-month{background:#F8F7F5}
      .cal-cell.other-month .cal-day-num{color:#bbb}
      .cal-cell.today{background:#FDF0EE}
      .cal-cell.today .cal-day-num{color:#C0392B;font-weight:800}
      .cal-day-num{font-size:.84rem;font-weight:600;color:#1A1A1A}
      .cal-event{display:flex;align-items:center;gap:6px;padding:3px 6px;border-radius:2px;font-size:.7rem;line-height:1.25}
      .cal-event-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
      .cal-event-title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500}
      .cal-event-rec{font-size:.65rem;opacity:.85;flex-shrink:0;font-weight:700}
      .cal-rec-badge{display:inline-block;padding:1px 6px;background:#F4E8E5;color:#C0392B;border-radius:2px;font-size:.66rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;margin-left:2px}
      .cal-overflow{font-size:.62rem;color:#888;font-weight:700;padding:1px 4px}
      .cal-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#E8E8E8;border:1px solid #E8E8E8;border-top:3px solid #C0392B;margin-bottom:18px}
      .cal-summary-cell{background:#fff;padding:16px 22px}
      .cal-summary-label{font-size:.64rem;letter-spacing:.12em;text-transform:uppercase;color:#6B6560;font-weight:700;margin-bottom:8px;display:flex;align-items:center;gap:6px}
      .cal-summary-label .dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
      .cal-summary-val{font-family:'Cormorant Garamond',serif;font-style:italic;font-weight:500;font-size:1.7rem;line-height:1}
      .cal-summary-val.in{color:#3B8B3B}
      .cal-summary-val.out{color:#C0392B}
      .cal-summary-sub{font-size:.7rem;color:#9B9590;margin-top:6px}
      .cal-summary-pending{font-size:.7rem;color:#A07818;margin-top:6px;padding-top:6px;border-top:1px dashed #E8E0D0}
      @media(max-width:680px){ .cal-summary{grid-template-columns:1fr} }
      .cal-legend{display:flex;flex-wrap:wrap;gap:14px;margin-top:18px;padding:14px 18px;background:#fff;border:1px solid #E8E8E8}
      .cal-legend-item{display:flex;align-items:center;gap:6px;font-size:.74rem;color:#1A1A1A}
      .cal-legend-item .dot{width:10px;height:10px;border-radius:50%}
      .cal-bg{position:fixed;inset:0;background:rgba(20,20,20,.45);z-index:99996;display:none;align-items:flex-start;justify-content:center;padding:48px 16px;overflow:auto;font-family:'DM Sans',sans-serif}
      .cal-bg.open{display:flex}
      .cal-panel{background:#fff;width:540px;max-width:100%;border-top:3px solid #C0392B;box-shadow:0 24px 60px rgba(0,0,0,.25);padding:24px 28px;color:#1A1A1A}
      .cal-panel h2{font-family:'Cormorant Garamond',serif;font-style:italic;font-weight:500;font-size:1.6rem;margin:0 0 14px}
      .cal-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:12px 14px;background:#F8F7F5;border-left:3px solid #C0392B;margin-bottom:8px}
      .cal-row .t{font-size:.86rem;font-weight:600}
      .cal-row .s{font-size:.72rem;color:#888;margin-top:2px}
      .cal-row .actions{display:flex;gap:6px;flex-shrink:0}
      .cal-row button{padding:5px 10px;font-size:.62rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;border:1px solid #E8E8E8;background:#fff;color:#888;cursor:pointer;border-radius:2px;font-family:inherit}
      .cal-row button.danger:hover{border-color:#C0392B;color:#C0392B}
      .cal-empty{color:#888;font-style:italic;padding:18px 0;text-align:center}
      .cal-form .k{display:block;font-size:.62rem;letter-spacing:.12em;text-transform:uppercase;color:#888;font-weight:700;margin-bottom:4px;margin-top:12px}
      .cal-form .k:first-of-type{margin-top:0}
      .cal-form input,.cal-form select,.cal-form textarea{width:100%;padding:9px 11px;border:1px solid #E8E8E8;font-size:.88rem;font-family:inherit;outline:none;background:#fff;color:#1A1A1A;box-sizing:border-box}
      .cal-form input:focus,.cal-form select:focus,.cal-form textarea:focus{border-color:#C0392B}
      .cal-form textarea{resize:vertical;min-height:60px}
      .cal-foot{margin-top:18px;display:flex;justify-content:flex-end;gap:8px}
      .cal-foot .ghost{background:#fff;color:#888;border:1px solid #E8E8E8;padding:9px 14px;font:600 .72rem/1 'DM Sans',sans-serif;text-transform:uppercase;letter-spacing:.1em;cursor:pointer;border-radius:2px}
      .cal-foot .ghost:hover{border-color:#C0392B;color:#C0392B}
    `;
    document.head.appendChild(s);
  }

  function ensureCalendarSidebarAndView() {
    if (document.getElementById('view-calendar')) return true;
    const sidebar = document.querySelector('.sidebar');
    const main    = document.querySelector('.main');
    if (!sidebar || !main) return false;

    if (!sidebar.querySelector('[data-view="calendar"]')) {
      const anchor = sidebar.querySelector('[data-view="documents"]') ||
                     sidebar.querySelector('[data-view="reports"]');
      const btn = document.createElement('button');
      btn.className = 'sidebar-item';
      btn.setAttribute('data-view', 'calendar');
      btn.setAttribute('onclick', "showView('calendar')");
      btn.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>' +
          '<line x1="16" y1="2" x2="16" y2="6"/>' +
          '<line x1="8" y1="2" x2="8" y2="6"/>' +
          '<line x1="3" y1="10" x2="21" y2="10"/>' +
        '</svg>' +
        '<span data-en="Calendar" data-es="Calendario">Calendar</span>';
      if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(btn, anchor.nextSibling);
      } else {
        sidebar.appendChild(btn);
      }
    }

    if (!document.getElementById('view-calendar')) {
      const v = document.createElement('div');
      v.className = 'view';
      v.id = 'view-calendar';
      v.innerHTML =
        '<div class="cal-head">' +
          '<div>' +
            '<div class="cal-eyebrow">Schedule</div>' +
            '<h1 id="cal-month-label">Calendar</h1>' +
            '<div class="cal-rule"></div>' +
          '</div>' +
          '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">' +
            '<div class="cal-nav">' +
              '<button id="cal-prev"  type="button" aria-label="Previous month">‹</button>' +
              '<button id="cal-today" type="button" class="cal-today-btn">Today</button>' +
              '<button id="cal-next"  type="button" aria-label="Next month">›</button>' +
            '</div>' +
            '<button class="cal-add" id="cal-add-btn" type="button">+ Add Event</button>' +
          '</div>' +
        '</div>' +
        '<div class="cal-summary" id="cal-summary"></div>' +
        '<div class="cal-month-grid-wrap"><div class="cal-month-grid" id="cal-month-grid"></div></div>' +
        '<div class="cal-legend" id="cal-legend"></div>';
      main.appendChild(v);
      v.querySelector('#cal-prev').addEventListener('click', () => {
        calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar();
      });
      v.querySelector('#cal-next').addEventListener('click', () => {
        calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar();
      });
      v.querySelector('#cal-today').addEventListener('click', () => {
        const d = new Date(); calMonth = d.getMonth(); calYear = d.getFullYear(); renderCalendar();
      });
      v.querySelector('#cal-add-btn').addEventListener('click', () => openAddEventModal());
    }
    return true;
  }

  // "Name · #ID" for a loan/deposit — the bare reference number alone
  // doesn't say whose loan it is at a glance in the compact month-grid
  // pill (the day panel already shows the name via subtitle, but the
  // pill itself only ever rendered title). The ID is kept, not replaced —
  // the name is prepended so it's the first thing visible before any
  // ellipsis truncation, since who it belongs to matters more at a
  // glance than the reference number.
  function loanRef(l) {
    const id = l && (l.loan_id_display || (l.id ? String(l.id).slice(0, 8) : ''));
    const name = l && l.profiles && up(l.profiles.full_name);
    if (!id) return '';
    return name ? name + ' · #' + id : '#' + id;
  }

  async function loadCalendarData() {
    const c = OnixDB.client;
    const [eventsRes, bdayRes, loansRes, paymentsRes, nextDueRes, clientsRes, allLoansRes, originationsRes] = await Promise.all([
      c.from('calendar_events').select('*'),
      c.from('profiles').select('id, full_name, date_of_birth').not('date_of_birth', 'is', null),
      // Extra fields (interest_rate, origination_date) used by the
      // per-month cashflow summary below — balance × rate / 12 for each
      // active loan / deposit gives the real monthly interest cashflow
      // for the month, so we don't have to lean on the sparse
      // loan_payments / next_due_date events (which OUS never fills in).
      c.from('loans').select('id, loan_id_display, maturity_date, origination_date, balance, interest_rate, data_source, profiles!user_id(full_name)').eq('status', 'active').not('maturity_date', 'is', null),
      c.from('loan_payments').select('id, due_date, amount_due, loans(loan_id_display, data_source, profiles!user_id(full_name))').eq('status', 'pending').not('due_date', 'is', null),
      // Loans whose next_due_date is set get a "Payment due" (or "Interest
      // due" for OUS Pasiva deposits) event automatically.
      c.from('loans').select('id, loan_id_display, next_due_date, monthly_payment, data_source, profiles!user_id(full_name)').eq('status', 'active').not('next_due_date', 'is', null),
      c.from('profiles').select('id, full_name, email').eq('role', 'client').order('full_name', { ascending: true }),
      c.from('loans').select('id, loan_id_display, user_id, profiles!user_id(full_name)').order('created_at', { ascending: false }),
      // New OUS Pasiva deposits opened — real client money coming in, which
      // the monthly cashflow summary needs on the "In" side (see below).
      // Separate query rather than reusing loansRes, since a row can have
      // origination_date set without maturity_date or vice versa.
      c.from('loans').select('id, loan_id_display, origination_date, balance, data_source, profiles!user_id(full_name)').eq('status', 'active').eq('data_source', 'ous_pasiva').not('origination_date', 'is', null)
    ]);
    if (eventsRes.error)       console.error('[onix-cal] events fetch failed:',       eventsRes.error);
    if (bdayRes.error)         console.error('[onix-cal] birthdays fetch failed:',    bdayRes.error);
    if (loansRes.error)        console.error('[onix-cal] loans fetch failed:',        loansRes.error);
    if (paymentsRes.error)     console.error('[onix-cal] payments fetch failed:',     paymentsRes.error);
    if (nextDueRes.error)      console.error('[onix-cal] next-due fetch failed:',     nextDueRes.error);
    if (originationsRes.error) console.error('[onix-cal] originations fetch failed:', originationsRes.error);

    calEvents = [];
    (eventsRes.data || []).forEach(e => calEvents.push({
      id: e.id, title: e.title, type: e.event_type, date: e.event_date,
      description: e.description, source: 'manual',
      profileId: e.related_profile_id, loanId: e.related_loan_id,
      recurrence: e.recurrence || 'none'
    }));
    (bdayRes.data || []).forEach(p => {
      const parts = p.date_of_birth.split('-'); // YYYY-MM-DD
      calEvents.push({
        id: 'bday-' + p.id,
        title: (up(p.full_name) || 'Client') + "'s Birthday",
        type: 'birthday',
        monthDay: parts[1] + '-' + parts[2],
        date: null, // recomputed per-viewed-year in renderCalendar
        source: 'profile', profileId: p.id, readOnly: true
      });
    });
    // OUS Pasiva rows are deposits, not loans (see Active Deposits tab)
    // — flag them separately on the calendar so they don't look like
    // loan closings. Real loan rows (data_source != 'ous_pasiva') keep the
    // Loan Closing type. See CAL_TYPES.deposit_closing / loan_closing.
    (loansRes.data || []).forEach(l => {
      const isDeposit = l.data_source === 'ous_pasiva';
      // Deposit closings are when the client gets paid out (principal +
      // accrued interest), so show that amount on the calendar. Real loan
      // closings are the reverse (client owes us) — the pill text stays
      // amount-free to match the existing display convention, but the
      // balance is still the real dollar figure changing hands, so it's
      // kept on the event (used by the monthly cashflow summary, which
      // needs the true amount regardless of what the pill shows).
      const payout = isDeposit && l.balance != null ? fmt.money(l.balance) + ' · ' : '';
      calEvents.push({
        id: 'closing-' + l.id,
        title: (isDeposit ? 'Deposit closing · ' : 'Loan closing · ') + payout + loanRef(l),
        subtitle: (l.profiles && up(l.profiles.full_name)) || '',
        amount: l.balance,
        type: isDeposit ? 'deposit_closing' : 'loan_closing',
        date: l.maturity_date,
        source: 'loan', loanId: l.id, readOnly: true
      });
    });
    (paymentsRes.data || []).forEach(p => {
      // Same deposit-vs-loan distinction as closing events: OUS Pasiva
      // deposits get paid interest by us, real loans pay us — flip the
      // wording so it's clear which direction the money moves.
      const isDeposit = !!(p.loans && p.loans.data_source === 'ous_pasiva');
      const ref = p.loans ? loanRef(p.loans) : '';
      calEvents.push({
        id: 'payment-' + p.id,
        title: fmt.money(p.amount_due) + (isDeposit ? ' interest due' : ' payment due') + (ref ? ' · ' + ref : ''),
        subtitle: (p.loans && (p.loans.loan_id_display || (p.loans.profiles && up(p.loans.profiles.full_name)))) || '',
        amount: p.amount_due,
        type: isDeposit ? 'interest_due' : 'payment', date: p.due_date, source: 'payment', readOnly: true
      });
    });
    // Loan-level next-payment-due dates (set by admin during Edit Loan after
    // approval). Skip if there's already a loan_payments row for that same
    // loan+date — keeps the calendar from showing duplicate payment chips.
    const haveLoanPaymentOn = new Set(
      (paymentsRes.data || []).map(p => (p.loans && p.loans.id ? p.loans.id : '') + '|' + p.due_date)
    );
    (nextDueRes.data || []).forEach(l => {
      const key = l.id + '|' + l.next_due_date;
      if (haveLoanPaymentOn.has(key)) return;
      const isDeposit = l.data_source === 'ous_pasiva';
      const amt = l.monthly_payment != null ? fmt.money(l.monthly_payment) + ' ' : '';
      calEvents.push({
        id: 'loan-next-due-' + l.id,
        title: amt + (isDeposit ? 'interest due · ' : 'payment due · ') + loanRef(l),
        subtitle: (l.profiles && up(l.profiles.full_name)) || '',
        amount: l.monthly_payment,
        type: isDeposit ? 'interest_due' : 'payment',
        date: l.next_due_date,
        source: 'loan-next-due',
        loanId: l.id,
        readOnly: true
      });
    });
    // New deposits opened — real client money coming into Onix. Only ever
    // OUS Pasiva rows (the query above already scopes to that), so no
    // isDeposit branch needed here the way the other blocks have. Kept
    // as a calendar chip; the monthly Cashflow summary uses the
    // interest-margin math below rather than summing these principal
    // originations, so it doesn't matter for the total either way.
    (originationsRes.data || []).forEach(l => {
      calEvents.push({
        id: 'opened-' + l.id,
        title: 'New deposit · ' + fmt.money(l.balance) + ' · ' + loanRef(l),
        subtitle: (l.profiles && up(l.profiles.full_name)) || '',
        amount: l.balance,
        type: 'deposit_opened',
        date: l.origination_date,
        source: 'loan', loanId: l.id, readOnly: true
      });
    });
    calClients     = clientsRes.data || [];
    calLoans       = allLoansRes.data || [];
    calActiveLoans = loansRes.data || [];
  }

  function renderCalendar() {
    const grid = document.getElementById('cal-month-grid');
    if (!grid) return;
    const monthLabel = document.getElementById('cal-month-label');
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    if (monthLabel) monthLabel.textContent = monthNames[calMonth] + ' ' + calYear;

    calEvents.forEach(e => {
      if (e.source === 'profile' && e.monthDay) e.date = calYear + '-' + e.monthDay;
    });

    const firstOfMonth    = new Date(calYear, calMonth, 1);
    const startDow        = firstOfMonth.getDay();
    const daysInMonth     = new Date(calYear, calMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(calYear, calMonth, 0).getDate();
    const today           = new Date();
    const todayStr        = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');

    // Compute the date range of the 42 visible cells so we can expand
    // recurring events into all in-range occurrences.
    const gridStart = new Date(calYear, calMonth, 1 - startDow);
    const gridEnd   = new Date(calYear, calMonth, 1 - startDow + 41);
    const toDateStr = d => d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');

    const byDate = {};
    const pushOcc = (ev, dateStr) => {
      (byDate[dateStr] = byDate[dateStr] || []).push(ev);
    };

    calEvents.forEach(e => {
      if (!e.date) return;
      const rec = e.recurrence || 'none';
      if (rec === 'none') {
        pushOcc(e, e.date);
        return;
      }
      // Parse the original event date as a local date so we don't drift by a
      // day in timezones with a negative UTC offset.
      const [by, bm, bd] = e.date.split('-').map(Number);
      const base = new Date(by, bm - 1, bd);

      // Weekly + biweekly: step in days.
      if (rec === 'weekly' || rec === 'biweekly') {
        const stepDays = rec === 'weekly' ? 7 : 14;
        // Find the first occurrence at or before gridStart, then walk forward.
        const cur = new Date(base);
        if (cur < gridStart) {
          const msPerDay = 24 * 60 * 60 * 1000;
          const diffDays = Math.ceil((gridStart - cur) / msPerDay);
          const skipSteps = Math.ceil(diffDays / stepDays);
          cur.setDate(cur.getDate() + skipSteps * stepDays);
        }
        while (cur <= gridEnd) {
          pushOcc({ ...e, date: toDateStr(cur), occurrenceOf: e.id, isOccurrence: cur.getTime() !== base.getTime() }, toDateStr(cur));
          cur.setDate(cur.getDate() + stepDays);
        }
        return;
      }

      // Monthly cadences: step in months while preserving the original day-of-month.
      const monthsMap = { monthly: 1, bimonthly: 2, '6months': 6, '12months': 12, '36months': 36, '48months': 48 };
      const stepMonths = monthsMap[rec];
      if (!stepMonths) {
        pushOcc(e, e.date);
        return;
      }
      const baseDom = base.getDate();
      // Walk forward month-by-month from the base date until past gridEnd.
      let cy2 = base.getFullYear();
      let cm2 = base.getMonth();
      while (true) {
        // Clamp the day-of-month to the actual length of the target month.
        const lastOfTarget = new Date(cy2, cm2 + 1, 0).getDate();
        const dom = Math.min(baseDom, lastOfTarget);
        const occ = new Date(cy2, cm2, dom);
        if (occ > gridEnd) break;
        if (occ >= gridStart) {
          const ds = toDateStr(occ);
          pushOcc({ ...e, date: ds, occurrenceOf: e.id, isOccurrence: occ.getTime() !== base.getTime() }, ds);
        }
        cm2 += stepMonths;
        while (cm2 > 11) { cm2 -= 12; cy2 += 1; }
      }
    });

    const dowHtml = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
      .map(d => '<div class="cal-dow">' + d + '</div>').join('');

    let cellsHtml = '';
    for (let i = 0; i < 42; i++) {
      const slot = i - startDow + 1;
      let cy, cm, cd, otherMonth = false;
      if (slot < 1) {
        cy = calMonth === 0 ? calYear - 1 : calYear;
        cm = calMonth === 0 ? 11 : calMonth - 1;
        cd = daysInPrevMonth + slot;
        otherMonth = true;
      } else if (slot > daysInMonth) {
        cy = calMonth === 11 ? calYear + 1 : calYear;
        cm = calMonth === 11 ? 0 : calMonth + 1;
        cd = slot - daysInMonth;
        otherMonth = true;
      } else {
        cy = calYear; cm = calMonth; cd = slot;
      }
      const dateStr = cy + '-' + String(cm + 1).padStart(2, '0') + '-' + String(cd).padStart(2, '0');
      const isToday = dateStr === todayStr;
      const events  = byDate[dateStr] || [];

      // Group same-type events into one summary row per type when a day has
      // more than one — a busy day was otherwise showing a full pill per
      // individual loan/client. Clicking the cell still opens the day
      // panel, which lists every event in full individual detail, so
      // nothing is lost, just condensed here. Applies to every event type,
      // not just payments — a day with 3 deposit closings or 8 birthdays
      // gets the same treatment.
      const GROUP_LABEL = {
        payment:          n => n + ' payments due',
        interest_due:     n => n + ' interest payments due',
        deposit_closing:  n => n + ' deposit closings',
        deposit_opened:   n => n + ' new deposits',
        loan_closing:     n => n + ' loan closings',
        loan_renewal:     n => n + ' loan renewals',
        birthday:         n => n + ' birthdays'
      };
      // Only these types have a per-event dollar amount worth summing into
      // the group's headline — loan closings, renewals and birthdays don't
      // carry one (and didn't show one individually before this either).
      const GROUP_HAS_AMOUNT = { payment: true, interest_due: true, deposit_closing: true, deposit_opened: true };
      const byType = {};
      events.forEach(ev => {
        if (!GROUP_LABEL[ev.type]) return;
        (byType[ev.type] = byType[ev.type] || []).push(ev);
      });
      const groupedTypeEmitted = {};
      const displayEvents = events.reduce((out, ev) => {
        const group = GROUP_LABEL[ev.type] && byType[ev.type];
        if (!group || group.length === 1) { out.push(ev); return out; }
        if (groupedTypeEmitted[ev.type]) return out; // summary row already added for this type
        groupedTypeEmitted[ev.type] = true;
        const label = GROUP_LABEL[ev.type](group.length);
        const title = GROUP_HAS_AMOUNT[ev.type]
          ? fmt.money(group.reduce((sum, e) => sum + (Number(e.amount) || 0), 0)) + ' · ' + label
          : label;
        out.push({ title, type: ev.type, grouped: true, groupedEvents: group });
        return out;
      }, []);

      const eventsHtml = displayEvents.slice(0, 3).map(ev => {
        const color = (CAL_TYPES[ev.type] || CAL_TYPES.other).color;
        const recMark = (ev.recurrence && ev.recurrence !== 'none')
          ? '<span class="cal-event-rec" title="Recurring (' + esc(ev.recurrence) + ')">↻</span>' : '';
        return '<div class="cal-event" style="background:' + color + '22;color:' + color + '">' +
                 '<span class="cal-event-dot" style="background:' + color + '"></span>' +
                 '<span class="cal-event-title">' + esc(ev.title) + '</span>' + recMark +
               '</div>';
      }).join('');
      const overflow = displayEvents.length > 3 ? '<div class="cal-overflow">+' + (displayEvents.length - 3) + ' more</div>' : '';
      cellsHtml +=
        '<div class="cal-cell' + (otherMonth ? ' other-month' : '') + (isToday ? ' today' : '') + '" data-date="' + dateStr + '">' +
          '<div class="cal-day-num">' + cd + '</div>' +
          eventsHtml + overflow +
        '</div>';
    }
    grid.innerHTML = dowHtml + cellsHtml;

    grid.querySelectorAll('.cal-cell').forEach(c => c.addEventListener('click', () => openDayPanel(c.dataset.date)));

    // Monthly cashflow summary — real monthly INTEREST cashflow, not
    // maturity-principal returns.
    //
    // Previous logic summed deposit-closing balances into cashflow-out,
    // producing spikes of several million on months when multiple
    // deposits happened to mature (which mostly roll over in practice —
    // that principal doesn't actually leave the institution). William
    // (PR #196) then symmetrized by adding deposit-openings to Cashflow
    // In, but the maturity spike still dominated in months with heavy
    // deposit turnover, so net could still swing wildly (e.g. Sept 2026
    // showed -$5.0M).
    //
    // The new math is the real recurring economics — Net Interest
    // Margin, straight from OUS-synced balances:
    //
    //   In  = Σ (loan.balance × loan.interest_rate / 12 / 100)    for every
    //         active OUS Activa loan whose origination_date <= month-end
    //         and maturity_date >= month-start
    //   Out = Σ (deposit.balance × deposit.interest_rate / 12 / 100)
    //         for every active OUS Pasiva deposit under the same window
    //   Net = In - Out                                             (Net Interest Margin)
    //
    // Maturity events (loan_closing / deposit_closing) AND the new
    // deposit_opened events still visually appear on the calendar as
    // chips so admins can see what's scheduled — they just don't
    // dominate the monthly cashflow total, which now reflects the
    // stable recurring interest economics.
    //
    // Confirmed vs. pending: cashIn above only ever counts verified OUS
    // Activa loans that made it into the real `loans` table — that's a
    // structural guarantee (loans.user_id is NOT NULL, so an unverified
    // credit is physically incapable of landing there; see CLAUDE.md
    // "OUS Activa Integration"). Separately, a "pending" figure is
    // computed below from activaMatches (the same array the Loan Match
    // Review tab and Dashboard's Loan Portfolio caption already use) —
    // the potential monthly interest sitting in still-unverified credits.
    // It's rendered in its own dashed-off sub-line, never added into
    // cashIn/net, so the confirmed numbers this section is named for
    // never quietly include a number nobody has verified.
    const summaryEl = document.getElementById('cal-summary');
    if (summaryEl) {
      const monthStart = new Date(calYear, calMonth, 1);
      const monthEnd   = new Date(calYear, calMonth + 1, 0);
      const parseDay   = (s) => {
        if (!s) return null;
        const [y, m, d] = s.split('-').map(Number);
        return new Date(y, (m || 1) - 1, d || 1);
      };
      const isActiveThisMonth = (l) => {
        const orig = parseDay(l.origination_date);
        const mat  = parseDay(l.maturity_date);
        if (orig && orig > monthEnd)    return false; // starts after this month
        if (mat  && mat  < monthStart)  return false; // matured before this month
        return true;
      };
      let cashIn = 0, cashOut = 0, loanCount = 0, depositCount = 0;
      (calActiveLoans || []).forEach(l => {
        if (!isActiveThisMonth(l)) return;
        const bal = Number(l.balance) || 0;
        const rate = Number(l.interest_rate) || 0;
        if (bal <= 0 || rate <= 0) return;
        const monthlyInterest = bal * (rate / 12 / 100);
        if (l.data_source === 'ous_activa') { cashIn  += monthlyInterest; loanCount++; }
        else if (l.data_source === 'ous_pasiva') { cashOut += monthlyInterest; depositCount++; }
      });

      // Pending (unconfirmed) potential — OUS Activa credits sitting in
      // the Loan Match Review queue that haven't been verified yet (see
      // ous_activa_client_matches / LMR_SELECT_COLS). These can NEVER be
      // folded into cashIn above: runOUSActivaSync() only ever writes a
      // row to `loans` once an admin sets verified=true, so an unverified
      // credit has no origination_date/maturity_date to even month-window
      // against — this is a flat "if every one of these were confirmed
      // today" estimate, not a month-scoped figure like cashIn/cashOut.
      // Shown as a separate, clearly-labeled line so it's never mistaken
      // for real, already-happening cashflow.
      let pendingIn = 0, pendingLoanCount = 0;
      (activaMatches || []).forEach(m => {
        if (m.verified) return;
        const bal = Number(m.balance) || 0;
        const rate = Number(m.interest_rate) || 0;
        if (bal <= 0 || rate <= 0) return;
        pendingIn += bal * (rate / 12 / 100);
        pendingLoanCount++;
      });

      const net = cashIn - cashOut;
      const netDisplay = (net < 0 ? '−' : '+') + fmt.money(Math.abs(net));
      summaryEl.innerHTML =
        '<div class="cal-summary-cell">' +
          '<div class="cal-summary-label"><span class="dot" style="background:#3B8B3B"></span>Cashflow In</div>' +
          '<div class="cal-summary-val in">' + fmt.money(cashIn) + '</div>' +
          '<div class="cal-summary-sub">Interest from ' + loanCount + ' active loan' + (loanCount === 1 ? '' : 's') + '</div>' +
          (pendingLoanCount > 0
            ? '<div class="cal-summary-pending">+' + fmt.money(pendingIn) + '/mo potential &mdash; ' + pendingLoanCount + ' unverified loan' + (pendingLoanCount === 1 ? '' : 's') + ', not yet confirmed</div>'
            : '') +
        '</div>' +
        '<div class="cal-summary-cell">' +
          '<div class="cal-summary-label"><span class="dot" style="background:#C0392B"></span>Cashflow Out</div>' +
          '<div class="cal-summary-val out">' + fmt.money(cashOut) + '</div>' +
          '<div class="cal-summary-sub">Interest to ' + depositCount + ' active deposit' + (depositCount === 1 ? '' : 's') + '</div>' +
        '</div>' +
        '<div class="cal-summary-cell">' +
          '<div class="cal-summary-label">Net Interest Margin</div>' +
          '<div class="cal-summary-val ' + (net >= 0 ? 'in' : 'out') + '">' + netDisplay + '</div>' +
          '<div class="cal-summary-sub">In minus out, this month</div>' +
        '</div>';
    }

    const legend = document.getElementById('cal-legend');
    if (legend) {
      legend.innerHTML = Object.keys(CAL_TYPES).filter(k => k !== 'other').map(k => {
        const t = CAL_TYPES[k];
        return '<div class="cal-legend-item"><span class="dot" style="background:' + t.color + '"></span>' + t.label + '</div>';
      }).join('');
    }
  }

  function ensureCalBg(id) {
    let bg = document.getElementById(id);
    if (bg) return bg;
    bg = document.createElement('div');
    bg.id = id;
    bg.className = 'cal-bg';
    bg.innerHTML = '<div class="cal-panel"></div>';
    document.body.appendChild(bg);
    bg.addEventListener('click', e => { if (e.target === bg) bg.classList.remove('open'); });
    return bg;
  }

  // Does a recurring event fall on a given target date? Returns true if so.
  function recurringHitsDate(ev, target) {
    const rec = ev.recurrence || 'none';
    if (rec === 'none' || !ev.date) return ev.date === target;
    const [by, bm, bd] = ev.date.split('-').map(Number);
    const [ty, tm, td] = target.split('-').map(Number);
    const base = new Date(by, bm - 1, bd);
    const tgt  = new Date(ty, tm - 1, td);
    if (tgt < base) return false;
    if (rec === 'weekly' || rec === 'biweekly') {
      const stepDays = rec === 'weekly' ? 7 : 14;
      const msPerDay = 24 * 60 * 60 * 1000;
      const diff = Math.round((tgt - base) / msPerDay);
      return diff >= 0 && diff % stepDays === 0;
    }
    const monthsMap = { monthly: 1, bimonthly: 2, '6months': 6, '12months': 12, '36months': 36, '48months': 48 };
    const step = monthsMap[rec];
    if (!step) return false;
    const monthsApart = (ty - by) * 12 + (tm - bm);
    if (monthsApart < 0 || monthsApart % step !== 0) return false;
    // Day-of-month must match the base — except we clamp to the last day of
    // shorter months (e.g. Jan 31 → Feb 28).
    const lastOfTarget = new Date(ty, tm, 0).getDate();
    const expected = Math.min(bd, lastOfTarget);
    return td === expected;
  }

  function openDayPanel(dateStr) {
    const bg = ensureCalBg('cal-day-bg');
    const panel = bg.querySelector('.cal-panel');
    const events = calEvents.filter(e => recurringHitsDate(e, dateStr));
    const [y, m, d] = dateStr.split('-').map(Number);
    const pretty = new Date(y, m - 1, d).toLocaleDateString('en-US',
      { weekday:'long', year:'numeric', month:'long', day:'numeric' });

    const recLabel = {
      weekly: 'repeats weekly',
      biweekly: 'repeats every 2 weeks',
      monthly: 'repeats monthly',
      bimonthly: 'repeats every 2 months',
      '6months': 'repeats every 6 months',
      '12months': 'repeats every 12 months',
      '36months': 'repeats every 36 months',
      '48months': 'repeats every 48 months'
    };

    const rowsHtml = events.length ? events.map(ev => {
      const t = CAL_TYPES[ev.type] || CAL_TYPES.other;
      const recBadge = (ev.recurrence && ev.recurrence !== 'none')
        ? ' · <span class="cal-rec-badge">↻ ' + esc(recLabel[ev.recurrence] || ev.recurrence) + '</span>' : '';
      return '<div class="cal-row" style="border-left-color:' + t.color + '">' +
        '<div>' +
          '<div class="t">' + esc(ev.title) + '</div>' +
          '<div class="s">' + esc(t.label) +
            (ev.subtitle    ? ' · ' + esc(ev.subtitle)    : '') +
            (ev.description ? ' · ' + esc(ev.description) : '') +
            (ev.readOnly    ? ' · <em>auto</em>' : '') +
            recBadge +
          '</div>' +
        '</div>' +
        '<div class="actions">' +
          (ev.readOnly ? '' : '<button class="danger" data-cal-delete="' + esc(ev.id) + '">Delete' +
            (ev.recurrence && ev.recurrence !== 'none' ? ' series' : '') + '</button>') +
        '</div>' +
      '</div>';
    }).join('') : '<div class="cal-empty">No events scheduled for this day.</div>';

    panel.innerHTML =
      '<h2>' + esc(pretty) + '</h2>' +
      rowsHtml +
      '<div class="cal-foot">' +
        '<button class="ghost" id="cal-day-close" type="button">Close</button>' +
        '<button class="cal-add" id="cal-day-add"   type="button">+ Add Event</button>' +
      '</div>';

    panel.querySelector('#cal-day-close').addEventListener('click', () => bg.classList.remove('open'));
    panel.querySelector('#cal-day-add').addEventListener('click', () => {
      bg.classList.remove('open');
      openAddEventModal(dateStr);
    });
    panel.querySelectorAll('[data-cal-delete]').forEach(btn => btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-cal-delete');
      const target = calEvents.find(e => e.id === id);
      const isRecurring = target && target.recurrence && target.recurrence !== 'none';
      const prompt = isRecurring
        ? 'Delete this entire recurring series? All future occurrences will disappear from the calendar.'
        : 'Delete this event?';
      if (!confirm(prompt)) return;
      btn.disabled = true; btn.textContent = 'Deleting…';
      const r = await OnixDB.client.from('calendar_events').delete().eq('id', id);
      if (r.error) { alert('Delete failed: ' + r.error.message); btn.disabled = false; btn.textContent = 'Delete'; return; }
      calEvents = calEvents.filter(e => e.id !== id);
      renderCalendar();
      bg.classList.remove('open');
    }));

    bg.classList.add('open');
  }

  function openAddEventModal(presetDate) {
    const bg = ensureCalBg('cal-add-bg');
    const panel = bg.querySelector('.cal-panel');
    const defaultDate = presetDate || new Date().toISOString().slice(0, 10);

    const typeOpts = Object.keys(CAL_TYPES).filter(k => k !== 'other').map(k =>
      '<option value="' + k + '">' + CAL_TYPES[k].label + '</option>'
    ).join('');
    const clientOpts = '<option value="">— No client —</option>' +
      calClients.map(c =>
        '<option value="' + esc(c.id) + '">' + esc(up(c.full_name) || c.email || c.id) + '</option>'
      ).join('');
    // Build the loan options for a specific client (or all loans if blank).
    function loanOptionsFor(clientId) {
      const list = clientId ? calLoans.filter(l => l.user_id === clientId) : calLoans;
      const empty = clientId
        ? '<option value="">— No loan —</option>'
        : '<option value="">— No loan (select a client first to filter) —</option>';
      return empty + list.map(l =>
        '<option value="' + esc(l.id) + '">' +
          esc(l.loan_id_display || l.id.slice(0, 8)) +
          (!clientId && l.profiles && up(l.profiles.full_name) ? ' · ' + esc(up(l.profiles.full_name)) : '') +
        '</option>'
      ).join('');
    }
    const loanOpts = loanOptionsFor('');

    const RECURRENCE_OPTS = [
      ['none',      'Does not repeat'],
      ['weekly',    'Every week'],
      ['biweekly',  'Every two weeks'],
      ['monthly',   'Every month'],
      ['bimonthly', 'Every two months'],
      ['6months',   'Every 6 months'],
      ['12months',  'Every 12 months'],
      ['36months',  'Every 36 months'],
      ['48months',  'Every 48 months']
    ];
    const recOpts = RECURRENCE_OPTS.map(([v, l]) =>
      '<option value="' + v + '">' + l + '</option>'
    ).join('');

    panel.innerHTML =
      '<h2>Add Calendar Event</h2>' +
      '<form id="cal-add-form" class="cal-form">' +
        '<label class="k">Type</label>' +
        '<select name="event_type" required>' + typeOpts + '</select>' +
        '<label class="k">Title</label>' +
        '<input name="title" type="text" required placeholder="e.g. Q2 2026 LP Letter">' +
        '<label class="k">Date</label>' +
        '<input name="event_date" type="date" required value="' + esc(defaultDate) + '">' +
        '<label class="k">Recurrence</label>' +
        '<select name="recurrence" required>' + recOpts + '</select>' +
        '<label class="k">Description (optional)</label>' +
        '<textarea name="description" rows="2"></textarea>' +
        '<label class="k">Related Client (optional)</label>' +
        '<select name="related_profile_id">' + clientOpts + '</select>' +
        '<label class="k">Related Loan (optional)</label>' +
        '<select name="related_loan_id">' + loanOpts + '</select>' +
        '<div id="cal-add-err" style="color:#C0392B;font-size:.85rem;margin-top:10px;display:none"></div>' +
        '<div class="cal-foot">' +
          '<button type="button" class="ghost" id="cal-add-cancel">Cancel</button>' +
          '<button type="submit" class="cal-add" id="cal-add-submit">Save Event</button>' +
        '</div>' +
      '</form>';

    panel.querySelector('#cal-add-cancel').addEventListener('click', () => bg.classList.remove('open'));

    // Filter the Related Loan dropdown to only loans belonging to the
    // currently-selected client. Clears the loan selection on client change.
    const clientSel = panel.querySelector('select[name="related_profile_id"]');
    const loanSel   = panel.querySelector('select[name="related_loan_id"]');
    if (clientSel && loanSel) {
      clientSel.addEventListener('change', () => {
        loanSel.innerHTML = loanOptionsFor(clientSel.value || '');
      });
    }

    panel.querySelector('#cal-add-form').addEventListener('submit', async e => {
      e.preventDefault();
      const form = e.target;
      const err = panel.querySelector('#cal-add-err');
      err.style.display = 'none';
      const fd = new FormData(form);
      const payload = {
        event_type: fd.get('event_type'),
        title: (fd.get('title') || '').trim(),
        event_date: fd.get('event_date'),
        recurrence: fd.get('recurrence') || 'none',
        description: (fd.get('description') || '').trim() || null,
        related_profile_id: fd.get('related_profile_id') || null,
        related_loan_id:    fd.get('related_loan_id')    || null
      };
      if (!payload.title || !payload.event_date || !payload.event_type) {
        err.style.display = 'block';
        err.textContent = 'Type, title, and date are required.';
        return;
      }
      const submitBtn = panel.querySelector('#cal-add-submit');
      submitBtn.disabled = true;
      const origLabel = submitBtn.textContent; submitBtn.textContent = 'Saving…';
      const ins = await OnixDB.client.from('calendar_events').insert(payload).select().single();
      if (ins.error) {
        err.style.display = 'block'; err.textContent = ins.error.message;
        submitBtn.disabled = false; submitBtn.textContent = origLabel;
        return;
      }
      calEvents.push({
        id: ins.data.id, title: ins.data.title, type: ins.data.event_type,
        date: ins.data.event_date, description: ins.data.description, source: 'manual',
        profileId: ins.data.related_profile_id, loanId: ins.data.related_loan_id,
        recurrence: ins.data.recurrence || 'none'
      });
      const [yy, mm] = ins.data.event_date.split('-').map(Number);
      calYear = yy; calMonth = mm - 1;
      renderCalendar();
      bg.classList.remove('open');
    });

    bg.classList.add('open');
  }

  async function wireCalendarTab() {
    injectCalendarStyles();
    let tries = 0;
    const wait = () => new Promise(r => setTimeout(r, 250));
    while (tries++ < 40 && !ensureCalendarSidebarAndView()) await wait();
    try {
      await loadCalendarData();
      renderCalendar();
    } catch (ex) {
      console.error('[onix-cal] init failed:', ex);
    }
  }

  // ================================================================
  // OUS Pasiva tab — proof of concept that exercises the Railway
  // proxy. Three sections: live catalog reference, closing balances
  // for a date, and credits coming due in N days. Standalone — does
  // not interact with the Supabase-backed flows.
  // ================================================================

  const OUS_PROXY_URL = 'https://onix-production-50c3.up.railway.app';

  async function ousFetch(path, body) {
    // Auth: the Railway proxy now requires a Supabase admin JWT on
    // every /api/* call (see server.js requireSupabaseAuth + requireOnixAdmin).
    // Without this header the proxy returns 401. We pull the current
    // access token from the live Supabase session — there is no fallback
    // to "anonymous": if the admin isn't logged in we fail loudly here
    // rather than send an unauthenticated request to Railway.
    const sess = await OnixDB.client.auth.getSession();
    const accessToken = sess && sess.data && sess.data.session && sess.data.session.access_token;
    if (!accessToken) {
      const err = new Error('OUS proxy call requires a logged-in admin Supabase session');
      err.status = 401;
      throw err;
    }
    const authHeader = { Authorization: 'Bearer ' + accessToken };

    // The proxy accepts both GET-with-query and POST-with-body for
    // the parameterized endpoints. We use POST so query strings
    // never end up in browser/Cloudflare logs alongside loan ids.
    const url  = OUS_PROXY_URL + path;
    const init = body
      ? { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, authHeader), body: JSON.stringify(body) }
      : { method: 'GET',  headers: authHeader };
    const res = await fetch(url, init);
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!res.ok) {
      const err = new Error('OUS proxy ' + res.status + ': ' + (json.error || json.detail || text.slice(0, 200)));
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  }

  function injectOUSStyles() {
    if (document.getElementById('ous-styles')) return;
    const s = document.createElement('style');
    s.id = 'ous-styles';
    s.textContent = `
      #view-ous{padding:32px 40px;font-family:'DM Sans',sans-serif;color:#1A1A1A}
      .ous-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:18px;flex-wrap:wrap}
      .ous-head h1{font-family:'Cormorant Garamond',serif;font-style:italic;font-weight:500;font-size:2rem;margin:0}
      .ous-eyebrow{font-size:.7rem;letter-spacing:.18em;text-transform:uppercase;color:#C0392B;font-weight:600;margin-bottom:6px}
      .ous-rule{width:40px;height:2px;background:#C0392B}
      .ous-status{display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border:1px solid #E8E8E8;background:#fff;font-size:.72rem;color:#1A1A1A;letter-spacing:.04em}
      .ous-status .dot{width:8px;height:8px;border-radius:50%;background:#aaa}
      .ous-status.ok    .dot{background:#3B8B3B}
      .ous-status.warn  .dot{background:#C0392B}
      .ous-card{background:#fff;border:1px solid #E8E8E8;border-top:3px solid #C0392B;padding:22px 26px;margin-bottom:22px}
      .ous-card h2{font-family:'Cormorant Garamond',serif;font-style:italic;font-weight:500;font-size:1.4rem;margin:0 0 4px}
      .ous-card .sub{font-size:.74rem;color:#888;margin-bottom:14px}
      .ous-controls{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:14px}
      .ous-controls label{display:flex;flex-direction:column;gap:4px;font-size:.62rem;letter-spacing:.12em;text-transform:uppercase;color:#888;font-weight:700}
      .ous-controls input{padding:9px 11px;border:1px solid #E8E8E8;font-size:.88rem;font-family:inherit;outline:none;background:#fff;color:#1A1A1A;min-width:160px}
      .ous-controls input:focus{border-color:#C0392B}
      .ous-btn{background:#C0392B;color:#fff;border:1px solid #C0392B;padding:10px 18px;cursor:pointer;font:600 .72rem/1 'DM Sans',sans-serif;text-transform:uppercase;letter-spacing:.1em;border-radius:2px;height:36px}
      .ous-btn:hover{background:#a93226}
      .ous-btn:disabled{opacity:.6;cursor:not-allowed}
      .ous-result{margin-top:10px;border:1px solid #E8E8E8;background:#FBFAF7;padding:12px 14px;font-size:.78rem;color:#1A1A1A;line-height:1.55;max-height:520px;overflow:auto}
      .ous-result.err{border-color:#C0392B;background:#FDF0EE;color:#a93226}
      .ous-result .muted{color:#888;font-style:italic}
      .ous-chip-row{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
      .ous-chip{display:inline-block;padding:4px 10px;background:#F4E8E5;color:#1A1A1A;border-radius:2px;font-size:.72rem;font-weight:500}
      .ous-chip strong{color:#C0392B;margin-right:4px}
      .ous-kv-row{display:flex;align-items:baseline;gap:8px;margin:6px 0;font-size:.74rem}
      .ous-kv-row .k{font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#888;font-size:.62rem;min-width:170px}
      .ous-table{width:100%;border-collapse:collapse;font-size:.78rem;margin-top:6px}
      .ous-table th{background:#F8F7F5;color:#888;text-transform:uppercase;letter-spacing:.08em;font-size:.62rem;font-weight:700;padding:8px 10px;text-align:left;border-bottom:1px solid #E8E8E8;white-space:nowrap}
      .ous-table td{padding:8px 10px;border-bottom:1px solid #F0EDE8;color:#1A1A1A;vertical-align:top}
      .ous-table tbody tr:hover{background:#FAFAFA}
      .ous-table .num{text-align:right;font-variant-numeric:tabular-nums}
      .ous-meta-line{font-size:.7rem;color:#888;margin-top:8px}
      .ous-pre{white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,Menlo,monospace;font-size:.72rem;margin:0}
    `;
    document.head.appendChild(s);
  }

  function ensureOUSSidebarAndView() {
    if (document.getElementById('view-ous')) return true;
    const sidebar = document.querySelector('.sidebar');
    const main    = document.querySelector('.main');
    if (!sidebar || !main) return false;

    if (!sidebar.querySelector('[data-view="ous"]')) {
      // Place it right after the Calendar item if that exists, else
      // before Reports / at the end.
      const anchor = sidebar.querySelector('[data-view="calendar"]') ||
                     sidebar.querySelector('[data-view="reports"]');
      const btn = document.createElement('button');
      btn.className = 'sidebar-item';
      btn.setAttribute('data-view', 'ous');
      btn.setAttribute('onclick', "showView('ous')");
      btn.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<path d="M3 3v18h18"/>' +
          '<path d="M7 14l4-4 4 4 5-5"/>' +
        '</svg>' +
        '<span data-en="OUS Pasiva" data-es="OUS Pasiva">OUS Pasiva</span>';
      if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(btn, anchor.nextSibling);
      } else {
        sidebar.appendChild(btn);
      }
    }

    if (!document.getElementById('view-ous')) {
      const v = document.createElement('div');
      v.className = 'view';
      v.id = 'view-ous';
      const today = new Date().toISOString().slice(0, 10);
      v.innerHTML =
        '<div class="ous-head">' +
          '<div>' +
            '<div class="ous-eyebrow" data-en="External System" data-es="Sistema Externo">External System</div>' +
            '<h1>OUS Pasiva</h1>' +
            '<div class="ous-rule"></div>' +
          '</div>' +
          '<div id="ous-status" class="ous-status">' +
            '<span class="dot"></span><span id="ous-status-text" data-en="Checking…" data-es="Verificando…">Checking…</span>' +
          '</div>' +
        '</div>' +

        // ---- Sync control panel -------------------------------------
        // Big red button that mirrors OUS Pasiva credits into the Onix
        // Supabase (profiles + loans), plus a chip showing the latest
        // scheduled run so admins know how fresh the dashboard is.
        '<div class="ous-card" style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">' +
          '<div>' +
            '<h2 data-en="Sync With OUS" data-es="Sincronizar con OUS">Sync With OUS</h2>' +
            '<div class="sub" data-en="Pulls the latest closing balances and coming-due data from OUS and writes them into the Onix database. Runs automatically every 15 minutes; click below to run now." data-es="Trae los saldos al cierre y próximos vencimientos desde OUS y los guarda en la base de datos de Onix. Se ejecuta automáticamente cada 15 minutos; haz clic para ejecutar ahora.">Pulls the latest closing balances and coming-due data from OUS and writes them into the Onix database. Runs automatically every 15 minutes; click below to run now.</div>' +
          '</div>' +
          '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">' +
            '<button class="ous-btn" id="ous-sync-btn" type="button" data-en="Sync Now" data-es="Sincronizar Ahora">Sync Now</button>' +
            '<div id="ous-sync-chip" style="font-size:.72rem;color:#888" data-en="Loading last sync…" data-es="Cargando última sincronización…">Loading last sync…</div>' +
          '</div>' +
        '</div>' +

        // ---- Catalogos ----------------------------------------------
        '<div class="ous-card">' +
          '<h2 data-en="Catalogs" data-es="Catálogos">Catalogs</h2>' +
          '<div class="sub" data-en="Reference lookups live from OUS — products, segments, payment frequencies." data-es="Consultas de referencia en vivo desde OUS — productos, segmentos, frecuencias de pago.">Reference lookups live from OUS — products, segments, payment frequencies.</div>' +
          '<div id="ous-catalogos">' +
            '<div class="muted" data-en="Loading…" data-es="Cargando…">Loading…</div>' +
          '</div>' +
          '<div class="ous-meta-line" id="ous-catalogos-meta"></div>' +
        '</div>' +

        // ---- Closing balances ---------------------------------------
        '<div class="ous-card">' +
          '<h2 data-en="Closing Balances" data-es="Saldos al Cierre">Closing Balances</h2>' +
          '<div class="sub" data-en="Balances on every active credit as of a closing date." data-es="Saldos de cada crédito activo en una fecha de cierre.">Balances on every active credit as of a closing date.</div>' +
          '<div class="ous-controls">' +
            '<label><span data-en="Closing date" data-es="Fecha de cierre">Closing date</span><input type="date" id="ous-cierre-date" value="' + today + '"></label>' +
            '<button class="ous-btn" id="ous-cierre-btn" type="button" data-en="Fetch" data-es="Consultar">Fetch</button>' +
          '</div>' +
          '<div id="ous-cierre-result" class="ous-result"><span class="muted" data-en="No fetch yet." data-es="Sin consulta aún.">No fetch yet.</span></div>' +
        '</div>' +

        // ---- Coming due --------------------------------------------
        '<div class="ous-card">' +
          '<h2 data-en="Credits Coming Due" data-es="Créditos por Vencer">Credits Coming Due</h2>' +
          '<div class="sub" data-en="Credits scheduled to fall due within the next N days." data-es="Créditos programados a vencer en los próximos N días.">Credits scheduled to fall due within the next N days.</div>' +
          '<div class="ous-controls">' +
            '<label><span data-en="Days ahead" data-es="Días por delante">Days ahead</span><input type="number" id="ous-vencer-days" value="30" min="1" max="365" step="1"></label>' +
            '<button class="ous-btn" id="ous-vencer-btn" type="button" data-en="Fetch" data-es="Consultar">Fetch</button>' +
          '</div>' +
          '<div id="ous-vencer-result" class="ous-result"><span class="muted" data-en="No fetch yet." data-es="Sin consulta aún.">No fetch yet.</span></div>' +
        '</div>' +

        // ---- Payload capture (dev tool for setting up sync) --------
        '<div class="ous-card" style="border-top-color:#888">' +
          '<h2 data-en="Capture OUS Payloads" data-es="Capturar Cargas OUS">Capture OUS Payloads</h2>' +
          '<div class="sub" data-en="Snapshots the raw JSON from all three OUS endpoints into Supabase so the dev team can finalize the sync mapping. Safe to run any time." data-es="Guarda la respuesta cruda de los tres endpoints OUS en Supabase para que el equipo de desarrollo cierre el mapeo de la sincronización. Se puede ejecutar en cualquier momento.">Snapshots the raw JSON from all three OUS endpoints into Supabase so the dev team can finalize the sync mapping. Safe to run any time.</div>' +
          '<div class="ous-controls">' +
            '<button class="ous-btn" id="ous-capture-btn" type="button" data-en="Capture Payloads Now" data-es="Capturar Ahora">Capture Payloads Now</button>' +
          '</div>' +
          '<div id="ous-capture-result" class="ous-result"><span class="muted" data-en="No capture yet." data-es="Sin captura aún.">No capture yet.</span></div>' +
        '</div>';
      main.appendChild(v);

      v.querySelector('#ous-cierre-btn').addEventListener('click', () => fetchCierreSaldos());
      v.querySelector('#ous-vencer-btn').addEventListener('click', () => fetchPorVencer());
      v.querySelector('#ous-capture-btn').addEventListener('click', () => captureOUSPayloads());
      v.querySelector('#ous-sync-btn').addEventListener('click', () => runOUSSync());
      refreshOUSSyncChip();
      if (window.__onixOUSSyncPoll) clearInterval(window.__onixOUSSyncPoll);
      window.__onixOUSSyncPoll = setInterval(refreshOUSSyncChip, 30000);
    }
    return true;
  }

  // ---------------- Catalogos ----------------------------------------

  function renderCatalogos(payload) {
    const root = document.getElementById('ous-catalogos');
    if (!root) return;
    const data = (payload && payload.data) || {};

    // Build a chip-row for every list-shaped field in `data`. Each
    // element is either a string ("normal", "judicial") or an object
    // with a human label we can guess at.
    const sections = [];
    Object.keys(data).forEach(key => {
      const val = data[key];
      if (Array.isArray(val) && val.length) {
        const chips = val.map(item => {
          if (item == null) return '';
          if (typeof item === 'string' || typeof item === 'number') {
            return '<span class="ous-chip">' + esc(String(item)) + '</span>';
          }
          // Guess the label and id keys (Spanish API conventions).
          const label = item.nombre || item.producto || item.periodicidad ||
                        item.descripcion || item.label || item.name ||
                        JSON.stringify(item);
          const id = item.id_producto || item.id_periodicidad || item.id_segmento || item.id;
          return '<span class="ous-chip">' +
                   (id != null ? '<strong>' + esc(String(id)) + '</strong>' : '') +
                   esc(String(label)) +
                 '</span>';
        }).join('');
        sections.push(
          '<div class="ous-kv-row"><span class="k">' + esc(key) + '</span>' +
          '<div class="ous-chip-row">' + chips + '</div></div>'
        );
      } else if (val != null && typeof val !== 'object') {
        sections.push(
          '<div class="ous-kv-row"><span class="k">' + esc(key) + '</span><span>' +
            esc(String(val)) + '</span></div>'
        );
      }
    });

    root.innerHTML = sections.length
      ? sections.join('')
      : '<div class="muted">No catalog entries returned.</div>';
  }

  // ---------------- Helpers for tabular results ----------------------

  function ousRenderTable(rows) {
    if (!Array.isArray(rows) || !rows.length) return null;
    // Collect every key across the rows so missing fields don't break
    // the alignment.
    const cols = [];
    const seen = {};
    rows.forEach(r => {
      if (r && typeof r === 'object') {
        Object.keys(r).forEach(k => { if (!seen[k]) { seen[k] = true; cols.push(k); } });
      }
    });
    if (!cols.length) return null;
    const thead = '<thead><tr>' + cols.map(c => '<th>' + esc(c) + '</th>').join('') + '</tr></thead>';
    const tbody = '<tbody>' + rows.map(r => '<tr>' + cols.map(c => {
      const v = r ? r[c] : '';
      const isNumeric = v != null && v !== '' && !isNaN(Number(v));
      return '<td class="' + (isNumeric ? 'num' : '') + '">' + esc(v == null ? '' : String(v)) + '</td>';
    }).join('') + '</tr>').join('') + '</tbody>';
    return '<table class="ous-table">' + thead + tbody + '</table>';
  }

  function ousShowResult(elId, html, isErr) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.classList.toggle('err', !!isErr);
    el.innerHTML = html;
  }

  function ousExtractRows(payload) {
    // OUS responses often look like { status: 'ok', data: { creditos: [...] } }
    // or { status: 'ok', data: [...] }. Try the obvious shapes and
    // fall back to scanning the data object for the first array.
    if (!payload) return null;
    const d = payload.data;
    if (Array.isArray(d)) return d;
    if (d && typeof d === 'object') {
      if (Array.isArray(d.creditos))    return d.creditos;
      if (Array.isArray(d.credits))     return d.credits;
      if (Array.isArray(d.saldos))      return d.saldos;
      if (Array.isArray(d.rows))        return d.rows;
      // Last resort: first array we find inside `data`.
      for (const k of Object.keys(d)) {
        if (Array.isArray(d[k])) return d[k];
      }
    }
    return null;
  }

  // ---------------- /api/creditos-cierre-saldos ----------------------

  async function fetchCierreSaldos() {
    const dateEl = document.getElementById('ous-cierre-date');
    const btnEl  = document.getElementById('ous-cierre-btn');
    if (!dateEl || !btnEl) return;
    const fecha_cierre = dateEl.value;
    if (!fecha_cierre) { ousShowResult('ous-cierre-result', 'Pick a date first.', true); return; }
    ousShowResult('ous-cierre-result', '<span class="muted">Loading…</span>');
    btnEl.disabled = true; const orig = btnEl.textContent; btnEl.textContent = 'Loading…';
    try {
      const payload = await ousFetch('/api/creditos-cierre-saldos', { fecha_cierre });
      const rows = ousExtractRows(payload);
      const table = ousRenderTable(rows);
      const meta = '<div class="ous-meta-line">fecha_cierre=' + esc(fecha_cierre) +
                   ' · ' + (rows ? rows.length + ' row(s)' : 'no rows') +
                   ' · fetched ' + new Date().toLocaleTimeString() + '</div>';
      ousShowResult('ous-cierre-result', (table || '<pre class="ous-pre">' + esc(JSON.stringify(payload, null, 2)) + '</pre>') + meta);
    } catch (err) {
      ousShowResult('ous-cierre-result', esc(err.message || String(err)), true);
    } finally {
      btnEl.disabled = false; btnEl.textContent = orig;
    }
  }

  // ---------------- /api/creditos/por-vencer -------------------------

  // Friendly column labels for the Credits Coming Due table. Anything not in
  // this map falls back to the raw key, which is fine for unexpected fields.
  const PV_COL_LABELS = {
    id_cliente:                   { en: 'Client ID',         es: 'ID Cliente' },
    id_credito:                   { en: 'Credit ID',         es: 'ID Crédito' },
    cliente:                      { en: 'Client',            es: 'Cliente' },
    producto:                     { en: 'Product',           es: 'Producto' },
    fecha_inicio:                 { en: 'Start Date',        es: 'Fecha de Inicio' },
    fecha_vencimiento:            { en: 'Maturity Date',     es: 'Fecha de Vencimiento' },
    saldo_inicial:                { en: 'Initial Balance',   es: 'Saldo Inicial' },
    saldo_actual:                 { en: 'Current Balance',   es: 'Saldo Actual' },
    interes:                      { en: 'Interest',          es: 'Interés' },
    saldo_final:                  { en: 'Final Balance',     es: 'Saldo Final' },
    tasa:                         { en: 'Rate (%)',          es: 'Tasa (%)' },
    tipo_pago:                    { en: 'Payment Frequency', es: 'Frecuencia de Pago' },
    tiene_solicitud_de_renovacion:{ en: 'Renewal Requested?',es: '¿Renovación Solicitada?' }
  };

  // Translate a handful of Spanish enum values when the active language is
  // English. Names, product codes, etc. stay as-is (proper nouns).
  const PV_VALUE_EN = {
    'Diaria':     'Daily',
    'Semanal':    'Weekly',
    'Quincenal':  'Bi-weekly',
    'Mensual':    'Monthly',
    'Trimestral': 'Quarterly',
    'Anual':      'Annual',
    'SI':         'Yes',
    'NO':         'No'
  };
  // Light cleanups for the Spanish side (e.g. add the accent that the OUS
  // API drops on "SI").
  const PV_VALUE_ES = { 'SI': 'Sí' };

  function activeLang() {
    try { if (window.OnixLang && OnixLang.getLang) return OnixLang.getLang(); } catch (e) {}
    return (document.documentElement.getAttribute('data-lang') || 'en');
  }

  function ousRenderPorVencerTable(rows) {
    if (!Array.isArray(rows) || !rows.length) return null;
    const lang = activeLang();
    // Use a fixed column order so the rendered table stays consistent
    // across API responses; trailing keys we don't know about get appended.
    const knownOrder = Object.keys(PV_COL_LABELS);
    const seen = {};
    const cols = [];
    knownOrder.forEach(k => { if (rows.some(r => r && k in r)) { seen[k] = true; cols.push(k); } });
    rows.forEach(r => {
      if (r && typeof r === 'object') {
        Object.keys(r).forEach(k => { if (!seen[k]) { seen[k] = true; cols.push(k); } });
      }
    });
    if (!cols.length) return null;

    const labelFor = (k) => {
      const m = PV_COL_LABELS[k];
      return m ? (lang === 'es' ? m.es : m.en) : k;
    };
    const translateValue = (v) => {
      if (v == null) return '';
      const s = String(v);
      if (lang === 'en' && PV_VALUE_EN[s]) return PV_VALUE_EN[s];
      if (lang === 'es' && PV_VALUE_ES[s]) return PV_VALUE_ES[s];
      return s;
    };

    const thead = '<thead><tr>' + cols.map(c => '<th>' + esc(labelFor(c)) + '</th>').join('') + '</tr></thead>';
    const tbody = '<tbody>' + rows.map(r => '<tr>' + cols.map(c => {
      const v = r ? r[c] : '';
      const isNumeric = v != null && v !== '' && !isNaN(Number(v));
      return '<td class="' + (isNumeric ? 'num' : '') + '">' + esc(translateValue(v)) + '</td>';
    }).join('') + '</tr>').join('') + '</tbody>';
    return '<table class="ous-table">' + thead + tbody + '</table>';
  }

  // Cache the last fetched rows so we can re-render in the new language
  // when the user clicks the EN/ES toggle.
  let __ousPorVencerRows = null;
  let __ousPorVencerDias = null;
  let __ousPorVencerFetchedAt = null;
  function repaintPorVencer() {
    if (!__ousPorVencerRows) return;
    const lang = activeLang();
    const table = ousRenderPorVencerTable(__ousPorVencerRows) || '';
    const labels = lang === 'es'
      ? { dias: 'días', rows: 'fila(s)', noRows: 'sin filas', fetched: 'obtenido' }
      : { dias: 'days', rows: 'row(s)', noRows: 'no rows', fetched: 'fetched' };
    const meta = '<div class="ous-meta-line">' +
                  labels.dias + '=' + esc(__ousPorVencerDias) +
                  ' · ' + (__ousPorVencerRows.length ? __ousPorVencerRows.length + ' ' + labels.rows : labels.noRows) +
                  ' · ' + labels.fetched + ' ' + (__ousPorVencerFetchedAt || '') +
                 '</div>';
    ousShowResult('ous-vencer-result', table + meta);
  }
  // Re-paint whenever the EN/ES toggle is clicked.
  document.addEventListener('click', (e) => {
    if (e.target && e.target.closest && e.target.closest('[data-lang-set]')) {
      setTimeout(repaintPorVencer, 50);
    }
  });

  async function fetchPorVencer() {
    const daysEl = document.getElementById('ous-vencer-days');
    const btnEl  = document.getElementById('ous-vencer-btn');
    if (!daysEl || !btnEl) return;
    const dias = Number(daysEl.value);
    const lang = activeLang();
    const loadingTxt = lang === 'es' ? 'Cargando…' : 'Loading…';
    if (!Number.isFinite(dias) || dias < 1) {
      ousShowResult('ous-vencer-result', lang === 'es' ? 'Los días deben ser ≥ 1.' : 'Days must be ≥ 1.', true);
      return;
    }
    ousShowResult('ous-vencer-result', '<span class="muted">' + esc(loadingTxt) + '</span>');
    btnEl.disabled = true; const orig = btnEl.textContent; btnEl.textContent = loadingTxt;
    try {
      const payload = await ousFetch('/api/creditos/por-vencer', { dias });
      const rows = ousExtractRows(payload);
      __ousPorVencerRows = rows || [];
      __ousPorVencerDias = dias;
      __ousPorVencerFetchedAt = new Date().toLocaleTimeString();
      const table = ousRenderPorVencerTable(rows);
      if (!table) {
        // Fall back to raw JSON for diagnostic visibility if the shape is unexpected
        ousShowResult('ous-vencer-result', '<pre class="ous-pre">' + esc(JSON.stringify(payload, null, 2)) + '</pre>');
      } else {
        repaintPorVencer();
      }
    } catch (err) {
      ousShowResult('ous-vencer-result', esc(err.message || String(err)), true);
    }  finally {
      btnEl.disabled = false; btnEl.textContent = orig;
    }
  }

  // ---------------- Payload capture (dev tool) -----------------------
  // POSTs to /api/ous-capture, which fires all three OUS endpoints in
  // one shot on the Railway proxy and stages the raw JSON in the
  // public.ous_raw_capture Supabase table for developer inspection.
  async function captureOUSPayloads() {
    const btnEl = document.getElementById('ous-capture-btn');
    const resEl = document.getElementById('ous-capture-result');
    if (!btnEl || !resEl) return;
    const lang = activeLang();
    const loadingTxt = lang === 'es' ? 'Capturando…' : 'Capturing…';
    ousShowResult('ous-capture-result', '<span class="muted">' + esc(loadingTxt) + '</span>');
    btnEl.disabled = true; const orig = btnEl.textContent; btnEl.textContent = loadingTxt;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const payload = await ousFetch('/api/ous-capture', { fecha_cierre: today, dias: 90 });
      const rows = (payload && payload.results) || [];
      const lines = rows.map(r => {
        const status = r.error ? 'ERROR' : ('HTTP ' + r.http_status);
        const saved  = r.saved ? '<span style="color:#3B8B3B">saved ✓</span>' : ('<span style="color:#C0392B">save failed: ' + esc(r.save_error || '?') + '</span>');
        const detail = r.error ? ' — ' + esc(r.error) : '';
        return '<div><b>' + esc(r.endpoint) + '</b> · ' + status + ' · ' + saved + detail + '</div>';
      }).join('');
      const doneNote = (lang === 'es'
        ? 'Cargas guardadas en Supabase (public.ous_raw_capture). Enviar al equipo de desarrollo.'
        : 'Payloads staged in Supabase (public.ous_raw_capture). Send to dev team.');
      ousShowResult('ous-capture-result',
        lines +
        '<div style="margin-top:10px;font-size:.72rem;color:#888">' + esc(doneNote) + '</div>');
    } catch (err) {
      ousShowResult('ous-capture-result', esc(err.message || String(err)), true);
    } finally {
      btnEl.disabled = false; btnEl.textContent = orig;
    }
  }

  // ---------------- OUS sync (mirror OUS Pasiva into Supabase) -------
  // Hits the Railway proxy's /api/sync-run which fetches OUS then
  // upserts clients + loans. On success we immediately trigger a
  // refreshAll() so the admin sees the freshly-synced numbers on the
  // dashboard / clients / loans tabs without needing to reload.
  async function runOUSSync() {
    const btn = document.getElementById('ous-sync-btn');
    if (!btn) return;
    const orig = btn.textContent;
    btn.disabled = true;
    const lang = activeLang();
    btn.textContent = lang === 'es' ? 'Sincronizando…' : 'Syncing…';
    try {
      const summary = await ousFetch('/api/sync-run', {});
      const chip = document.getElementById('ous-sync-chip');
      if (chip) {
        const parts = [
          (lang === 'es' ? 'Listo · ' : 'Done · ') +
          summary.rows_seen + (lang === 'es' ? ' créditos' : ' credits'),
          summary.clients_upserted + (lang === 'es' ? ' clientes' : ' clients') +
            (summary.clients_created ? ' (' + summary.clients_created + ' ' + (lang === 'es' ? 'nuevos' : 'new') + ')' : ''),
          summary.loans_upserted + (lang === 'es' ? ' préstamos' : ' loans'),
          (summary.duration_ms / 1000).toFixed(1) + 's'
        ];
        chip.textContent = parts.join(' · ');
        chip.style.color = summary.ok ? '#3B8B3B' : '#C0392B';
      }
      if (typeof refreshAll === 'function') refreshAll();
      setTimeout(refreshOUSSyncChip, 3000);
    } catch (err) {
      const chip = document.getElementById('ous-sync-chip');
      if (chip) {
        chip.textContent = (lang === 'es' ? 'Error: ' : 'Error: ') + (err.message || String(err));
        chip.style.color = '#C0392B';
      }
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  }

  // Read the last sync from /api/sync-status and paint the chip.
  async function refreshOUSSyncChip() {
    const chip = document.getElementById('ous-sync-chip');
    if (!chip) return;
    try {
      const r = await ousFetch('/api/sync-status');
      const l = r && r.latest;
      const lang = activeLang();
      if (!l) {
        chip.textContent = lang === 'es' ? 'Sin sincronizaciones aún.' : 'No syncs yet.';
        chip.style.color = '#888';
        return;
      }
      const ago = Math.round((Date.now() - new Date(l.ran_at).getTime()) / 60000);
      const agoTxt = ago < 1
        ? (lang === 'es' ? 'hace instantes' : 'moments ago')
        : (lang === 'es' ? 'hace ' + ago + ' min' : ago + ' min ago');
      const noun = lang === 'es' ? 'Última sincronización' : 'Last synced';
      const detail = l.ok
        ? ' · ' + l.loans_upserted + (lang === 'es' ? ' préstamos' : ' loans') +
          ' · ' + l.clients_upserted + (lang === 'es' ? ' clientes' : ' clients')
        : ' · ' + (lang === 'es' ? 'con errores' : 'with errors');
      chip.textContent = noun + ' ' + agoTxt + detail;
      chip.style.color = l.ok ? '#3B8B3B' : '#C0392B';
    } catch (err) {
      chip.textContent = (activeLang() === 'es' ? 'No se pudo cargar el estado.' : 'Could not load sync status.');
      chip.style.color = '#888';
    }
  }

  // ---------------- Status pill + initial load -----------------------

  // Helper: set the OUS status pill text + sync data-en/data-es so the
  // EN/ES toggle's MutationObserver can re-translate when the user flips.
  function setOusStatus(txt, en, es) {
    if (!txt) return;
    txt.setAttribute('data-en', en);
    txt.setAttribute('data-es', es);
    const lang = activeLang();
    txt.textContent = (lang === 'es' ? es : en);
  }
  async function loadOUSHealth() {
    const txt  = document.getElementById('ous-status-text');
    const pill = document.getElementById('ous-status');
    if (!pill) return;
    pill.classList.remove('ok','warn');
    try {
      const r = await fetch(OUS_PROXY_URL + '/healthz', { cache: 'no-store' });
      const j = await r.json();
      if (j.ous_logged_in) {
        pill.classList.add('ok');
        const time = new Date(j.token_acquired_at).toLocaleTimeString();
        setOusStatus(txt,
          'Connected · token acquired ' + time,
          'Conectado · token obtenido ' + time);
      } else {
        pill.classList.add('warn');
        setOusStatus(txt,
          'Proxy not logged in (see Railway logs)',
          'Proxy no autenticado (ver logs en Railway)');
      }
    } catch (err) {
      pill.classList.add('warn');
      setOusStatus(txt, 'Cannot reach proxy', 'No se puede conectar al proxy');
    }
  }

  async function wireOUSTab() {
    injectOUSStyles();
    let tries = 0;
    const wait = () => new Promise(r => setTimeout(r, 250));
    while (tries++ < 40 && !ensureOUSSidebarAndView()) await wait();
    loadOUSHealth();
    try {
      const payload = await ousFetch('/api/catalogos');
      renderCatalogos(payload);
      const meta = document.getElementById('ous-catalogos-meta');
      if (meta && payload && payload.data && payload.data.fechaCierre) {
        meta.textContent = 'Most recent fechaCierre reported by OUS: ' + payload.data.fechaCierre;
      }
    } catch (err) {
      const root = document.getElementById('ous-catalogos');
      if (root) root.innerHTML = '<div class="ous-result err">' + esc(err.message || String(err)) + '</div>';
    }
  }

  // ================================================================
  // PROFILE TAB
  // Injects a Profile sidebar item + view-profile div into the
  // unpacked Bolt bundle (same dynamic-injection pattern as Calendar
  // and OUS above — never edits the JSON-encoded bundler blob
  // directly). Lets the logged-in admin edit their own Full Name /
  // Phone / Address. Email is read-only (auth-managed, not editable
  // here). wireAdminProfileForm always scopes the update to
  // .eq('id', userId) — the logged-in admin's own row — so it can
  // never touch role, status, or any other admin/client's data.
  // ================================================================
  function ensureProfileSidebarAndView() {
    if (document.getElementById('view-profile')) return true;
    const sidebar = document.querySelector('.sidebar');
    const main    = document.querySelector('.main');
    if (!sidebar || !main) return false;

    if (!sidebar.querySelector('[data-view="profile"]')) {
      const anchor = sidebar.querySelector('[data-view="users"]');
      const btn = document.createElement('button');
      btn.className = 'sidebar-item';
      btn.setAttribute('data-view', 'profile');
      btn.setAttribute('onclick', "showView('profile')");
      btn.innerHTML =
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<circle cx="12" cy="8" r="4"></circle>' +
          '<path d="M4 21v-1a8 8 0 0 1 16 0v1"></path>' +
        '</svg>' +
        '<span data-en="Profile" data-es="Perfil">Profile</span>';
      if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(btn, anchor.nextSibling);
      } else {
        sidebar.appendChild(btn);
      }
    }

    if (!document.getElementById('view-profile')) {
      const v = document.createElement('div');
      v.className = 'view';
      v.id = 'view-profile';
      v.innerHTML =
        '<div class="page-hd reveal">' +
          '<div class="page-hd-text">' +
            '<div class="eyebrow" data-en="Account" data-es="Cuenta">Account</div>' +
            '<h1 data-en="My Profile" data-es="Mi Perfil">My Profile</h1>' +
            '<div class="rule"></div>' +
          '</div>' +
        '</div>' +
        '<div class="card reveal">' +
          '<div class="card-title" data-en="Personal Information" data-es="Información Personal">Personal Information</div>' +
          '<div class="form-grid">' +
            '<div class="form-field"><label class="field-label" data-en="Full Name" data-es="Nombre">Full Name</label><input type="text" class="field-input" id="profile-full-name"></div>' +
            '<div class="form-field"><label class="field-label" data-en="Email" data-es="Correo">Email</label><input type="email" class="field-input" id="profile-email" readonly></div>' +
            '<div class="form-field"><label class="field-label" data-en="Phone" data-es="Teléfono">Phone</label><input type="tel" class="field-input" id="profile-phone"></div>' +
            '<div class="form-field"><label class="field-label" data-en="Address" data-es="Dirección">Address</label><input type="text" class="field-input" id="profile-address"></div>' +
          '</div>' +
          '<button class="btn btn-red" type="button" id="profile-save-btn"><span data-en="Save Changes" data-es="Guardar Cambios">Save Changes</span></button>' +
        '</div>';
      main.appendChild(v);
      const emailInput = v.querySelector('#profile-email');
      emailInput.style.background = '#f4f4f4';
      emailInput.style.cursor = 'not-allowed';
      emailInput.setAttribute('title', 'Email cannot be changed from here');
    }
    return true;
  }

  function wireAdminProfileForm(profile, userId) {
    const view = document.getElementById('view-profile');
    if (!view) return;
    const nameInput    = view.querySelector('#profile-full-name');
    const emailInput   = view.querySelector('#profile-email');
    const phoneInput   = view.querySelector('#profile-phone');
    const addressInput = view.querySelector('#profile-address');
    const saveBtn      = view.querySelector('#profile-save-btn');
    if (!nameInput || !saveBtn) return;

    nameInput.value    = profile.full_name || '';
    emailInput.value   = profile.email || '';
    phoneInput.value   = profile.phone || '';
    addressInput.value = profile.address || '';

    if (saveBtn.dataset.onixWired === '1') return;
    saveBtn.dataset.onixWired = '1';
    saveBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const orig = saveBtn.innerHTML;
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span>Saving…</span>';
      const payload = {
        full_name: (nameInput.value || '').trim() || null,
        phone:     (phoneInput.value || '').trim() || null,
        address:   (addressInput.value || '').trim() || null
      };
      const { error } = await OnixDB.client
        .from('profiles')
        .update(payload)
        .eq('id', userId);
      saveBtn.disabled = false;
      saveBtn.innerHTML = orig;
      if (error) {
        alert('Could not save profile: ' + error.message);
        return;
      }
      profile.full_name = payload.full_name;
      profile.phone     = payload.phone;
      profile.address   = payload.address;
      renderSidebarUser(profile);
      let banner = view.querySelector('[data-onix-profile-ok]');
      if (!banner) {
        banner = document.createElement('div');
        banner.setAttribute('data-onix-profile-ok', '1');
        banner.style.cssText = 'margin-top:14px;padding:10px 12px;background:var(--success-bg);color:var(--success-text);border-left:3px solid var(--success);font-size:.85rem';
        saveBtn.after(banner);
      }
      banner.textContent = '✓ Profile updated';
      banner.style.opacity = '1';
      setTimeout(() => { banner.style.transition = 'opacity 1s'; banner.style.opacity = '0'; }, 2500);
    });
  }

  async function wireProfileTab(profile, userId) {
    let tries = 0;
    const wait = () => new Promise(r => setTimeout(r, 250));
    while (tries++ < 40 && !ensureProfileSidebarAndView()) await wait();
    wireAdminProfileForm(profile, userId);
  }

  // ============================================================
  // LOAN MATCH REVIEW TAB
  // Injects a "Loan Match Review" sidebar item + view into the
  // unpacked Bolt bundle — same dynamic-inject pattern as Calendar
  // (ensureCalendarSidebarAndView) and Active Deposits
  // (ensureActiveDepositsSidebarAndView). admin-portal.html itself is
  // never touched. Reviews/verifies rows in ous_activa_client_matches,
  // replacing the manual Supabase Table Editor / SQL Editor workflow
  // (see CLAUDE.md "OUS Activa Integration"). All reads/writes go
  // straight through OnixDB.client with the existing
  // ous_activa_client_matches_admin_all RLS policy (is_admin()) — no
  // new backend endpoint.
  // ============================================================
  let activaMatches = [];
  let activaMatchesLoaded = false;
  let lmrFilters = { verified: 'unverified', confidence: '' };
  const LMR_CONFIDENCE_COLOR = { high: '#2D6A2D', medium: '#A07818', low: '#C0392B', none: '#888' };
  const LMR_SELECT_COLS = 'id_credito, nombre_cliente_raw, balance, interest_rate, matched_profile_id, confidence, verified, verified_by, verified_at, first_seen_at, last_seen_at, profiles!matched_profile_id(full_name, email)';

  function injectLoanMatchReviewStyles() {
    if (document.getElementById('lmr-styles')) return;
    const s = document.createElement('style');
    s.id = 'lmr-styles';
    s.textContent = `
      #view-loan-match-review{padding:32px 40px;font-family:'DM Sans',sans-serif;color:#1A1A1A}
      .lmr-filters{display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;align-items:center}
      .lmr-filters select{padding:8px 10px;border:1px solid #E8E8E8;font:600 .74rem/1 'DM Sans',sans-serif;color:#1A1A1A;background:#fff}
      .lmr-conf{display:inline-block;padding:2px 8px;font-size:.62rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;border-radius:2px;color:#fff}
      .lmr-picker-input{width:100%;padding:9px 11px;border:1px solid #E8E8E8;font-size:.88rem;font-family:inherit;outline:none;box-sizing:border-box}
      .lmr-picker-input:focus{border-color:#C0392B}
      .lmr-picker-results{max-height:220px;overflow-y:auto;border:1px solid #E8E8E8;border-top:none;margin-top:-1px}
      .lmr-picker-row{padding:9px 12px;cursor:pointer;font-size:.84rem;border-bottom:1px solid #f4f4f4}
      .lmr-picker-row:hover,.lmr-picker-row.sel{background:#FAE8E8}
      .lmr-picker-row .sub{font-size:.7rem;color:#888;margin-top:1px}
      .lmr-picker-empty{padding:12px;color:#888;font-style:italic;font-size:.82rem}
      .lmr-picked{margin-top:10px;padding:10px 12px;background:#F8F7F5;border-left:3px solid #C0392B;font-size:.86rem;display:flex;justify-content:space-between;align-items:center;gap:8px}
    `;
    document.head.appendChild(s);
  }

  function ensureLoanMatchReviewSidebarAndView() {
    if (document.getElementById('view-loan-match-review') &&
        document.querySelector('[data-view="loan-match-review"]')) return true;
    const sidebar = document.querySelector('.sidebar');
    const main    = document.querySelector('.main');
    if (!sidebar || !main) return false;

    if (!sidebar.querySelector('[data-view="loan-match-review"]')) {
      // Anchor right after Active Deposits so the two OUS-sourced tabs
      // sit together under Lending.
      const anchor = sidebar.querySelector('[data-view="active-deposits"]') ||
                     sidebar.querySelector('[data-view="loans"]');
      const btn = document.createElement('button');
      btn.className = 'sidebar-item';
      btn.setAttribute('data-view', 'loan-match-review');
      btn.setAttribute('onclick', "showView('loan-match-review')");
      btn.innerHTML =
        // Magnifying glass over a person — reviewing/matching a client.
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<circle cx="10" cy="10" r="6"/>' +
          '<line x1="14.5" y1="14.5" x2="20" y2="20"/>' +
          '<path d="M7 10a3 3 0 0 1 3-3"/>' +
        '</svg>' +
        '<span data-en="Loan Match Review" data-es="Revisión de Coincidencias">Loan Match Review</span>';
      if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(btn, anchor.nextSibling);
      } else {
        sidebar.appendChild(btn);
      }
    }

    if (!document.getElementById('view-loan-match-review')) {
      const v = document.createElement('div');
      v.className = 'view';
      v.id = 'view-loan-match-review';
      main.appendChild(v);
    }
    return true;
  }

  async function loadActivaMatchesData() {
    const { data, error } = await OnixDB.client
      .from('ous_activa_client_matches')
      .select(LMR_SELECT_COLS)
      .order('verified', { ascending: true })
      .order('last_seen_at', { ascending: false });
    if (error) { console.error('[onix-lmr] load failed:', error); return; }
    activaMatches = data || [];
  }

  // Builds the view shell + filter controls once (guarded by
  // alreadyPainted, same convention as every other painted view here).
  // Row content is rendered by renderLoanMatchReviewRows() below, called
  // both from here (so a fresh shell always shows current data) and
  // directly after Verify/Clear actions (no need to rebuild the shell
  // for those).
  function paintLoanMatchReviewView() {
    const v = document.getElementById('view-loan-match-review');
    if (!v || alreadyPainted(v)) return false;
    v.innerHTML = viewShell('Loan Match Review',
      'Verify which OUS Activa credits belong to which client before they become real loans',
      `<div class="lmr-filters">
        <select id="lmr-filter-verified">
          <option value="unverified">Unverified only</option>
          <option value="">All statuses</option>
          <option value="verified">Verified only</option>
        </select>
        <select id="lmr-filter-confidence">
          <option value="">All confidence levels</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
          <option value="none">None</option>
        </select>
        <button type="button" class="oac-btn outline" id="lmr-refresh-btn">↻ Refresh</button>
        <span id="lmr-count" style="font-size:.78rem;color:#888"></span>
      </div>
      <table class="oac-table" style="width:100%"><thead><tr>
        <th>Client Name (raw)</th><th>Credit ID</th><th>Confidence</th><th>Last Synced</th><th>Matched To</th><th>Status</th><th style="text-align:right">Actions</th>
      </tr></thead><tbody id="lmr-tbody"></tbody></table>`);

    v.querySelector('#lmr-filter-verified').value = lmrFilters.verified;
    v.querySelector('#lmr-filter-confidence').value = lmrFilters.confidence;
    v.querySelector('#lmr-filter-verified').addEventListener('change', e => {
      lmrFilters.verified = e.target.value; renderLoanMatchReviewRows();
    });
    v.querySelector('#lmr-filter-confidence').addEventListener('change', e => {
      lmrFilters.confidence = e.target.value; renderLoanMatchReviewRows();
    });
    v.querySelector('#lmr-refresh-btn').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; const orig = btn.textContent; btn.textContent = 'Refreshing…';
      await loadActivaMatchesData();
      renderLoanMatchReviewRows();
      btn.disabled = false; btn.textContent = orig;
    });

    renderLoanMatchReviewRows();
    return true;
  }

  function renderLoanMatchReviewRows() {
    const tbody = document.getElementById('lmr-tbody');
    const countEl = document.getElementById('lmr-count');
    if (!tbody) return;

    const filtered = activaMatches.filter(m => {
      if (lmrFilters.verified === 'verified' && !m.verified) return false;
      if (lmrFilters.verified === 'unverified' && m.verified) return false;
      if (lmrFilters.confidence && m.confidence !== lmrFilters.confidence) return false;
      return true;
    });
    if (countEl) countEl.textContent = filtered.length + ' of ' + activaMatches.length + ' rows';

    tbody.innerHTML = filtered.length ? filtered.map((m) => `
      <tr>
        <td>${esc(m.nombre_cliente_raw)}</td>
        <td>${esc(m.id_credito)}</td>
        <td><span class="lmr-conf" style="background:${LMR_CONFIDENCE_COLOR[m.confidence] || '#888'}">${esc(m.confidence)}</span></td>
        <td>${fmt.date(m.last_seen_at)}</td>
        <td>${m.profiles ? esc(up(m.profiles.full_name) || m.profiles.email) : '—'}</td>
        <td><span class="oac-badge ${m.verified ? 'active' : 'pending'}">${m.verified ? 'Verified' : 'Unverified'}</span></td>
        <td style="text-align:right;white-space:nowrap">
          <button type="button" class="oac-btn outline" data-lmr-verify="${esc(m.id_credito)}">${m.matched_profile_id ? 'Edit Match' : 'Verify Match'}</button>
          ${m.matched_profile_id
            ? `<button type="button" class="oac-btn danger" data-lmr-clear="${esc(m.id_credito)}">Clear Match</button>`
            : `<button type="button" class="oac-btn outline" data-lmr-create="${esc(m.id_credito)}">Create New Client</button>`}
        </td>
      </tr>`).join('') : '<tr><td colspan="7" class="oac-empty">No rows match the current filters.</td></tr>';

    tbody.querySelectorAll('[data-lmr-verify]').forEach(b => {
      b.addEventListener('click', () => {
        const row = activaMatches.find(m => m.id_credito === b.dataset.lmrVerify);
        if (row) openVerifyMatchModal(row);
      });
    });
    tbody.querySelectorAll('[data-lmr-clear]').forEach(b => {
      b.addEventListener('click', () => {
        const row = activaMatches.find(m => m.id_credito === b.dataset.lmrClear);
        if (row) clearMatch(row);
      });
    });
    tbody.querySelectorAll('[data-lmr-create]').forEach(b => {
      b.addEventListener('click', () => {
        const row = activaMatches.find(m => m.id_credito === b.dataset.lmrCreate);
        if (row) openCreateClientModal(row);
      });
    });
  }

  // Searchable client picker — reuses window.__onixAdminData.clients
  // (the same data source wireGlobalSearch reads) and the same
  // lowercase-substring hit test wireGlobalSearch uses, rendered as an
  // embeddable list inside the existing modal system (ensureModal/
  // openModal) rather than the global search's fixed-position dropdown.
  function openVerifyMatchModal(row) {
    const clients = ((window.__onixAdminData && window.__onixAdminData.clients) || [])
      .filter(c => c.role === 'client');
    let picked = row.matched_profile_id
      ? clients.find(c => c.id === row.matched_profile_id) || null
      : null;

    openModal(`
      <h2>Verify Match</h2>
      <div class="sub">${esc(row.nombre_cliente_raw)} · Credit ${esc(row.id_credito)} ·
        <span class="lmr-conf" style="background:${LMR_CONFIDENCE_COLOR[row.confidence] || '#888'}">${esc(row.confidence)}</span>
      </div>
      <div class="oac-modal-row" style="grid-template-columns:1fr">
        <div>
          <div class="k">Search clients</div>
          <input type="text" class="lmr-picker-input" id="lmr-search" placeholder="Type a name or email…" autocomplete="off">
          <div class="lmr-picker-results" id="lmr-results" style="display:none"></div>
          <div id="lmr-picked-wrap"></div>
        </div>
      </div>
      <div id="lmr-verify-err" style="color:#C0392B;font-size:.85rem;margin-bottom:10px;display:none"></div>
      <div class="oac-modal-foot" style="margin-top:0">
        <button type="button" class="oac-btn outline" data-modal-close>Cancel</button>
        <button type="button" class="oac-btn red" id="lmr-verify-submit" disabled>Verify Match</button>
      </div>
    `);

    const searchInput = document.getElementById('lmr-search');
    const resultsEl   = document.getElementById('lmr-results');
    const pickedWrap  = document.getElementById('lmr-picked-wrap');
    const submitBtn   = document.getElementById('lmr-verify-submit');

    function renderPicked() {
      submitBtn.disabled = !picked;
      if (!picked) { pickedWrap.innerHTML = ''; return; }
      pickedWrap.innerHTML = `<div class="lmr-picked">
        <span>${esc(up(picked.full_name) || picked.email)} · ${esc(picked.email || '')}</span>
        <button type="button" class="oac-btn outline" id="lmr-picked-clear" style="margin:0">Change</button>
      </div>`;
      resultsEl.style.display = 'none';
      document.getElementById('lmr-picked-clear').addEventListener('click', () => {
        picked = null; renderPicked(); searchInput.value = ''; searchInput.focus();
      });
    }

    function runSearch(q) {
      q = q.trim().toLowerCase();
      if (!q) { resultsEl.innerHTML = ''; resultsEl.style.display = 'none'; return; }
      const hit = s => String(s || '').toLowerCase().includes(q);
      const matches = clients.filter(c => hit(c.full_name) || hit(c.email)).slice(0, 20);
      resultsEl.innerHTML = matches.length
        ? matches.map((c, i) => `<div class="lmr-picker-row" data-pick="${i}">
            <div>${esc(up(c.full_name) || c.email)}</div>
            <div class="sub">${esc(c.email || '')}</div>
          </div>`).join('')
        : '<div class="lmr-picker-empty">No clients match.</div>';
      resultsEl.style.display = 'block';
      resultsEl.querySelectorAll('[data-pick]').forEach(el => {
        el.addEventListener('click', () => {
          picked = matches[Number(el.dataset.pick)];
          renderPicked();
        });
      });
    }

    let t;
    searchInput.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => runSearch(searchInput.value), 120);
    });
    renderPicked(); // shows the currently-matched client, if any, pre-filled

    submitBtn.addEventListener('click', async () => {
      if (!picked) return;
      const err = document.getElementById('lmr-verify-err');
      err.style.display = 'none';
      submitBtn.disabled = true; const orig = submitBtn.textContent; submitBtn.textContent = 'Saving…';
      try {
        const sess = await OnixDB.client.auth.getSession();
        const adminId = sess && sess.data && sess.data.session && sess.data.session.user && sess.data.session.user.id;
        if (!adminId) throw new Error('No active admin session — please sign in again.');
        const { data, error } = await OnixDB.client
          .from('ous_activa_client_matches')
          .update({
            matched_profile_id: picked.id,
            verified: true,
            verified_by: adminId,
            verified_at: new Date().toISOString()
          })
          .eq('id_credito', row.id_credito)
          .select(LMR_SELECT_COLS)
          .single();
        if (error) throw error;
        const idx = activaMatches.findIndex(m => m.id_credito === row.id_credito);
        if (idx !== -1) activaMatches[idx] = data;
        document.getElementById('oac-modal').classList.remove('open');
        renderLoanMatchReviewRows();
      } catch (ex) {
        err.style.display = 'block';
        err.textContent = ex.message || 'Could not save.';
        submitBtn.disabled = false; submitBtn.textContent = orig;
      }
    });
  }

  // "Create New Client" — Piece 2. For rows with no existing candidate
  // match at all. Needs a real backend endpoint (POST /api/activa-
  // create-client) rather than a direct Supabase write like Verify/Clear
  // use — creating a real login-capable account requires the Admin Auth
  // API + service role key, which can't happen from the browser (same
  // reason createPlaceholderClient() lives in server.js). Uses the
  // existing field()/submitBar() form helpers (same as openAddLoanModal)
  // rather than a bespoke layout, since this is a plain field-entry
  // form, and ousFetch() (same helper the OUS Pasiva tab already uses)
  // rather than handleFormSubmit(), since this posts to the Railway
  // proxy, not a direct Supabase insert.
  function openCreateClientModal(row) {
    openModal(`
      <h2>Create New Client</h2>
      <div class="sub">${esc(row.nombre_cliente_raw)} · Credit ${esc(row.id_credito)} ·
        <span class="lmr-conf" style="background:${LMR_CONFIDENCE_COLOR[row.confidence] || '#888'}">${esc(row.confidence)}</span>
      </div>
      <form id="lmr-create-form">
        <div class="oac-modal-row" style="grid-template-columns:1fr">
          ${field('Full Name', 'full_name', { required: true, value: row.nombre_cliente_raw })}
        </div>
        <div class="oac-modal-row" style="grid-template-columns:1fr">
          ${field('Email', 'email', { required: true, type: 'email', placeholder: 'client@example.com' })}
        </div>
        <div class="oac-modal-row">
          ${field('Phone (optional)', 'phone', { placeholder: '(713) 555-0100' })}
          ${field('Address (optional)', 'address', { placeholder: '1842 Montrose Blvd, Houston, TX' })}
        </div>
        <div style="font-size:.76rem;color:#888;margin-bottom:14px">
          Creates a real login-capable account (status: Ready to Activate) and links it to this credit as a verified match.
        </div>
        ${submitBar('Create Client')}
      </form>
    `);

    const form = document.getElementById('lmr-create-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = form.querySelector('[data-form-submit]');
      const errEl = form.querySelector('#oac-form-err');
      errEl.style.display = 'none';
      const orig = submitBtn.textContent;
      submitBtn.disabled = true; submitBtn.textContent = 'Creating…';
      try {
        const fd = new FormData(form);
        // ousFetch() throws on any non-2xx response (see the OUS Pasiva
        // tab above), so reaching the line after this is success.
        const resp = await ousFetch('/api/activa-create-client', {
          id_credito: row.id_credito,
          full_name:  String(fd.get('full_name') || '').trim(),
          email:      String(fd.get('email') || '').trim(),
          phone:      strOrNull(fd.get('phone')),
          address:    strOrNull(fd.get('address'))
        });
        const idx = activaMatches.findIndex(m => m.id_credito === row.id_credito);
        if (idx !== -1 && resp.match) activaMatches[idx] = resp.match;
        document.getElementById('oac-modal').classList.remove('open');
        renderLoanMatchReviewRows();
        // Unlike Verify/Clear, this adds a brand-new client — refresh the
        // shared client list (window.__onixAdminData.clients) so it's
        // immediately searchable in the Verify Match picker for other
        // rows, and so Dashboard/Clients reflect the new account too.
        if (typeof refreshAll === 'function') refreshAll();
      } catch (ex) {
        errEl.style.display = 'block';
        errEl.textContent = ex.message || 'Could not create client.';
        submitBtn.disabled = false; submitBtn.textContent = orig;
      }
    });
  }

  // Clears matched_profile_id/confidence AND verified together, so a
  // cleared row reads as "not verified" rather than a "verified but
  // empty" state — a plain confirm() is enough here (matches the
  // existing precedent for reversible, non-catastrophic actions
  // elsewhere in this file, e.g. closing a raise, removing a document).
  async function clearMatch(row) {
    if (!confirm('Clear the match for ' + row.nombre_cliente_raw + ' (Credit ' + row.id_credito +
      ')? This unmatches and unverifies the row — it will not delete it from the review queue.')) return;
    try {
      const { data, error } = await OnixDB.client
        .from('ous_activa_client_matches')
        .update({ matched_profile_id: null, confidence: 'none', verified: false })
        .eq('id_credito', row.id_credito)
        .select(LMR_SELECT_COLS)
        .single();
      if (error) throw error;
      const idx = activaMatches.findIndex(m => m.id_credito === row.id_credito);
      if (idx !== -1) activaMatches[idx] = data;
      renderLoanMatchReviewRows();
    } catch (ex) {
      alert('Could not clear match: ' + (ex.message || ex));
    }
  }

  async function wireLoanMatchReviewTab() {
    let tries = 0;
    const wait = () => new Promise(r => setTimeout(r, 250));
    while (tries++ < 40 && !ensureLoanMatchReviewSidebarAndView()) await wait();
    injectLoanMatchReviewStyles();
    try {
      await loadActivaMatchesData();
      activaMatchesLoaded = true;
      paintLoanMatchReviewView();
    } catch (ex) {
      console.error('[onix-lmr] init failed:', ex);
    }
  }
  // ── /Loan Match Review tab ────────────────────────────────────────────────

  // ── Role-based permission enforcement ────────────────────────────────────
  // Managers can view all data and add clients but cannot reject/remove
  // clients or manage admin team members. Account executives (role=admin,
  // title=ae) can view data but cannot add clients — the real enforcement
  // for that is server-side (admin_create_client()'s is_ae() check in
  // Postgres, and requireNotAE on POST /api/activa-create-client in
  // server.js); this is UI-only, so an AE never even sees a button that
  // would just fail. We hide the relevant buttons/tabs via CSS injected
  // once, then re-apply via MutationObserver to catch elements the bundler
  // renders after initial load.
  function enforceRolePermissions(role, title) {
    if (role !== 'manager' && title !== 'ae') return; // no restrictions apply

    const CSS_RULES = [];
    if (role === 'manager') {
      CSS_RULES.push(
        // Hide reject/remove buttons for clients
        '[data-act="reject"], [data-pending-act="reject"], #oac-bulk-reject, .oac-btn.danger { display: none !important; }',
        // Hide the Users/Team management tab in the sidebar
        '[data-view="users"], [onclick*="showView(\'users\')"], a[href="#users"] { display: none !important; }',
        // Hide the Users view itself
        '#view-users { display: none !important; }'
      );
    }
    if (title === 'ae') {
      CSS_RULES.push(
        // Hide every "+ New Client" trigger (Clients tab button, the
        // per-row "Create New Client" action in Loan Match Review).
        '#oac-new-client-btn, [data-lmr-create] { display: none !important; }'
      );
    }

    if (!document.getElementById('__onix_role_css')) {
      const s = document.createElement('style');
      s.id = '__onix_role_css';
      s.textContent = CSS_RULES.join('\n');
      document.head.appendChild(s);
    }

    // Re-apply to any elements the bundler injects after initial load
    const obs = new MutationObserver(() => {
      if (role === 'manager') {
        document.querySelectorAll('[data-act="reject"], [data-pending-act="reject"], #oac-bulk-reject')
          .forEach(el => { el.style.display = 'none'; });
      }
      if (title === 'ae') {
        document.querySelectorAll('#oac-new-client-btn, [data-lmr-create]')
          .forEach(el => { el.style.display = 'none'; });
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }
  // ── /Role-based permission enforcement ───────────────────────────────────

  async function bootstrap() {
    const gate = await OnixDB.requireAdmin();
    if (!gate) return;
    injectStyles();
    buildPanel();
    renderSidebarUser(gate.profile);
    enforceRolePermissions(gate.profile.role, gate.profile.title);
    // oac-greeting belongs to the retired Live Admin Console drawer; only
    // set its text if the element actually exists. Without this guard the
    // bootstrap throws and downstream wiring (Calendar tab, etc.) never runs.
    const greet = document.getElementById('oac-greeting');
    if (greet) greet.textContent = 'Signed in as ' + (gate.profile.full_name || gate.profile.email);
    wireCalendarTab();
    wireOUSTab();
    wireProfileTab(gate.profile, gate.profile.id);
    wireLoanMatchReviewTab();
    refreshAll();
  }

  // Expose refreshAll so other scripts (e.g. the New Client overlay in
  // admin-portal.html) can request a re-fetch + repaint after they create
  // data without going through this IIFE's own submit forms.
  window.__onixAdminRefresh = refreshAll;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap);
  else bootstrap();
})();
