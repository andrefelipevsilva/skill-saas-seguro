// Gerador de PDF mínimo, sem dependências.
// Usado só quando não há Chrome, Edge, Brave ou Chromium instalado para gerar o PDF a partir do HTML.
// Fontes padrão do PDF (Helvetica e Courier) com codificação WinAnsi, que cobre os acentos do português.

const W = 595.28, H = 841.89, M = 44;
const COR = {
  bg: [11, 13, 12], panel: [18, 21, 19], line: [36, 42, 38], fg: [238, 240, 234], body: [201, 206, 198],
  muted: [142, 150, 142], lime: [200, 245, 96], amber: [242, 184, 75], coral: [255, 122, 107], red: [255, 77, 77],
};
const COR_SEV = { critico: COR.red, alto: COR.coral, medio: COR.amber, baixo: COR.muted };
const COR_ST = { falha: COR.coral, ok: COR.lime, manual: COR.body, pendente: COR.amber, nao_aplica: COR.muted };

// Larguras da Helvetica (AFM padrão) para ASCII 32..126, em milésimos de em.
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722,
  667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556,
  333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];

function normalizar(s) {
  return String(s ?? "")
    .replace(/[“”„]/g, '"').replace(/[‘’‚]/g, "'").replace(/[—–]/g, "-").replace(/…/g, "...").replace(/→/g, "->")
    .replace(/[✓✔]/g, "v").replace(/•/g, "·").replace(/ /g, " ").replace(/[​-‍﻿]/g, "")
    .normalize("NFC");
}
function codificar(s) {
  let out = "";
  for (const ch of normalizar(s)) {
    let c = ch.codePointAt(0);
    if (c > 255) c = 63; // "?"
    if (ch === "(" || ch === ")" || ch === "\\") out += "\\" + ch;
    else if (c < 32) out += " ";
    else if (c > 126) out += "\\" + c.toString(8).padStart(3, "0");
    else out += ch;
  }
  return out;
}
function largura(s, fonte, tam) {
  let w = 0;
  for (const ch of normalizar(s)) {
    if (fonte === "F3") { w += 600; continue; }
    const base = ch.normalize("NFD")[0];
    const c = base.charCodeAt(0);
    w += c >= 32 && c <= 126 ? HELV[c - 32] : 556;
  }
  return (w * tam * (fonte === "F2" ? 1.06 : 1)) / 1000;
}
const f = (n) => Number(n).toFixed(2);
const rgb = (c) => c.map((v) => (v / 255).toFixed(3)).join(" ");

class Doc {
  constructor() { this.paginas = []; this.novaPagina(); }
  novaPagina() {
    this.cur = [];
    this.paginas.push(this.cur);
    this.y = H - M;
    this.ret(0, 0, W, H, COR.bg);
  }
  ret(x, y, w, h, c) { this.cur.push(`${rgb(c)} rg ${f(x)} ${f(y)} ${f(w)} ${f(h)} re f`); }
  linha(x1, y1, x2, y2, c, esp = 0.6) { this.cur.push(`${rgb(c)} RG ${esp} w ${f(x1)} ${f(y1)} m ${f(x2)} ${f(y2)} l S`); }
  texto(x, y, s, fonte = "F1", tam = 10, c = COR.body) { this.cur.push(`BT /${fonte} ${tam} Tf ${rgb(c)} rg ${f(x)} ${f(y)} Td (${codificar(s)}) Tj ET`); }
  garantir(h) { if (this.y - h < M + 18) this.novaPagina(); }
  quebrar(s, fonte, tam, larg) {
    const linhas = [];
    for (const par of normalizar(s).split("\n")) {
      let atual = "";
      for (const palavra of par.split(/(\s+)/)) {
        if (!palavra) continue;
        const teste = atual + palavra;
        if (largura(teste, fonte, tam) <= larg || !atual.trim()) {
          if (largura(teste, fonte, tam) > larg && !atual.trim()) {
            // palavra maior que a linha: corta
            let pedaco = "";
            for (const ch of palavra) {
              if (largura(pedaco + ch, fonte, tam) > larg) { linhas.push(pedaco); pedaco = ""; }
              pedaco += ch;
            }
            atual = pedaco;
          } else atual = teste;
        } else { linhas.push(atual.trimEnd()); atual = palavra.trimStart(); }
      }
      linhas.push(atual.trimEnd());
    }
    return linhas;
  }
  paragrafo(s, { fonte = "F1", tam = 10, cor = COR.body, x = M, larg = W - 2 * M, entre = 1.45, depois = 6, prefixo = null } = {}) {
    if (!s) return;
    const linhas = this.quebrar(s, fonte, tam, larg - (prefixo ? 14 : 0));
    linhas.forEach((l, i) => {
      this.garantir(tam * entre);
      this.y -= tam * entre;
      if (prefixo && i === 0) this.texto(x, this.y, prefixo, "F2", tam, COR.lime);
      this.texto(x + (prefixo ? 14 : 0), this.y, l, fonte, tam, cor);
    });
    this.y -= depois;
  }
  rotulo(s) { this.garantir(26); this.y -= 14; this.texto(M, this.y, s.toUpperCase(), "F3", 7.5, COR.muted); this.y -= 2; }
  titulo(s, tam = 18) { this.garantir(tam * 2.4); this.y -= tam * 0.6; this.paragrafo(s, { fonte: "F2", tam, cor: COR.fg, entre: 1.25, depois: 4 }); }
}

