#!/usr/bin/env node
// saas-seguro · gera o relatório (HTML + PDF) a partir do achados.json
// Uso: node report.mjs [--in relatorio-seguranca/achados.json] [--out relatorio-seguranca] [--pdf auto|navegador|simples|nao]
//
// PDF: tenta primeiro um navegador instalado (Chrome, Edge, Brave ou Chromium) em modo headless,
// que gera o PDF idêntico ao HTML. Se não houver navegador, usa um gerador de PDF próprio, sem dependências.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { ITENS, ITEM_POR_ID, AREAS, SEVERIDADES } from "./checklist.mjs";
import { gerarPdfSimples } from "./lib/pdf-simples.mjs";

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("--")) continue;
  const [k, v] = a.slice(2).split("=");
  if (v !== undefined) args[k] = v;
  else if (process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) args[k] = process.argv[++i];
  else args[k] = true;
}
const ENTRADA = path.resolve(args.in || "relatorio-seguranca/achados.json");
const PASTA = path.resolve(args.out || path.dirname(ENTRADA));
const MODO_PDF = args.pdf || "auto";
const CTA_URL = "https://checklist-saas-seguro-lp.vercel.app/?utm_source=skill-saas-seguro&utm_medium=relatorio";
const REPO_URL = "github.com/andrefelipevsilva/skill-saas-seguro";

const dados = JSON.parse(fs.readFileSync(ENTRADA, "utf8"));
const ORDEM = { critico: 0, alto: 1, medio: 2, baixo: 3 };
const achados = (dados.achados || [])
  .filter((a) => a.status !== "descartado")
  .map((a) => {
    const item = ITEM_POR_ID[a.id] || {};
    const severidade = ORDEM[a.severidade] !== undefined ? a.severidade : item.severidade || "medio";
    return { ...a, severidade, area: a.area || AREAS[item.area] || "Outros", item: a.item || item.titulo || "",
      risco: a.risco || item.risco || "", passos: a.passos?.length ? a.passos : item.corrigir || [], evidencias: a.evidencias || [] };
  })
  .sort((x, y) => ORDEM[x.severidade] - ORDEM[y.severidade] || String(x.id).localeCompare(String(y.id), "pt-BR", { numeric: true }));
{
  const usados = new Set(achados.map((a) => a.codigo).filter(Boolean));
  let n = 1;
  for (const a of achados) {
    if (a.codigo) continue;
    while (usados.has(`SS-${String(n).padStart(2, "0")}`)) n++;
    a.codigo = `SS-${String(n).padStart(2, "0")}`;
    usados.add(a.codigo);
  }
}
if (!AREAS.includes("Outros") && achados.some((a) => a.area === "Outros")) AREAS.push("Outros");
const confirmados = achados.filter((a) => a.status === "confirmado");
const suspeitas = achados.filter((a) => a.status === "suspeita");
const checklist = dados.checklist || [];

// ---------------------------------------------------------------- nota
const piorPorItem = new Map();
for (const a of confirmados) {
  const atual = piorPorItem.get(a.id);
  if (!atual || SEVERIDADES[a.severidade].ordem < SEVERIDADES[atual].ordem) piorPorItem.set(a.id, a.severidade);
}
const desconto = [...piorPorItem.values()].reduce((s, sev) => s + SEVERIDADES[sev].peso, 0);
const nota = Math.max(0, 100 - desconto);
const faixa = nota >= 90 ? { rotulo: "Ótimo", cor: "#C8F560" } : nota >= 70 ? { rotulo: "Bom", cor: "#C8F560" } : nota >= 50 ? { rotulo: "Atenção", cor: "#F2B84B" } : { rotulo: "Crítico", cor: "#FF7A6B" };
const contagem = Object.fromEntries(Object.keys(SEVERIDADES).map((s) => [s, confirmados.filter((a) => a.severidade === s).length]));
const contStatus = (st) => checklist.filter((c) => c.status === st).length;

