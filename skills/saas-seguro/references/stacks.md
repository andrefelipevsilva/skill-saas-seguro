# Onde procurar em cada stack

Mapa rápido para a revisão manual: onde ficam as rotas, a autenticação, o banco e as configurações sensíveis em cada stack comum de SaaS feito com vibe coding.

Use `rg` (ripgrep) ou `grep -rn` para listar, sempre ignorando `node_modules`, `.next`, `dist` e `build`.

---

## Next.js (App Router)

- **Rotas de API:** `app/**/route.ts` (ou `src/app/**/route.ts`). Cada `export async function GET/POST/PUT/PATCH/DELETE` é um endpoint público.
- **Server Actions:** arquivos ou funções com `"use server"`. São endpoints públicos chamáveis por qualquer um: cada ação precisa checar o usuário e validar a entrada.
- **Proteção global:** `middleware.ts` na raiz ou em `src/`. Confira o `matcher`: ele cobre `/api/*`? Middleware que só redireciona páginas não protege rotas de API chamadas direto.
- **Componentes de cliente:** arquivos com `"use client"` rodam no navegador. Nada de segredos, service role ou consultas privilegiadas ali.
- **Variáveis:** `NEXT_PUBLIC_*` vão para o navegador.
- **Headers:** `next.config.(js|mjs|ts)` → `async headers()`.
- **Listar rotas:** `rg -l "export (async )?function (GET|POST|PUT|PATCH|DELETE)" app src/app`

## Next.js (Pages Router)

- **Rotas de API:** `pages/api/**`. Cada arquivo exporta um `handler(req, res)`.
- **getServerSideProps:** roda no servidor, mas o que ele retorna em `props` vai para o navegador. Confira se não devolve campos sensíveis.

## NestJS

- **Rotas:** `*.controller.ts` (`@Controller`, `@Get`, `@Post`...).
- **Autenticação:** guard global (`APP_GUARD` no `app.module.ts`) ou `@UseGuards` por controller/método. Decorator `@Public()` marca exceções.
- **Validação:** `main.ts` → `app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))` e DTOs com class-validator.
- **Segurança da app:** `main.ts` → `helmet()`, `enableCors({ origin: [...] })`, Swagger só fora de produção.
- **Rate limit:** `ThrottlerModule` + `ThrottlerGuard`.
- **Posse do recurso:** services (`*.service.ts`) com `findOne`, `update`, `remove` recebendo `id` sem o usuário.

## Express / Fastify / Hono

- **Rotas:** `app.get/post/...`, `router.get/post/...`, normalmente em `routes/` ou `src/routes/`.
- **Autenticação:** middleware aplicado com `app.use(auth)` antes das rotas, ou por rota (`router.get('/x', auth, handler)`).
- **Segurança:** `helmet`, `cors({ origin })`, `express-rate-limit`, `express.json({ limit: '1mb' })`.

## Supabase

- **Front fala direto com o banco** usando a anon key. A proteção real é a **RLS** (Row Level Security).
- **Migrations:** `supabase/migrations/*.sql`. Cada `create table` precisa de `alter table ... enable row level security` e de policies.
- **Service role:** só em código de servidor (rotas de API, Edge Functions). Nunca com `NEXT_PUBLIC_` ou em `"use client"`.
- **Storage:** buckets públicos expõem arquivos para qualquer um com a URL.
- **Edge Functions:** `supabase/functions/*/index.ts` — confira se verificam o JWT do usuário.
- **Verificar RLS sem migrations:** `select tablename, rowsecurity from pg_tables where schemaname = 'public';`

## Firebase

- **Regras:** `firestore.rules`, `storage.rules`, `database.rules.json`. Procure `allow read, write: if true` e `if request.time < timestamp.date(...)` (modo de teste que expira, mas abre tudo até lá).
- **Chave web (`AIza...`):** é pública por design. A segurança vem das regras e da restrição de domínio da chave.
- **Admin SDK:** `firebase-admin` só no servidor; a credencial de serviço nunca vai para o repositório.

## Prisma / Drizzle / TypeORM / Mongoose

- **Prisma:** `schema.prisma` (modelos e campos sensíveis), consultas `prisma.<modelo>.findUnique/findFirst/update/delete`. `$queryRawUnsafe` é perigoso; `$queryRaw\`...\`` é seguro.
- **Drizzle:** `db.select().from(tabela).where(eq(tabela.id, id))` — confira se há `and(eq(tabela.userId, user.id))`.
- **TypeORM:** entidades com `@Column({ select: false })` para senha; `findOneBy({ id })`.
- **Mongoose:** `findById(req.params.id)`; `find(req.body)` permite injeção NoSQL; senha com `select: false` no schema.

## Pagamentos

- **Stripe:** webhook com `stripe.webhooks.constructEvent(rawBody, sig, secret)`; preço via `price` (ID do Stripe) decidido no servidor.
- **Mercado Pago:** valide o header `x-signature` do webhook e consulte o pagamento pela API antes de liberar.
- **Asaas:** confira o token de autenticação do webhook (`asaas-access-token`).
- **Hotmart / Kiwify:** valide o token ou a assinatura enviados pela plataforma no webhook.

## Python (Django / FastAPI / Flask)

- **Django:** `settings.py` (`DEBUG`, `SECRET_KEY`, `ALLOWED_HOSTS`, `CORS_ALLOW_ALL_ORIGINS`), `urls.py` + views (`@login_required`, permissões do DRF), `raw()` e `cursor.execute` com f-string.
- **FastAPI:** rotas com `Depends(get_current_user)`; `CORSMiddleware(allow_origins=["*"])`; modelos Pydantic validam a entrada.
- **Flask:** `@login_required`, `app.run(debug=True)`, `flask-limiter`, `flask-cors`.

## Apps mobile (React Native / Expo)

- Tudo que está no app pode ser extraído do pacote: nenhuma chave secreta no código, nem em `EXPO_PUBLIC_*`.
- Tokens no `SecureStore`, não no `AsyncStorage`.
- A segurança fica no backend (as mesmas regras de rotas, posse e validação valem).

## Hospedagem

- **Vercel:** variáveis por ambiente (Production, Preview, Development), Deployment Protection para previews, Spend Management para alertas de gasto.
- **VPS:** SSH só por chave, firewall (ufw), fail2ban, Docker sem publicar portas de banco, Cloudflare na frente.
- **Render / Railway / Fly:** variáveis de ambiente no painel, banco privado na rede interna do provedor.
