/* Presentasjon · bibliotek: blokker (settes inn) og hele presentasjoner (startpunkt), i tre nivåer:
   Faktisk (godkjent, på Faktisks Drive, bare admin publiserer), Delt og Mine.
   Bare i Studio (window.faktisk.presentationBlocks*). Filene pakkes med JSZip, alt ukomprimert,
   så Studio kan lese og pakke ut uten egne zip-biblioteker (src/presentasjon-blokker.js). */
(function () {
  const F = window.faktisk;
  if (!F || !F.presentationBlocksList) return;

  // eksempelmenyen fra prototypen erstattes av biblioteket (eksemplene der har ikke medier)
  const deckpick = document.querySelector('.deckpick');
  if (deckpick) {
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn small'; btn.id = 'libHeadBtn'; btn.textContent = 'Bibliotek…';
    deckpick.replaceWith(btn); btn.addEventListener('click', () => openLibrary());
  }

  // ---------- knapper under lysbildelista ----------
  const wrap = document.querySelector('.add-wrap');
  const row = document.createElement('div'); row.className = 'blk-row';
  row.innerHTML = '<button class="btn small" id="blkSaveBtn" type="button">Lagre i biblioteket…</button><button class="btn small" id="blkInsertBtn" type="button">Bibliotek…</button>';
  wrap.appendChild(row);
  // typemenyen skal åpne seg rett over «+ Nytt lysbilde» og kunne rulles når den er høyere enn plassen over
  { const am = document.getElementById('typemenu'), ab = document.getElementById('addBtn');
    const place = () => { if (matchMedia('(max-width: 720px)').matches) { am.style.bottom = am.style.maxHeight = ''; return; }
      am.style.bottom = (wrap.clientHeight - ab.offsetTop + 6) + 'px'; am.style.maxHeight = Math.max(180, ab.getBoundingClientRect().top - Math.max(12, document.getElementById('list').getBoundingClientRect().top) - 6) + 'px'; };
    ab.addEventListener('click', place, true); window.addEventListener('resize', () => { if (!am.hidden) place(); }); }

  const css = document.createElement('style');
  css.textContent = `
  .blk-row{display:flex;flex-direction:column;gap:6px;margin-top:8px}.blk-row .btn{justify-content:center;width:100%;box-sizing:border-box}
  dialog.blk{background:var(--ui-panel);color:var(--ui-fg);border:1px solid var(--ui-line);border-radius:14px;padding:0;width:min(780px,92vw);max-height:88vh}
  dialog.blk::backdrop{background:rgba(0,0,0,.55)}
  .blk-in{display:flex;flex-direction:column;gap:12px;padding:18px 20px;max-height:88vh;box-sizing:border-box}
  .blk h3{margin:0;font-size:17px}.blk .mute{color:var(--ui-mute);font-size:12.5px}
  .blk input[type=text],.blk textarea{width:100%;box-sizing:border-box;background:var(--ui-bg);color:var(--ui-fg);border:1px solid var(--ui-line);border-radius:8px;padding:8px 10px;font:inherit}
  .blk textarea{min-height:54px;resize:vertical}
  .blk-kind{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .blk-kind label{border:1px solid var(--ui-line);border-radius:10px;padding:10px 12px;cursor:pointer;display:flex;gap:10px;align-items:flex-start}
  .blk-kind label:has(input:checked){border-color:var(--ui-accent);background:var(--ui-raise)}
  .blk-slides{overflow:auto;display:flex;flex-direction:column;gap:4px;max-height:32vh;border:1px solid var(--ui-line);border-radius:8px;padding:6px}
  .blk-slides label{display:grid;grid-template-columns:20px 28px 1fr auto;gap:8px;align-items:center;padding:4px 6px;border-radius:6px;cursor:pointer}
  .blk-slides label:hover{background:var(--ui-raise)}.blk-slides .n{color:var(--ui-mute);font-variant-numeric:tabular-nums}
  .blk-foot{display:flex;gap:8px;justify-content:flex-end;align-items:center;flex-wrap:wrap}.blk-foot .sp{flex:1}
  .blk-tabs{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.blk-tabs button[aria-pressed=true]{background:var(--ui-accent);color:#0f1514;border-color:var(--ui-accent)}
  .blk-list{overflow:auto;display:flex;flex-direction:column;gap:8px;min-height:120px;max-height:54vh}
  .blk-card{border:1px solid var(--ui-line);border-radius:10px;padding:10px 12px;background:var(--ui-raise);display:flex;flex-direction:column;gap:6px}
  .blk-card h4{margin:0;font-size:15px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}.blk-card .acts{display:flex;gap:6px;flex-wrap:wrap}
  .blk-tag{font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:2px 6px;border-radius:4px;background:var(--ui-bg);color:var(--ui-mute)}
  .blk-tag.faktisk{background:#0050FC;color:#fff}.blk-tag.delt{background:#2d4a68;color:#fff}.blk-tag.pres{background:#FFD166;color:#3A2C00}
  .blk-titles{font-size:12.5px;color:var(--ui-mute);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  .blk-empty{color:var(--ui-mute);padding:16px;text-align:center;border:1px dashed var(--ui-line);border-radius:10px}
  .blk-drop{outline:3px dashed var(--ui-accent);outline-offset:-6px}
  .blk-where{font-size:12px;color:var(--ui-mute);display:flex;flex-direction:column;gap:3px}
  .blk-where button{all:unset;cursor:pointer;text-decoration:underline;color:var(--ui-fg)}`;
  document.head.appendChild(css);

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const titleOf = (s) => (s.f && (s.f.tittel || s.f.sak || s.f.utsagn || s.f.kicker)) || TYPES[s.type].name;
  const dateNo = (iso) => { try { return new Date(iso).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; } };
  const home = (p) => String(p || '').replace(/^\/Users\/[^/]+/, '~');
  const LEVEL = { faktisk: 'Faktisk', delt: 'Delt', mine: 'Mine' };
  function dialog(html) {
    const d = document.createElement('dialog'); d.className = 'blk'; d.innerHTML = `<div class="blk-in">${html}</div>`;
    document.body.appendChild(d); d.addEventListener('close', () => d.remove()); d.showModal(); return d;
  }

  // ---------- lagre ----------
  document.getElementById('blkSaveBtn').addEventListener('click', () => {
    const d = dialog(`<h3>Lagre i biblioteket</h3>
      <div class="blk-kind" role="radiogroup" aria-label="Hva som lagres">
        <label><input type="radio" name="kind" value="blokk" checked><span><b>Blokk</b><br><span class="mute">Noen lysbilder, for eksempel et case, som settes inn i andre presentasjoner.</span></span></label>
        <label><input type="radio" name="kind" value="presentasjon"><span><b>Hel presentasjon</b><br><span class="mute">Alle lysbildene med tittel, palett og avsender, som man starter en ny presentasjon fra.</span></span></label>
      </div>
      <label>Navn<input type="text" id="blkName" value="${esc(doc.title)}"></label>
      <label>Beskrivelse (valgfritt)<textarea id="blkDesc" placeholder="Hva den viser, og når den passer"></textarea></label>
      <div class="blk-foot" style="justify-content:flex-start"><b>Lysbilder</b><span class="sp"></span><button class="btn small" type="button" id="blkAll">Alle</button><button class="btn small" type="button" id="blkNone">Ingen</button></div>
      <div class="blk-slides" id="blkSlides">${slides.map((s, i) => `<label><input type="checkbox" value="${i}" ${i === sel ? 'checked' : ''}><span class="n">${i + 1}</span><span>${esc(titleOf(s))}</span><span class="mute">${esc(TYPES[s.type].name)}</span></label>`).join('')}</div>
      <p class="mute">Bilder, klipp og lyd pakkes inn i fila, så den virker på alle maskiner. Den lagres i «Mine», og kan deles derfra.</p>
      <div class="blk-foot"><span class="mute" id="blkStatus"></span><span class="sp"></span><button class="btn" type="button" id="blkCancel">Avbryt</button><button class="btn primary" type="button" id="blkGo">Lagre</button></div>`);
    const boxes = () => [...d.querySelectorAll('#blkSlides input')];
    d.querySelector('#blkAll').onclick = () => boxes().forEach((b) => { b.checked = true; });
    d.querySelector('#blkNone').onclick = () => boxes().forEach((b) => { b.checked = false; });
    d.querySelectorAll('input[name=kind]').forEach((r) => r.onchange = () => { if (r.checked && r.value === 'presentasjon') boxes().forEach((b) => { b.checked = true; }); });
    d.querySelector('#blkCancel').onclick = () => d.close();
    d.querySelector('#blkGo').onclick = async () => {
      const kind = d.querySelector('input[name=kind]:checked').value;
      const idx = boxes().filter((b) => b.checked).map((b) => +b.value);
      const name = d.querySelector('#blkName').value.trim() || 'Uten navn', st = d.querySelector('#blkStatus');
      if (!idx.length) { st.textContent = 'Velg minst ett lysbilde.'; return; }
      const go = d.querySelector('#blkGo'); go.disabled = true; st.textContent = 'Pakker medier …';
      try {
        const zip = new JSZip(), media = {}; let n = 0, skipped = 0;
        const pick = idx.map((i) => JSON.parse(JSON.stringify({ ...slides[i], img: slides[i].img || {} })));
        for (const s of pick) {
          delete s.def; delete s.blokk;
          for (const [role, m] of Object.entries(s.img)) {
            if (!m || !m.url || !/^file:/.test(m.url)) { if (m && m.url) skipped++; delete s.img[role]; continue; }   // blob-adresser kan ikke lagres
            if (!media[m.url]) {
              const r = await F.presentationReadFile(m.url); if (!r || !r.ok) throw new Error(r && r.error || 'Kunne ikke lese ' + m.url);
              const base = decodeURI(m.url).split('/').pop().replace(/[^\w.\-æøåÆØÅ ]/g, '_');
              media[m.url] = `medier/${n++}-${base}`; zip.file(media[m.url], r.bytes);
            }
            m.url = 'blokk:' + media[m.url];
          }
        }
        const manifest = { format: 'faktisk-blokk', version: 1, kind, id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          name, description: d.querySelector('#blkDesc').value.trim(), savedAt: new Date().toISOString(),
          palette: doc.palette, sender: doc.sender, logo: doc.logo || null, doc: kind === 'presentasjon' ? { title: name, palette: doc.palette, sender: doc.sender, logo: doc.logo || null } : null, slides: pick };
        zip.file('blokk.json', JSON.stringify(manifest, null, 1));
        st.textContent = 'Lagrer …';
        const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
        const r = await F.presentationBlocksSave({ bytes, name });
        if (!r.ok) throw new Error(r.error);
        d.close(); toast(`«${name}» er lagret i Mine${skipped ? ` (${skipped} medie${skipped > 1 ? 'r' : ''} uten fil kom ikke med: lagre dokumentet først)` : ''}.`);
      } catch (err) { console.error(err); st.textContent = 'Kunne ikke lagre: ' + err.message; go.disabled = false; }
    };
  });

  // ---------- bibliotek ----------
  document.getElementById('blkInsertBtn').addEventListener('click', () => openLibrary());
  function openLibrary() {
    let level = 'alle', q = '', data = null;
    const d = dialog(`<h3>Bibliotek</h3>
      <div class="blk-tabs" role="group" aria-label="Hvilke"><button class="btn small" data-l="alle" aria-pressed="true">Alle</button><button class="btn small" data-l="faktisk" aria-pressed="false">Faktisk</button><button class="btn small" data-l="delt" aria-pressed="false">Delt</button><button class="btn small" data-l="mine" aria-pressed="false">Mine</button>
        <span style="flex:1"></span><input type="text" id="blkQ" placeholder="Søk" style="max-width:220px"></div>
      <div class="blk-list" id="blkList"></div>
      <div class="blk-foot"><div class="blk-where" id="blkWhere"></div><span class="sp"></span><button class="btn small" type="button" id="blkBlank">Ny tom presentasjon</button><button class="btn small" type="button" id="blkImport">Importer fil…</button><button class="btn" type="button" id="blkClose">Lukk</button></div>`);
    const list = d.querySelector('#blkList');
    d.querySelector('#blkClose').onclick = () => d.close();
    d.querySelector('#blkBlank').onclick = async (e) => {
      const btn = e.currentTarget;   // må hentes før await: etterpå er currentTarget null
      const info = F.documentInfo ? await F.documentInfo().catch(() => null) : null;
      if (!arm(btn, info ? `Klikk igjen: tømmer «${info.name || 'dokumentet'}»` : 'Klikk igjen: tømmer lysbildene')) return;
      deck = 'tom'; doc = freshDoc('tom'); slides = DECKS.tom.slides(); sel = 0;
      document.getElementById('docTitle').value = doc.title; save(); drawAll(); d.close();
      toast('Ny tom presentasjon. Bruk Lagre som… hvis du vil beholde den forrige.');
    };
    d.querySelectorAll('.blk-tabs button').forEach((b) => b.onclick = () => { level = b.dataset.l; d.querySelectorAll('.blk-tabs button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); draw(); });
    d.querySelector('#blkQ').oninput = (e) => { q = e.target.value.toLowerCase(); draw(); };
    d.querySelector('#blkImport').onclick = async () => {
      const r = await F.openFileDialog({ title: 'Velg bibliotekfil', filters: [{ name: 'Faktisk-blokk', extensions: ['faktiskblokk'] }] });
      if (r && !r.canceled && r.path) { const x = await F.presentationBlocksImport([r.path]); if (!x.ok) toast('Kunne ikke importere: ' + x.error); refresh(); }
    };
    list.addEventListener('dragover', (e) => { e.preventDefault(); list.classList.add('blk-drop'); });
    list.addEventListener('dragleave', () => list.classList.remove('blk-drop'));
    list.addEventListener('drop', async (e) => { e.preventDefault(); list.classList.remove('blk-drop');
      const paths = [...e.dataTransfer.files].map((f) => (F.pathForFile || F.bevisPathForFile)(f)).filter((p) => p && p.endsWith('.faktiskblokk'));
      if (paths.length) { const x = await F.presentationBlocksImport(paths); if (!x.ok) toast('Kunne ikke importere: ' + x.error); refresh(); } });

    async function refresh() { data = await F.presentationBlocksList(); draw(); }
    function where(s) {
      const el = d.querySelector('#blkWhere');
      el.innerHTML = `<span>Faktisk: ${s.faktisk ? esc(home(s.faktisk)) : 'ikke valgt'} · <button data-c="faktisk">${s.faktisk ? 'endre' : 'velg mappa på Faktisk-Drive'}</button></span>
        <span>Delt: ${s.delt ? esc(home(s.delt)) : 'ikke valgt'} · <button data-c="delt">${s.delt ? 'endre' : 'velg'}</button> &nbsp; Mine: ${esc(home(s.mine))} · <button data-c="mine">endre</button></span>`;
      el.querySelectorAll('[data-c]').forEach((b) => b.onclick = async () => { const r = await F.presentationBlocksChoose(b.dataset.c); if (r.ok) refresh(); });
    }
    function draw() {
      if (!data) { list.innerHTML = '<div class="blk-empty">Henter biblioteket …</div>'; return; }
      if (!data.ok) { list.innerHTML = `<div class="blk-empty">${esc(data.error)}</div>`; return; }
      const s = data.settings; where(s);
      const items = data.blocks.filter((b) => (level === 'alle' || b.level === level) &&
        (!q || (b.name + ' ' + b.description + ' ' + b.slides.map((x) => x.title).join(' ')).toLowerCase().includes(q)));
      if (!items.length) {
        const hint = level === 'faktisk' && !s.faktisk ? 'Velg mappa med Faktisk-biblioteket på Faktisks Google Drive nederst.' : level === 'delt' && !s.delt ? 'Velg en delt mappe nederst for å se det andre har delt.' : '';
        list.innerHTML = `<div class="blk-empty">${data.blocks.length ? 'Ingenting passer.' : 'Biblioteket er tomt. Lagre lysbilder med «Lagre i biblioteket…», eller slipp en .faktiskblokk-fil her.'}${hint ? '<br>' + hint : ''}</div>`; return;
      }
      list.innerHTML = '';
      for (const b of items) {
        const pres = b.kind === 'presentasjon', c = document.createElement('div'); c.className = 'blk-card';
        c.innerHTML = `<h4>${esc(b.name)}<span class="blk-tag ${b.level}">${LEVEL[b.level]}</span>${pres ? '<span class="blk-tag pres">Presentasjon</span>' : ''}</h4>
          ${b.error ? `<div class="mute">Kan ikke leses: ${esc(b.error)}</div>` : `<div class="mute">${b.slides.length} lysbilde${b.slides.length === 1 ? '' : 'r'} · ${esc(dateNo(b.savedAt))} · ${Math.max(1, Math.round(b.size / 1e6))} MB</div>
          ${b.description ? `<div>${esc(b.description)}</div>` : ''}<div class="blk-titles">${b.slides.map((x, i) => `${i + 1}. ${esc(x.title || x.type)}`).join(' · ')}</div>`}
          <div class="acts">${b.error ? '' : (pres ? '<button class="btn small primary" data-a="ny">Start ny presentasjon herfra</button>' : '') + `<button class="btn small${pres ? '' : ' primary'}" data-a="ins">Sett inn etter lysbilde ${sel + 1}</button>`}
            ${b.level === 'mine' && s.delt ? '<button class="btn small" data-a="del">Del</button>' : ''}
            ${data.admin && b.level !== 'faktisk' && s.faktisk ? '<button class="btn small" data-a="pub">Publiser til Faktisk</button>' : ''}
            ${data.admin && b.level === 'faktisk' ? '<button class="btn small" data-a="unpub">Fjern fra Faktisk…</button>' : ''}
            <button class="btn small" data-a="vis">Vis i Finder</button>
            ${b.level === 'mine' ? '<button class="btn small" data-a="slett">Slett…</button>' : ''}</div>`;
        c.querySelectorAll('[data-a]').forEach((btn) => btn.onclick = () => act(btn.dataset.a, b, btn));
        list.appendChild(c);
      }
    }
    const arm = (btn, text) => { if (btn.dataset.armed) return true; btn.dataset.armed = '1'; btn.textContent = text; return false; };
    async function act(a, b, btn) {
      if (a === 'vis') return F.presentationBlocksReveal(b.path);
      if (a === 'del') { const r = await F.presentationBlocksShare(b.path); toast(r.ok ? `«${b.name}» er kopiert til den delte mappa.` : 'Kunne ikke dele: ' + r.error); return refresh(); }
      if (a === 'pub') { const r = await F.presentationBlocksPublish(b.path); toast(r.ok ? `«${b.name}» er publisert i Faktisk-biblioteket.` : 'Kunne ikke publisere: ' + r.error); return refresh(); }
      if (a === 'unpub') { if (!arm(btn, 'Klikk igjen for å fjerne')) return; const r = await F.presentationBlocksUnpublish(b.path); toast(r.ok ? `«${b.name}» er fjernet fra Faktisk-biblioteket.` : 'Kunne ikke fjerne: ' + r.error); return refresh(); }
      if (a === 'slett') { if (!arm(btn, 'Klikk igjen for å slette')) return; const r = await F.presentationBlocksTrash(b.path); toast(r.ok ? `«${b.name}» er lagt i papirkurven.` : 'Kunne ikke slette: ' + r.error); return refresh(); }
      if (a === 'ny') {
        const info = F.documentInfo ? await F.documentInfo() : null;
        if (!arm(btn, info ? `Klikk igjen: erstatter innholdet i «${info.name || 'dokumentet'}»` : 'Klikk igjen: erstatter lysbildene')) return;
      }
      if (a === 'ins' || a === 'ny') {
        btn.disabled = true; btn.textContent = 'Henter …';
        const r = await F.presentationBlocksLoad({ path: b.path });
        if (!r.ok) { toast('Kunne ikke hente: ' + r.error); btn.disabled = false; return; }
        const add = r.block.slides.filter((s) => TYPES[s.type]).map((s, i) => ({ ...s, id: uid++, img: s.img || {},
          in: i === 0 && a === 'ins' ? 'toning' : s.in,   // mellom blokker: vanlig toning
          blokk: { id: r.block.id, name: r.block.name, savedAt: r.block.savedAt, level: b.level } }));
        if (a === 'ny') {
          const dd = r.block.doc || {};
          doc = { ...doc, title: dd.title || r.block.name, palette: PALETTES[dd.palette] ? dd.palette : doc.palette, sender: dd.sender || doc.sender, logo: dd.logo || (dd.sender ? null : doc.logo) };
          slides = add; sel = 0; document.getElementById('docTitle').value = doc.title;
        } else { slides.splice(sel + 1, 0, ...add); sel = sel + 1; }
        save(); drawAll(); d.close();
        toast(a === 'ny' ? `Startet fra «${b.name}». Lagre som nytt dokument med Lagre som… hvis du vil beholde originalen urørt.` : `«${b.name}» er satt inn (${add.length} lysbilde${add.length === 1 ? '' : 'r'}).`);
      }
    }
    draw(); refresh();
  }
})();
