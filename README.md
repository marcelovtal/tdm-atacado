# Gerenciamento de Dados de Teste - VTAL

Ferramenta interna para **geração de massa de testes QA**, permitindo que QAs executem os scripts do projeto VTAL pela interface web, sem linha de comando.

## Funcionalidades

- **Ambiente**: TI ou TRG
- **Tipo de massa**:
  - Lead → Pedido (fluxo completo até criação do pedido)
  - Conta até Ativação BRM (Lead → conta Billing/Business ativa no BRM)
- **Quantidade**: 1, 5 ou 10 execuções
- **Fila de jobs**: execução assíncrona com controle de concorrência, logs e retentativas
- **Dashboard**: listagem de jobs com status, horário e resultado:
  - Fluxo Lead → Pedido: `OrderId`, `OrderNumber`, `Status`
  - Fluxo Conta até Ativação BRM: `AccountBillingId`, `AccountBusinessId`, `AccountOrganizationId`, `ContactTecnicoId`
- **Detalhes**: logs da execução e erros por job

## Pré-requisitos

- **Node.js** 18+
- **Redis** (opcional em desenvolvimento — veja “Fila em memória” abaixo)
- Projeto **VTAL** em um caminho acessível (variável `VTAL_PROJECT_PATH`)

## Autenticação e permissões

| Modo | Quando | Login |
|------|--------|--------|
| `ldap` | QA / OpenShift (`APP_PROFILE=qa`) | VT + senha de rede (LDAP `10.101.0.13`) |
| `local` | Desenvolvimento (`APP_PROFILE=local`) | `admin` / `admin` — sem LDAP, todas as permissões |

Após o login LDAP, qualquer usuário acessa **Gerar massa**. Permissões extras (por VT):

- **Dashboard** — ver `dashboard.html`
- **Cancelar jobs** — cancelar jobs na fila ou em execução
- **Admin** — tela `/admin.html` para configurar VTs (somente administradores da plataforma)

Arquivo de permissões (local): `server/data/access-control.json`. Em QA/OpenShift: tabela MySQL `access_control_users` (persistente entre deploys).

Administrador da plataforma fixo: **VT422570** (`PLATFORM_ADMIN_VT` em `server/config.js`) — vê todos os jobs e a tela Admin. Demais VTs: permissões via `access-control.json` / tela Admin (Dashboard, Cancelar jobs). Cada QA vê apenas as próprias execuções. Logs stdout/stderr não vão ao navegador.

## Perfis de configuração

A aplicação suporta dois perfis via `APP_PROFILE`:

| Perfil | Uso | Banco | Fila |
|--------|-----|-------|------|
| `local` | Desenvolvimento na máquina | SQLite (`server/data/`) | Memória ou Redis local |
| `qa` | OpenShift / infra VTAL (TDM-QA) | MySQL `tdm_qa` em ATDMQX01 | Redis Sentinel em ATDMQX02 |

Arquivos de ambiente (não commitar senhas):

- `.env` — valores comuns
- `.env.local` — copie de `.env.local.example` (perfil local)
- `.env.qa` — copie de `.env.qa.example` (perfil QA / empresa)

Ordem de carga: `.env` → `.env.<APP_PROFILE>` (o perfil sobrescreve).

## Configuração

1. Clone ou use este repositório e instale as dependências:

```bash
cd test-fdl
npm install
```

2. **Desenvolvimento local:**

```bash
cp .env.local.example .env.local
npm run dev
```

O `dev` usa `APP_PROFILE=local` e fila em memória — Redis e MySQL da empresa **não** são necessários.

3. **Ambiente QA (empresa / OpenShift):**

```bash
cp .env.qa.example .env.qa
# Edite .env.qa com MYSQL_PASSWORD e REDIS_PASSWORD reais
npm run dev:qa
```

Infra QA (referência):

- **MySQL:** `ATDMQX01.local` (banco `tdm_qa`, usuário `automacaoqa`) — use o **hostname**, não só o IP; em muitas redes o IP `10.101.37.168` dá `ETIMEDOUT` enquanto o `.local` funciona (como no teste Python).
- **Redis:** `ATDMQX02.local` via **Sentinel** porta `26379`, master `TDMQA`
- **OpenShift:** cluster ARC-NPRD, namespace `automation-tdm-qa` — manifests em `deploy/openshift/`

4. O projeto deve ter configurados:

- `support/environment/env.json` (ambientes ti, trg, etc.)
- `support/fixtures/user.json` (credenciais Salesforce e PEGA por ambiente)

### PEGA por ambiente

| Ambiente | Instância PEGA | Token URL |
|----------|----------------|-----------|
| **TI** | `vtal-omvtal-qa.pega.net` | `…/prweb/PRRestService/oauth2/v1/token` |
| **TRG** | `vtal-omvtal-stg1.pega.net` | `…/prweb/PRRestService/oauth2/v1/token` |

