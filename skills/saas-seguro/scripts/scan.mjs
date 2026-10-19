#!/usr/bin/env node
// saas-seguro · varredura automática de segurança
// Uso: node scan.mjs [--root <pasta do projeto>] [--out relatorio-seguranca/achados.json] [--no-audit] [--no-history]
//
// Só lê arquivos. Não altera nada no projeto, exceto o arquivo de saída.
// Não envia nada para a internet (o único acesso de rede possível é o "npm audit",
// que pode ser desligado com --no-audit).

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ITENS, ITEM_POR_ID, AREAS } from "./checklist.mjs";

// ---------------------------------------------------------------- argumentos
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("--")) continue;
  const [k, v] = a.slice(2).split("=");
  if (v !== undefined) args[k] = v;
  else if (process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) args[k] = process.argv[++i];
  else args[k] = true;
}
const ROOT = path.resolve(args.root || process.cwd());
const OUT = path.resolve(ROOT, args.out || "relatorio-seguranca/achados.json");
const SEM_AUDIT = !!args["no-audit"];
const SEM_HISTORICO = !!args["no-history"];

const log = (m) => process.stderr.write(m + "\n");

// ---------------------------------------------------------------- leitura dos arquivos
const IGNORAR_DIRS = new Set([
  "node_modules", ".git", ".next", ".nuxt", ".svelte-kit", ".output", "dist", "build", "out", "coverage",
  ".vercel", ".netlify", ".turbo", ".cache", ".parcel-cache", "vendor", ".venv", "venv", "__pycache__",
  ".pytest_cache", "target", "Pods", ".expo", ".gradle", "relatorio-seguranca", ".idea", ".vscode",
  ".claude", ".agents", ".codex", "storybook-static", ".docusaurus", "bower_components",
]);
const EXT_TEXTO = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".vue", ".svelte", ".astro", ".py", ".rb", ".php", ".go",
  ".java", ".kt", ".cs", ".sql", ".prisma", ".graphql", ".yml", ".yaml", ".toml", ".json", ".rules", ".html",
  ".conf", ".sh", ".tf", ".ini", ".cfg",
]);
const NOMES_TEXTO = new Set(["Dockerfile", "Caddyfile", "Procfile", "firestore.rules", "storage.rules", "database.rules.json"]);
const IGNORAR_ARQ = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|composer\.lock|Gemfile\.lock|poetry\.lock|\.min\.(js|css)|\.map|\.d\.ts)$/;
const MAX_BYTES = 1_500_000;
const MAX_ARQUIVOS = 25_000;

const arquivos = [];
function andar(dir) {
  let entradas;
  try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entradas) {
    if (arquivos.length >= MAX_ARQUIVOS) return;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!IGNORAR_DIRS.has(e.name)) andar(abs);
      continue;
    }
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    const ehEnv = /^\.env(\..+)?$/.test(e.name);
    if (!ehEnv && !EXT_TEXTO.has(ext) && !NOMES_TEXTO.has(e.name) && !/^docker-compose/.test(e.name)) continue;
    if (IGNORAR_ARQ.test(e.name)) continue;
    let st; try { st = fs.statSync(abs); } catch { continue; }
    if (st.size > MAX_BYTES) continue;
    let texto; try { texto = fs.readFileSync(abs, "utf8"); } catch { continue; }
    if (texto.includes("\u0000")) continue;
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    const linhas = texto.split(/\r?\n/).map((l) => (l.length > 3000 ? "" : l));
    arquivos.push({
      rel, abs, nome: e.name, ext, texto, linhas,
      env: ehEnv,
      exemploEnv: ehEnv && /\.(example|sample|template|dist|defaults?)$/i.test(e.name),
      codigo: [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".vue", ".svelte", ".astro", ".py", ".rb", ".php", ".go", ".java", ".kt", ".cs"].includes(ext),
      teste: /(^|\/)(__tests__|__mocks__|tests?|spec|fixtures?|mocks?|e2e|cypress|playwright)\/|\.(test|spec|stories)\.[a-z]+$/i.test(rel),
      script: /(^|\/)(seed|seeds|migrations?|scripts?)\//i.test(rel) || /seed\.[jt]s$/.test(rel),
      cliente: /^\s*['"]use client['"]/m.test(texto),
    });
  }
}

// ---------------------------------------------------------------- utilidades
function git(argsGit, opts = {}) {
  const r = spawnSync("git", argsGit, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: opts.timeout || 60_000 });
  if (r.error || r.status !== 0) return null;
  return r.stdout;
}
function existe(rel) { return fs.existsSync(path.join(ROOT, rel)); }
function ler(rel) { try { return fs.readFileSync(path.join(ROOT, rel), "utf8"); } catch { return null; } }
const bloco = (arq, i, n = 8) => arq.linhas.slice(i, i + n).join("\n");
const semStrings = (l) => l.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
const MAX_EVID = 12;

