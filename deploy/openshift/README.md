# Deploy TDM-QA no OpenShift (ARC-NPRD)

Guia prático com **todos os comandos** usados no primeiro deploy em `qualidade-automation-tdm-qa`, incluindo build sem esteira CI/CD, troubleshooting e atualizações.

| Item | Valor |
|------|-------|
| **Cluster** | ARC-NPRD — `https://api.ocparc-nprd.vtal.intra:6443` |
| **Namespace** | `qualidade-automation-tdm-qa` |
| **ServiceAccount** | `automacaoqa` |
| **BuildConfig / ImageStream** | `tdm-qa` → tag `latest` |
| **URL da aplicação** | https://atacado-qualidade-automation-tdm-qa.apps.ocparc-nprd.vtal.intra/login.html |

---

## Arquitetura no cluster

```
código local
    │
    ▼ oc start-build --from-dir=.
BuildConfig tdm-qa (Docker)
    │
    ▼
ImageStream tdm-qa:latest
    │
    ├── Deployment tdm-qa-api    → node server/index.js   (porta 3333)
    └── Deployment tdm-qa-worker → node server/worker.js (fila BullMQ)
            │
            ▼
    ConfigMap tdm-qa-config  +  Secret tdm-qa-secrets
            │
            ▼
    Service tdm-qa-api → Route atacado
```

**Dependências externas** (pods precisam de rede até):

| Serviço | Host | Uso |
|---------|------|-----|
| MySQL | `10.101.37.168` / `ATDMQX01.local` | Banco `tdm_qa`, usuário `automacaoqa` |
| Redis Sentinel | `10.101.37.169` / `ATDMQX02.local:26379` | Master `TDMQA`, fila BullMQ |
| LDAP | `ldap://10.101.0.13:389` | Login dos QAs |
| Salesforce / PEGA | URLs em `support/environment/env.json` | Credenciais no Secret |

---

## Deploy completo

Na raiz do repo:

```cmd
deploy\openshift\deploy.cmd
```

Faz: `oc apply` de todos os manifests (inclui keepalive) → garante `replicas=1` → `oc start-build` → **`rollout restart`** (pods pegam a imagem nova) → aguarda rollout.

Recursos por pod (API e Worker): `500m` CPU, `768Mi` RAM, probes HTTP em `/api/health`, `RollingUpdate`.

**Keepalive** (`keepalive-cronjob.yaml`): a cada 3 min, se API ou Worker estiverem em `0` réplicas, sobe para 1. Recuperação imediata: `deploy\openshift\wake-up.cmd`

---

## Não existe regra de inatividade (10 min, etc.)

Verificado no namespace: **não há** HPA, CronJob nem política de idle que desliga pods por tempo sem uso.

Se os pods ficarem em `0` réplicas (build, quota ou scale manual), o **keepalive** repõe em até 3 min. Para subir na hora: `deploy\openshift\wake-up.cmd`

---

## Pré-requisitos

- [ ] `oc` CLI instalado
- [ ] Token de acesso ao cluster (console → copiar token de login)
- [ ] Permissão de deploy no namespace `qualidade-automation-tdm-qa`
- [ ] Senhas reais: MySQL, Redis, Salesforce, PEGA (ver `.env.qa.example`)
- [ ] Quota do namespace: **4 CPU / 8 Gi** de limits — builds competem com os pods

---

## 1. Login no cluster

```cmd
oc login --token=<SEU_TOKEN> --server=https://api.ocparc-nprd.vtal.intra:6443
oc project qualidade-automation-tdm-qa
```

Verificar contexto:

```cmd
oc whoami
oc project
```

> **Segurança:** não commitar tokens nem colar em chats. Gere um novo token se expor o anterior.

---

## 2. Build da imagem (sem esteira CI/CD)

### 2.1 Criar BuildConfig (só na primeira vez)

Na **raiz do repositório** (`C:\projeto\test-fdl`):

