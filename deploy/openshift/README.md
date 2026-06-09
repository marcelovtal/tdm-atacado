# Deploy TDM-QA no OpenShift

**Cluster:** ARC-NPRD (`api.ocparc-nprd.vtal.intra:6443`)  
**Namespace:** `automation-tdm-qa` (liberação via análise de arquitetura)  
**Conta de serviço:** `automacaoqa` (ajuste no YAML se o nome no cluster for diferente, ex. `AUTOMACAOQA`)

## Pré-requisitos

- Namespace `automation-tdm-qa` criado e com permissão de deploy
- Acesso à rede interna (MySQL, Redis Sentinel, LDAP)
- `oc` CLI logado no cluster
- Imagem da aplicação publicada no registry interno

## 1. Login

```bash
oc login --server=https://api.ocparc-nprd.vtal.intra:6443 --token=<SEU_TOKEN>
oc project automation-tdm-qa
```

## 2. Secret (senhas)

```bash
oc create secret generic tdm-qa-secrets \
  --from-literal=MYSQL_PASSWORD='<senha_mysql>' \
  --from-literal=REDIS_PASSWORD='<senha_redis>' \
  -n automation-tdm-qa
```

Recomendado incluir também `SESSION_SECRET` (não commitar valores reais):

```bash
oc create secret generic tdm-qa-secrets \
  --from-literal=MYSQL_PASSWORD='<senha_mysql>' \
  --from-literal=REDIS_PASSWORD='<senha_redis>' \
  --from-literal=SESSION_SECRET='<segredo_forte>' \
  -n automation-tdm-qa
```

## 3. ConfigMap e deployments

Substitua `REPLACE_IMAGE_REGISTRY/tdm-qa:latest` nos YAMLs pela imagem buildada.

```bash
oc apply -f deploy/openshift/configmap.yaml
oc apply -f deploy/openshift/deployment-api.yaml
oc apply -f deploy/openshift/deployment-worker.yaml
```

## 4. Build da imagem (exemplo)

Na raiz do repositório:

```bash
docker build -t <registry>/tdm-qa:latest .
docker push <registry>/tdm-qa:latest
```

## 5. Route (acesso web)

Os manifests atuais expõem apenas o `Service` na porta 3333. Crie uma **Route** no console (Networking → Routes) ou peça à infra a URL externa apontando para `tdm-qa-api`.

## Redis

Conforme o manual de operação, a aplicação deve usar **Redis Sentinel** (master `TDMQA`), não conexão direta na porta 6379 em produção.

## Desenvolvimento local

Use `APP_PROFILE=local` e `.env.local` — ver README na raiz do projeto.
