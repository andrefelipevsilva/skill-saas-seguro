# Checklist de segurança · o que procurar em cada item

Guia de revisão para o agente. Para cada um dos 44 itens: o que procurar no código, como confirmar e os falsos positivos mais comuns. A severidade entre parênteses é o padrão; ajuste pelo contexto (dados de saúde, de menores, financeiros ou documentos sobem um nível).

Legenda de cobertura do scanner: **automática** (confiável), **heurística** (aponta suspeitas, você confirma), **manual** (fora do código).

---

## 1. Segredos e chaves

### 1.1 Chaves, senhas e tokens escritos no código (crítico · automática)
- **Procure:** strings com prefixos de chaves (`sk-`, `sk_live_`, `rk_live_`, `whsec_`, `AKIA`, `ghp_`, `github_pat_`, `xox`, `SG.`, `APP_USR-`, `$aact_`, `re_`), blocos `-----BEGIN PRIVATE KEY-----`, JWTs do Supabase com `"role":"service_role"`, URLs de banco com senha (`postgres://user:senha@host`), e atribuições como `apiKey: "..."`, `password = "..."`.
- **Confirme:** o valor é real (não é placeholder, exemplo de documentação ou valor de teste óbvio)?
- **Falsos positivos:** chaves `AIza...` do Firebase Web (são públicas por design, desde que restritas por domínio); `pk_live_`/`pk_test_` do Stripe (publicáveis); anon key do Supabase; valores em arquivos de fixture claramente falsos.

### 1.2 Arquivo .env fora do Git (crítico · automática)
- **Procure:** `git ls-files | grep env` (qualquer `.env` que não seja `.example`/`.sample`), e se `git check-ignore .env` retorna o arquivo.
- **Confirme:** o arquivo rastreado tem valores reais?

### 1.3 Histórico do Git sem segredos (crítico · automática)
- **Procure:** o scanner lê os últimos 400 commits. Se o repositório for maior, sugira `gitleaks git -v .`.
- **Lembre:** a correção começa revogando a chave. Reescrever histórico é opcional e perigoso em repositório compartilhado.

### 1.4 Segredos fora das variáveis públicas (crítico · automática)
- **Procure:** variáveis `NEXT_PUBLIC_*`, `VITE_*`, `EXPO_PUBLIC_*`, `REACT_APP_*`, `NUXT_PUBLIC_*`, `PUBLIC_*` com nomes ou valores de segredo (SECRET, SERVICE_ROLE, PRIVATE, TOKEN, chaves `sk_`). Também `SERVICE_ROLE` usado em arquivos com `"use client"` ou em projetos só de front (Vite/CRA).
- **Falsos positivos:** `NEXT_PUBLIC_SUPABASE_ANON_KEY`, chaves publicáveis, IDs de analytics.

### 1.5 Chaves separadas para dev e produção (médio · heurística)
- **Procure:** chaves de produção (`sk_live_`, `APP_USR-`) em `.env`, `.env.local`, `.env.development`.
- **Confirme com o usuário:** se esse `.env` é só da máquina dele, ele está usando produção para testar.

### 1.6 Menor permissão por chave (baixo · manual)
- Liste as chaves que o projeto usa (pelas variáveis de ambiente) para o usuário revisar no painel de cada provedor.

---

## 2. Autenticação e autorização

### 2.1 Login com biblioteca consolidada (alto · heurística)
- **Procure:** `Math.random()` gerando token, código de verificação, link de recuperação ou convite; `jwt.sign` espalhado sem um módulo central; tabela de sessões própria.
- **Bom sinal:** Supabase Auth, Clerk, Auth.js, Better Auth, Firebase Auth, `@nestjs/passport` + `@nestjs/jwt`.

### 2.2 Senhas com hash forte (crítico · heurística)
- **Procure:** campo `password`/`senha` gravado direto do body; `createHash('md5'|'sha1'|'sha256')` perto de senha; comparação com `===`.
- **Confirme:** procure `bcrypt`, `argon2`, `scrypt` no fluxo de cadastro e login. Se a autenticação é de um provedor (Supabase, Clerk, Firebase), não se aplica.

### 2.3 Toda rota exige login por padrão (alto · heurística)
- **Procure:** handlers de rota sem checagem de usuário. Next.js: `app/**/route.ts`, `pages/api/**`, Server Actions (`"use server"`). NestJS: controllers sem `@UseGuards` e sem `APP_GUARD` global. Express: rotas sem middleware de auth.
- **Confirme:** existe um `middleware.ts` (Next) ou guard global que cubra a rota? A rota é pública de propósito (landing, webhook, health, login)?
- **Atenção:** Server Actions são endpoints públicos: cada uma precisa checar o usuário.

