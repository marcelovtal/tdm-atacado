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
- **OpenShift:** cluster ARC-NPRD, namespace `qualidade-automation-tdm-qa` — manifests em `deploy/openshift/`

4. Credenciais dos scripts (Salesforce / PEGA):

- **Desenvolvimento local:** copie `support/fixtures/user.example.json` → `support/fixtures/user.json` e preencha com valores reais (arquivo no `.gitignore`, não versionar).
- **OpenShift / CI:** configure as variáveis de ambiente listadas na seção [Guia DevOps — OpenShift](#guia-devops--deploy-no-openshift). O arquivo `user.json` **não vai na imagem Docker** — os pods montam as credenciais via Secrets.

Arquivo de ambientes (URLs, sem segredos): `support/environment/env.json` (ti, trg, etc.).

### PEGA por ambiente

| Ambiente | Instância PEGA | Token URL |
|----------|----------------|-----------|
| **TI** | `vtal-omvtal-qa.pega.net` | `…/prweb/PRRestService/oauth2/v1/token` |
| **TRG** | `vtal-omvtal-stg1.pega.net` | `…/prweb/PRRestService/oauth2/v1/token` |

Client ID e Client Secret são os mesmos nos dois ambientes. Em local: bloco `pega` em `user.json`. Em OpenShift: secrets `PEGA_CLIENT_ID`, `PEGA_CLIENT_SECRET` (e opcionalmente `PEGA_TOKEN_URL`, `PEGA_BASE_URL`, `PEGA_BEARER_TOKEN`).

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

## Guia DevOps — Deploy no OpenShift

Seção para quem vai subir e manter a aplicação no cluster. Manifests em `deploy/openshift/`; passo a passo resumido também em `deploy/openshift/README.md`.

### Visão geral

A aplicação roda como **dois Deployments** com a **mesma imagem Docker**:

| Componente | Deployment | Comando | Função |
|------------|------------|---------|--------|
| **API** | `tdm-qa-api` | `node server/index.js` (padrão do Dockerfile) | Interface web, autenticação LDAP, enfileiramento de jobs |
| **Worker** | `tdm-qa-worker` | `node server/worker.js` | Executa os scripts de geração de massa (Salesforce / PEGA) |

Dependências **fora do cluster** (pods precisam de rede até elas):

| Serviço | Host (referência) | Uso |
|---------|-------------------|-----|
| **MySQL** | `ATDMQX01.local` (`10.101.37.168`) | Histórico de jobs, permissões de usuário (`access_control_users`) |
| **Redis Sentinel** | `ATDMQX02.local` (`10.101.37.169`), porta `26379`, master `TDMQA` | Fila BullMQ — **obrigatório** em QA (`USE_MEMORY_QUEUE=0`) |
| **LDAP** | `ldap://10.101.0.13:389` | Login dos QAs (VT + senha de rede) |
| **Salesforce** | URLs em `support/environment/env.json` | Scripts OAuth2 nos ambientes TI / TRG |
| **PEGA** | `vtal-omvtal-qa.pega.net` (TI) / `vtal-omvtal-stg1.pega.net` (TRG) | Scripts com configuração PEGA |

**Cluster:** ARC-NPRD (`api.ocparc-nprd.vtal.intra:6443`)  
**Namespace:** `qualidade-automation-tdm-qa`  
**ServiceAccount:** `automacaoqa`  
**URL (Route `atacado`):** https://atacado-qualidade-automation-tdm-qa.apps.ocparc-nprd.vtal.intra/login.html

> Guia operacional completo (build, secrets, troubleshooting): [`deploy/openshift/README.md`](deploy/openshift/README.md)

### Checklist antes do deploy

- [ ] Namespace `qualidade-automation-tdm-qa` criado e com permissão de deploy
- [ ] ServiceAccount `automacaoqa` existente no namespace
- [ ] Pods com egress para MySQL, Redis Sentinel, LDAP, Salesforce e PEGA
- [ ] Imagem publicada (`oc start-build tdm-qa` ou push manual para o ImageStream `tdm-qa:latest`)
- [ ] Secrets criados (senhas + credenciais Salesforce/PEGA — **não commitar**)
- [ ] Route `atacado` criada apontando para o Service `tdm-qa-api:3333`
- [ ] Deployments `tdm-qa-api` e `tdm-qa-worker` com **1 réplica** cada (`READY 1/1`)

### 1. Build da imagem

**Opção A — Build no OpenShift (sem esteira CI/CD, recomendado para testes):**

```bash
# Primeira vez
oc new-build --name=tdm-qa --binary=true --strategy=docker -n qualidade-automation-tdm-qa

# A cada deploy (na raiz do repo; escale worker para 0 se quota estiver cheia)
oc scale deployment/tdm-qa-worker --replicas=0 -n qualidade-automation-tdm-qa
oc start-build tdm-qa --from-dir=. --wait -n qualidade-automation-tdm-qa

# IMPORTANTE: após o build, subir os pods de novo
oc rollout restart deployment/tdm-qa-api -n qualidade-automation-tdm-qa
oc scale deployment/tdm-qa-worker --replicas=1 -n qualidade-automation-tdm-qa
oc rollout restart deployment/tdm-qa-worker -n qualidade-automation-tdm-qa
```

**Opção B — Docker local + push** (se o build no cluster falhar por rede):

```bash
oc registry login
docker build -t <registry>/qualidade-automation-tdm-qa/tdm-qa:latest .
docker push <registry>/qualidade-automation-tdm-qa/tdm-qa:latest
```

A imagem inclui `server/`, `scripts/`, `support/environment/env.json` e o front buildado em `client/dist`. **Não inclui** `support/fixtures/user.json` nem `sqlite3` (só dev local).

**Guia completo com troubleshooting:** [`deploy/openshift/README.md`](deploy/openshift/README.md)

### 2. Secret `tdm-qa-secrets`

Crie no namespace (valores reais via `oc`, cofre ou pipeline — nunca no Git):

```bash
oc project qualidade-automation-tdm-qa

oc create secret generic tdm-qa-secrets \
  --from-literal=MYSQL_PASSWORD='<senha_mysql>' \
  --from-literal=REDIS_PASSWORD='<senha_redis>' \
  --from-literal=SESSION_SECRET='<segredo_forte_aleatorio>' \
  --from-literal=SF_TI_CLIENT_ID='<salesforce_ti_client_id>' \
  --from-literal=SF_TI_CLIENT_SECRET='<salesforce_ti_client_secret>' \
  --from-literal=PEGA_TI_CLIENT_ID='<pega_ti_client_id>' \
  --from-literal=PEGA_TI_CLIENT_SECRET='<pega_ti_client_secret>' \
  --from-literal=SF_TRG_CLIENT_ID='<salesforce_trg_client_id>' \
  --from-literal=SF_TRG_CLIENT_SECRET='<salesforce_trg_client_secret>' \
  --from-literal=PEGA_TRG_CLIENT_ID='<pega_trg_client_id>' \
  --from-literal=PEGA_TRG_CLIENT_SECRET='<pega_trg_client_secret>' \
  -n qualidade-automation-tdm-qa
```

| Chave do Secret | Obrigatório | Descrição |
|-----------------|-------------|-----------|
| `MYSQL_PASSWORD` | Sim | Senha do usuário `automacaoqa` no banco `tdm_qa` |
| `REDIS_PASSWORD` | Sim | Senha do Redis (master Sentinel `TDMQA`) |
| `SESSION_SECRET` | Sim | Segredo de sessão da API (cookies de login) |
| `SF_TI_CLIENT_ID` / `SF_TI_CLIENT_SECRET` | Sim* | Salesforce ambiente TI (`ENVIRONMENT=ti`) |
| `PEGA_TI_CLIENT_ID` / `PEGA_TI_CLIENT_SECRET` | Sim** | PEGA ambiente TI |
| `SF_TRG_CLIENT_ID` / `SF_TRG_CLIENT_SECRET` | Sim* | Salesforce ambiente TRG (`ENVIRONMENT=trg`) |
| `PEGA_TRG_CLIENT_ID` / `PEGA_TRG_CLIENT_SECRET` | Sim** | PEGA ambiente TRG |
| `SF_CONSUMER_KEY` / `SF_CONSUMER_SECRET` | Legado | Override genérico (ambiente ativo) |
| `PEGA_CLIENT_ID` / `PEGA_CLIENT_SECRET` | Legado | Override genérico PEGA |
| `SF_ACCESS_TOKEN` | Alternativa | Se definido, dispensa `SF_CONSUMER_KEY` / `SF_CONSUMER_SECRET` |
| `SF_USERNAME` / `SF_PASSWORD` | Opcional | Apenas se `SF_GRANT_TYPE=password` |
| `PEGA_BEARER_TOKEN` | Opcional | Token fixo PEGA (validação manual / bypass OAuth) |

\* Ou `SF_ACCESS_TOKEN` pré-emitido.  
\** Obrigatório para tipos de massa que executam fluxo PEGA; scripts sem PEGA ignoram.

Os Deployments (`deployment-api.yaml` / `deployment-worker.yaml`) usam `envFrom.secretRef` no `tdm-qa-secrets` — **toda chave** do Secret vira variável de ambiente automaticamente nos pods API e Worker.

### 3. ConfigMap `tdm-qa-config`

Arquivo: `deploy/openshift/configmap.yaml`. Valores principais:

| Variável | Valor QA | Observação |
|----------|----------|------------|
| `APP_PROFILE` | `qa` | Ativa MySQL + Redis Sentinel + LDAP |
| `USE_MEMORY_QUEUE` | `0` | Fila Redis obrigatória |
| `DATABASE_DRIVER` | `mysql` | |
| `MYSQL_HOST` | Preferir `ATDMQX01.local` | IP `10.101.37.168` pode dar timeout em algumas redes |
| `MYSQL_DATABASE` | `tdm_qa` | |
| `MYSQL_USER` | `automacaoqa` | |
| `REDIS_MODE` | `sentinel` | Não usar standalone em produção |
| `REDIS_SENTINEL_HOST` | Preferir `ATDMQX02.local` | Porta `26379`, master `TDMQA` |
| `WORKER_CONCURRENCY` | `1` | Um job por vez no worker QA |
| `AUTH_MODE` | `ldap` | Adicionar ao ConfigMap se ainda não estiver |
| `LDAP_URL` | `ldap://10.101.0.13:389` | |
| `LDAP_DOMAIN` | `CORPORATIVO` | |
| `ENVIRONMENT` | `ti` ou `trg` | Ambiente Salesforce/PEGA padrão dos scripts |

```bash
oc apply -f deploy/openshift/configmap.yaml
```

### 4. Deployments e Service

Substitua a imagem nos YAMLs e aplique:

```bash
oc apply -f deploy/openshift/serviceaccount.yaml
oc apply -f deploy/openshift/deployment-api.yaml
oc apply -f deploy/openshift/deployment-worker.yaml
oc apply -f deploy/openshift/route.yaml
```

- **API:** readiness/liveness em **TCP :3333** (`/api/config` exige login e retorna 401)
- **Worker:** sem HTTP; processa fila Redis — se o worker cair, jobs ficam pendentes

Escale conforme necessidade (QA costuma usar `replicas: 1` em cada).

### 5. Route `atacado` (acesso web)

Arquivo: `deploy/openshift/route.yaml`. A URL pública segue o padrão `{nome-da-route}-{namespace}.apps...`:

```
https://atacado-qualidade-automation-tdm-qa.apps.ocparc-nprd.vtal.intra/login.html
```

O Service interno continua `tdm-qa-api` — só o nome da Route define o hostname.

```bash
oc apply -f deploy/openshift/route.yaml
oc get route atacado -n qualidade-automation-tdm-qa
```

Para trocar a URL antiga (`tdm-qa-api-...`):

```bash
oc delete route tdm-qa-api -n qualidade-automation-tdm-qa
oc apply -f deploy/openshift/route.yaml
```

### 6. Validação pós-deploy

```bash
oc get pods -l app=tdm-qa -n qualidade-automation-tdm-qa
oc get deployment tdm-qa-api tdm-qa-worker -n qualidade-automation-tdm-qa
oc get route atacado -n qualidade-automation-tdm-qa
oc get endpoints tdm-qa-api -n qualidade-automation-tdm-qa

oc logs deployment/tdm-qa-api -n qualidade-automation-tdm-qa --tail=50
oc logs deployment/tdm-qa-worker -n qualidade-automation-tdm-qa --tail=50
```

**Sucesso esperado:**

| Verificação | Esperado |
|-------------|----------|
| Pods | `tdm-qa-api` e `tdm-qa-worker` em `1/1 Running` |
| Deployments | `READY 1/1`, `AVAILABLE 1` |
| Endpoints | IP:3333 (não `<none>`) |
| Logs API | `Perfil: qa`, MySQL e Redis conectados |

### 7. Site fora do ar (`Application is not available`)

Se a URL não abre (nem a antiga nem `atacado-...`), **não precisa de build novo** na maioria dos casos. Diagnóstico:

```bash
oc project qualidade-automation-tdm-qa

oc get pods -l app=tdm-qa -n qualidade-automation-tdm-qa
oc get deployment tdm-qa-api tdm-qa-worker -n qualidade-automation-tdm-qa
oc get route atacado -n qualidade-automation-tdm-qa
oc get endpoints tdm-qa-api -n qualidade-automation-tdm-qa
```

#### Causa mais comum: Deployments com 0 réplicas

Após build (worker escalado para 0 por quota) ou intervenção manual, os Deployments podem ficar em `0/0` — a Route existe, mas **não há pods** atrás do Service.

```
NAME           READY   UP-TO-DATE   AVAILABLE
tdm-qa-api     0/0     0            0        ← problema
tdm-qa-worker  0/0     0            0        ← problema
```

**Solução (sem rebuild):**

```bash
oc scale deployment/tdm-qa-api deployment/tdm-qa-worker --replicas=1 -n qualidade-automation-tdm-qa
oc get pods -l app=tdm-qa -n qualidade-automation-tdm-qa
```

Aguarde `1/1 Running` e teste: https://atacado-qualidade-automation-tdm-qa.apps.ocparc-nprd.vtal.intra/login.html

> **Sintoma:** login ou `index.html` abrem, mas Dashboard / Sair mostram *Application is not available* — em geral os pods caíram **depois** do login (Deployments em `0/0`). Rode o `oc scale` acima; não é URL diferente por página.

#### Outras causas

| Sintoma | O que verificar |
|---------|-----------------|
| `No resources found` nos pods | Deployments em 0 — `oc scale ... --replicas=1` |
| Endpoints `<none>` | Mesmo que acima — sem pod, Route não encaminha tráfego |
| `CrashLoopBackOff` | `oc logs deployment/tdm-qa-api --tail=30` — MySQL, Redis ou ConfigMap |
| `oc`: `no such host` | VPN / rede corporativa; depois `oc login` de novo |
| Route não existe | `oc apply -f deploy/openshift/route.yaml` |

#### Depois de corrigir

```bash
oc logs deployment/tdm-qa-api -n qualidade-automation-tdm-qa --tail=20
oc logs deployment/tdm-qa-worker -n qualidade-automation-tdm-qa --tail=20
```

Testes funcionais (com credenciais já nos Secrets):

1. Login LDAP com um VT de QA
2. Gerar massa (1 execução) em ambiente TI
3. Confirmar job `completed` no dashboard e logs sem erro de OAuth

Para validar PEGA isoladamente (no pod worker ou job de debug):

```bash
ENVIRONMENT=trg node scripts/test-pega-auth.js
```

### 8. O que não versionar

| Arquivo / dado | Motivo |
|----------------|--------|
| `support/fixtures/user.json` | Credenciais Salesforce/PEGA |
| `server/data/*.sqlite` | Banco local com dados de execução |
| `.env`, `.env.qa` | Senhas de infra |
| Secrets OpenShift com valores reais | Usar `oc create secret` ou pipeline |

Template seguro para devs: `support/fixtures/user.example.json`.

### 9. Contato com o time de QA

- **Admin da plataforma (fixo):** VT `VT422570` — vê todos os jobs e tela Admin
- **Permissões extras** (Dashboard, cancelar jobs): tabela MySQL `access_control_users` ou tela Admin
- **Tipos de massa disponíveis:** definidos em `server/config.js` (`MASS_TYPES`)

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