```cmd
oc new-build --name=tdm-qa --binary=true --strategy=docker -n qualidade-automation-tdm-qa
```

Isso cria:
- `BuildConfig` `tdm-qa`
- `ImageStream` `tdm-qa` (tag `latest`)

### 2.2 Disparar build com o código local

**Importante — quota:** o pod de build precisa de ~300m CPU + 600Mi RAM. Se a quota estiver cheia, escale **só o worker** para 0 antes (a **API pode ficar no ar** — é ela que serve o site):

```cmd
oc scale deployment/tdm-qa-worker --replicas=0 -n qualidade-automation-tdm-qa
```

> **Nunca** escale a API para 0 a menos que o build falhe por quota mesmo assim. Depois do build, rode `deploy\openshift\wake-up.cmd`.

Build (na raiz do repo):

```cmd
oc start-build tdm-qa --from-dir=. --wait -n qualidade-automation-tdm-qa
```

Alternativa com log em tempo real:

```cmd
oc start-build tdm-qa --from-dir=. --follow -n qualidade-automation-tdm-qa
```

> Prefira `--wait` se `--follow` der `timed out waiting for the condition` (fila de build ou quota).

Verificar:

```cmd
oc get builds -n qualidade-automation-tdm-qa
oc get imagestream tdm-qa -n qualidade-automation-tdm-qa
```

Imagem interna:

```
image-registry.openshift-image-registry.svc:5000/qualidade-automation-tdm-qa/tdm-qa:latest
```

### 2.3 Notas sobre o Dockerfile

- **Sem `apt-get`** — o cluster corporativo bloqueia `deb.debian.org`; dependências nativas são instaladas no estágio builder.
- **`sqlite3` não vai na imagem** — está em `devDependencies` (só uso local). Em QA o banco é **MySQL** (`DATABASE_DRIVER=mysql`).

---

## 3. Secret `tdm-qa-secrets`

Credenciais sensíveis. **Nunca commitar valores reais.**

### Criar (CMD do Windows — use `^` para quebra de linha)

```cmd
oc create secret generic tdm-qa-secrets ^
  --from-literal=MYSQL_PASSWORD=<senha_mysql> ^
  --from-literal=REDIS_PASSWORD=<senha_redis> ^
  --from-literal=SESSION_SECRET=<segredo_forte_aleatorio> ^
  --from-literal=SF_TI_CLIENT_ID=<salesforce_ti_client_id> ^
  --from-literal=SF_TI_CLIENT_SECRET=<salesforce_ti_client_secret> ^
  --from-literal=PEGA_TI_CLIENT_ID=<pega_ti_client_id> ^
  --from-literal=PEGA_TI_CLIENT_SECRET=<pega_ti_client_secret> ^
  --from-literal=SF_TRG_CLIENT_ID=<salesforce_trg_client_id> ^
  --from-literal=SF_TRG_CLIENT_SECRET=<salesforce_trg_client_secret> ^
  --from-literal=PEGA_TRG_CLIENT_ID=<pega_trg_client_id> ^
  --from-literal=PEGA_TRG_CLIENT_SECRET=<pega_trg_client_secret> ^
  -n qualidade-automation-tdm-qa
```

### Recriar (senha errada / rotação)

```cmd
oc delete secret tdm-qa-secrets -n qualidade-automation-tdm-qa
REM ... oc create secret generic ... (mesmo comando acima)
oc rollout restart deployment/tdm-qa-api deployment/tdm-qa-worker -n qualidade-automation-tdm-qa
```