### 2.4 Toda consulta confere o dono do recurso · IDOR (crítico · heurística)
- **Procure:** `findUnique({ where: { id } })`, `findById(req.params.id)`, `findByPk`, `update/delete` por ID, `.eq('id', id)` sem filtro de `userId`, `organizationId`, `tenantId`, `clinicaId` ou equivalente.
- **Confirme:** a posse é conferida depois da busca (`if (doc.userId !== user.id)`)? A tabela tem RLS ativa (Supabase)? Se não, é crítico.
- **Teste mental:** "logado como A, se eu trocar o ID na URL pelo de B, o que acontece?"

### 2.5 Supabase com RLS e Firebase com regras (crítico · automática)
- **Procure:** tabelas criadas nas migrations sem `enable row level security`; policies `using (true)` em tabelas com dados de usuário; regras do Firebase com `allow read, write: if true` ou `if request.time < ...` (modo de teste).
- **Sem migrations no repositório:** peça ao usuário para rodar no SQL Editor: `select tablename, rowsecurity from pg_tables where schemaname = 'public';`

### 2.6 Sessão em cookie protegido, token com expiração (alto · heurística)
- **Procure:** `localStorage.setItem('token'...)`, cookies de sessão sem `httpOnly: true`, `jwt.sign` sem `expiresIn`.

### 2.7 Limite de tentativas no login (alto · heurística)
- **Procure:** bibliotecas de rate limit (`@nestjs/throttler`, `express-rate-limit`, `@upstash/ratelimit`, `rate-limiter-flexible`) aplicadas nas rotas de login, cadastro e recuperação.
- **Não se aplica:** login feito por provedor que já limita (Supabase Auth, Clerk, Firebase Auth).
- **Também confira:** a recuperação de senha responde a mesma mensagem exista ou não o e-mail? O link expira?

---

## 3. Banco de dados e entradas

### 3.1 Sem SQL concatenado (crítico · automática)
- **Procure:** `$queryRawUnsafe`, `$executeRawUnsafe`, `.query(\`... ${x}\`)`, `.query('...' + x)`, `knex.raw` com template, `cursor.execute(f"...")`, `find(req.body)` no Mongo (injeção NoSQL).
- **Falsos positivos:** `prisma.$queryRaw\`...${x}\`` (tagged template é parametrizado), `sql\`...\`` do Drizzle/postgres.js.

### 3.2 Toda entrada validada no backend (alto · heurística)
- **Procure:** rotas que usam `req.body` / `await req.json()` sem schema (zod, class-validator, yup); NestJS sem `ValidationPipe` global com `whitelist: true`; `create({ data: body })` (mass assignment); campos como `role`, `plano`, `isAdmin` vindos do body.

### 3.3 Uploads seguros (alto · heurística)
- **Procure:** `multer` sem `limits`, `FileInterceptor` sem `ParseFilePipe`, nome original do arquivo usado no caminho, arquivos gravados em `public/`, buckets públicos com dados de usuários, aceitação de `.html` e `.svg`.

### 3.4 Banco sem acesso público (alto · automática)
- **Procure:** `ports: "5432:5432"` (ou 3306, 27017, 6379) no docker-compose sem `127.0.0.1:`.
- **Manual:** em banco gerenciado, a restrição de IP fica no painel do provedor.

### 3.5 Usuário do banco sem poder de administrador (médio · heurística)
- **Procure:** `DATABASE_URL` com usuário `postgres`, `root`, `sa` ou `admin` apontando para um host de produção.

### 3.6 Respostas só com os campos necessários (médio · heurística)
- **Procure:** consultas em tabelas com senha/token sem `select`/`omit`; `return user` / `res.json(user)` do objeto inteiro; colunas de senha sem `select: false` (TypeORM, Mongoose).

---

## 4. Infra e deploy

### 4.1 Proxy com WAF (médio · manual)
- Pergunte ou deduza onde o app está hospedado. Vercel e Netlify já têm uma borda com proteção básica; VPS precisa de Cloudflare (proxy ativo, SSL Full strict, WAF).

### 4.2 HTTPS em tudo (alto · heurística)
- **Procure:** URLs `http://` de produção em `.env`, configs, `baseURL`, `success_url`, chamadas `fetch`.
- **Falsos positivos:** `localhost`, IPs internos, namespaces XML.

### 4.3 SSH por chave e firewall (alto · manual)
- Só se aplica a VPS. Passe os comandos de verificação: `sudo sshd -T | grep -E "passwordauthentication|permitrootlogin"` e `sudo ufw status`.

### 4.4 Dependências sem vulnerabilidades graves (médio · automática)
- O scanner roda `npm audit --omit=dev` quando há `package-lock.json`. Para pnpm, yarn e Python, passe o comando equivalente.