Client ID e Client Secret são os mesmos nos dois ambientes (bloco `pega` em `user.json`). Variáveis de ambiente opcionais sobrescrevem o arquivo: `PEGA_TOKEN_URL`, `PEGA_BASE_URL`, `PEGA_CLIENT_ID`, `PEGA_CLIENT_SECRET`, `PEGA_BEARER_TOKEN`.

Validar conexão TRG (OAuth + `obterdadosordem`):

```bash
ENVIRONMENT=trg node scripts/test-pega-auth.js
# ou com designação específica:
ENVIRONMENT=trg PEGA_DESIGNACAO=RJRJO1000001924 node scripts/test-pega-auth.js
```

Não altere nada dentro do projeto VTAL; a ferramenta apenas executa os scripts existentes.

## Executando

É necessário rodar **dois processos**: a API (e o frontend em dev) e o **worker** que processa a fila.

### Desenvolvimento (API + Frontend)

```bash
npm run dev
```

Isso sobe:

- API em `http://localhost:3333`
- Frontend em `http://localhost:5173` (com proxy para a API)

Por padrão o `dev` usa **fila em memória** (`USE_MEMORY_QUEUE=1`), então **Redis não é necessário**. Os jobs são processados na própria API. O processo do worker inicia e encerra sozinho nesse modo.

### Produção

Terminal 1 – API:

```bash
npm run server
```

Terminal 2 – Worker:

```bash
npm run worker
```

Build do frontend (para servir estático):

```bash
npm run client:build
```

Os arquivos estarão em `client/dist`. Sirva essa pasta junto à API ou por um reverse proxy (ex.: Nginx).

## Variáveis de ambiente

| Variável | Descrição | Local | QA |
|----------|-----------|-------|-----|
| `APP_PROFILE` | `local` ou `qa` | `local` | `qa` |
| `USE_MEMORY_QUEUE` | `1` = fila em memória | `1` (dev) | `0` |
| `DATABASE_DRIVER` | `sqlite` ou `mysql` | `sqlite` | `mysql` |
| `MYSQL_HOST` | Host MySQL | — | `ATDMQX01.local` |
| `MYSQL_DATABASE` | Nome do banco | — | `tdm_qa` |
| `MYSQL_USER` / `MYSQL_PASSWORD` | Credenciais MySQL | — | via secret |
| `REDIS_MODE` | `standalone` ou `sentinel` | `standalone` | `sentinel` |
| `REDIS_SENTINEL_HOST` | Host Sentinel | — | `ATDMQX02.local` |
| `REDIS_SENTINEL_PORT` | Porta Sentinel | — | `26379` |
| `REDIS_MASTER_NAME` | Nome do master | — | `TDMQA` |
| `REDIS_PASSWORD` | Senha Redis | — | via secret |
| `PORT` | Porta da API | `3333` | `3333` |
| `WORKER_CONCURRENCY` | Jobs paralelos no worker | `1–3` | `1` |
| `JOB_ATTEMPTS` | Retentativas | `2` | `2` |

Detalhes completos em `.env.example`, `.env.local.example` e `.env.qa.example`.

## Monitoramento Redis e banco

- **Console:** prefixos `[Monitor][Redis]` e `[Monitor][DB]` na API e no worker (terminal onde rodam `npm run server` e `npm run worker`).
- **API (opcional):** `GET /api/monitor`, `GET /api/monitor/redis`, `GET /api/monitor/db` — eventos agregados (inclui lista `fdl-vtal:monitor:events` no Redis).

Eventos registrados: conexão Redis, enfileiramento, início/fim/falha de job, gravação em `job_executions` (sem stdout completo no log de monitor).

Desligar logs: `LOG_MONITOR=0`.

## Fluxo técnico

1. Usuário escolhe ambiente, tipo de massa e quantidade e clica em **Gerar Massa**.
2. A API cria N jobs na fila (BullMQ/Redis ou fila em memória).
3. O worker (ou a própria API, no modo memória) pega cada job e executa:  
   `node scripts/<script>.js` no diretório do projeto copiado de VTAL para dentro do **Gerenciamento de Dados de Teste - VTAL**, com `ENVIRONMENT=ti` ou `trg` e variáveis extras conforme o tipo de massa.
4. `stdout` e `stderr` são capturados; para cada tipo de massa:
   - Lead → Pedido: são extraídos `OrderId`, `OrderNumber` e `Status` com base nos logs padronizados do script.
   - Conta até Ativação BRM: são extraídos `AccountBillingId`, `AccountBusinessId`, `AccountOrganizationId` e `ContactTecnicoId` com base nos logs padronizados do script `ativacao-brm.js`.
5. O resultado e os logs ficam associados ao job e podem ser vistos na tela de monitoramento e no detalhe do job.

## Observação

O repositório **VTAL** não é alterado por esta ferramenta. Se precisar de algo do VTAL aqui (ex.: cópia de config), copie para o FDL-VTAL; não altere o projeto VTAL.