// ---------------------------------------------------------------- redação de segredos
const SEGREDOS = [
  { nome: "Chave da Anthropic", re: /\bsk-ant-[A-Za-z0-9_-]{32,}/g, sev: "critico" },
  { nome: "Chave da OpenAI", re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/g, sev: "critico" },
  { nome: "Chave secreta do Stripe (produção)", re: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/g, sev: "critico", producao: true },
  { nome: "Chave secreta do Stripe (teste)", re: /\bsk_test_[A-Za-z0-9]{20,}/g, sev: "medio" },
  { nome: "Segredo de webhook do Stripe", re: /\bwhsec_[A-Za-z0-9]{24,}/g, sev: "alto" },
  { nome: "Chave de acesso da AWS", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, sev: "critico" },
  { nome: "Token do GitHub", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})/g, sev: "critico" },
  { nome: "Token do Slack", re: /\bxox[baprs]-[A-Za-z0-9-]{20,}/g, sev: "alto" },
  { nome: "Chave privada", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY-----/g, sev: "critico" },
  { nome: "Chave da SendGrid", re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/g, sev: "critico" },
  { nome: "Access token do Mercado Pago", re: /\bAPP_USR-\d{6,}-\d{6}-[a-f0-9]{32}-\d{6,}/g, sev: "critico", producao: true },
  { nome: "Chave do Asaas", re: /\$aact_[A-Za-z0-9_]{20,}/g, sev: "critico", producao: true },
  { nome: "Chave da Resend", re: /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/g, sev: "alto" },
  { nome: "Token do Supabase com papel service_role", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, sev: "critico", jwt: true },
  { nome: "Chave de API do Google", re: /\bAIza[0-9A-Za-z_-]{35}\b/g, sev: "baixo", suspeita: true,
    nota: "Chaves AIza do Firebase Web são públicas por design. Confirme se não é uma chave de Maps, Gemini ou outro serviço sem restrição de domínio." },
  { nome: "URL de banco com usuário e senha", re: /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?):\/\/[^\s:'"`/@]+:[^\s@'"`]+@[^\s'"`]+/g, sev: "alto", db: true },
];
const GENERICO = /(?:api[_-]?key|apikey|secret[_-]?key|client[_-]?secret|password|passwd|senha|access[_-]?token|auth[_-]?token|private[_-]?key|secret)["']?\s*[:=]\s*["'`]([^"'`\s]{12,})["'`]/i;
const PLACEHOLDER = /(your|seu|sua|xxx|example|exemplo|changeme|change[-_]me|placeholder|dummy|fake|teste?|sample|\$\{|<|>|process\.env|import\.meta|os\.environ|\*\*\*|\.\.\.|0000|1234|abcdef|password123|senha123|insira|replace)/i;

function jwtPapel(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return payload.role || null;
  } catch { return null; }
}
function dbLocal(url) {
  const host = (url.split("@")[1] || "").split(/[:/?]/)[0].toLowerCase();
  return !host.includes(".") || /^(localhost|127\.|0\.0\.0\.0|host\.docker\.internal)/.test(host) || /example|exemplo|\.local$/.test(host);
}
function mascara(valor) {
  if (!valor) return valor;
  const v = String(valor);
  if (v.startsWith("-----BEGIN")) return "-----BEGIN … PRIVATE KEY-----[redigido]";
  if (/:\/\//.test(v)) return v.replace(/(:\/\/[^:/@\s]+:)[^@\s]+@/, "$1•••••@");
  return v.slice(0, Math.min(6, Math.floor(v.length / 3))) + "…[redigido]";
}
function redigir(linha) {
  let l = linha;
  for (const s of SEGREDOS) l = l.replace(new RegExp(s.re.source, "g"), (m) => mascara(m));
  l = l.replace(new RegExp(GENERICO.source, "gi"), (m, val) => m.replace(val, mascara(val)));
  l = l.replace(/^(\s*(?:export\s+)?[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASS|PWD|SENHA|DSN|URL|URI)[A-Z0-9_]*\s*=\s*)(.+)$/i,
    (m, a, val) => (/^["']?\s*["']?$/.test(val) ? m : a + mascara(val.replace(/^["']|["']$/g, ""))));
  l = l.trim();
  return l.length > 200 ? l.slice(0, 197) + "…" : l;
}
const evid = (arq, i, extra) => ({ arquivo: arq.rel, linha: i + 1, trecho: redigir(arq.linhas[i] || ""), ...(extra || {}) });

// ---------------------------------------------------------------- achados
const achados = [];
const statusItem = {}; // id -> { status, nota }
function achado(id, severidade, status, titulo, evidencias, extra = {}) {
  const ev = evidencias.slice(0, MAX_EVID);
  const resto = evidencias.length - ev.length;
  achados.push({
    id, area: AREAS[ITEM_POR_ID[id].area], item: ITEM_POR_ID[id].titulo, severidade, status, titulo,
    resumo: extra.resumo || "", evidencias: ev, outrasOcorrencias: resto > 0 ? resto : 0,
    risco: extra.risco || ITEM_POR_ID[id].risco, passos: extra.passos || ITEM_POR_ID[id].corrigir.slice(),
    prompt: extra.prompt || "", nota: extra.nota || "", origem: "scanner",
  });
}
const marcar = (id, status, nota = "") => { statusItem[id] = { status, nota }; };

// ---------------------------------------------------------------- stack
function lerJson(rel) { try { return JSON.parse(ler(rel)); } catch { return null; } }
const deps = new Set();
const scriptsPkg = [];
let LIB_RATE = false;

// ======================================================================= início
const t0 = Date.now();
log("saas-seguro · varredura de segurança");
log(`Projeto: ${ROOT}`);
andar(ROOT);
log(`Arquivos analisados: ${arquivos.length}`);

for (const a of arquivos.filter((x) => x.nome === "package.json")) {
  try {
    const pj = JSON.parse(a.texto);
    for (const k of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      for (const d of Object.keys(pj[k] || {})) deps.add(d);
    }
    if (pj.scripts) scriptsPkg.push({ arq: a, scripts: pj.scripts });
  } catch { /* ignora package.json inválido */ }
}
const reqPy = arquivos.filter((a) => /(^|\/)(requirements[\w.-]*\.txt|pyproject\.toml|Pipfile)$/.test(a.rel)).map((a) => a.texto.toLowerCase()).join("\n");
const tem = (...nomes) => nomes.some((n) => (n.endsWith("*") ? [...deps].some((d) => d.startsWith(n.slice(0, -1))) : deps.has(n)));
const temPy = (re) => re.test(reqPy);

const stack = [];
if (tem("next")) stack.push("Next.js");
if (tem("@nestjs/core")) stack.push("NestJS");
if (tem("express")) stack.push("Express");
if (tem("fastify")) stack.push("Fastify");
if (tem("hono")) stack.push("Hono");
if (tem("nuxt")) stack.push("Nuxt");
if (tem("@sveltejs/kit")) stack.push("SvelteKit");
if (tem("vite") && !tem("next")) stack.push("Vite");
if (tem("react") && !tem("next")) stack.push("React");
if (tem("vue") && !tem("nuxt")) stack.push("Vue");
if (tem("expo", "react-native")) stack.push("React Native");
if (tem("@supabase/supabase-js", "@supabase/ssr")) stack.push("Supabase");
if (tem("firebase", "firebase-admin")) stack.push("Firebase");
if (tem("@prisma/client", "prisma")) stack.push("Prisma");
if (tem("drizzle-orm")) stack.push("Drizzle");
if (tem("typeorm")) stack.push("TypeORM");
if (tem("mongoose")) stack.push("Mongoose");
if (tem("sequelize")) stack.push("Sequelize");
if (tem("stripe")) stack.push("Stripe");
if (tem("mercadopago")) stack.push("Mercado Pago");
if (temPy(/django/)) stack.push("Django");
if (temPy(/fastapi/)) stack.push("FastAPI");
if (temPy(/flask/)) stack.push("Flask");

const temBackend = tem("@nestjs/core", "express", "fastify", "hono", "koa", "next", "nuxt", "@sveltejs/kit") || temPy(/django|fastapi|flask/);
const temFront = tem("react", "vue", "svelte", "next", "nuxt", "@sveltejs/kit", "astro", "solid-js") || arquivos.some((a) => a.ext === ".html");
const textoCodigo = (re) => arquivos.some((a) => a.codigo && re.test(a.texto));
const authGerenciada = [];
if (tem("@supabase/supabase-js", "@supabase/ssr", "@supabase/auth-helpers-nextjs") && textoCodigo(/\.auth\.(signIn|signUp|getUser|getSession|exchangeCodeForSession|onAuthStateChange)/)) authGerenciada.push("Supabase Auth");
if (tem("firebase", "firebase-admin") && textoCodigo(/(firebase\/auth|getAuth\(|signInWith\w+\()/)) authGerenciada.push("Firebase Auth");
if (tem("@clerk/*")) authGerenciada.push("Clerk");
if (tem("@auth0/*")) authGerenciada.push("Auth0");
if (tem("@kinde-oss/*")) authGerenciada.push("Kinde");
if (tem("@workos-inc/*")) authGerenciada.push("WorkOS");
if (tem("@stackframe/stack")) authGerenciada.push("Stack Auth");

const codigo = arquivos.filter((a) => a.codigo);
const codigoApp = codigo.filter((a) => !a.teste);
const envs = arquivos.filter((a) => a.env && !a.exemploEnv);
const ehGit = git(["rev-parse", "--is-inside-work-tree"])?.trim() === "true";
const rastreados = ehGit ? new Set((git(["ls-files"]) || "").split("\n").filter(Boolean)) : new Set();

// Marcadores reutilizados
const RE_AUTH = /(getServerSession|getSession\(|auth\(\)|await auth\b|currentUser\(|getUser\(|getAuth\(|requireAuth|requireUser|ensureAuth|isAuthenticated|verifyToken|jwt\.verify|jwtVerify|clerkClient|supabase\.auth\.getUser|auth\.getUser|withAuth|withApiAuth|getToken\(|validateRequest|lucia|useAuth|authorize\(|checkAuth|authenticate|UseGuards|AuthGuard|req\.user|request\.user|ctx\.user|session\.user|x-api-key|CRON_SECRET|Bearer)/;
const RE_DONO = /(user_?id|owner_?id|author_?id|created_?by|tenant_?id|org(?:anization)?_?id|company_?id|empresa_?id|clinica_?id|account_?id|workspace_?id|team_?id|customer_?id|cliente_?id|usuario_?id|profile_?id|session\.user|req\.user|request\.user|currentUser|user\.id|ctx\.user|auth\.uid|userId|ownerId)/i;
const RE_ROTA_PUBLICA = /(auth|login|signin|sign-in|signup|sign-up|register|cadastro|webhook|health|healthz|status|public|publico|og|sitemap|robots|callback|cron|leads?|contact|contato|newsletter|waitlist|lista-de-espera|manifest|favicon|\[\.\.\.nextauth\])/i;

// ======================================================================= 1. SEGREDOS
log("▸ Segredos e chaves");
{
  // 1.1 segredos no código
  const porTipo = new Map();
  const genericos = [];
  for (const a of arquivos.filter((x) => !x.env)) {
    a.linhas.forEach((linha, i) => {
      if (!linha) return;
      for (const s of SEGREDOS) {
        const re = new RegExp(s.re.source, "g");
        let m;
        while ((m = re.exec(linha))) {
          if (s.jwt && jwtPapel(m[0]) !== "service_role") continue;
          if (s.db && dbLocal(m[0])) continue;
          if (PLACEHOLDER.test(m[0]) && !s.jwt && !s.db) continue;
          const k = s.nome;
          if (!porTipo.has(k)) porTipo.set(k, { s, ev: [], suspeitaTeste: true });
          const reg = porTipo.get(k);
          reg.ev.push(evid(a, i));
          if (!a.teste) reg.suspeitaTeste = false;
        }
      }
      const g = linha.match(GENERICO);
      if (g && !PLACEHOLDER.test(g[1]) && !/^(true|false|null|undefined)$/i.test(g[1]) && a.codigo && !SEGREDOS.some((s) => new RegExp(s.re.source).test(linha))) {
        genericos.push({ a, i });
      }
    });
  }
  for (const [nome, { s, ev, suspeitaTeste }] of porTipo) {
    const status = s.suspeita || suspeitaTeste ? "suspeita" : "confirmado";
    achado("1.1", s.sev, status, `${nome} escrita no código`, ev, {
      resumo: `${ev.length} ocorrência(s) de ${nome.toLowerCase()} em arquivos do projeto.`,
      nota: s.nota || (suspeitaTeste ? "Aparece só em arquivos de teste. Confirme se é uma chave real." : ""),
    });
  }
  if (genericos.length) {
    achado("1.1", "alto", "suspeita", "Possíveis senhas ou chaves atribuídas direto no código", genericos.map(({ a, i }) => evid(a, i)), {
      resumo: `${genericos.length} atribuição(ões) de valores com cara de segredo.`,
      nota: "Padrão genérico: confirme se são credenciais reais ou valores inofensivos.",
    });
  }

  // 1.2 .env no Git
  if (ehGit) {
    const envRastreados = [...rastreados].filter((f) => /(^|\/)\.env(\.[\w-]+)?$/.test(f) && !/\.(example|sample|template|dist|defaults?)$/i.test(f));
    if (envRastreados.length) {
      achado("1.2", "critico", "confirmado", "Arquivo .env rastreado pelo Git", envRastreados.map((f) => ({ arquivo: f, linha: null, trecho: "arquivo versionado no repositório" })), {
        resumo: `${envRastreados.length} arquivo(s) .env estão no repositório.`,
      });
    }
    const ignorado = spawnSync("git", ["check-ignore", "-q", ".env"], { cwd: ROOT }).status === 0;
    if (!ignorado) {
      achado("1.2", "alto", "confirmado", "O .env não está no .gitignore", [{ arquivo: ".gitignore", linha: null, trecho: existe(".gitignore") ? "sem regra que ignore .env" : "arquivo .gitignore não existe" }], {
        resumo: "Um git add . distraído manda todas as credenciais para o repositório.",
      });
    }
    if (!envRastreados.length && ignorado) marcar("1.2", "ok", ".env ignorado pelo Git e nenhum .env versionado.");
  } else {
    marcar("1.2", "manual", "O projeto não é um repositório Git; confira manualmente onde o .env é guardado.");
  }

  // 1.3 histórico do Git
  if (ehGit && !SEM_HISTORICO) {
    const valoresAtuais = new Set();
    for (const a of arquivos) for (const s of SEGREDOS) for (const m of a.texto.match(new RegExp(s.re.source, "g")) || []) valoresAtuais.add(m);
    const hist = git(["log", "--all", "-p", "--no-color", "--no-ext-diff", "-U0", "--max-count=400", "--format=@@COMMIT %h %ad", "--date=short"], { timeout: 90_000 });
    const ev = [];
    const vistos = new Set();
    if (hist) {
      let commit = "", data = "", arquivo = "";
      for (const linha of hist.split("\n")) {
        if (linha.startsWith("@@COMMIT ")) { [, commit, data] = linha.split(" "); continue; }
        if (linha.startsWith("+++ ")) { arquivo = linha.replace(/^\+\+\+ (b\/)?/, ""); continue; }
        if (!linha.startsWith("+") || linha.length > 3000) continue;
        for (const s of SEGREDOS) {
          if (s.suspeita || s.sev === "baixo" || s.sev === "medio") continue;
          for (const m of linha.match(new RegExp(s.re.source, "g")) || []) {
            if (s.jwt && jwtPapel(m) !== "service_role") continue;
            if (s.db && dbLocal(m)) continue;
            if (valoresAtuais.has(m) || vistos.has(m)) continue;
            vistos.add(m);
            ev.push({ arquivo: `${arquivo} (commit ${commit}, ${data})`, linha: null, trecho: `${s.nome}: ${mascara(m)}` });
          }
        }
      }
      const envsHistorico = (git(["log", "--all", "--diff-filter=A", "--name-only", "--format="]) || "").split("\n")
        .filter((f) => /(^|\/)\.env(\.[\w-]+)?$/.test(f) && !/\.(example|sample|template|dist|defaults?)$/i.test(f) && !rastreados.has(f));
      if (ev.length) {
        achado("1.3", "critico", "confirmado", "Segredos encontrados no histórico do Git", ev, {
          resumo: `${ev.length} segredo(s) que não estão mais no código, mas continuam nos commits antigos.`,
          nota: "Remover o arquivo não basta: revogue cada chave no painel do provedor.",
        });
      }
      if (envsHistorico.length) {
        achado("1.3", "alto", "confirmado", "Um arquivo .env já foi commitado no passado", [...new Set(envsHistorico)].map((f) => ({ arquivo: f, linha: null, trecho: "adicionado em algum commit do histórico" })), {
          resumo: "As chaves que estavam nesse .env continuam acessíveis no histórico.",
          nota: "Revogue as chaves que estavam nesse arquivo na época.",
        });
      }
      if (!ev.length && !envsHistorico.length) marcar("1.3", "ok", "Nenhum segredo de alta confiança nos últimos 400 commits.");
    } else {
      marcar("1.3", "manual", "Não foi possível ler o histórico. Rode: gitleaks git -v .");
    }
  } else if (!ehGit) {
    marcar("1.3", "nao_aplica", "O projeto não é um repositório Git.");
  } else {
    marcar("1.3", "manual", "Histórico não verificado (--no-history). Rode: gitleaks git -v .");
  }

  // 1.4 segredos em variáveis públicas
  const RE_PUBLICA = /\b(NEXT_PUBLIC_|VITE_|EXPO_PUBLIC_|REACT_APP_|NUXT_PUBLIC_|PUBLIC_|GATSBY_)[A-Z0-9_]*/g;
  const SENSIVEL = /(SECRET|SERVICE_ROLE|SERVICE_KEY|PRIVATE|PASSWORD|PASSWD|PASS\b|PWD|TOKEN|ACCESS_KEY|SK_|_SK\b|WEBHOOK|ADMIN|DATABASE_URL|DB_URL|OPENAI|ANTHROPIC|GEMINI_API|STRIPE_SECRET)/;
  const NAO_SENSIVEL = /(ANON|PUBLISHABLE|PUBLIC_KEY|SITE_KEY|CLIENT_ID|MEASUREMENT|GA_|GTM|POSTHOG|SENTRY_DSN|MAPBOX_TOKEN|URL$|_URL_|APP_ID|PROJECT_ID|VAPID)/;
  const ev14 = [];
  for (const a of envs) {
    a.linhas.forEach((l, i) => {
      const m = l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m || !m[2].trim()) return;
      const [, nome, valor] = m;
      const publica = /^(NEXT_PUBLIC_|VITE_|EXPO_PUBLIC_|REACT_APP_|NUXT_PUBLIC_|PUBLIC_|GATSBY_)/.test(nome);
      if (!publica) return;
      const valorSecreto = SEGREDOS.some((s) => s.sev === "critico" && !s.jwt && new RegExp(s.re.source).test(valor)) ||
        (/eyJ/.test(valor) && jwtPapel(valor.replace(/["'\s]/g, "")) === "service_role");
      if (valorSecreto || (SENSIVEL.test(nome) && !NAO_SENSIVEL.test(nome))) ev14.push(evid(a, i));
    });
  }
  for (const a of codigoApp) {
    a.linhas.forEach((l, i) => {
      for (const m of l.match(RE_PUBLICA) || []) {
        if (SENSIVEL.test(m) && !NAO_SENSIVEL.test(m)) { ev14.push(evid(a, i)); break; }
      }
      if (a.cliente && /SERVICE_ROLE|service_role/.test(l)) ev14.push(evid(a, i, { obs: "arquivo de cliente (use client)" }));
    });
  }
  if (ev14.length) {
    achado("1.4", "critico", "confirmado", "Segredo em variável pública ou em código que roda no navegador", ev14, {
      resumo: "Essas variáveis são embutidas no JavaScript entregue ao visitante.",
    });
  } else marcar("1.4", "ok", "Nenhuma variável pública com nome ou valor de segredo.");

  // 1.5 chaves de produção no ambiente local
  const ev15 = [];
  for (const a of envs.filter((e) => /^\.env(\.local|\.development(\.local)?)?$/.test(e.nome))) {
    a.linhas.forEach((l, i) => {
      if (SEGREDOS.some((s) => s.producao && new RegExp(s.re.source).test(l))) ev15.push(evid(a, i));
    });
  }
  if (ev15.length) {
    achado("1.5", "medio", "suspeita", "Chaves de produção no .env de desenvolvimento", ev15, {
      resumo: "Testes locais podem cobrar clientes reais ou mexer em dados de produção.",
      nota: "Confirme se esse .env é usado só na sua máquina. Se sim, troque por chaves de teste.",
    });
  } else marcar("1.5", "manual", "Confira se o banco e as chaves do .env local são diferentes dos de produção.");
  marcar("1.6", "manual");
}

// ======================================================================= 2. AUTENTICAÇÃO
log("▸ Autenticação e autorização");
const arquivosRota = codigoApp.filter((a) =>
  /(^|\/)app\/(.*\/)?route\.[jt]sx?$/.test(a.rel) || /(^|\/)pages\/api\//.test(a.rel) || /\.controller\.[jt]s$/.test(a.rel) ||
  /^\s*['"]use server['"]/m.test(a.texto) || /\b(app|router|server|api|routes?)\.(get|post|put|patch|delete)\(\s*['"`]\//.test(a.texto) ||
  /(^|\/)(routes?|controllers?|handlers?|api)\//.test(a.rel) || /@(app|router)\.(get|post|put|patch|delete)\(/.test(a.texto));
{
  // 2.1 token previsível
  const ev21 = [];
  for (const a of codigoApp) a.linhas.forEach((l, i) => {
    if (/Math\.random\(\)/.test(l) && /(token|reset|codigo|code|otp|senha|password|secret|session|nonce|invite|convite|verif|recover|recupera)/i.test(l)) ev21.push(evid(a, i));
  });
  if (ev21.length) achado("2.1", "alto", "confirmado", "Token de segurança gerado com Math.random", ev21, {
    resumo: "Math.random é previsível: tokens de recuperação ou convite podem ser adivinhados.",
    passos: ["Troque por crypto.randomBytes(32).toString(\"hex\") ou crypto.randomUUID().", "Faça o token expirar e valer uma vez só.", "Invalide os tokens antigos já emitidos."],
  });
  else marcar("2.1", authGerenciada.length ? "ok" : "ok", authGerenciada.length ? `Login gerenciado por ${authGerenciada.join(", ")}.` : "Nenhum token gerado com Math.random.");

  // 2.2 hash de senha
  const libHash = tem("bcrypt", "bcryptjs", "argon2", "@node-rs/argon2", "@node-rs/bcrypt", "better-auth") || temPy(/bcrypt|argon2|passlib/) ||
    codigoApp.some((a) => /\bscrypt(Sync)?\(|hashPassword|argon2\.|bcrypt\./.test(a.texto));
  const ev22c = [], ev22s = [];
  for (const a of codigoApp) a.linhas.forEach((l, i) => {
    const h = l.match(/createHash\(\s*['"](md5|sha1|sha256|sha512)['"]\s*\)/i);
    if (h && /(password|senha|pass)/i.test(a.linhas.slice(Math.max(0, i - 3), i + 4).join(" "))) (/(md5|sha1)/i.test(h[1]) ? ev22c : ev22s).push(evid(a, i));
    if (!libHash && /(password|senha)\s*:\s*(dto|body|req\.body|input|data|values|payload)\.(password|senha)\b/.test(l)) ev22s.push(evid(a, i, { obs: "senha gravada sem hash aparente" }));
    if (/(\.password|\.senha)\s*(===|!==|==|!=)\s*(?!undefined|null|''|""|``)/.test(semStrings(l)) || /(===|!==)\s*\w+\.(password|senha)\b/.test(semStrings(l))) ev22s.push(evid(a, i, { obs: "comparação direta de senha" }));
  });
  if (ev22c.length) achado("2.2", "critico", "confirmado", "Senha com hash fraco (MD5 ou SHA-1)", ev22c, { resumo: "MD5 e SHA-1 são quebrados em segundos com tabelas prontas." });
  if (ev22s.length) achado("2.2", "critico", "suspeita", "Senha guardada ou comparada sem hash forte", ev22s, { resumo: "Possível senha em texto puro ou com hash rápido (SHA-256 sem sal)." });
  if (!ev22c.length && !ev22s.length) {
    const temSenhaPropria = arquivos.some((a) => /\.prisma$|\.sql$|entity|model|schema/i.test(a.rel) && /\b(password|senha|password_hash|passwordHash)\b/.test(a.texto));
    if (temSenhaPropria && !libHash && !authGerenciada.length) {
      achado("2.2", "critico", "suspeita", "O projeto guarda senhas, mas não usa bcrypt nem argon2", [], { resumo: "Há campo de senha no banco e nenhuma biblioteca de hash forte nas dependências." });
    } else marcar("2.2", "ok", authGerenciada.length ? `Senhas gerenciadas por ${authGerenciada.join(", ")}.` : libHash ? "Biblioteca de hash forte encontrada." : "Nenhum campo de senha próprio encontrado.");
  }

  // 2.3 rotas sem login
  const ev23 = [];
  const temMiddlewareNext = arquivos.some((a) => /^(src\/)?middleware\.[jt]s$/.test(a.rel) && /(auth|session|token|supabase|clerk|redirect)/i.test(a.texto));
  const guardGlobal = codigoApp.some((a) => /APP_GUARD/.test(a.texto));
  for (const a of arquivosRota) {
    if (RE_ROTA_PUBLICA.test(a.rel)) continue;
    const proteg = RE_AUTH.test(a.texto);
    if (/(^|\/)app\/(.*\/)?route\.[jt]sx?$/.test(a.rel) || /(^|\/)pages\/api\//.test(a.rel)) {
      if (proteg) continue;
      const i = a.linhas.findIndex((l) => /export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)|export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\b|export\s+default/.test(l));
      if (i >= 0) ev23.push(evid(a, i));
    } else if (/^\s*['"]use server['"]/m.test(a.texto)) {
      if (!proteg) ev23.push(evid(a, 0, { obs: "Server Action sem checagem de usuário" }));
    } else if (/\.controller\.[jt]s$/.test(a.rel)) {
      if (!guardGlobal && !/UseGuards/.test(a.texto)) {
        const i = a.linhas.findIndex((l) => /@Controller\(/.test(l));
        ev23.push(evid(a, Math.max(i, 0)));
      }
    } else {
      const usoGlobal = /\.use\(\s*(auth|authenticate|requireAuth|verifyToken|protect|checkJwt|passport|ensureAuth|isAuth)/i.test(a.texto);
      if (usoGlobal) continue;
      a.linhas.forEach((l, i) => {
        const m = l.match(/\b(?:app|router|server|api|routes?)\.(post|put|patch|delete|get)\(\s*['"`]([^'"`]+)['"`]\s*,\s*(.*)$/);
        if (!m) return;
        const [, metodo, rota, resto] = m;
        if (RE_ROTA_PUBLICA.test(rota)) return;
        if (/(auth|authenticate|requireAuth|ensureAuth|isAuthenticated|verifyToken|protect|passport\.authenticate|checkJwt|guard|isAdmin|requireUser)/i.test(resto)) return;
        if (metodo === "get" && !/(user|admin|account|conta|me\b|perfil|profile|paciente|cliente|order|pedido|payment|pagamento|invoice|fatura|dashboard|relatorio|report)/i.test(rota)) return;
        ev23.push(evid(a, i));
      });
    }
  }
  if (ev23.length) achado("2.3", "alto", "suspeita", "Rotas que parecem não exigir login", ev23, {
    resumo: `${ev23.length} rota(s) ou ação(ões) sem checagem de usuário visível no arquivo.`,
    nota: temMiddlewareNext ? "Existe um middleware.ts: confirme se ele protege essas rotas." : guardGlobal ? "Há guard global: confirme se essas rotas não estão marcadas como públicas." : "",
  });
  else marcar("2.3", arquivosRota.length ? "ok" : "nao_aplica", arquivosRota.length ? "Todas as rotas encontradas têm checagem de usuário visível." : "Nenhuma rota de API encontrada.");

  // 2.4 IDOR
  const ev24 = [], ev24sb = [];
  const RE_BUSCA = /\.(findUnique|findFirst|findUniqueOrThrow|findFirstOrThrow|findOne|findOneBy|findOneOrFail|findById|findByIdAndUpdate|findByIdAndDelete|findByPk|update|delete|deleteOne|updateOne)\(/;
  for (const a of codigoApp.filter((x) => !x.script)) a.linhas.forEach((l, i) => {
    if (RE_BUSCA.test(l)) {
      const stmt = bloco(a, i, 6);
      const porId = /(where\s*:\s*\{\s*id\b|\{\s*id\s*[,}:]|findById\(|findByPk\(|findByIdAnd|findOneBy\(\s*\{\s*id)/.test(stmt);
      const vemDaRequisicao = /(params|query|body|req\.|request\.|\bid\b)/.test(stmt);
      if (!porId || !vemDaRequisicao) return;
      const contexto = a.linhas.slice(Math.max(0, i - 2), i + 12).join("\n");
      if (RE_DONO.test(contexto)) return;
      ev24.push(evid(a, i));
    }
    if (/\.eq\(\s*['"]id['"]\s*,/.test(l) && /\.from\(/.test(a.linhas.slice(Math.max(0, i - 4), i + 1).join(" "))) {
      if (!RE_DONO.test(a.linhas.slice(Math.max(0, i - 4), i + 4).join(" "))) ev24sb.push(evid(a, i));
    }
  });
  if (ev24.length) achado("2.4", "critico", "suspeita", "Consultas por ID sem conferir o dono do registro", ev24, {
    resumo: `${ev24.length} consulta(s) buscam, alteram ou apagam por ID sem filtro de usuário ou organização por perto.`,
    nota: "Confirme se a posse é conferida em outro lugar (por exemplo, numa checagem logo depois da busca).",
  });
  if (ev24sb.length) achado("2.4", "alto", "suspeita", "Consultas do Supabase por ID que dependem da RLS", ev24sb, {
    resumo: "Sem filtro de usuário, essas consultas só são seguras se a RLS da tabela estiver ativa e correta.",
  });
  if (!ev24.length && !ev24sb.length) marcar("2.4", "pendente", "Nenhum padrão óbvio. Revise manualmente as rotas que recebem ID.");

  // 2.5 Supabase RLS / Firebase rules
  const usaSupabase = tem("@supabase/supabase-js", "@supabase/ssr");
  const usaFirebase = tem("firebase", "firebase-admin") || arquivos.some((a) => /firestore\.rules|storage\.rules|database\.rules\.json/.test(a.rel));
  let checou25 = false;
  if (usaSupabase) {
    const sqls = arquivos.filter((a) => a.ext === ".sql");
    if (sqls.length) {
      checou25 = true;
      const criadas = new Map(), comRls = new Set();
      for (const a of sqls) a.linhas.forEach((l, i) => {
        const c = l.match(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\.)?"?([a-zA-Z0-9_]+)"?/i);
        if (c && !/^(schema_migrations)$/i.test(c[1])) criadas.set(c[1].toLowerCase(), evid(a, i));
        const r = l.match(/alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?(?:"?public"?\.)?"?([a-zA-Z0-9_]+)"?\s+enable\s+row\s+level\s+security/i);
        if (r) comRls.add(r[1].toLowerCase());
      });
      const sem = [...criadas].filter(([t]) => !comRls.has(t)).map(([, e]) => e);
      if (sem.length) achado("2.5", "critico", "confirmado", "Tabelas do Supabase sem Row Level Security", sem, {
        resumo: `${sem.length} tabela(s) criadas nas migrations sem "enable row level security".`,
        nota: "Confirme no painel (Database → Tables) se a RLS não foi ativada manualmente por lá.",
      });
      else marcar("2.5", "ok", `RLS ativada nas ${criadas.size} tabela(s) encontradas nas migrations. Confira as policies.`);
    }
  }
  if (usaFirebase) {
    const ev25 = [];
    for (const a of arquivos.filter((x) => /\.rules$|database\.rules\.json$/.test(x.rel))) {
      checou25 = true;
      a.linhas.forEach((l, i) => {
        if (/allow\s+(read|write|read\s*,\s*write|create|update|delete)\s*(:\s*if\s+true|;)/.test(l) || /if\s+request\.time\s*</.test(l) || /"\.(read|write)"\s*:\s*true/.test(l)) ev25.push(evid(a, i));
      });
    }
    if (ev25.length) achado("2.5", "critico", "confirmado", "Regras do Firebase abertas", ev25, { resumo: "Qualquer pessoa consegue ler ou escrever nesses dados." });
    else if (checou25 && !statusItem["2.5"]) marcar("2.5", "ok", "Regras do Firebase sem acesso aberto.");
  }
  if (!usaSupabase && !usaFirebase) marcar("2.5", "nao_aplica", "O projeto não usa Supabase nem Firebase.");
  else if (!checou25) marcar("2.5", "manual", usaSupabase
    ? "Rode no SQL Editor do Supabase: select tablename, rowsecurity from pg_tables where schemaname = 'public'; (rowsecurity deve ser true em todas)."
    : "Abra as regras do Firestore/Storage no console do Firebase e confira se não há allow read, write: if true.");

  // 2.6 sessão e token
  const ev26a = [], ev26b = [], ev26c = [];
  for (const a of codigoApp) a.linhas.forEach((l, i) => {
    if (/(localStorage|sessionStorage)\.setItem\(\s*['"`][^'"`]*(token|jwt|session|auth|access|refresh)/i.test(l)) ev26a.push(evid(a, i));
    if (/(res\.cookie\(|cookies\(\)\.set\(|cookieStore\.set\(|response\.cookies\.set\(|setCookie\(|\.cookies\.set\()/.test(l) && /(token|session|auth|jwt|sid)/i.test(bloco(a, i, 3))) {
      if (!/httpOnly\s*:\s*true/i.test(bloco(a, i, 8))) ev26b.push(evid(a, i));
    }
    if (/jwt\.sign\(|new SignJWT\(/.test(l) && !/(expiresIn|setExpirationTime|exp\s*:)/.test(bloco(a, i, 8))) ev26c.push(evid(a, i));
  });
  if (ev26a.length) achado("2.6", "alto", "confirmado", "Token de sessão guardado no localStorage", ev26a, { resumo: "Qualquer script injetado na página consegue ler e roubar a sessão." });
  if (ev26b.length) achado("2.6", "medio", "suspeita", "Cookie de sessão sem HttpOnly", ev26b, { resumo: "Sem HttpOnly, o JavaScript da página consegue ler o cookie." });
  if (ev26c.length) achado("2.6", "medio", "suspeita", "Token JWT sem expiração", ev26c, { resumo: "Um token roubado continua válido para sempre." });
  if (!ev26a.length && !ev26b.length && !ev26c.length) marcar("2.6", "ok", authGerenciada.length ? `Sessão gerenciada por ${authGerenciada.join(", ")}.` : "Nenhum token em localStorage, cookie sem HttpOnly ou JWT sem expiração.");

  // 2.7 limite de tentativas no login
  const libRate = tem("@nestjs/throttler", "express-rate-limit", "rate-limiter-flexible", "@upstash/ratelimit", "express-slow-down", "@fastify/rate-limit",
    "fastify-rate-limit", "hono-rate-limiter", "next-rate-limit", "limiter", "@arcjet/next", "@arcjet/node", "@arcjet/bun") || temPy(/slowapi|django-ratelimit|flask-limiter/) ||
    codigoApp.some((a) => /(ThrottlerGuard|@Throttle\(|rateLimit\(|Ratelimit\.|RateLimiter|rateLimiter)/.test(a.texto));
  LIB_RATE = libRate;
  const loginProprio = arquivosRota.filter((a) => /(login|signin|sign-in|entrar|authenticate|forgot|reset|recuperar|esqueci)/i.test(a.rel + "\n" + a.texto.slice(0, 4000)) && /(password|senha)/i.test(a.texto));
  if (!libRate && loginProprio.length && !authGerenciada.length) {
    achado("2.7", "alto", "confirmado", "Login sem limite de tentativas", loginProprio.map((a) => ({ arquivo: a.rel, linha: null, trecho: "rota de login ou recuperação sem rate limit" })), {
      resumo: "Nenhuma biblioteca de rate limit no projeto e há rotas próprias de login ou recuperação de senha.",
    });
  } else marcar("2.7", authGerenciada.length ? "ok" : libRate ? "ok" : "nao_aplica",
    authGerenciada.length ? `Login feito por ${authGerenciada.join(", ")}, que já limita tentativas.` : libRate ? "Biblioteca de rate limit encontrada. Confirme o limite nas rotas de login." : "Nenhuma rota própria de login encontrada.");
}

// ======================================================================= 3. BANCO E ENTRADAS
log("▸ Banco de dados e entradas");
{
  // 3.1 SQL injection
  const ev31c = [], ev31s = [];
  for (const a of codigoApp) a.linhas.forEach((l, i) => {
    if (/\$(queryRawUnsafe|executeRawUnsafe)\(/.test(l)) (/(\$\{|\+\s*\w)/.test(bloco(a, i, 3)) ? ev31c : ev31s).push(evid(a, i));
    else if (/\.(query|execute|raw|unsafe|exec)\(\s*`[^`]*\$\{/.test(l) && !/(sql|Prisma\.sql|SQL)`/.test(l)) ev31c.push(evid(a, i));
    else if (/\.(query|execute|raw)\(\s*['"][^'"]*(select|insert|update|delete|where)[^'"]*['"]\s*\+/i.test(l)) ev31c.push(evid(a, i));
    else if (/\b(execute|executemany|raw)\(\s*f["']/.test(l) || /\bexecute\(\s*["'][^"']*%s?[^"']*["']\s*%\s*/.test(l)) ev31c.push(evid(a, i));
    else if (/\.(find|findOne|deleteMany|updateMany)\(\s*(req\.(body|query)|request\.(body|query))\s*\)/.test(l)) ev31c.push(evid(a, i, { obs: "injeção NoSQL" }));
  });
  if (ev31c.length) achado("3.1", "critico", "confirmado", "SQL montado com texto vindo do usuário", ev31c, { resumo: "Permite injeção de SQL ou NoSQL." });
  if (ev31s.length) achado("3.1", "alto", "suspeita", "Uso de consulta crua insegura ($queryRawUnsafe)", ev31s, { resumo: "Confirme se nenhum valor do usuário entra nessa consulta." });
  if (!ev31c.length && !ev31s.length) marcar("3.1", "ok", "Nenhuma consulta montada por concatenação encontrada.");

  // 3.2 validação de entrada
  const libValid = tem("zod", "yup", "joi", "class-validator", "valibot", "superstruct", "@sinclair/typebox", "ajv", "@vinejs/vine", "arktype") || temPy(/pydantic|marshmallow|djangorestframework/);
  const ev32 = [], ev32m = [];
  if (tem("@nestjs/core")) {
    const vp = codigoApp.find((a) => /ValidationPipe/.test(a.texto));
    if (!vp) ev32.push({ arquivo: "src/main.ts", linha: null, trecho: "ValidationPipe não encontrado no projeto" });
    else if (!/whitelist\s*:\s*true/.test(vp.texto)) ev32.push({ arquivo: vp.rel, linha: null, trecho: "ValidationPipe sem whitelist: true" });
  }
  for (const a of arquivosRota) {
    const usaBody = /(await\s+(req|request)\.json\(\)|req\.body|request\.body|await\s+request\.formData\(\))/.test(a.texto);
    const valida = /(\.parse\(|\.safeParse\(|\.validate\(|validateSync|plainToInstance|@Body\(\)\s+\w+\s*:\s*\w+Dto|\.parseAsync\(|v\.parse\(|schema\.)/.test(a.texto);
    if (usaBody && !valida && !/\.controller\.[jt]s$/.test(a.rel) && !RE_ROTA_PUBLICA.test(a.rel)) {
      const i = a.linhas.findIndex((l) => /(await\s+(req|request)\.json\(\)|req\.body|request\.body)/.test(l));
      ev32.push(evid(a, Math.max(i, 0)));
    }
    a.linhas.forEach((l, i) => {
      if (/\.(create|update|upsert|insert|createMany)\(\s*\{\s*data\s*:\s*(body|req\.body|request\.body|await\s+req\.json\(\)|input|dto|data|payload)\s*[,}]/.test(l) ||
          /\.(insert|update)\(\s*(req\.body|body|payload)\s*\)/.test(l) || /\b(role|isAdmin|is_admin|plano|plan|isPremium)\s*:\s*(req\.body|body|dto|input)\./.test(l)) ev32m.push(evid(a, i));
    });
  }
  if (ev32.length) achado("3.2", "alto", ev32.some((e) => /ValidationPipe/.test(e.trecho)) ? "confirmado" : "suspeita", "Entradas sem validação no backend", ev32, {
    resumo: libValid ? "O projeto tem biblioteca de validação, mas essas rotas não parecem usá-la." : "Nenhuma biblioteca de validação nas dependências.",
  });
  if (ev32m.length) achado("3.2", "alto", "suspeita", "Body repassado direto para o banco (mass assignment)", ev32m, { resumo: "O usuário pode mandar campos extras, como role ou plano, e o banco grava." });
  if (!ev32.length && !ev32m.length) marcar("3.2", libValid ? "ok" : "pendente", libValid ? "Validação encontrada nas rotas analisadas." : "Sem biblioteca de validação: revise como as rotas tratam o body.");

  // 3.3 uploads
  const ev33 = [], ev33s = [];
  for (const a of codigoApp) {
    a.linhas.forEach((l, i) => {
      if (/\bmulter\(/.test(l) && !/limits/.test(a.texto)) ev33.push(evid(a, i));
      if (/FileInterceptor\(|FilesInterceptor\(/.test(l) && !/(limits|fileSize|ParseFilePipe|MaxFileSizeValidator)/.test(a.texto)) ev33s.push(evid(a, i));
      if (/(formidable|busboy)\(/.test(l) && !/(maxFileSize|limits)/.test(a.texto)) ev33s.push(evid(a, i));
      if (/createBucket\([^)]*public\s*:\s*true/.test(bloco(a, i, 3))) ev33s.push(evid(a, i, { obs: "bucket público" }));
      if (/writeFile(Sync)?\(\s*[^,]*public\//.test(l)) ev33s.push(evid(a, i, { obs: "gravando upload na pasta pública" }));
    });
  }
  if (ev33.length) achado("3.3", "alto", "confirmado", "Upload sem limite de tamanho", ev33, { resumo: "Um arquivo gigante pode derrubar o servidor." });
  if (ev33s.length) achado("3.3", "medio", "suspeita", "Upload sem validação clara de tamanho, tipo ou privacidade", ev33s);
  if (!ev33.length && !ev33s.length) marcar("3.3", codigoApp.some((a) => /(upload|multipart|FileInterceptor|storage\.from)/i.test(a.texto)) ? "pendente" : "nao_aplica",
    "Revise tamanho máximo, tipo e privacidade dos uploads, se houver.");

  // 3.4 banco exposto no docker-compose
  const ev34 = [];
  for (const a of arquivos.filter((x) => /(^|\/)(docker-)?compose[\w.-]*\.ya?ml$/.test(x.rel))) {
    let imagem = "";
    a.linhas.forEach((l, i) => {
      const im = l.match(/^\s*image\s*:\s*["']?([^"'\s]+)/);
      if (im) imagem = im[1];
      if (/^\s{2}[a-zA-Z0-9_-]+:\s*$/.test(l)) imagem = "";
      const p = l.match(/^\s*-\s*["']?((?:[\d.]+:)?)(\d+):(\d+)["']?/);
      if (!p) return;
      const portaInterna = Number(p[3]);
      const ehBanco = /(postgres|mysql|mariadb|mongo|redis|elasticsearch|rabbitmq|memcached|supabase\/postgres)/i.test(imagem) || [5432, 3306, 27017, 6379, 9200, 5672, 11211].includes(portaInterna);
      if (ehBanco && !/^(127\.0\.0\.1|localhost)/.test(p[1])) ev34.push(evid(a, i, { obs: imagem || `porta ${portaInterna}` }));
    });
  }
  if (ev34.length) achado("3.4", "alto", "confirmado", "Porta do banco publicada no docker-compose", ev34, { resumo: "Em uma VPS, essa porta fica acessível pela internet, mesmo com o firewall ativo." });
  else marcar("3.4", arquivos.some((x) => /compose[\w.-]*\.ya?ml$/.test(x.rel)) ? "ok" : "manual", "Confirme no provedor que o banco não aceita conexões de qualquer IP.");

  // 3.5 usuário do banco
  const ev35 = [];
  for (const a of envs) a.linhas.forEach((l, i) => {
    const m = l.match(/^\s*(?:export\s+)?(DATABASE_URL|DB_URL|POSTGRES_URL|POSTGRES_PRISMA_URL|MONGO(?:DB)?_URI|MYSQL_URL|DIRECT_URL)\s*=\s*["']?([^"'\s]+)/);
    if (!m) return;
    const usuario = (m[2].match(/:\/\/([^:/@]+)[:@]/) || [])[1] || "";
    if (/^(postgres(\.[a-z0-9]+)?|root|sa|admin)$/i.test(usuario) && !dbLocal(m[2])) ev35.push(evid(a, i));
  });
  if (ev35.length) achado("3.5", "medio", "suspeita", "Aplicação conectando ao banco com usuário administrador", ev35, {
    resumo: "O usuário da conexão parece ser o dono do banco.",
    nota: "No Supabase, o usuário padrão da connection string é o postgres. Prefira a API com RLS ou um usuário com permissões restritas.",
  });
  else marcar("3.5", "manual", "Confira se o usuário do banco usado pela aplicação não é o administrador.");

  // 3.6 respostas com campos demais
  const ev36 = [];
  const modelosSenha = [];
  for (const a of arquivos.filter((x) => x.ext === ".prisma")) {
    let modelo = null;
    for (const l of a.linhas) {
      const m = l.match(/^\s*model\s+(\w+)\s*\{/);
      if (m) modelo = m[1];
      if (modelo && /^\s*(password|senha|passwordHash|password_hash|hashedPassword|hash|refreshToken|refresh_token|resetToken)\s+String/.test(l)) modelosSenha.push(modelo[0].toLowerCase() + modelo.slice(1));
    }
  }
  const modelos = [...new Set(modelosSenha)];
  if (modelos.length) {
    const re = new RegExp(`prisma\\.(${modelos.join("|")})\\.(findMany|findUnique|findFirst|findUniqueOrThrow|findFirstOrThrow)\\(`);
    for (const a of codigoApp.filter((x) => !x.script)) a.linhas.forEach((l, i) => {
      if (re.test(l) && !/(select|omit)\s*:/.test(bloco(a, i, 10))) ev36.push(evid(a, i));
    });
  }
  for (const a of codigoApp) a.linhas.forEach((l, i) => {
    if (/@Column\(/.test(l) && /(password|senha)/i.test(bloco(a, i, 2)) && !/select\s*:\s*false/.test(bloco(a, i, 2))) ev36.push(evid(a, i, { obs: "coluna de senha sem select: false" }));
    if (/(password|senha)\s*:\s*\{[^}]*type\s*:\s*String/.test(l) && !/select\s*:\s*false/.test(l)) ev36.push(evid(a, i, { obs: "schema do Mongoose sem select: false" }));
  });
  if (ev36.length) achado("3.6", "medio", "suspeita", "Consultas que podem devolver senha ou token na resposta", ev36, {
    resumo: "Busca em tabela com campo de senha sem escolher os campos devolvidos.",
  });
  else marcar("3.6", "pendente", "Abra a aba Network do navegador e confira se as respostas não trazem campos sensíveis.");
}

// ======================================================================= 4. INFRA
log("▸ Infra e deploy");
{
  marcar("4.1", "manual");
  // 4.2 http
  const ev42 = [];
  const NAO_HTTP = /(localhost|127\.0\.0\.1|0\.0\.0\.0|example\.|exemplo|w3\.org|xmlns|schema\.org|schemas\.|\.local\b|host\.docker\.internal|10\.\d|192\.168\.|apache\.org|purl\.org|ogp\.me|json-schema)/i;
  for (const a of [...envs, ...arquivos.filter((x) => /(next|nuxt|vite|astro)\.config|vercel\.json|netlify\.toml/.test(x.rel)), ...codigoApp]) a.linhas.forEach((l, i) => {
    const m = l.match(/http:\/\/[^\s'"`)]+/);
    if (!m || NAO_HTTP.test(m[0])) return;
    if (a.env || /(baseURL|baseUrl|API_URL|apiUrl|fetch\(|axios|endpoint|url\s*[:=])/i.test(l)) ev42.push(evid(a, i));
  });
  if (ev42.length) achado("4.2", "alto", "suspeita", "URLs sem HTTPS na configuração", ev42, { resumo: "Dados trafegam sem criptografia nessas chamadas." });
  else marcar("4.2", "ok", "Nenhuma URL http:// de produção encontrada. Confirme o redirecionamento para HTTPS no domínio.");
  marcar("4.3", "manual");

  // 4.4 npm audit
  if (!SEM_AUDIT && existe("package-lock.json")) {
    log("  · npm audit (pode levar alguns segundos)");
    const r = spawnSync("npm audit --omit=dev --json", { cwd: ROOT, encoding: "utf8", timeout: 90_000, maxBuffer: 64 * 1024 * 1024, shell: true });
    try {
      const j = JSON.parse(r.stdout);
      const v = j.metadata?.vulnerabilities || {};
      const graves = (v.critical || 0) + (v.high || 0);
      const pacotes = Object.entries(j.vulnerabilities || {}).filter(([, x]) => ["critical", "high"].includes(x.severity)).slice(0, MAX_EVID)
        .map(([nome, x]) => ({ arquivo: "package.json", linha: null, trecho: `${nome} (${x.severity === "critical" ? "crítica" : "alta"})${x.fixAvailable ? " · correção disponível" : ""}` }));
      if (graves) achado("4.4", v.critical ? "alto" : "medio", "confirmado", "Dependências com vulnerabilidades graves", pacotes, {
        resumo: `npm audit (produção): ${v.critical || 0} crítica(s), ${v.high || 0} alta(s), ${v.moderate || 0} moderada(s).`,
      });
      else marcar("4.4", "ok", `npm audit (produção): nenhuma vulnerabilidade crítica ou alta${v.moderate ? `, ${v.moderate} moderada(s)` : ""}.`);
    } catch { marcar("4.4", "manual", "Não foi possível rodar o npm audit (sem internet?). Rode: npm audit --omit=dev"); }
  } else if (existe("pnpm-lock.yaml")) marcar("4.4", "manual", "Rode: pnpm audit --prod");
  else if (existe("yarn.lock")) marcar("4.4", "manual", "Rode: yarn npm audit --environment production");
  else if (reqPy) marcar("4.4", "manual", "Rode: pip-audit");
  else marcar("4.4", SEM_AUDIT ? "manual" : "nao_aplica", SEM_AUDIT ? "Auditoria desligada (--no-audit). Rode: npm audit --omit=dev" : "Nenhum gerenciador de pacotes encontrado.");

  // 4.5 CORS
  const ev45 = [], ev45c = [];
  for (const a of [...codigoApp, ...arquivos.filter((x) => /vercel\.json|netlify\.toml|next\.config|settings\.py/.test(x.rel))]) a.linhas.forEach((l, i) => {
    const aberto = /origin\s*:\s*['"`]\*['"`]|origin\s*:\s*true\b|\bcors\(\s*\)|enableCors\(\s*\)|Access-Control-Allow-Origin['"]\s*[,:]\s*['"]\*['"]|allow_origins\s*=\s*\[\s*['"]\*['"]\s*\]|CORS_ALLOW_ALL_ORIGINS\s*=\s*True|CORS_ORIGIN_ALLOW_ALL\s*=\s*True/.test(l)
      || (/"key"\s*:\s*"Access-Control-Allow-Origin"/.test(l) && /"value"\s*:\s*"\*"/.test(bloco(a, i, 2)));
    if (!aberto) return;
    (/(credentials\s*:\s*true|allow_credentials\s*=\s*True|Allow-Credentials)/i.test(a.linhas.slice(Math.max(0, i - 4), i + 6).join(" ")) ? ev45c : ev45).push(evid(a, i));
  });
  if (ev45c.length) achado("4.5", "critico", "confirmado", "CORS aberto para qualquer origem, com credenciais", ev45c, { resumo: "Qualquer site consegue fazer requisições autenticadas em nome do usuário logado." });
  if (ev45.length) achado("4.5", "alto", "confirmado", "CORS aberto para qualquer origem", ev45, { resumo: "A API aceita requisições de qualquer site." });
  if (!ev45.length && !ev45c.length) marcar("4.5", temBackend ? "ok" : "nao_aplica", "Nenhuma configuração de CORS aberta encontrada.");

  // 4.6 headers
  const apiNode = tem("express", "fastify", "@nestjs/core", "koa", "hono");
  const temHelmet = tem("helmet", "@fastify/helmet", "koa-helmet") || codigoApp.some((a) => /helmet/.test(a.texto));
  const headersManuais = arquivos.some((a) => /(X-Frame-Options|Content-Security-Policy|frame-ancestors)/i.test(a.texto));
  if (apiNode && !temHelmet && !headersManuais) achado("4.6", "medio", "confirmado", "API sem headers de segurança (helmet)", [{ arquivo: "package.json", linha: null, trecho: "helmet não está nas dependências" }]);
  else if (tem("next", "vite", "nuxt", "astro") && !headersManuais) achado("4.6", "baixo", "suspeita", "Front sem headers de segurança configurados", [], {
    resumo: "Nenhum X-Frame-Options ou Content-Security-Policy no next.config, vercel.json ou middleware.",
  });
  else marcar("4.6", "ok", "Headers de segurança encontrados.");

  // 4.7 erros vazando detalhes
  const ev47 = [], ev47c = [];
  for (const a of codigoApp) a.linhas.forEach((l, i) => {
    if (/(res\.(status\(\d+\)\.)?(json|send)\(|Response\.json\(|NextResponse\.json\(|return\s+\{|reply\.(code\(\d+\)\.)?send\()/.test(l) && /\b(err|error|e|ex|exception)\.(stack|message)\b/.test(l)) (/\.stack\b/.test(l) ? ev47c : ev47).push(evid(a, i));
    if (/^\s*DEBUG\s*=\s*True/.test(l) && /settings/.test(a.rel) && !/(dev|local|test)/i.test(a.rel)) ev47c.push(evid(a, i, { obs: "modo debug do Django" }));
    if (/\.run\([^)]*debug\s*=\s*True/.test(l)) ev47c.push(evid(a, i, { obs: "modo debug do Flask" }));
    if (/SwaggerModule\.setup\(/.test(l) && !/(NODE_ENV|isProduction|production|isDev)/.test(a.texto)) ev47.push(evid(a, i, { obs: "Swagger exposto em produção" }));
  });
  if (ev47c.length) achado("4.7", "alto", "confirmado", "Stack trace ou modo debug exposto ao usuário", ev47c);
  if (ev47.length) achado("4.7", "medio", "suspeita", "Mensagens de erro internas devolvidas na resposta", ev47, { resumo: "Mensagens do banco e de bibliotecas ajudam quem está tentando invadir." });
  if (!ev47.length && !ev47c.length) marcar("4.7", "ok", "Nenhuma resposta devolvendo stack ou mensagem interna de erro.");

  // 4.8 ambientes
  if (envs.length && !arquivos.some((a) => a.exemploEnv)) achado("4.8", "baixo", "suspeita", "Projeto sem .env.example", [], { resumo: "Sem um modelo das variáveis, é comum copiar o .env de produção para testar." });
  else marcar("4.8", "manual", "Confirme que existe um ambiente de testes com banco e chaves próprios.");
}

// ======================================================================= 5. APIS E PAGAMENTOS
log("▸ APIs, pagamentos e limites");
{
  const libRate = LIB_RATE;
  // 5.1
  if (!libRate && arquivosRota.length) achado("5.1", "medio", "confirmado", "API sem nenhum rate limit", [], {
    resumo: `${arquivosRota.length} arquivo(s) de rota e nenhuma biblioteca de rate limit no projeto.`,
  });
  else marcar("5.1", libRate ? "ok" : "nao_aplica", libRate ? "Rate limit encontrado. Confira se cobre as rotas caras." : "Nenhuma rota de API encontrada.");

  // 5.2 IA sem cota
  const RE_IA = /(from\s+['"](openai|@anthropic-ai\/sdk|@google\/generative-ai|@google\/genai|ai|@ai-sdk\/[\w-]+|groq-sdk|replicate|cohere-ai|@mistralai\/mistralai|together-ai)['"]|require\(\s*['"](openai|@anthropic-ai\/sdk|@google\/generative-ai|groq-sdk|replicate)['"]\s*\)|^\s*(from\s+(openai|anthropic)\s+import|import\s+(openai|anthropic)))/m;
  const RE_COTA = /(ratelimit|rateLimit|Ratelimit|Throttle|quota|cota|credits|creditos|créditos|usage|uso_?diario|dailyLimit|limite|maxRequests|consumirCota)/i;
  const ev52 = arquivosRota.filter((a) => RE_IA.test(a.texto) && !RE_COTA.test(a.texto)).map((a) => {
    const i = a.linhas.findIndex((l) => RE_IA.test(l)); return evid(a, Math.max(i, 0));
  });
  const usaIa = codigoApp.some((a) => RE_IA.test(a.texto));
  if (ev52.length) achado("5.2", "alto", "suspeita", "Rotas que chamam IA paga sem cota por usuário", ev52, { resumo: "Um usuário ou script pode gerar uma fatura alta chamando essas rotas em loop." });
  else marcar("5.2", usaIa ? "pendente" : "nao_aplica", usaIa ? "O projeto usa IA: confirme se as rotas que chamam o modelo têm cota por usuário." : "O projeto não chama APIs de IA.");

  // 5.3 webhooks
  const RE_VERIFICA = /(constructEvent|constructEventAsync|webhooks\.verify|verifySignature|validateSignature|verifyWebhook|validateWebhook|createHmac|timingSafeEqual|svix|new Webhook\(|stripe-signature|x-signature|x-hub-signature|hottok|x-hotmart-hottok|asaas-access-token|WEBHOOK_SECRET|WEBHOOK_TOKEN|webhookSecret|signature)/i;
  const RE_PAGTO = /(stripe|mercadopago|mercado_pago|asaas|pagarme|pagar\.me|kiwify|hotmart|paypal|pagseguro|iugu|abacatepay|efi|gerencianet|lemonsqueezy|paddle|eduzz|monetizze|pix)/i;
  const ev53c = [], ev53s = [];
  for (const a of codigoApp.filter((x) => /webhook/i.test(x.rel) || /(@Post|\.post)\(\s*['"`][^'"`]*webhook/i.test(x.texto))) {
    if (RE_VERIFICA.test(a.texto)) continue;
    const i = a.linhas.findIndex((l) => /(POST|@Post|\.post\(|export\s+default)/.test(l));
    (RE_PAGTO.test(a.texto + a.rel) ? ev53c : ev53s).push(evid(a, Math.max(i, 0)));
  }
  if (ev53c.length) achado("5.3", "critico", "confirmado", "Webhook de pagamento sem verificação de assinatura", ev53c, { resumo: "Qualquer pessoa pode simular um pagamento aprovado chamando essa rota." });
  if (ev53s.length) achado("5.3", "alto", "suspeita", "Webhook sem verificação de origem", ev53s);
  if (!ev53c.length && !ev53s.length) marcar("5.3", codigoApp.some((a) => /webhook/i.test(a.rel + a.texto)) ? "ok" : "nao_aplica", "Webhooks encontrados verificam assinatura ou token.");

  // 5.4 preço vindo do front
  const ev54 = [];
  for (const a of codigoApp) a.linhas.forEach((l, i) => {
    if (/\b(amount|price|preco|preço|valor|unit_amount|unitAmount|unit_price|total|transaction_amount)\s*:\s*(Number\(|parseFloat\(|parseInt\()?\s*(req\.body|body|input|data|dto|params|payload|values|request\.body)\.(amount|price|preco|valor|total|unit_amount|unitAmount|unit_price|transaction_amount)\b/.test(l)) ev54.push(evid(a, i));
  });
  if (ev54.length) achado("5.4", "critico", "suspeita", "Valor da cobrança vindo do front", ev54, { resumo: "Se o valor vem da requisição, o usuário troca o preço e paga quanto quiser." });
  else marcar("5.4", RE_PAGTO.test([...deps].join(" ")) ? "pendente" : "nao_aplica", "Confira se o preço e o plano são decididos no backend.");
  marcar("5.5", "manual");
}

// ======================================================================= 6. DADOS E LGPD
log("▸ Dados, LGPD e monitoramento");
{
  marcar("6.1", codigoApp.some((a) => /(pg_dump|mongodump|mysqldump|backup)/i.test(a.texto)) || arquivos.some((a) => /backup/i.test(a.rel)) ? "manual" : "manual",
    arquivos.some((a) => /backup/i.test(a.rel)) ? "Encontrei scripts de backup: confirme se rodam e se a restauração foi testada." : "");

  // 6.2 política de privacidade
  if (temFront) {
    const temPolitica = arquivos.some((a) => /(privacidade|privacy|termos|terms)/i.test(a.rel)) || codigoApp.some((a) => /href=["'`][^"'`]*(privacidade|privacy|termos|terms)/i.test(a.texto));
    if (!temPolitica) achado("6.2", "baixo", "confirmado", "Sem política de privacidade ou termos de uso", [], { resumo: "Nenhuma página ou link de privacidade e termos encontrado." });
    else marcar("6.2", "ok", "Página ou link de privacidade/termos encontrado.");
  } else marcar("6.2", "nao_aplica", "Projeto sem front-end.");

  // 6.3 exclusão de conta
  const temUsuarios = authGerenciada.length || arquivos.some((a) => /model\s+User\b|create\s+table\s+(public\.)?(users|usuarios|profiles)\b/i.test(a.texto));
  const temExclusao = codigoApp.some((a) => /(excluir[-_ ]?conta|delete[-_ ]?account|deleteAccount|excluirConta|apagarConta|apagar[-_ ]?conta|deleteUser|deleteMe|auth\.admin\.deleteUser|removeAccount|closeAccount|encerrarConta)/i.test(a.texto));
  if (temUsuarios && !temExclusao) achado("6.3", "medio", "suspeita", "Usuário não consegue excluir a própria conta", [], { resumo: "Não encontrei rota ou ação de exclusão de conta." });
  else marcar("6.3", temUsuarios ? "ok" : "nao_aplica", temUsuarios ? "Encontrei uma ação de exclusão de conta." : "Projeto sem contas de usuário.");

  // 6.4 dados sensíveis
  const RE_SENS = /\b(cpf|rg|cns|cid10|diagnostic[oa]s?|diagnosis|prontuario|prontuário|anamnese|alergias?|allerg\w*|medicament\w*|medication\w*|prescri\w*|exames?|laudos?|sintomas?|symptoms?|biometri\w*|religi\w*|etnia|ethnicity|orientacao_sexual|sexual_orientation|health\w*|saude|medical\w*|card_?number|numero_?cartao)\b/i;
  const campos = new Map();
  for (const a of arquivos.filter((x) => /\.prisma$|\.sql$|(entity|entities|models?|schemas?)\b/i.test(x.rel))) a.linhas.forEach((l, i) => {
    const m = l.match(/^\s*["`]?([A-Za-z_][\w]*)["`]?\s*[:\s]/);
    if (m && RE_SENS.test(m[1]) && !campos.has(m[1].toLowerCase())) campos.set(m[1].toLowerCase(), evid(a, i));
  });
  const criptografa = codigoApp.some((a) => /(createCipheriv|encrypt\(|pgp_sym_encrypt|pgcrypto|@47ng\/cloak|prisma-field-encryption|kms|crypto-js|AES)/i.test(a.texto)) || arquivos.some((a) => /pgcrypto|pgp_sym_encrypt/.test(a.texto));
  if (campos.size && !criptografa) achado("6.4", "alto", "suspeita", "Dados sensíveis sem criptografia de campo", [...campos.values()], {
    resumo: `Campos com dados pessoais sensíveis: ${[...campos.keys()].slice(0, 8).join(", ")}.`,
    nota: "Confirme se esses campos guardam dados sensíveis de verdade (saúde, documentos, biometria).",
  });
  else marcar("6.4", campos.size ? "ok" : "nao_aplica", campos.size ? "Campos sensíveis encontrados e há sinal de criptografia no projeto." : "Nenhum campo de dado sensível encontrado nos schemas.");

  // 6.5 logs com dados sensíveis
  const ev65 = [];
  for (const a of codigoApp) a.linhas.forEach((l, i) => {
    if (!/(console\.(log|info|debug|warn|error)|logger\.(log|info|debug|warn|error)|print)\s*\(/.test(l)) return;
    if (/\b(password|senha|token|secret|authorization|req\.body|request\.body|cpf|cartao|cardNumber|card_number|cvv|apiKey|api_key)\b/i.test(semStrings(l))) ev65.push(evid(a, i));
  });
  if (ev65.length) achado("6.5", "medio", "confirmado", "Logs gravando senha, token ou dados pessoais", ev65);
  else marcar("6.5", "ok", "Nenhum log com dados sensíveis encontrado.");

  // 6.6 monitoramento
  const temSentry = tem("@sentry/*", "@datadog/*", "newrelic", "@bugsnag/*", "logrocket", "@highlight-run/*", "rollbar", "@axiomhq/*", "@logtail/*") || temPy(/sentry/);
  const temHealth = arquivos.some((a) => /health|healthz/i.test(a.rel)) || codigoApp.some((a) => /['"`]\/?(health|healthz|status)['"`]/.test(a.texto));
  if (!temSentry && !temHealth && temBackend) achado("6.6", "baixo", "suspeita", "Sem monitoramento de erros nem rota de health check", [], { resumo: "Ninguém é avisado quando o app cai ou quebra." });
  else marcar("6.6", temSentry || temHealth ? "ok" : "nao_aplica", [temSentry && "monitoramento de erros encontrado", temHealth && "rota de health check encontrada"].filter(Boolean).join("; "));
}

// ======================================================================= 7. AGENTES
log("▸ Uso de agentes de IA");
{
  const regras = ["CLAUDE.md", "AGENTS.md", ".claude/CLAUDE.md"].map((f) => ({ f, t: ler(f) })).filter((x) => x.t);
  if (!regras.length) achado("7.1", "baixo", "confirmado", "Projeto sem CLAUDE.md ou AGENTS.md", [], { resumo: "O agente não tem regras de segurança escritas para seguir." });
  else if (!regras.some((x) => /(segredo|secret|seguran|security|\.env|credenc)/i.test(x.t))) achado("7.1", "baixo", "confirmado", "CLAUDE.md / AGENTS.md sem regras de segurança", regras.map((x) => ({ arquivo: x.f, linha: null, trecho: "nenhuma regra sobre segredos ou segurança" })));
  else marcar("7.1", "ok", "Arquivo de regras do agente menciona segurança.");

  if (!ehGit) achado("7.2", "medio", "confirmado", "Projeto sem Git", [], { resumo: "Sem histórico, não há como desfazer uma mudança ruim do agente." });
  else {
    const pend = (git(["status", "--porcelain"]) || "").split("\n").filter(Boolean).length;
    if (pend > 40) achado("7.2", "baixo", "suspeita", "Muitas mudanças sem commit", [], { resumo: `${pend} arquivo(s) alterados sem commit. Faça um commit antes de novos pedidos ao agente.` });
    else marcar("7.2", "ok", `Projeto versionado no Git${pend ? ` (${pend} arquivo(s) sem commit)` : ""}.`);
  }
  marcar("7.3", "manual");

  const settings = ler(".claude/settings.json") || "";
  const bloqueiaEnv = /Read\(\.\/\.env/.test(settings);
  if (envs.length && !bloqueiaEnv) achado("7.4", statusItem["1.5"] ? "baixo" : "medio", "suspeita", "Agente pode ler o .env do projeto", envs.slice(0, 5).map((e) => ({ arquivo: e.rel, linha: null, trecho: "arquivo de variáveis acessível ao agente" })), {
    resumo: "Nada impede o agente de ler as credenciais do .env.",
    passos: ["Adicione em .claude/settings.json: \"permissions\": { \"deny\": [\"Read(./.env)\", \"Read(./.env.*)\"] }.", "Mantenha chaves de produção fora da sua máquina."],
  });
  else marcar("7.4", envs.length ? "ok" : "nao_aplica", envs.length ? "Leitura do .env bloqueada para o agente." : "Nenhum .env no projeto.");

  const ev75 = [];
  for (const { arq, scripts } of scriptsPkg) for (const [k, v] of Object.entries(scripts)) {
    if (/^(pre|post)?install$|^prepare$/.test(k) && /(curl|wget|bash\s|sh\s-c|node\s-e|powershell|Invoke-WebRequest)/i.test(v)) ev75.push({ arquivo: arq.rel, linha: null, trecho: `"${k}": "${v.slice(0, 120)}"` });
  }
  if (ev75.length) achado("7.5", "medio", "suspeita", "Script de instalação que baixa ou executa código", ev75);
  else marcar("7.5", "manual", `O projeto tem ${deps.size} dependência(s). Confira as que você não conhece antes de instalar novas.`);
  marcar("7.6", "manual");
}

// ======================================================================= consolidação
const checklist = ITENS.map((it) => {
  const doItem = achados.filter((a) => a.id === it.id);
  const confirmados = doItem.filter((a) => a.status === "confirmado");
  let status, nota = statusItem[it.id]?.nota || "";
  if (confirmados.length) status = "falha";
  else if (doItem.length) status = "pendente";
  else status = statusItem[it.id]?.status || (it.cobertura === "manual" ? "manual" : "pendente");
  if (status === "manual" && !nota) nota = it.manual || "";
  return { id: it.id, area: AREAS[it.area], titulo: it.titulo, cobertura: it.cobertura, status, nota };
});

const ordemSev = { critico: 0, alto: 1, medio: 2, baixo: 3 };
achados.sort((a, b) => ordemSev[a.severidade] - ordemSev[b.severidade] || a.id.localeCompare(b.id, "pt-BR", { numeric: true }));
achados.forEach((a, i) => { a.codigo = `SS-${String(i + 1).padStart(2, "0")}`; });

let nomeProjeto = path.basename(ROOT);
try { nomeProjeto = JSON.parse(ler("package.json")).name || nomeProjeto; } catch { /* sem package.json */ }

const saida = {
  versao: 1,
  ferramenta: "saas-seguro by @andrevale.dev",
  projeto: {
    nome: nomeProjeto, raiz: ROOT, stack, arquivosAnalisados: arquivos.length,
    git: ehGit, data: new Date().toISOString(), duracaoSegundos: Math.round((Date.now() - t0) / 1000),
  },
  revisado: false,
  achados,
  checklist,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(saida, null, 2));

// ---------------------------------------------------------------- resumo no terminal
const cont = (s) => achados.filter((a) => a.severidade === s).length;
const pend = achados.filter((a) => a.status === "suspeita").length;
log("");
log(`Concluído em ${saida.projeto.duracaoSegundos}s · stack: ${stack.join(", ") || "não identificada"}`);
log(`Achados: ${achados.length}  (crítico ${cont("critico")} · alto ${cont("alto")} · médio ${cont("medio")} · baixo ${cont("baixo")})`);
log(`Suspeitas para o agente confirmar: ${pend}`);
log(`Itens para revisão manual do agente: ${checklist.filter((c) => c.status === "pendente").length}`);
log(`Arquivo: ${path.relative(ROOT, OUT) || OUT}`);