### 4.5 CORS restrito (alto · automática)
- **Procure:** `origin: '*'`, `origin: true`, `cors()` sem opções, `enableCors()` sem opções, `allow_origins=["*"]`, header `Access-Control-Allow-Origin: *`. Com `credentials: true` junto, é crítico.

### 4.6 Headers de segurança (médio · heurística)
- **Procure:** `helmet` na API (Express/Nest/Fastify); `headers()` no `next.config`, `vercel.json` ou middleware com `X-Frame-Options`, `X-Content-Type-Options`, `Content-Security-Policy`.

### 4.7 Erros sem detalhes internos (médio · heurística)
- **Procure:** respostas com `err.stack` ou `err.message`, `DEBUG = True` (Django), `app.run(debug=True)` (Flask), Swagger exposto em produção sem proteção.

### 4.8 Produção separada de testes (baixo · heurística)
- **Procure:** `.env.example`, ambientes separados, seeds com dados fictícios. Pergunte ao usuário se existe homologação.

---

## 5. APIs, pagamentos e limites

### 5.1 Rate limiting na API (médio · heurística)
- **Procure:** biblioteca de rate limit configurada globalmente. Atrás da Cloudflare, o IP do visitante vem em `cf-connecting-ip`.

### 5.2 IA paga com cota (alto · heurística)
- **Procure:** rotas que importam `openai`, `@anthropic-ai/sdk`, `@google/genai`, `ai` (Vercel AI SDK) e similares, sem login, sem cota por usuário e sem limite de tamanho da entrada.

### 5.3 Webhooks com assinatura verificada (crítico · heurística)
- **Procure:** rotas de webhook que processam o evento sem `stripe.webhooks.constructEvent`, HMAC (`createHmac` + `timingSafeEqual`), token do provedor (`hottok` da Hotmart, token do Asaas, assinatura do Mercado Pago e da Kiwify) ou consulta do pagamento na API do provedor.
- **Também confira:** idempotência (o mesmo evento processado duas vezes libera duas vezes?).

### 5.4 Preço e plano decididos no backend (crítico · heurística)
- **Procure:** `amount`, `price`, `unit_amount`, `valor` vindos do body no checkout; liberação de recurso pago checando só o front; plano gravado a partir do body.

### 5.5 Alertas de gasto (baixo · manual)
- Liste os serviços pagos detectados (hospedagem, IA, banco, e-mail) para o usuário configurar alertas.

---

## 6. Dados, LGPD e monitoramento

### 6.1 Backup testado (médio · manual)
- Procure scripts de backup (`pg_dump`, workflows agendados). Pergunte onde fica o último backup e quando a restauração foi testada.

### 6.2 Política de privacidade e termos (baixo · heurística)
- **Procure:** páginas ou links de privacidade e termos no front, e link no cadastro.

### 6.3 Exclusão de conta (médio · heurística)
- **Procure:** rota ou ação de exclusão de conta pelo próprio usuário.

### 6.4 Dados sensíveis protegidos (alto · heurística)
- **Procure:** campos de saúde (diagnóstico, prontuário, CID, exames, medicamentos), documentos (CPF, RG), biometria, religião, etnia, dados de menores. Confira criptografia de campo, controle de acesso por perfil e log de acesso.

### 6.5 Logs sem dados sensíveis (médio · automática)
- **Procure:** `console.log` / `logger` com senha, token, `req.body`, CPF, cartão.

### 6.6 Monitoramento (baixo · heurística)
- **Procure:** Sentry (ou similar) e rota `/health`.

---

## 7. Uso de agentes de IA

### 7.1 Regras no CLAUDE.md / AGENTS.md (baixo · automática)
- **Procure:** arquivo de regras do agente com orientações de segurança. Se faltar, sugira um bloco curto com as regras que esta varredura mostrou serem necessárias.

### 7.2 Projeto no Git (médio · automática)
- **Procure:** repositório Git e quantidade de mudanças sem commit.

### 7.3 Diff revisado (baixo · manual)
- Hábito do usuário. Só oriente.

### 7.4 Agente sem credenciais de produção (médio · heurística)
- **Procure:** `.env` com chaves de produção na máquina e ausência de `"deny": ["Read(./.env)", "Read(./.env.*)"]` em `.claude/settings.json`.

### 7.5 Pacotes conferidos (baixo · heurística)
- **Procure:** scripts `preinstall`/`postinstall` que baixam ou executam código; dependências com nomes estranhos ou muito parecidos com pacotes famosos.

### 7.6 Revisão antes do deploy (baixo · manual)
- Recomende rodar esta skill antes de cada deploy importante.
