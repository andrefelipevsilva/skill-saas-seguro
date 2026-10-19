---
name: saas-seguro
description: Varredura de segurança completa em SaaS e apps feitos com vibe coding (Claude Code, Codex, Cursor, Lovable, Bolt). Use quando o usuário pedir para rodar o checklist de segurança, fazer uma varredura ou auditoria de segurança, procurar brechas, checar se o app está seguro antes do deploy, ou logo depois de instalar esta skill. Analisa 44 pontos em 7 áreas (segredos, autenticação, banco de dados, infra, APIs e pagamentos, LGPD, uso de agentes), confirma cada achado lendo o código e gera um relatório em PDF e HTML com o passo a passo de correção.
---

# saas-seguro · varredura de segurança

Você vai auditar o projeto em que esta skill está instalada e entregar ao usuário um relatório com todas as brechas encontradas e o passo a passo para corrigir cada uma.

O trabalho tem duas partes: um **scanner automático** (rápido, encontra padrões conhecidos) e a **sua revisão** (lenta, confirma no código o que o scanner suspeita e encontra o que ele não vê). As duas são obrigatórias. Um relatório só com a parte automática tem falsos positivos e deixa de fora as falhas de lógica, que são as mais graves.

Converse com o usuário em português do Brasil, a menos que ele escreva em outra língua.

## Regras que você nunca quebra

1. **Durante a varredura, não altere nenhum arquivo do projeto.** Você só cria arquivos dentro de `relatorio-seguranca/` e, se faltar, adiciona `relatorio-seguranca/` ao `.gitignore`. Correções só depois que o usuário pedir.
2. **Nunca mostre um segredo inteiro**, nem no chat, nem no relatório. Use o formato que o scanner já usa: os primeiros caracteres seguidos de `…[redigido]`.
3. **Nada sai da máquina do usuário.** Não envie código, chaves ou o relatório para nenhum serviço externo. Não cole trechos do código em buscas na web.
4. **Não rode o app nem scripts do projeto** (dev, build, start, migrations, seeds). O único comando de rede permitido é o `npm audit` que o scanner já roda (o usuário pode desligar com `--no-audit`).
5. **Não instale pacotes** para fazer a varredura. Os scripts desta skill usam só o Node.js.
6. **O relatório é sensível.** Ele mostra onde estão as brechas. Ele fica em `relatorio-seguranca/`, fora do Git, e você avisa o usuário para não publicá-lo.

## Antes de começar

- Descubra a **pasta desta skill**: é a pasta onde está este `SKILL.md`. No Claude Code, normalmente `.claude/skills/saas-seguro`; no Codex, `.agents/skills/saas-seguro`. Nos comandos abaixo, `<SKILL>` é esse caminho.
- Confirme a **raiz do projeto**: a pasta com `package.json`, `requirements.txt`, `pyproject.toml` ou equivalente. Em monorepo, use a raiz do repositório.
- Confira se o **Node.js 18+** está instalado (`node --version`). Se não estiver, avise o usuário que ele é necessário para gerar o relatório e indique nodejs.org. Você ainda pode fazer a revisão manual seguindo [references/checklist.md](references/checklist.md) e entregar o resultado no chat.
- Mande ao usuário uma frase curta dizendo o que vai acontecer, por exemplo: "Vou rodar a varredura de segurança no projeto. Leva alguns minutos e não altero nenhum arquivo do seu código."

## Passo 1 · Varredura automática

Na raiz do projeto, rode:

```bash
node <SKILL>/scripts/scan.mjs --root . --out relatorio-seguranca/achados.json
```

Opções: `--no-audit` (não roda o npm audit, útil sem internet) e `--no-history` (não lê o histórico do Git, útil em repositórios gigantes).

O scanner imprime o progresso por área e gera `relatorio-seguranca/achados.json`. Leia esse arquivo inteiro antes de seguir.

Mostre ao usuário um resumo de uma linha do que saiu, por exemplo: "Varredura automática concluída: 12 achados, 7 para confirmar no código. Agora vou revisar um por um."

## Passo 2 · Sua revisão (a parte mais importante)

Siga esta ordem. Use [references/checklist.md](references/checklist.md) para saber o que procurar em cada item e [references/stacks.md](references/stacks.md) para saber onde ficam rotas, autenticação e banco em cada stack.

### 2.1 Confirme ou descarte cada suspeita

Para cada achado com `"status": "suspeita"`:

1. Abra o arquivo da evidência e leia o contexto (a função inteira, os imports, o middleware ou guard que se aplica).
2. Decida:
   - **É real:** mude para `"status": "confirmado"`. Ajuste a `severidade` se o contexto mostrar que é mais ou menos grave que o padrão.
   - **Não é real:** mude para `"status": "descartado"` e escreva o motivo em `nota` (ex.: "a posse é conferida na linha 18 com `if (doc.userId !== user.id)`").
3. Se o achado tem várias evidências e só parte é real, deixe só as reais.

