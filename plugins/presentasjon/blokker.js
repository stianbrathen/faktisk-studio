/* Presentasjon · blokker: lagre lysbilder som en blokk og sette blokker inn i andre presentasjoner.
   Bare i Studio (window.faktisk.presentationBlocks*). Pakker blokka med JSZip, alt ukomprimert,
   så Studio kan lese og pakke ut uten egne zip-biblioteker (src/presentasjon-blokker.js). */
(function () {
  const F = window.faktisk;
  if (!F || !F.presentationBlocksList) return;

  // ---------- knapper under lysbildelista ----------
  const wrap = document.querySelector('.add-wrap');
  const row = document.createElement('div'); row.className = 'blk-row';
  row.innerHTML = '<button class="btn small" id="blkSaveBtn" type="button">Lagre som blokk…</button><button class="btn small" id="blkInsertBtn" type="button">Sett inn blokk…</button>';
  wrap.appendChild(row);

  const css = document.createElement('style');
  css.textContent = `
  .blk-row{display:flex;flex-direction:column;gap:6px;margin-top:8px}.blk-row .btn{justify-content:center;width:100%;box-sizing:border-box}
  dialog.blk{background:var(--ui-panel);color:var(--ui-fg);border:1px solid var(--ui-line);border-radius:14px;padding:0;width:min(760px,92vw);max-height:86vh}
  dialog.blk::backdrop{background:rgba(0,0,0,.55)}
  .blk-in{display:flex;flex-direction:column;gap:12px;padding:18px 20px;max-height:86vh;box-sizing:border-box}
  .blk h3{margin:0;font-size:17px}.blk .mute{color:var(--ui-mute);font-size:12.5px}
  .blk input[type=text],.blk textarea{width:100%;box-sizing:border-box;background:var(--ui-bg);color:var(--ui-fg);border:1px solid var(--ui-line);border-radius:8px;padding:8px 10px;font:inherit}
  .blk textarea{min-height:54px;resize:vertical}
  .blk-slides{overflow:auto;display:flex;flex-direction:column;gap:4px;max-height:38vh;border:1px solid var(--ui-line);border-radius:8px;padding:6px}
  .blk-slides label{display:grid;grid-template-columns:20px 28px 1fr auto;gap:8px;align-items:center;padding:4px 6px;border-radius:6px;cursor:pointer}
  .blk-slides label:hover{background:var(--ui-raise)}.blk-slides .n{color:var(--ui-mute);font-variant-numeric:tabular-nums}
  .blk-foot{display:flex;gap:8px;justify-content:flex-end;align-items:center;flex-wrap:wrap}.blk-foot .sp{flex:1}
  .blk-tabs{display:flex;gap:6px;align-items:center}.blk-tabs button[aria-pressed=true]{background:var(--ui-accent);color:#0f1514;border-color:var(--ui-accent)}
  .blk-list{overflow:auto;display:flex;flex-direction:column;gap:8px;min-height:120px;max-height:52vh}
  .blk-card{border:1px solid var(--ui-line);border-radius:10px;padding:10px 12px;background:var(--ui-raise);display:flex;flex-direction:column;gap:6px}
  .blk-card h4{margin:0;font-size:15px}.blk-card .acts{display:flex;gap:6px;flex-wrap:wrap}
  .blk-tag{font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:2px 6px;border-radius:4px;background:var(--ui-bg);color:var(--ui-mute);margin-left:6px}
  .blk-tag.delt{background:#2d4a68;color:#fff}
  .blk-titles{font-size:12.5px;color:var(--ui-mute);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  .blk-empty{color:var(--ui-mute);padding:16px;text-align:center;border:1px dashed var(--ui-line);border-radius:10px}
  .blk-drop{outline:3px dashed var(--ui-accent);outline-offset:-6px}`;
  document.head.appendChild(css);

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const titleOf = (s) => (s.f && (s.f.tittel || s.f.sak || s.f.utsagn || s.f.kicker)) || TYPES[s.type].name;
  const dateNo = (iso) => { try { return new Date(iso).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; } };
  function dialog(html) {
    const d = document.createElement('dialog'); d.className = 'blk'; d.innerHTML = `<div class="blk-in">${html}</div>`;
    document.body.appendChild(d); d.addEventListener('close', () => d.remove()); d.showModal(); return d;
  }

  // ---------- lagre ----------
  document.getElementById('blkSaveBtn').addEventListener('click', () => {
    const d = dialog(`<h3>Lagre som blokk</h3>
      <p class="mute">Lysbildene du velger lagres med tekst, talenotater, bygg og medier i én fil i «Mine blokker». Paletten følger presentasjonen blokka settes inn i.</p>
      <label>Navn<input type="text" id="blkName" value="${esc(doc.title)}"></label>
      <label>Beskrivelse (valgfritt)<textarea id="blkDesc" placeholder="Hva blokka viser, og når den passer"></textarea></label>
      <div class="blk-foot" style="justify-content:flex-start"><b>Lysbilder</b><span class="sp"></span><button class="btn small" type="button" id="blkAll">Alle</button><button class="btn small" type="button" id="blkNone">Ingen</button></div>
      <div class="blk-slides" id="blkSlides">${slides.map((s, i) => `<label><input type="checkbox" value="${i}" ${i === sel ? 'checked' : ''}><span class="n">${i + 1}</span><span>${esc(titleOf(s))}</span><span class="mute">${esc(TYPES[s.type].name)}</span></label>`).join('')}</div>
      <div class="blk-foot"><span class="mute" id="blkStatus"></span><span class="sp"></span><button class="btn" type="button" value="cancel" id="blkCancel">Avbryt</button><button class="btn primary" type="button" id="blkGo">Lagre blokk</button></div>`);
    const boxes = () => [...d.querySelectorAll('#blkSlides input')];
    d.querySelector('#blkAll').onclick = () => boxes().forEach((b) => { b.checked = true; });
    d.querySelector('#blkNone').onclick = () => boxes().forEach((b) => { b.checked = false; });
    d.querySelector('#blkCancel').onclick = () => d.close();
    d.querySelector('#blkGo').onclick = async () => {
      const idx = boxes().filter((b) => b.checked).map((b) => +b.value);
      const name = d.querySelector('#blkName').value.trim() || 'Blokk', st = d.querySelector('#blkStatus');
      if (!idx.length) { st.textContent = 'Velg minst ett lysbilde.'; return; }
      const go = d.querySelector('#blkGo'); go.disabled = true; st.textContent = 'Pakker medier …';
      try {
        const zip = new JSZip(), media = {}; let n = 0;
        const pick = idx.map((i) => JSON.parse(JSON.stringify({ ...slides[i], img: slides[i].img || {} })));
        for (const s of pick) {
          delete s.def; delete s.blokk;
          for (const [role, m] of Object.entries(s.img)) {
            if (!m || !m.url) { delete s.img[role]; continue; }
            if (!/^file:/.test(m.url)) { delete s.img[role]; continue; }   // blob-adresser kan ikke lagres
            if (!media[m.url]) {
              const r = await F.presentationReadFile(m.url); if (!r || !r.ok) throw new Error(r && r.error || 'Kunne ikke lese ' + m.url);
              const base = decodeURI(m.url).split('/').pop().replace(/[^\w.\-æøåÆØÅ ]/g, '_');
              media[m.url] = `medier/${n++}-${base}`; zip.file(media[m.url], r.bytes);
            }
            m.url = 'blokk:' + media[m.url];
          }
        }
        const manifest = { format: 'faktisk-blokk', version: 1, id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          name, description: d.querySelector('#blkDesc').value.trim(), savedAt: new Date().toISOString(),
          palette: doc.palette, sender: doc.sender, slides: pick };
        zip.file('blokk.json', JSON.stringify(manifest, null, 1));
        st.textContent = 'Lagrer …';
        const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
        const r = await F.presentationBlocksSave({ bytes, name });
        if (!r.ok) throw new Error(r.error);
        d.close(); toast(`Blokka «${name}» er lagret i Mine blokker (${idx.length} lysbilde${idx.length > 1 ? 'r' : ''}).`);
      } catch (err) { console.error(err); st.textContent = 'Kunne ikke lagre: ' + err.message; go.disabled = false; }
    };
  });

  // ---------- sette inn ----------
  document.getElementById('blkInsertBtn').addEventListener('click', async () => {
    let level = 'alle', q = '', data = null;
    const d = dialog(`<h3>Sett inn blokk</h3>
      <div class="blk-tabs" role="group" aria-label="Hvilke blokker"><button class="btn small" data-l="alle" aria-pressed="true">Alle</button><button class="btn small" data-l="mine" aria-pressed="false">Mine</button><button class="btn small" data-l="delt" aria-pressed="false">Delt</button>
        <span style="flex:1"></span><input type="text" id="blkQ" placeholder="Søk" style="max-width:220px"></div>
      <div class="blk-list" id="blkList"></div>
      <div class="blk-foot"><span class="mute" id="blkWhere"></span><span class="sp"></span>
        <button class="btn small" type="button" id="blkImport">Importer fil…</button><button class="btn small" type="button" id="blkMine">Mappe for mine…</button><button class="btn small" type="button" id="blkDelt">Delt mappe…</button><button class="btn" type="button" id="blkClose">Lukk</button></div>`);
    const list = d.querySelector('#blkList');
    d.querySelector('#blkClose').onclick = () => d.close();
    d.querySelectorAll('.blk-tabs button').forEach((b) => b.onclick = () => { level = b.dataset.l; d.querySelectorAll('.blk-tabs button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); draw(); });
    d.querySelector('#blkQ').oninput = (e) => { q = e.target.value.toLowerCase(); draw(); };
    d.querySelector('#blkMine').onclick = async () => { const r = await F.presentationBlocksChoose('mine'); if (r.ok) refresh(); };
    d.querySelector('#blkDelt').onclick = async () => { const r = await F.presentationBlocksChoose('delt'); if (r.ok) refresh(); };
    d.querySelector('#blkImport').onclick = async () => {
      const r = await F.openFileDialog({ title: 'Velg blokkfil', filters: [{ name: 'Faktisk-blokk', extensions: ['faktiskblokk'] }] });
      if (r && !r.canceled && r.path) { const x = await F.presentationBlocksImport([r.path]); if (!x.ok) toast('Kunne ikke importere: ' + x.error); refresh(); }
    };
    // slipp .faktiskblokk-filer i vinduet
    list.addEventListener('dragover', (e) => { e.preventDefault(); list.classList.add('blk-drop'); });
    list.addEventListener('dragleave', () => list.classList.remove('blk-drop'));
    list.addEventListener('drop', async (e) => { e.preventDefault(); list.classList.remove('blk-drop');
      const paths = [...e.dataTransfer.files].map((f) => (F.pathForFile || F.bevisPathForFile)(f)).filter((p) => p && p.endsWith('.faktiskblokk'));
      if (paths.length) { const x = await F.presentationBlocksImport(paths); if (!x.ok) toast('Kunne ikke importere: ' + x.error); refresh(); } });

    async function refresh() { data = await F.presentationBlocksList(); draw(); }
    function draw() {
      if (!data) { list.innerHTML = '<div class="blk-empty">Henter blokker …</div>'; return; }
      if (!data.ok) { list.innerHTML = `<div class="blk-empty">${esc(data.error)}</div>`; return; }
      const s = data.settings;
      d.querySelector('#blkWhere').textContent = `Mine: ${s.mine.replace(/^\/Users\/[^/]+/, '~')}` + (s.delt ? ` · Delt: ${s.delt.replace(/^\/Users\/[^/]+/, '~')}` : ' · ingen delt mappe valgt');
      const items = data.blocks.filter((b) => (level === 'alle' || b.level === level) &&
        (!q || (b.name + ' ' + b.description + ' ' + b.slides.map((x) => x.title).join(' ')).toLowerCase().includes(q)));
      if (!items.length) { list.innerHTML = `<div class="blk-empty">${data.blocks.length ? 'Ingen blokker passer.' : 'Ingen blokker ennå. Lagre lysbilder med «Lagre som blokk…», eller slipp en .faktiskblokk-fil her.'}${level === 'delt' && !s.delt ? '<br>Velg en delt mappe nederst for å se blokker andre har delt.' : ''}</div>`; return; }
      list.innerHTML = '';
      for (const b of items) {
        const c = document.createElement('div'); c.className = 'blk-card';
        c.innerHTML = `<h4>${esc(b.name)}<span class="blk-tag ${b.level}">${b.level === 'delt' ? 'Delt' : 'Mine'}</span></h4>
          ${b.error ? `<div class="mute">Kan ikke leses: ${esc(b.error)}</div>` : `<div class="mute">${b.slides.length} lysbilde${b.slides.length === 1 ? '' : 'r'} · lagret ${esc(dateNo(b.savedAt))} · ${Math.max(1, Math.round(b.size / 1e6))} MB</div>
          ${b.description ? `<div>${esc(b.description)}</div>` : ''}<div class="blk-titles">${b.slides.map((x, i) => `${i + 1}. ${esc(x.title || x.type)}`).join(' · ')}</div>`}
          <div class="acts">${b.error ? '' : '<button class="btn small primary" data-a="ins">Sett inn etter lysbilde ' + (sel + 1) + '</button>'}
            ${b.level === 'mine' && s.delt ? '<button class="btn small" data-a="del">Del</button>' : ''}<button class="btn small" data-a="vis">Vis i Finder</button>
            ${b.level === 'mine' ? '<button class="btn small" data-a="slett">Slett…</button>' : ''}</div>`;
        c.querySelectorAll('[data-a]').forEach((btn) => btn.onclick = () => act(btn.dataset.a, b, btn));
        list.appendChild(c);
      }
    }
    async function act(a, b, btn) {
      if (a === 'vis') return F.presentationBlocksReveal(b.path);
      if (a === 'del') { const r = await F.presentationBlocksShare(b.path); toast(r.ok ? `«${b.name}» er kopiert til den delte mappa.` : 'Kunne ikke dele: ' + r.error); return refresh(); }
      if (a === 'slett') {
        if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = 'Klikk igjen for å slette'; return; }
        const r = await F.presentationBlocksTrash(b.path); toast(r.ok ? `«${b.name}» er lagt i papirkurven.` : 'Kunne ikke slette: ' + r.error); return refresh();
      }
      if (a === 'ins') {
        btn.disabled = true; btn.textContent = 'Setter inn …';
        const r = await F.presentationBlocksLoad({ path: b.path });
        if (!r.ok) { toast('Kunne ikke sette inn: ' + r.error); btn.disabled = false; return; }
        const add = r.block.slides.filter((s) => TYPES[s.type]).map((s, i) => ({ ...s, id: uid++, img: s.img || {},
          in: i === 0 ? 'toning' : s.in,   // mellom blokker: vanlig toning
          blokk: { id: r.block.id, name: r.block.name, savedAt: r.block.savedAt, level: b.level } }));
        slides.splice(sel + 1, 0, ...add); sel = sel + 1; save(); drawAll(); d.close();
        toast(`«${b.name}» er satt inn (${add.length} lysbilde${add.length === 1 ? '' : 'r'}).`);
      }
    }
    draw(); refresh();
  });
})();