export function gerarPdfSimples(ctx) {
  const { dados, achados, confirmados, suspeitas, checklist, nota, faixa, contagem, contStatus, dataBR, CTA_URL, SEVERIDADES, AREAS } = ctx;
  const d = new Doc();
  const corFaixa = faixa.rotulo === "Crítico" ? COR.coral : faixa.rotulo === "Atenção" ? COR.amber : COR.lime;

  // Capa / resumo
  d.texto(M, d.y - 4, ">_", "F3", 10, COR.lime);
  d.texto(M + 16, d.y - 4, "saas-seguro · by @andrevale.dev", "F3", 10, COR.muted);
  d.y -= 40;
  d.texto(M, d.y, "Relatório de", "F2", 32, COR.fg); d.y -= 36;
  d.texto(M, d.y, "segurança", "F2", 32, COR.lime); d.y -= 22;
  d.paragrafo(`${dados.projeto?.nome || ""} · ${dataBR}`, { cor: COR.muted, tam: 11 });
  d.paragrafo(`Stack: ${(dados.projeto?.stack || []).join(", ") || "não identificada"} · ${dados.projeto?.arquivosAnalisados || 0} arquivos analisados${dados.revisado ? " · revisado por IA" : " · varredura automática, sem revisão"}`, { tam: 9.5, cor: COR.muted, depois: 14 });

  const yBox = d.y - 110;
  d.ret(M, yBox, W - 2 * M, 110, COR.panel);
  d.texto(M + 20, yBox + 50, String(nota), "F2", 48, corFaixa);
  d.texto(M + 22 + largura(String(nota), "F2", 48), yBox + 50, "/100", "F1", 14, COR.muted);
  d.texto(M + 20, yBox + 26, `Nota de segurança: ${faixa.rotulo}`, "F2", 11, COR.fg);
  const ks = Object.keys(SEVERIDADES);
  ks.forEach((s, i) => {
    const x = M + 200 + i * 78;
    d.ret(x, yBox + 22, 70, 62, COR.bg);
    d.texto(x + 10, yBox + 52, String(contagem[s]), "F2", 22, COR.fg);
    d.texto(x + 10, yBox + 32, SEVERIDADES[s].rotulo.toUpperCase(), "F3", 7.5, COR_SEV[s]);
  });
  d.y = yBox - 8;
  d.paragrafo(`Checklist de 44 pontos: ${contStatus("ok")} aprovados · ${contStatus("falha")} com falha · ${contStatus("manual")} para conferir manualmente${contStatus("pendente") ? ` · ${contStatus("pendente")} para revisar` : ""}${contStatus("nao_aplica") ? ` · ${contStatus("nao_aplica")} não se aplicam` : ""}.`, { tam: 10, depois: 4 });
  if (suspeitas.length) d.paragrafo(`${suspeitas.length} ponto(s) ainda precisam de confirmação.`, { tam: 10, cor: COR.amber });

  const prioridade = confirmados.filter((a) => a.severidade === "critico" || a.severidade === "alto");
  if (prioridade.length) {
    d.titulo("Corrija primeiro", 16);
    for (const a of prioridade) {
      d.garantir(30);
      d.y -= 14;
      d.texto(M, d.y, SEVERIDADES[a.severidade].rotulo.toUpperCase(), "F3", 8, COR_SEV[a.severidade]);
      const linhas = d.quebrar(`${a.codigo} · ${a.titulo}`, "F2", 10, W - 2 * M - 64);
      linhas.forEach((l, i) => { if (i) { d.garantir(13); d.y -= 13; } d.texto(M + 64, d.y, l, "F2", 10, COR.fg); });
      const e = a.evidencias?.[0];
      if (e) { d.y -= 12; d.texto(M + 64, d.y, `${e.arquivo}${e.linha ? ":" + e.linha : ""}`.slice(0, 95), "F3", 8, COR.muted); }
      d.y -= 4;
    }
  }

  // Achados detalhados
  d.novaPagina();
  d.titulo(`Achados detalhados (${achados.length})`, 18);
  for (const area of AREAS) {
    const lista = achados.filter((a) => a.area === area);
    if (!lista.length) continue;
    d.garantir(40); d.y -= 16;
    d.texto(M, d.y, area.toUpperCase(), "F3", 9, COR.lime); d.y -= 6;
    for (const a of lista) {
      d.garantir(70);
      d.y -= 10;
      d.linha(M, d.y, W - M, d.y, COR.line);
      d.y -= 16;
      d.texto(M, d.y, SEVERIDADES[a.severidade].rotulo.toUpperCase(), "F3", 8, COR_SEV[a.severidade]);
      d.texto(M + 64, d.y, `${a.codigo} · item ${a.id}${a.status === "suspeita" ? " · PARA CONFIRMAR" : ""}`, "F3", 8, a.status === "suspeita" ? COR.amber : COR.muted);
      d.paragrafo(a.titulo, { fonte: "F2", tam: 12, cor: COR.fg, depois: 2 });
      d.paragrafo(a.resumo, { tam: 9.5 });
      if (a.evidencias?.length) {
        d.rotulo("Onde está");
        for (const e of a.evidencias) {
          d.paragrafo(`${e.arquivo}${e.linha ? ":" + e.linha : ""}${e.obs ? " · " + e.obs : ""}`, { fonte: "F3", tam: 8, cor: COR.lime, depois: 0, entre: 1.35 });
          if (e.trecho) d.paragrafo(e.trecho, { fonte: "F3", tam: 8, cor: COR.body, depois: 3, entre: 1.35, x: M + 8, larg: W - 2 * M - 8 });
        }
        if (a.outrasOcorrencias) d.paragrafo(`+ ${a.outrasOcorrencias} outra(s) ocorrência(s).`, { tam: 8.5, cor: COR.muted });
      }
      d.rotulo("Por que é perigoso");
      d.paragrafo(a.risco, { tam: 9.5 });
      if (a.passos?.length) {
        d.rotulo("Passo a passo para corrigir");
        a.passos.forEach((p, i) => d.paragrafo(p, { tam: 9.5, prefixo: `${i + 1}.`, depois: 2 }));
      }
      if (a.prompt) {
        d.rotulo("Prompt para o Claude Code ou Codex");
        d.paragrafo(a.prompt, { tam: 9.5, cor: COR.fg });
      }
      if (a.nota) d.paragrafo(a.nota, { tam: 9, cor: COR.amber });
    }
  }

  // Manuais
  const manuais = checklist.filter((c) => c.status === "manual");
  if (manuais.length) {
    d.novaPagina();
    d.titulo(`Verificação manual (${manuais.length})`, 18);
    d.paragrafo("Estes pontos dependem de painéis e servidores fora do código.", { cor: COR.muted, depois: 8 });
    for (const c of manuais) {
      d.garantir(30);
      d.y -= 14;
      d.cur.push(`${rgb(COR.lime)} RG 1 w ${f(M)} ${f(d.y - 1)} 8 8 re S`);
      d.texto(M + 16, d.y, `${c.id}  ${c.titulo}`, "F2", 10, COR.fg);
      d.paragrafo(c.nota || ctx.ITEM_POR_ID?.[c.id]?.manual || "", { tam: 9, x: M + 16, larg: W - 2 * M - 16, depois: 4 });
    }
  }

  // Checklist
  d.novaPagina();
  d.titulo("Checklist completo (44 pontos)", 18);
  const ROT = { falha: "FALHA", ok: "OK", manual: "MANUAL", pendente: "REVISAR", nao_aplica: "N/A" };
  for (const c of checklist) {
    d.garantir(16);
    d.y -= 15;
    d.texto(M, d.y, c.id, "F3", 8.5, COR.muted);
    d.texto(M + 32, d.y, ROT[c.status] || c.status, "F3", 8, COR_ST[c.status] || COR.body);
    const l = d.quebrar(c.titulo, "F1", 9.5, W - 2 * M - 100)[0];
    d.texto(M + 100, d.y, l, "F1", 9.5, COR.body);
    d.linha(M, d.y - 5, W - M, d.y - 5, COR.line, 0.4);
  }

  d.garantir(90);
  d.y -= 30;
  d.ret(M, d.y - 60, W - 2 * M, 70, COR.panel);
  d.texto(M + 16, d.y - 12, "Quer o passo a passo completo?", "F2", 13, COR.fg);
  d.texto(M + 16, d.y - 30, "Checklist grátis e Guia de implementação com código e prompts:", "F1", 9.5, COR.body);
  d.texto(M + 16, d.y - 46, CTA_URL.split("?")[0], "F3", 9, COR.lime);
  d.y -= 80;
  d.paragrafo("Varredura automatizada com revisão por IA. Não substitui um teste de invasão profissional. Este arquivo pode conter trechos sensíveis do seu código: não publique.", { tam: 8, cor: COR.muted });

  // Rodapés
  const total = d.paginas.length;
  d.paginas.forEach((p, i) => {
    p.push(`${rgb(COR.line)} RG 0.5 w ${f(M)} ${f(30)} m ${f(W - M)} ${f(30)} l S`);
    p.push(`BT /F3 7.5 Tf ${rgb(COR.muted)} rg ${f(M)} 18 Td (${codificar("saas-seguro · @andrevale.dev")}) Tj ET`);
    const num = `${i + 1}/${total}`;
    p.push(`BT /F3 7.5 Tf ${rgb(COR.muted)} rg ${f(W - M - largura(num, "F3", 7.5))} 18 Td (${num}) Tj ET`);
  });

  return montarPdf(d.paginas);
}

function montarPdf(paginas) {
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const catalogo = add(null);
  const raizPaginas = add(null);
  const fonte = (nome) => add(`<< /Type /Font /Subtype /Type1 /BaseFont /${nome} /Encoding /WinAnsiEncoding >>`);
  const F1 = fonte("Helvetica"), F2 = fonte("Helvetica-Bold"), F3 = fonte("Courier");
  const idsPaginas = [];
  for (const conteudo of paginas) {
    const stream = conteudo.join("\n");
    const c = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    idsPaginas.push(add(`<< /Type /Page /Parent ${raizPaginas} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${F1} 0 R /F2 ${F2} 0 R /F3 ${F3} 0 R >> >> /Contents ${c} 0 R >>`));
  }
  objs[catalogo - 1] = `<< /Type /Catalog /Pages ${raizPaginas} 0 R >>`;
  objs[raizPaginas - 1] = `<< /Type /Pages /Kids [${idsPaginas.map((i) => `${i} 0 R`).join(" ")}] /Count ${idsPaginas.length} >>`;
  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, "latin1")); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogo} 0 R /Info << /Title (Relatorio de seguranca) /Producer (saas-seguro by @andrevale.dev) >> >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
