# Deploy TDM-QA no OpenShift

**Cluster:** ARC-NPRD (`api.ocparc-nprd.vtal.intra:6443`)  
**Namespace:** `automation-tdm-qa`  
**Conta de serviço:** `automacaoqa` (ajuste no YAML se o nome no cluster for diferente, ex. `AUTOMACAOQA`)

Guia completo para DevOps: ver seção **Guia DevOps — Deploy no OpenShift** no `README.md` da raiz do projeto.

## Pré-requisitos

- Namespace `automation-tdm-qa` criado e com permissão de deploy
- Acesso à rede interna (MySQL, Redis Sentinel, LDAP, Salesforce, PEGA)
- `oc` CLI logado no cluster
- Imagem da aplicação publicada no registry interno

## 1. Login

```bash
oc login --server=https://api.ocparc-nprd.vtal.intra:6443 --token=<SEU_TOKEN>
oc project automation-tdm-qa
```

## 2. Secret `tdm-qa-secrets`

Crie com **todas** as chaves necessárias (não commitar valores reais):

```bash
oc create secret generic tdm-qa-secrets \
  --from-literal=MYSQL_PASSWORD='<senha_mysql>' \
  --from-literal=REDIS_PASSWORD='<senha_redis>' \
  --from-literal=SESSION_SECRET='<segredo_forte_aleatorio>' \
  --from-literal=SF_CONSUMER_KEY='<salesforce_consumer_key>' \
  --from-literal=SF_CONSUMER_SECRET='<salesforce_consumer_secret>' \
  --from-literal=PEGA_CLIENT_ID='<pega_client_id>' \
  --from-literal=PEGA_CLIENT_SECRET='<pega_client_secret>' \
  -n automation-tdm-qa
```

| Chave | Obrigatório | Uso |
|-------|-------------|-----|
| `MYSQL_PASSWORD` | Sim | Banco `tdm_qa` |
| `REDIS_PASSWORD` | Sim | Redis Sentinel master `TDMQA` |
| `SESSION_SECRET` | Sim | Sessão de login (API) |
| `SF_CONSUMER_KEY` | Sim* | OAuth2 Salesforce |
| `SF_CONSUMER_SECRET` | Sim* | OAuth2 Salesforce |
| `PEGA_CLIENT_ID` | Sim** | OAuth2 PEGA |
| `PEGA_CLIENT_SECRET` | Sim** | OAuth2 PEGA |

\* Ou `SF_ACCESS_TOKEN` (alternativa ao par key/secret).  
\** Obrigatório para tipos de massa com fluxo PEGA.

Chaves opcionais (adicionar ao `oc create` se necessário):  
`SF_ACCESS_TOKEN`, `SF_USERNAME`, `SF_PASSWORD`, `SF_GRANT_TYPE`, `SF_COOKIE`,  
`PEGA_BEARER_TOKEN`, `PEGA_TOKEN_URL`, `PEGA_BASE_URL`, `PEGA_COOKIE`.

Os Deployments usam `envFrom.secretRef` — **toda chave** do Secret vira variável de ambiente no pod (API e Worker).

Template de referência: `secret.example.yaml` (somente placeholders).

## 3. ConfigMap e deployments

Ajuste hosts no `configmap.yaml` se necessário (preferir `ATDMQX01.local` / `ATDMQX02.local` em vez de IP).

Substitua `REPLACE_IMAGE_REGISTRY/tdm-qa:latest` nos YAMLs pela imagem buildada.

```bash
oc apply -f deploy/openshift/configmap.yaml
oc apply -f deploy/openshift/deployment-api.yaml
oc apply -f deploy/openshift/deployment-worker.yaml
```

## 4. Build da imagem

Na raiz do repositório:

```bash
docker build -t <registry>/tdm-qa:latest .
docker push <registry>/tdm-qa:latest
```

A imagem **não** contém `support/fixtures/user.json` — credenciais vêm do Secret.

## 5. Route (acesso web)

Os manifests expõem apenas o `Service` na porta 3333. Crie uma **Route** no console (Networking → Routes) ou peça à infra a URL externa apontando para `tdm-qa-api`.

## 6. Validação

```bash
oc get pods -l app=tdm-qa -n automation-tdm-qa
oc logs -l component=api -n automation-tdm-qa --tail=50
oc logs -l component=worker -n automation-tdm-qa --tail=50
```

## Redis

Em QA use **Redis Sentinel** (master `TDMQA`), não conexão direta na porta 6379. Configurado em `configmap.yaml` (`REDIS_MODE=sentinel`).

## Desenvolvimento local

Use `APP_PROFILE=local` e `.env.local` — ver README na raiz do projeto.