> **PowerShell:** use crase `` ` `` no fim da linha, **não** `^`.  
> **CMD:** use `^`.

### Chaves do Secret

| Chave | Obrigatório | Descrição |
|-------|-------------|-----------|
| `MYSQL_PASSWORD` | Sim | Senha do `automacaoqa` no banco `tdm_qa` |
| `REDIS_PASSWORD` | Sim* | Senha do master Redis `TDMQA` |
| `SESSION_SECRET` | Sim | Segredo de sessão (cookies de login) |
| `SF_TI_CLIENT_ID` / `SF_TI_CLIENT_SECRET` | Sim** | Salesforce TI (`ENVIRONMENT=ti`) |
| `PEGA_TI_CLIENT_ID` / `PEGA_TI_CLIENT_SECRET` | Sim*** | PEGA TI |
| `SF_TRG_CLIENT_ID` / `SF_TRG_CLIENT_SECRET` | Sim** | Salesforce TRG |
| `PEGA_TRG_CLIENT_ID` / `PEGA_TRG_CLIENT_SECRET` | Sim*** | PEGA TRG |

\* Se o Redis QA **não usa senha**, omita `REDIS_PASSWORD` do `oc create` (não use o placeholder `alterar_senha_redis` do `.env.qa.example`).  
\** Ou `SF_ACCESS_TOKEN` / legado `SF_CONSUMER_KEY` + `SF_CONSUMER_SECRET`.  
\*** Obrigatório para tipos de massa com fluxo PEGA.

Template: `secret.example.yaml` (somente placeholders).

Ver chaves sem expor valores:

```cmd
oc get secret tdm-qa-secrets -n qualidade-automation-tdm-qa
```

---

## 4. ConfigMap `tdm-qa-config`

Arquivo: `deploy/openshift/configmap.yaml`

| Variável | Valor QA | Observação |
|----------|----------|------------|
| `APP_PROFILE` | `qa` | **Crítico** — sem isso a app roda como `local` (SQLite + fila em memória) |
| `DATABASE_DRIVER` | `mysql` | |
| `USE_MEMORY_QUEUE` | `0` | Fila Redis obrigatória |
| `MYSQL_HOST` | `10.101.37.168` | Preferir `ATDMQX01.local` se DNS resolver no cluster |
| `MYSQL_DATABASE` | `tdm_qa` | |
| `MYSQL_USER` | `automacaoqa` | |
| `REDIS_MODE` | `sentinel` | |
| `REDIS_SENTINEL_HOST` | `10.101.37.169` | Preferir `ATDMQX02.local` |
| `REDIS_SENTINEL_PORT` | `26379` | |
| `REDIS_MASTER_NAME` | `TDMQA` | |
| `ENVIRONMENT` | `ti` | `ti` ou `trg` para Salesforce/PEGA |
| `AUTH_MODE` | `ldap` | |
| `LDAP_URL` | `ldap://10.101.0.13:389` | |
| `LDAP_DOMAIN` | `CORPORATIVO` | |

Aplicar (sempre reaplicar após editar o arquivo):

```cmd
oc apply -f deploy/openshift/configmap.yaml
oc rollout restart deployment/tdm-qa-api deployment/tdm-qa-worker -n qualidade-automation-tdm-qa
```

> **Atenção:** o namespace pode já ter um ConfigMap `tdm-qa-config` de **outro app**. Se os pods tentarem SQLite ou fila em memória, reaplique o YAML deste repositório.

---

## 5. Route `atacado` (URL pública)

Arquivo: `deploy/openshift/route.yaml`

A URL segue o padrão `{nome-da-route}-{namespace}.apps...`. Com `metadata.name: atacado`:

```
https://atacado-qualidade-automation-tdm-qa.apps.ocparc-nprd.vtal.intra/login.html
```

O Service interno continua `tdm-qa-api` — só a Route muda.

Para aplicar após renomear (delete a route antiga se existir):

```cmd
oc delete route tdm-qa-api -n qualidade-automation-tdm-qa --ignore-not-found
oc apply -f deploy/openshift/route.yaml
oc get route atacado -n qualidade-automation-tdm-qa
```

---

## 6. Manifests (primeiro deploy)