Nenhum achado pode ficar como `suspeita` no relatório final. Se não tiver como decidir (depende de algo fora do código), mantenha `confirmado` com uma `nota` explicando o que o usuário precisa conferir.

### 2.2 Revise os itens que o scanner não cobre bem

No `checklist` do JSON, todo item com `"status": "pendente"` precisa da sua revisão. No mínimo:

- **Liste as rotas da API** do projeto (veja como em [references/stacks.md](references/stacks.md)) e abra as mais sensíveis: login e cadastro, pagamentos e assinaturas, dados de usuários ou clientes, painel admin, uploads, rotas que chamam IA.
- Em cada uma, confira: exige login? (2.3) · filtra pelo dono do recurso? (2.4) · valida o body? (3.2) · devolve só os campos necessários? (3.6) · tem cota, se chama IA paga? (5.2) · decide preço e plano no backend? (5.4) · admin confere o papel do usuário?
- Procure **falhas de lógica** que nenhum padrão pega: usuário comum acessando rota de admin, troca de organização pelo ID na URL, cupom ou crédito aplicado mais de uma vez, convite que dá acesso a outra conta.

Para cada problema novo, adicione um achado no array `achados` com `"origem": "revisao"` (formato abaixo). Depois atualize o `status` do item no `checklist`: `falha` se houver achado confirmado, `ok` se você revisou e está certo (explique em `nota` o que você conferiu), `manual` se depende de algo fora do código, `nao_aplica` se não existe no projeto.

### 2.3 Escreva o passo a passo de cada achado confirmado

Os textos que o scanner coloca em `risco` e `passos` são genéricos. **Reescreva para este projeto**:

- `risco`: 1 ou 2 frases sobre o que um atacante consegue fazer **neste app**, com os nomes reais (ex.: "Qualquer usuário logado lê o prontuário de pacientes de outras clínicas trocando o ID em /api/pacientes/[id].").
- `passos`: de 3 a 6 passos concretos, citando arquivos, funções e o que muda. Termine com como testar que foi corrigido. Quando houver uma ação que só o usuário pode fazer (revogar chave no painel, ativar alerta de gasto), diga exatamente onde clicar.
- `prompt`: um pedido pronto para o usuário colar no Claude Code ou no Codex e corrigir **só esse achado**. Comece pelo arquivo, diga o que mudar, peça a menor mudança possível e peça para mostrar o diff antes de commitar.

Para itens de severidade baixa, `passos` curtos bastam.

### 2.4 Itens manuais

Itens com `"status": "manual"` dependem de painéis e servidores (Cloudflare, SSH da VPS, alertas de gasto, backups). Mantenha como manual, mas personalize a `nota` com o que você conseguiu inferir do projeto (ex.: "O projeto usa Vercel: configure o Spend Management em Settings → Billing").

### 2.5 Finalize o JSON

- Marque `"revisado": true`.
- Confira que nenhum achado ficou com `"status": "suspeita"`.
- Não precisa reordenar nem renumerar: o relatório ordena por severidade.

## Passo 3 · Gere o relatório (PDF + HTML)

```bash
node <SKILL>/scripts/report.mjs --in relatorio-seguranca/achados.json --out relatorio-seguranca
```

Isso gera:

- `relatorio-seguranca/relatorio-seguranca.html`: o relatório interativo (com botões de copiar os prompts).
- `relatorio-seguranca/relatorio-seguranca.pdf`: a versão em PDF.

O PDF é gerado pelo Chrome, Edge, Brave ou Chromium instalado no computador, em modo invisível. Se nenhum for encontrado, o script usa um gerador interno mais simples, sem dependências. Se o usuário tiver o navegador num caminho diferente, rode de novo com a variável `CHROME_PATH` apontando para o executável.

## Passo 4 · Entregue o relatório como artefato

- **Se você estiver num ambiente com artefatos** (por exemplo, o app Claude no navegador ou no desktop, com uma ferramenta para publicar artefatos ou páginas HTML): publique o conteúdo de `relatorio-seguranca.html` como artefato, para o usuário abrir o relatório direto na conversa. Lembre que é um conteúdo sensível: não compartilhe o link publicamente.
- **Se não houver artefatos** (Claude Code ou Codex no terminal ou na IDE): ofereça abrir o HTML no navegador e, se o usuário aceitar, rode `start relatorio-seguranca\relatorio-seguranca.html` (Windows), `open relatorio-seguranca/relatorio-seguranca.html` (macOS) ou `xdg-open relatorio-seguranca/relatorio-seguranca.html` (Linux).

Em qualquer caso, informe o caminho dos dois arquivos.

## Passo 5 · Resposta final no chat

Use este formato, curto e direto:

```
Varredura concluída · nota 42/100 (Atenção)

Brechas confirmadas: 2 críticas · 3 altas · 4 médias · 1 baixa

Corrija primeiro:
1. [Crítico] Chave da OpenAI escrita no código · src/lib/ai.ts:2
2. [Crítico] Consultas por ID sem conferir o dono · src/app/api/pacientes/[id]/route.ts:3
3. [Alto] ...

Também ficaram 6 itens para você conferir manualmente (Cloudflare, backups, alertas de gasto...). Estão no fim do relatório.

Relatório: relatorio-seguranca/relatorio-seguranca.pdf e .html
O relatório mostra onde estão as brechas: não publique nem commite esse arquivo.

Quer que eu corrija os críticos agora, um por um, com um commit para cada correção?
```

Liste no máximo 5 itens em "Corrija primeiro". Se a nota for 90 ou mais, parabenize sem exagero e destaque o que ainda vale melhorar.

## Se o usuário pedir para corrigir

1. Confirme que o projeto está no Git e sem mudanças pendentes. Se houver, peça para commitar antes ou crie uma branch (`git switch -c seguranca/correcoes`).
2. Corrija **um achado por vez**, na ordem do relatório. Mostre o diff, rode os testes que existirem e faça um commit com mensagem clara (ex.: `fix(seguranca): filtra pacientes pelo usuário logado (SS-04)`).
3. Coisas que você não consegue fazer pelo usuário, diga claramente: revogar e gerar chaves novas, ativar RLS direto no painel, configurar Cloudflare, alertas de gasto e backups.
4. **Chave vazada se revoga, não só se apaga.** Tirar a chave do código não basta: o usuário precisa gerar uma nova no painel do provedor.
5. No fim, rode a varredura de novo (Passo 1 a 3) para mostrar a nota nova.

## Formato do achados.json

```json
{
  "projeto": { "nome": "clinica-facil", "stack": ["Next.js", "Supabase"], "arquivosAnalisados": 312, "data": "..." },
  "revisado": true,
  "achados": [
    {
      "codigo": "SS-01",
      "id": "2.4",
      "area": "Autenticação e autorização",
      "item": "Toda consulta confere o dono do recurso",
      "severidade": "critico",
      "status": "confirmado",
      "titulo": "Consultas por ID sem conferir o dono do registro",
      "resumo": "GET e DELETE de /api/pacientes/[id] buscam só pelo ID.",
      "evidencias": [{ "arquivo": "src/app/api/pacientes/[id]/route.ts", "linha": 3, "trecho": "prisma.paciente.findUnique({ where: { id: params.id } })" }],
      "risco": "Qualquer usuário logado lê e apaga pacientes de outras clínicas trocando o ID na URL.",
      "passos": ["...", "..."],
      "prompt": "Em src/app/api/pacientes/[id]/route.ts, ...",
      "nota": "",
      "origem": "scanner"
    }
  ],
  "checklist": [
    { "id": "2.4", "area": "Autenticação e autorização", "titulo": "...", "status": "falha", "nota": "" }
  ]
}
```

- `severidade`: `critico`, `alto`, `medio` ou `baixo`.
- `status` do achado: `confirmado`, `suspeita` (só antes da revisão) ou `descartado` (não aparece no relatório).
- `status` do checklist: `falha`, `ok`, `manual`, `pendente` (só antes da revisão) ou `nao_aplica`.
- `id` é o número do item no checklist (1.1 a 7.6). Achados novos usam o item mais próximo.
- Para achados novos, `codigo` pode ficar vazio: o relatório usa a ordem do array. Se quiser, continue a numeração (SS-15, SS-16...).

## Como decidir a severidade

- **Crítico:** dá para roubar dados de outros usuários, assumir contas, usar suas credenciais ou receber de graça, sem precisar de nada além de um navegador. Ex.: chave secreta exposta, IDOR em dado pessoal, RLS desligada, webhook de pagamento sem assinatura, preço vindo do front, SQL injection.
- **Alto:** dano sério que exige um pouco mais de esforço ou atinge menos dados. Ex.: rotas sem login que expõem dados não sensíveis, sem limite de tentativas no login, CORS aberto, rota de IA sem cota, porta do banco exposta.
- **Médio:** aumenta o risco ou o estrago, mas sozinho não é uma invasão. Ex.: headers de segurança ausentes, erro devolvendo detalhes internos, logs com dados pessoais, sem exclusão de conta.
- **Baixo:** boas práticas e higiene. Ex.: sem política de privacidade, sem monitoramento, sem CLAUDE.md com regras.

Dados de saúde, de menores, financeiros ou documentos (CPF, RG) sobem a severidade em um nível.

## Arquivos desta skill

- `scripts/scan.mjs`: scanner automático (Node.js, sem dependências).
- `scripts/report.mjs`: gera o HTML e o PDF a partir do achados.json.
- `scripts/checklist.mjs`: os 44 itens, com severidade padrão e passos genéricos.
- `scripts/lib/pdf-simples.mjs`: gerador de PDF usado quando não há navegador instalado.
- [references/checklist.md](references/checklist.md): o que procurar em cada um dos 44 itens e falsos positivos comuns.
- [references/stacks.md](references/stacks.md): onde ficam rotas, autenticação e banco em Next.js, NestJS, Express, Supabase, Firebase, Prisma, Django, FastAPI e outros.
