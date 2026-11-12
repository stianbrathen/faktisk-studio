// Faktisk Studio · Verifisering — rapport
//
// Lager én selvstendig HTML-fil (bilder som data-URL) som kan lagres i saken,
// åpnes i nettleser og skrives ut som PDF. Ingen samlet konklusjon — bare funn,
// metadata, bildene journalisten har lagt til, og hva verktøyet ikke kan si.

(function (root) {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const VEKT = { ai: ['Peker mot AI', '#7A3CFF'], opptak: ['Fila påstår opptak', '#0050FC'], behandlet: ['Bearbeidet', '#B26A00'], noytral: ['', '#6E6E6E'] };
  const NIVÅ = { merking: 'Merking i fila', spor: 'Teknisk spor', mangler: 'Ikke funnet', info: 'Fakta' };

  function build(r) {
    const f = r.file; const now = new Date();
    const finds = r.findings.map(x => {
      const v = (x.vekt === 'opptak' && x.nivå !== 'merking') ? ['Typisk for opptak', '#0050FC'] : (VEKT[x.vekt] || VEKT.noytral);
      return `<div class="f"><div class="f__h"><span class="lvl">${esc(NIVÅ[x.nivå] || x.nivå)}</span>${v[0] ? `<span class="tag" style="background:${v[1]}">${esc(v[0])}</span>` : ''}<h3>${esc(x.tittel)}</h3></div>
        <p>${esc(x.tekst)}</p><p class="b"><b>Betyr:</b> ${esc(x.betyr)}</p><p class="bi"><b>Betyr ikke:</b> ${esc(x.betyrIkke)}</p></div>`;
    }).join('');
    const rows = (obj) => Object.keys(obj).filter(k => obj[k] !== '' && obj[k] != null).map(k => `<tr><th>${esc(k)}</th><td>${esc(typeof obj[k] === 'object' ? JSON.stringify(obj[k]) : obj[k])}</td></tr>`).join('');
    const shots = (r.shots || []).map((s, i) => `<figure><img src="${s.dataUrl}" alt=""><figcaption><b>${i + 1}. ${esc(s.label)}</b>${s.note ? ' — ' + esc(s.note) : ''}<br><span class="m">${esc(s.explain || '')}</span></figcaption></figure>`).join('');
    const c2 = r.c2paDetail ? `<h2>Content Credentials i detalj</h2><table>${rows(r.c2paDetail)}</table>` : '';
    return `<!doctype html><html lang="no"><head><meta charset="utf-8"><title>Verifisering – ${esc(f.name)}</title>
<style>
body{font-family:-apple-system,"Helvetica Neue",Arial,sans-serif;color:#212121;max-width:900px;margin:32px auto;padding:0 20px;line-height:1.45}
h1{font-size:26px;margin:0 0 4px}h2{font-size:18px;margin:28px 0 10px;border-bottom:2px solid #0050FC;padding-bottom:4px}
.sub{color:#4A4A4A;font-size:13px}.warn{background:#FFF6DA;border-left:4px solid #E0A800;padding:10px 14px;font-size:14px;margin:16px 0}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;vertical-align:top;padding:5px 8px;border-bottom:1px solid #e3e3e3}th{width:34%;color:#4A4A4A;font-weight:600}
td{word-break:break-word}.f{border:1px solid #ddd;border-radius:10px;padding:10px 14px;margin:10px 0}.f__h{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.f h3{margin:0;font-size:15px;flex-basis:100%}.lvl{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#6E6E6E}.tag{color:#fff;font-size:11px;font-weight:700;padding:1px 7px;border-radius:4px}
.f p{margin:6px 0;font-size:14px}.b{color:#1a4d1a}.bi{color:#7a1f1f}figure{margin:14px 0;break-inside:avoid}figure img{max-width:100%;border-radius:6px;display:block}
figcaption{font-size:13px;margin-top:4px}.m{color:#6E6E6E}ul{font-size:14px}code{font-size:12px}
@media print{body{margin:0}.f,figure{break-inside:avoid}}
</style></head><body>
<h1>Verifiseringsnotat</h1>
<div class="sub">${esc(f.name)} · laget ${esc(now.toLocaleString('nb-NO'))} · Faktisk Studio Verifisering ${esc(r.pluginVersion || '')}</div>
<div class="warn"><b>Verktøyet gir ingen samlet vurdering av om innholdet er ekte.</b> Det viser funn hver for seg, med hva de betyr og ikke betyr. Fravær av merking er ikke et tegn på ekthet. Vurderingen gjøres av journalisten, sammen med kildearbeid.</div>
${r.note ? `<h2>Notat</h2><p>${esc(r.note).replace(/\n/g, '<br>')}</p>` : ''}
<h2>Fila</h2><table>${rows(f.facts)}</table>
<h2>Funn</h2>${finds}
${c2}
${shots ? `<h2>Bilder fra analysen</h2>${shots}` : ''}
${r.metaTable && Object.keys(r.metaTable).length ? `<h2>All metadata som ble lest</h2><table>${rows(r.metaTable)}</table>` : ''}
<h2>Hva verktøyet ikke har sjekket</h2>
${r.kind === 'text' ? `<ul>
<li><b>Ingen AI-score.</b> Språket i teksten er ikke vurdert. Statistiske AI-detektorer gir mange feilalarmer, særlig på korte, redigerte og ikke-engelske tekster, og bommer på AI-tekst som er skrevet om.</li>
<li><b>Usynlige vannmerker i tekst</b> (f.eks. SynthID Text i Gemini) kan bare kontrolleres av leverandøren selv. Det fantes ingen offentlig sjekk for tekst da denne versjonen ble laget (nov. 2026), og omskriving eller oversettelse svekker merket.</li>
<li>At verktøyet ikke fant AI-rester, betyr ikke at et menneske skrev teksten. Kilder og sitater i teksten må sjekkes for seg — AI kan finne opp kilder som ikke finnes.</li>
<li>Den beste kilden er fortsatt den som skrev teksten: utkast, versjonshistorikk og notater.</li>
</ul>` : `<ul>
<li><b>Signaturen i Content Credentials er ikke kontrollert.</b> Kontroller på <code>contentcredentials.org/verify</code> (fila lastes opp dit).</li>
<li><b>Usynlige vannmerker</b> som SynthID (Google, OpenAI-bilder fra mai 2026, NVIDIA m.fl.) kan bare leses av leverandørens egen tjeneste, f.eks. <code>synthid.com</code>. «Ikke funnet» der betyr bare at akkurat de verktøyene ikke laget fila.</li>
<li>Parallakse, leppesynk, tekstlesing og solberegning står under funn bare hvis de ble kjørt. God synk og dybde i bakgrunnen betyr ikke at videoen er ekte; manglende dybde betyr ikke at den er falsk.</li>
<li>Den beste kilden er fortsatt originalfila fra den som tok opptaket, og kontroll av sted og tid mot uavhengige kilder.</li>
</ul>`}
</body></html>`;
  }

  root.VfReport = { build };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.VfReport;
})(typeof window !== 'undefined' ? window : globalThis);