Execute **um `oc apply` por linha** (não junte vários na mesma linha):

```cmd
cd C:\projeto\test-fdl

oc apply -f deploy/openshift/serviceaccount.yaml
oc apply -f deploy/openshift/configmap.yaml
oc apply -f deploy/openshift/deployment-api.yaml
oc apply -f deploy/openshift/deployment-worker.yaml
oc apply -f deploy/openshift/route.yaml
```

A imagem nos Deployments já aponta para o registry interno:

```
image-registry.openshift-image-registry.svc:5000/qualidade-automation-tdm-qa/tdm-qa:latest
```

### Health checks (API)

Probes HTTP em `/api/health` (porta 3333). Não usar `/api/config` — exige login e retorna 401.

---

## 7. Validar deploy

```cmd
oc get pods -l app=tdm-qa -n qualidade-automation-tdm-qa
oc get deployment tdm-qa-api tdm-qa-worker -n qualidade-automation-tdm-qa
oc get route atacado -n qualidade-automation-tdm-qa
oc get endpoints tdm-qa-api -n qualidade-automation-tdm-qa
oc logs deployment/tdm-qa-api -n qualidade-automation-tdm-qa --tail=50
oc logs deployment/tdm-qa-worker -n qualidade-automation-tdm-qa --tail=50
oc get resourcequota -n qualidade-automation-tdm-qa
```

**Sucesso esperado nos logs da API:**

```
[DB] MySQL 10.101.37.168:3306/tdm_qa ...
[Fila] Redis conectado (Sentinel → TDMQA)
Gerenciamento de Dados de Teste - VTAL API rodando em http://localhost:3333
Perfil: qa | Auth: ldap
```

**Pods:**

```
tdm-qa-api-...      1/1   Running
tdm-qa-worker-...   1/1   Running
```

**Browser:** https://atacado-qualidade-automation-tdm-qa.apps.ocparc-nprd.vtal.intra/login.html

Login: VT corporativo + senha de rede (LDAP).

---

## 8. Site fora do ar (`Application is not available`)

A mensagem *"The application is currently not serving requests at this endpoint"* aparece quando a **Route existe**, mas **não há pods saudáveis** atrás do Service. Na maioria dos casos **não é preciso build novo**.

### Passo 1 — Diagnóstico

```cmd
oc project qualidade-automation-tdm-qa

oc get pods -l app=tdm-qa -n qualidade-automation-tdm-qa
oc get deployment tdm-qa-api tdm-qa-worker -n qualidade-automation-tdm-qa
oc get route atacado -n qualidade-automation-tdm-qa
oc get endpoints tdm-qa-api -n qualidade-automation-tdm-qa
```

### Passo 2 — Interpretar o resultado

| O que você vê | Significado |
|---------------|-------------|
| `No resources found` nos pods | Deployments com **0 réplicas** — ninguém escalou de volta após build |
| Deployment `READY 0/0` | Mesmo problema |
| Endpoints `<none>` | Service sem pod — Route não encaminha tráfego |
| Pod `CrashLoopBackOff` | Pod sobe e cai — ver logs (MySQL, Redis, ConfigMap) |
| Pod `1/1 Running` + Endpoints com IP | App no ar — testar URL no browser |

### Passo 3 — Corrigir (causa mais comum: 0 réplicas)

Isso acontece após `oc scale deployment/tdm-qa-worker --replicas=0` para liberar quota no build, ou se os Deployments ficaram em 0 por outro motivo:

```cmd
oc scale deployment/tdm-qa-api deployment/tdm-qa-worker --replicas=1 -n qualidade-automation-tdm-qa
oc get pods -l app=tdm-qa -n qualidade-automation-tdm-qa
```

Aguarde `1/1 Running` e abra:

https://atacado-qualidade-automation-tdm-qa.apps.ocparc-nprd.vtal.intra/login.html