// ---------------------------------------------------------------- HTML
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dataBR = new Date(dados.projeto?.data || Date.now()).toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "short" });
const STATUS_ROTULO = { falha: "Falha", ok: "Aprovado", manual: "Manual", pendente: "Revisar", nao_aplica: "Não se aplica" };

function cartao(a) {
  const ev = (a.evidencias || []).map((e) => `
      <li><span class="loc">${esc(e.arquivo)}${e.linha ? `<b>:${e.linha}</b>` : ""}${e.obs ? ` <i>· ${esc(e.obs)}</i>` : ""}</span>${e.trecho ? `<code>${esc(e.trecho)}</code>` : ""}</li>`).join("");
  const passos = (a.passos || []).map((p) => `<li>${esc(p)}</li>`).join("");
  return `
  <article class="achado sev-${a.severidade}" id="${esc(a.codigo)}">
    <header>
      <span class="badge ${a.severidade}">${SEVERIDADES[a.severidade].rotulo}</span>
      <span class="cod">${esc(a.codigo)} · item ${esc(a.id)}</span>
      ${a.status === "suspeita" ? `<span class="badge revisar">Para confirmar</span>` : ""}
    </header>
    <h3>${esc(a.titulo)}</h3>
    ${a.resumo ? `<p class="resumo">${esc(a.resumo)}</p>` : ""}
    ${ev ? `<div class="bloco"><div class="lab">Onde está</div><ul class="ev">${ev}</ul>${a.outrasOcorrencias ? `<p class="mais">+ ${a.outrasOcorrencias} outra(s) ocorrência(s) com o mesmo padrão.</p>` : ""}</div>` : ""}
    <div class="bloco"><div class="lab">Por que é perigoso</div><p>${esc(a.risco)}</p></div>
    ${passos ? `<div class="bloco"><div class="lab">Passo a passo para corrigir</div><ol class="passos">${passos}</ol></div>` : ""}
    ${a.prompt ? `<div class="prompt"><div class="lab">Prompt para o Claude Code ou Codex corrigir <button class="copiar" type="button">Copiar</button></div><p>${esc(a.prompt)}</p></div>` : ""}
    ${a.nota ? `<p class="nota">${esc(a.nota)}</p>` : ""}
  </article>`;
}

const prioridade = confirmados.filter((a) => a.severidade === "critico" || a.severidade === "alto");
const porArea = AREAS.map((area) => ({ area, lista: achados.filter((a) => a.area === area) })).filter((g) => g.lista.length);
const manuais = checklist.filter((c) => c.status === "manual");
const circ = 2 * Math.PI * 52;

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Relatório de segurança · ${esc(dados.projeto?.nome)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500&display=swap">
<style>
:root{--bg:#0B0D0C;--panel:#121513;--panel2:#171B18;--line:#242A26;--fg:#EEF0EA;--body:#C9CEC6;--muted:#8E968E;--faint:#5D655E;
  --lime:#C8F560;--ink:#0B0D0C;--amber:#F2B84B;--coral:#FF7A6B;--red:#FF4D4D;
  --sans:"Geist",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;--mono:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color-scheme:dark}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--fg);-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font:15px/1.6 var(--sans)}
.wrap{max-width:980px;margin:0 auto;padding:40px max(16px,4vw) 64px;display:flex;flex-direction:column;gap:40px}
a{color:var(--lime)}
.brand{font:500 13px var(--mono);color:var(--muted)} .brand b{color:var(--lime);font-weight:500}
h1{font-size:clamp(32px,5vw,48px);line-height:1.05;letter-spacing:-.035em;margin:10px 0 6px;font-weight:800}
h1 span{color:var(--lime)}
h2{font-size:24px;letter-spacing:-.02em;margin:0 0 6px;display:flex;align-items:baseline;gap:12px}
h2 small{font:500 12px var(--mono);color:var(--muted);letter-spacing:.06em;text-transform:uppercase}
.sub{color:var(--muted);margin:0}
.meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.chip{font:500 12px var(--mono);color:var(--body);border:1px solid var(--line);background:var(--panel);border-radius:999px;padding:4px 10px}
.hero{display:grid;grid-template-columns:auto 1fr;gap:28px;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:28px}
.ring{position:relative;width:132px;height:132px}
.ring svg{transform:rotate(-90deg)}
.ring .n{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.ring .n b{font-size:38px;letter-spacing:-.03em;line-height:1;font-variant-numeric:tabular-nums}
.ring .n span{font:500 11px var(--mono);color:var(--muted);margin-top:4px}
.resumo-hero h2{margin-bottom:4px}
.contagens{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:16px}
.cont{background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.cont b{display:block;font-size:26px;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.cont span{font:500 11px var(--mono);text-transform:uppercase;letter-spacing:.08em}
.cont.critico span{color:var(--red)} .cont.alto span{color:var(--coral)} .cont.medio span{color:var(--amber)} .cont.baixo span{color:var(--muted)}
.check-resumo{margin:14px 0 0;color:var(--body);font-size:14px}
.prioridade{list-style:none;margin:16px 0 0;padding:0;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--panel)}
.prioridade li{display:grid;grid-template-columns:auto auto minmax(0,1fr);gap:12px;align-items:baseline;padding:12px 16px;border-bottom:1px solid var(--line)}
.prioridade li:last-child{border-bottom:0}
.prioridade .cod{font:500 12px var(--mono);color:var(--muted)}
.prioridade .t{min-width:0} .prioridade .t small{display:block;font:12px var(--mono);color:var(--muted);overflow-wrap:anywhere}
.badge{display:inline-block;font:600 10.5px var(--mono);letter-spacing:.08em;text-transform:uppercase;border-radius:6px;padding:3px 8px;white-space:nowrap}
.badge.critico{background:var(--red);color:#1a0505} .badge.alto{background:var(--coral);color:#1a0806} .badge.medio{background:var(--amber);color:#1a1205} .badge.baixo{background:var(--line);color:var(--body)}
.badge.revisar{background:transparent;border:1px solid var(--amber);color:var(--amber)}
.area{display:flex;flex-direction:column;gap:14px}
.area>h3{font:500 12px var(--mono);color:var(--lime);letter-spacing:.12em;text-transform:uppercase;margin:12px 0 0}
.achado{background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--line);border-radius:14px;padding:20px 22px;display:flex;flex-direction:column;gap:12px;break-inside:avoid}
.achado.sev-critico{border-left-color:var(--red)} .achado.sev-alto{border-left-color:var(--coral)} .achado.sev-medio{border-left-color:var(--amber)}
.achado header{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.achado .cod{font:500 12px var(--mono);color:var(--muted)}
.achado h3{margin:0;font-size:19px;letter-spacing:-.015em;line-height:1.3}
.resumo{margin:0;color:var(--body)}
.bloco p{margin:0;color:var(--body)}
.lab{font:500 11px var(--mono);color:var(--muted);letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;gap:8px}
.ev{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.ev li{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:4px;min-width:0}
.loc{font:12px var(--mono);color:var(--body);overflow-wrap:anywhere} .loc b{color:var(--lime);font-weight:500} .loc i{color:var(--muted);font-style:normal}
.ev code{font:12px/1.5 var(--mono);color:#D6DBD3;white-space:pre-wrap;overflow-wrap:anywhere}
.mais{font-size:13px;color:var(--muted);margin:6px 0 0}
.passos{margin:0;padding-left:20px;color:var(--body);display:flex;flex-direction:column;gap:4px}
.passos li::marker{color:var(--lime);font-family:var(--mono)}
.prompt{background:var(--panel2);border:1px solid #2E3A1E;border-radius:10px;padding:12px 14px;break-inside:avoid}
.prompt .lab{color:var(--lime)}
.prompt p{margin:0;color:var(--fg);font-size:14px}
.copiar{font:500 11px var(--mono);background:transparent;color:var(--lime);border:1px solid var(--lime);border-radius:6px;padding:3px 8px;cursor:pointer}
.copiar:focus-visible{outline:2px solid var(--lime);outline-offset:2px}
.nota{margin:0;font-size:13px;color:var(--amber);background:rgba(242,184,75,.07);border:1px solid rgba(242,184,75,.25);border-radius:8px;padding:8px 10px}
.manuais{list-style:none;margin:16px 0 0;padding:0;border-top:1px solid var(--line)}
.manuais li{display:grid;grid-template-columns:18px 44px minmax(0,1fr);gap:12px;padding:12px 0;border-bottom:1px solid var(--line);align-items:start}
.box{width:16px;height:16px;border:1.5px solid var(--lime);border-radius:4px;margin-top:3px}
.manuais .id{font:500 12px var(--mono);color:var(--muted);padding-top:2px}
.manuais b{display:block;font-weight:600} .manuais span{color:var(--body);font-size:14px}
.tabela{overflow-x:auto;margin-top:16px;border:1px solid var(--line);border-radius:14px;background:var(--panel)}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th{text-align:left;font:500 11px var(--mono);color:var(--muted);letter-spacing:.08em;text-transform:uppercase;padding:10px 14px;border-bottom:1px solid var(--line);background:var(--panel2)}
td{padding:9px 14px;border-bottom:1px solid var(--line);color:var(--body);vertical-align:top}
tr:last-child td{border-bottom:0} tr{break-inside:avoid}
td.id{font:500 12px var(--mono);color:var(--muted);white-space:nowrap}
.st{font:600 10.5px var(--mono);letter-spacing:.06em;text-transform:uppercase;border-radius:6px;padding:2px 7px;white-space:nowrap}
.st.falha{background:var(--coral);color:#1a0806} .st.ok{background:var(--lime);color:var(--ink)} .st.manual{border:1px solid var(--muted);color:var(--body)}
.st.pendente{border:1px solid var(--amber);color:var(--amber)} .st.nao_aplica{color:var(--faint);border:1px solid var(--line)}
.cta{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:26px;display:flex;flex-wrap:wrap;gap:18px;align-items:center;justify-content:space-between;break-inside:avoid}
.cta h3{margin:0 0 4px;font-size:21px;letter-spacing:-.02em} .cta h3 span{color:var(--lime)}
.cta p{margin:0;color:var(--body);max-width:56ch}
.btn{display:inline-block;background:var(--lime);color:var(--ink);font-weight:700;text-decoration:none;border-radius:10px;padding:12px 18px}
footer{font:12px var(--mono);color:var(--faint);display:flex;flex-direction:column;gap:6px}
@media (max-width:640px){.hero{grid-template-columns:1fr}.contagens{grid-template-columns:repeat(2,minmax(0,1fr))}.prioridade li{grid-template-columns:auto minmax(0,1fr)}.prioridade .cod{display:none}}
@media print{
  @page{size:A4;margin:0}
  .wrap{display:block;max-width:none;padding:14mm 15mm;-webkit-box-decoration-break:clone;box-decoration-break:clone}
  .wrap>header,.wrap>section{margin-bottom:24px}
  .area{display:block}
  .area>h3{margin:18px 0 10px}
  .achado{display:block;margin-bottom:12px;break-inside:auto}
  .achado header,.achado h3{break-after:avoid}
  .bloco,.ev li{break-inside:avoid}
  .achado>*+*{margin-top:10px}
  body{font-size:12.5px}
  .copiar{display:none}
  .prompt,.cta,.hero{break-inside:avoid}
  h2,.area>h3{break-after:avoid}
}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="brand"><b>&gt;_</b> saas-seguro · by @andrevale.dev</div>
    <h1>Relatório de <span>segurança</span></h1>
    <p class="sub">${esc(dados.projeto?.nome)} · ${esc(dataBR)}</p>
    <div class="meta">
      ${(dados.projeto?.stack || []).map((s) => `<span class="chip">${esc(s)}</span>`).join("")}
      <span class="chip">${esc(dados.projeto?.arquivosAnalisados)} arquivos analisados</span>
      ${dados.revisado ? `<span class="chip">revisado por IA</span>` : `<span class="chip" style="color:var(--amber);border-color:rgba(242,184,75,.4)">varredura automática, sem revisão</span>`}
    </div>
  </header>

  <section class="hero" aria-label="Resumo">
    <div class="ring" role="img" aria-label="Nota ${nota} de 100">
      <svg width="132" height="132" viewBox="0 0 132 132"><circle cx="66" cy="66" r="52" fill="none" stroke="#242A26" stroke-width="12"/>
      <circle cx="66" cy="66" r="52" fill="none" stroke="${faixa.cor}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${(circ * nota) / 100} ${circ}"${nota === 0 ? ' stroke-opacity="0"' : ""}/></svg>
      <div class="n"><b>${nota}</b><span>de 100</span></div>
    </div>
    <div class="resumo-hero">
      <h2>Nota de segurança: <span style="color:${faixa.cor}">${faixa.rotulo}</span></h2>
      <p class="sub">${confirmados.length ? `${confirmados.length} brecha(s) confirmada(s) no código.` : "Nenhuma brecha confirmada no código."}${suspeitas.length ? ` ${suspeitas.length} ponto(s) ainda precisam de confirmação.` : ""}</p>
      <div class="contagens">
        ${Object.keys(SEVERIDADES).map((s) => `<div class="cont ${s}"><b>${contagem[s]}</b><span>${SEVERIDADES[s].rotulo}</span></div>`).join("")}
      </div>
      <p class="check-resumo">Checklist de 44 pontos: <b style="color:var(--lime)">${contStatus("ok")} aprovados</b> · ${contStatus("falha")} com falha · ${contStatus("manual")} para conferir manualmente${contStatus("pendente") ? ` · ${contStatus("pendente")} para revisar` : ""}${contStatus("nao_aplica") ? ` · ${contStatus("nao_aplica")} não se aplicam` : ""}.</p>
    </div>
  </section>

  ${prioridade.length ? `<section>
    <h2>Corrija primeiro <small>${prioridade.length} item(ns)</small></h2>
    <p class="sub">Brechas críticas e altas, na ordem em que devem ser corrigidas.</p>
    <ol class="prioridade">
      ${prioridade.map((a) => `<li><span class="badge ${a.severidade}">${SEVERIDADES[a.severidade].rotulo}</span><span class="cod">${esc(a.codigo)}</span><span class="t"><a href="#${esc(a.codigo)}" style="color:var(--fg);text-decoration:none">${esc(a.titulo)}</a>${a.evidencias?.[0] ? `<small>${esc(a.evidencias[0].arquivo)}${a.evidencias[0].linha ? ":" + a.evidencias[0].linha : ""}</small>` : ""}</span></li>`).join("")}
    </ol>
  </section>` : ""}

  ${porArea.length ? `<section>
    <h2>Achados detalhados <small>${achados.length} no total</small></h2>
    <p class="sub">Cada achado traz onde está, por que é perigoso, o passo a passo e um prompt pronto para corrigir.</p>
    ${porArea.map((g) => `<div class="area"><h3>${esc(g.area)}</h3>${g.lista.map(cartao).join("")}</div>`).join("")}
  </section>` : ""}

  ${manuais.length ? `<section>
    <h2>Verificação manual <small>${manuais.length} item(ns)</small></h2>
    <p class="sub">Estes pontos dependem de painéis e servidores fora do código. Confira cada um e marque.</p>
    <ul class="manuais">
      ${manuais.map((c) => `<li><span class="box"></span><span class="id">${esc(c.id)}</span><div><b>${esc(c.titulo)}</b><span>${esc(c.nota || ITEM_POR_ID[c.id]?.manual || "")}</span></div></li>`).join("")}
    </ul>
  </section>` : ""}

  <section>
    <h2>Checklist completo <small>44 pontos</small></h2>
    <div class="tabela"><table>
      <thead><tr><th>Item</th><th>Ponto verificado</th><th>Status</th><th>Observação</th></tr></thead>
      <tbody>${checklist.map((c) => `<tr><td class="id">${esc(c.id)}</td><td>${esc(c.titulo)}</td><td><span class="st ${esc(c.status)}">${STATUS_ROTULO[c.status] || esc(c.status)}</span></td><td>${esc(c.nota || "")}</td></tr>`).join("")}</tbody>
    </table></div>
  </section>

  <section class="cta">
    <div>
      <h3>Quer o passo a passo <span>completo</span>?</h3>
      <p>O checklist gratuito e o Guia de implementação explicam os 44 pontos com exemplos de código e prompts prontos para o Claude Code.</p>
    </div>
    <a class="btn" href="${CTA_URL}" target="_blank" rel="noopener">Baixar o checklist grátis</a>
  </section>

  <footer>
    <span>Gerado pela skill saas-seguro · ${REPO_URL} · @andrevale.dev no Instagram</span>
    <span>Varredura automatizada com revisão por IA. Não substitui um teste de invasão profissional. Este arquivo pode conter trechos sensíveis do seu código: não publique.</span>
  </footer>
</div>
<script>
document.querySelectorAll(".copiar").forEach(function (b) {
  b.addEventListener("click", function () {
    var t = b.closest(".prompt").querySelector("p").innerText;
    var ok = function () { b.textContent = "Copiado"; setTimeout(function () { b.textContent = "Copiar"; }, 1600); };
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(ok, function () {});
  });
});
</script>
</body>
</html>`;

fs.mkdirSync(PASTA, { recursive: true });
const arqHtml = path.join(PASTA, "relatorio-seguranca.html");
const arqPdf = path.join(PASTA, "relatorio-seguranca.pdf");
fs.writeFileSync(arqHtml, html);
console.log(`HTML: ${arqHtml}`);

// ---------------------------------------------------------------- PDF
function acharNavegador() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const c = [];
  if (process.platform === "win32") {
    for (const base of [process.env["PROGRAMFILES"], process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean)) {
      c.push(path.join(base, "Google/Chrome/Application/chrome.exe"), path.join(base, "Microsoft/Edge/Application/msedge.exe"),
        path.join(base, "BraveSoftware/Brave-Browser/Application/brave.exe"), path.join(base, "Chromium/Application/chrome.exe"));
    }
  } else if (process.platform === "darwin") {
    c.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser", "/Applications/Chromium.app/Contents/MacOS/Chromium",
      path.join(os.homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"));
  } else {
    for (const n of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-stable", "brave-browser"]) {
      const r = spawnSync("which", [n], { encoding: "utf8" });
      if (r.status === 0 && r.stdout.trim()) c.push(r.stdout.trim());
    }
  }
  return c.find((p) => fs.existsSync(p)) || null;
}

function pdfPeloNavegador(nav) {
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), "saas-seguro-"));
  const r = spawnSync(nav, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    ...(process.platform === "linux" ? ["--no-sandbox"] : []),
    `--user-data-dir=${perfil}`, "--no-pdf-header-footer", "--print-to-pdf-no-header", "--virtual-time-budget=8000",
    `--print-to-pdf=${arqPdf}`, pathToFileURL(arqHtml).href,
  ], { encoding: "utf8", timeout: 120_000 });
  try { fs.rmSync(perfil, { recursive: true, force: true }); } catch { /* ignora */ }
  return fs.existsSync(arqPdf) && fs.statSync(arqPdf).size > 1000 && (r.status === 0 || r.status === null);
}

if (MODO_PDF !== "nao") {
  try { fs.rmSync(arqPdf, { force: true }); } catch { /* ignora */ }
  let feito = false, motor = "";
  if (MODO_PDF !== "simples") {
    const nav = acharNavegador();
    if (nav) { feito = pdfPeloNavegador(nav); motor = `navegador (${path.basename(nav)})`; }
  }
  if (!feito) {
    fs.writeFileSync(arqPdf, gerarPdfSimples({ dados, achados, confirmados, suspeitas, checklist, nota, faixa, contagem, contStatus, dataBR, CTA_URL, SEVERIDADES, AREAS, ITEM_POR_ID }));
    motor = "gerador interno";
    feito = true;
  }
  console.log(`PDF: ${arqPdf} (${motor})`);
}
console.log(`Nota: ${nota}/100 (${faixa.rotulo}) · confirmados: ${confirmados.length} · para confirmar: ${suspeitas.length}`);