> **Login OK, mas Dashboard ou Sair falham** com a mesma página do OpenShift: os pods provavelmente ficaram em `0/0` entre uma navegação e outra. Mesmo `oc scale` — não é path diferente na Route.

### Passo 4 — Se ainda falhar

```cmd
oc logs deployment/tdm-qa-api -n qualidade-automation-tdm-qa --tail=30
oc logs deployment/tdm-qa-worker -n qualidade-automation-tdm-qa --tail=30
```

### Passo 5 — CLI sem conexão

```
lookup api.ocparc-nprd.vtal.intra: no such host
```

Conecte **VPN / rede corporativa**, depois:

```cmd
oc login --token=<SEU_TOKEN> --server=https://api.ocparc-nprd.vtal.intra:6443
```

Alternativa: console web → **Networking → Routes** → verificar Route `atacado` → **Workloads → Pods**.

### Lembrete após cada build

Sempre que escalar o worker para 0 antes do build, **suba os dois Deployments de novo**:

```cmd
oc rollout restart deployment/tdm-qa-api -n qualidade-automation-tdm-qa
oc scale deployment/tdm-qa-worker --replicas=1 -n qualidade-automation-tdm-qa
oc rollout restart deployment/tdm-qa-worker -n qualidade-automation-tdm-qa
```

---

## 9. Atualizar código (redeploy)

**Forma recomendada** — na raiz do repo, com VPN e `oc login` feitos:

```cmd
cd C:\projeto\test-fdl
deploy\openshift\deploy.cmd
```

Isso aplica manifests, faz build do código local (`oc start-build --from-dir=.`) e reinicia API + Worker para carregar a imagem `tdm-qa:latest` (sem depender de “cache” de pod antigo).

**Validar:**

```cmd
oc get pods -l app=tdm-qa
oc logs deployment/tdm-qa-api --tail=20
```

URL: https://atacado-qualidade-automation-tdm-qa.apps.ocparc-nprd.vtal.intra/login.html

---

### Fluxo manual (se o script falhar ou precisar liberar quota)

```cmd
oc project qualidade-automation-tdm-qa

REM 1. Liberar quota para o build (opcional)
oc scale deployment/tdm-qa-worker --replicas=0

REM 2. Build nova imagem (na raiz do repo)
oc start-build tdm-qa --from-dir=. --wait

REM 3. Reiniciar pods — obrigatório após build na tag latest
oc scale deployment/tdm-qa-api deployment/tdm-qa-worker --replicas=1
oc rollout restart deployment/tdm-qa-api deployment/tdm-qa-worker

REM 4. Validar
oc get pods -l app=tdm-qa
oc logs deployment/tdm-qa-api --tail=20
```

Se só mudou ConfigMap ou Secret (sem código):

```cmd
oc apply -f deploy/openshift/configmap.yaml
REM ou recriar secret...
oc rollout restart deployment/tdm-qa-api deployment/tdm-qa-worker -n qualidade-automation-tdm-qa
```

---

## 10. Troubleshooting

### `InvalidImageName` nos pods

```
couldn't parse image reference "REPLACE_IMAGE_REGISTRY/tdm-qa:latest"
```

**Causa:** placeholder de imagem nos YAMLs.  
**Solução:** usar `image-registry.openshift-image-registry.svc:5000/qualidade-automation-tdm-qa/tdm-qa:latest` (já corrigido em `deployment-api.yaml` e `deployment-worker.yaml`).

---

### `timed out waiting for the condition` no build

**Causa:** quota esgotada — API + Worker + pod pendente = 4 CPU / 8 Gi.

```cmd
oc get resourcequota -n qualidade-automation-tdm-qa
oc scale deployment/tdm-qa-worker --replicas=0
oc delete pod -l build=tdm-qa --ignore-not-found
oc start-build tdm-qa --from-dir=. --wait
```

---

### `Access denied for user 'automacaoqa'@'ocpbha02...'`

**Causa:** senha errada **ou** MySQL não libera conexão dos nós do OpenShift.

**Solução:**
1. Conferir `MYSQL_PASSWORD` no Secret.
2. Pedir ao DBA `GRANT` para `'automacaoqa'@'%'` (ou hosts dos nós OCP).

---

### `WRONGPASS` no Redis

**Causa:** `REDIS_PASSWORD` errada ou placeholder `alterar_senha_redis` do `.env.qa.example`.

**Solução:** senha real com a infra, ou omitir `REDIS_PASSWORD` se o Redis QA não exige senha.

---

### App tenta SQLite / fila em memória no OpenShift

```
SQLite indisponível... use DATABASE_DRIVER=mysql
[Worker] Fila em memória ativa — worker não é necessário
```

**Causa:** ConfigMap errado ou sem `APP_PROFILE=qa`.

**Solução:**

```cmd
oc apply -f deploy/openshift/configmap.yaml
oc rollout restart deployment/tdm-qa-api deployment/tdm-qa-worker
```

---

### Pod `Running` mas `0/1 Ready` — probe falhando

**Causa:** liveness/readiness em rota autenticada (ex.: `/api/config`).

**Solução:** probes HTTP em `/api/health` (já configurado em `deployment-api.yaml`).

---

### `Application is not available` na Route

Ver seção **[8. Site fora do ar](#8-site-fora-do-ar-application-is-not-available)** — fluxo completo de diagnóstico.

---

### Build Docker falha em `apt-get` (deb.debian.org)

**Causa:** rede corporativa bloqueia repositórios Debian no cluster.

**Solução:** Dockerfile atual usa multi-stage sem `apt-get`; `sqlite3` só em dev local.

---

### Build Docker falha em `playwright install` / `cdn.playwright.dev` timeout

**Causa:** o cluster bloqueia download do Chromium do Playwright (mesmo problema de rede do `apt-get`).

**Sintoma:** `oc get builds` mostra `Failed (DockerBuildFailed)`; `deploy.cmd` termina mas o código no ar **não muda** (imagem `latest` antiga).

**Solução:** o Dockerfile **não** roda `playwright install` no build. Confira:

```cmd
oc get builds -n qualidade-automation-tdm-qa
oc logs build/tdm-qa-13 -n qualidade-automation-tdm-qa --tail=30
```

Depois rode `deploy\openshift\deploy.cmd` de novo. Tipos de massa que usam login OFS via Playwright no worker precisam de sessão manual (`.auth/...`) ou rede liberada para o CDN.

---

## 11. O que não versionar

| Item | Motivo |
|------|--------|
| `support/fixtures/user.json` | Credenciais locais |
| `.env`, `.env.qa` | Senhas |
| Secrets OpenShift com valores reais | Usar `oc create secret` |
| Tokens `oc login` | Acesso ao cluster |

---

## 12. Referência rápida de arquivos

| Arquivo | Função |
|---------|--------|
| `deploy/openshift/serviceaccount.yaml` | SA `automacaoqa` |
| `deploy/openshift/configmap.yaml` | Variáveis não sensíveis |
| `deploy/openshift/secret.example.yaml` | Template do Secret |
| `deploy/openshift/deployment-api.yaml` | API + Service |
| `deploy/openshift/deployment-worker.yaml` | Worker BullMQ |
| `deploy/openshift/route.yaml` | URL HTTPS |
| `deploy/openshift/keepalive-cronjob.yaml` | Repõe réplicas se ficarem em 0 |
| `deploy/openshift/deploy.cmd` | Deploy completo (apply + build) |
| `deploy/openshift/wake-up.cmd` | Sobe pods imediatamente |
| `Dockerfile` | Imagem de produção |
| `.env.qa.example` | Referência de variáveis para QA |

---

## Desenvolvimento local

Use `APP_PROFILE=local` e `.env.local` — ver `README.md` na raiz do projeto.
