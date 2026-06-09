# Documento de Arquitetura da Solução (DAS)

## Ferramenta interna de geração de massa de testes (TDM) – VTAL

| Campo | Valor |
|--------|--------|
| **Nome da solução** | FDL VTAL — Gerenciamento de dados de teste / geração de massa QA |
| **Escopo** | Uso interno (QA/técnico), ambientes **TI** e **TRG** apenas |
| **Versão do documento** | 1.0 |
| **Stack** | Node.js (Express, BullMQ, Vite), Redis, SQLite |

---

## 1. Objetivo

Disponibilizar uma **aplicação web interna** para o time **disparar fluxos automatizados de geração de massa** (ex.: lead → pedido, massa pronta, BRM, fluxos com PEGA), com **fila de execução**, **histórico de jobs** e **logs**, sem uso em produção e sem acesso de cliente final.

---

## 2. Visão geral da arquitetura

```
[Usuários (browser)]
        │
        ▼ HTTPS
[Frontend estático] ──► [API Node.js (Express)]
                               │
                               ├── Enfileira jobs (BullMQ)
                               │
                               ▼
                         [Redis] ◄── fila BullMQ
                               │
                               ▼
[Worker Node.js] ──► executa scripts (child_process: node scripts/…)
                               │
                               ├── Saída: Salesforce / PEGA / outros (HTTPS, conforme script)
                               │
                               ▼
[Persistência histórico] ──► SQLite (arquivo)
                             Evolução possível: MySQL gerido (política de infra)
```

- **Modo desenvolvimento:** pode rodar com **fila em memória** (`USE_MEMORY_QUEUE=1`), sem Redis; a API processa jobs no mesmo processo.
- **Modo produção recomendado:** **Redis + BullMQ** + processo **worker** separado (`server/worker.js`).

---

## 3. Componentes principais

| Componente | Tecnologia | Função |
|------------|------------|--------|
| **Frontend** | HTML/CSS/JS (build **Vite**) | UI: tipo de massa, ambiente TI/TRG, quantidade, disparo e monitoramento de jobs |
| **API** | **Express** (`server/index.js`) | REST: `/api/config`, `POST /api/jobs`, `GET /api/jobs`, `GET /api/jobs/:id` |
| **Fila** | **BullMQ** + **Redis** (`ioredis`) | Fila `fdl-vtal-mass`, retries, estado dos jobs |
| **Worker** | Node (`server/worker.js`) | Consome a fila e executa jobs (mesma lógica que o processador em modo memória) |
| **Execução de massa** | `child_process.spawn` (`server/runScript.js`) | `node <script>.js` com `cwd` na raiz do repositório e `ENVIRONMENT` + `envVars` |
| **Scripts de negócio** | `scripts/*.js` | Fluxos E2E (Salesforce, integrações, PEGA quando aplicável) |
| **Histórico** | **SQLite** (`server/data/mass-generator.sqlite`, `server/database.js`) | Execuções: status, duração, stdout/stderr, order number, campos parseados do log |

---

## 4. Fluxos principais

### 4.1 Disparo de job

1. Usuário seleciona tipo de massa, ambiente (`ti` | `trg`) e quantidade.
2. A API valida e cria **N jobs** na fila BullMQ (ou processa na memória em modo dev).
3. Cada job carrega: `script` (ex.: `gerar-pedido-massa-pronta-ip-connect-config-pega.js`), `environment`, `envVars` (ex.: IDs de conta em massa pronta).

### 4.2 Processamento

1. Worker (ou processador in-process) chama `runVtalScript`.
2. O script roda com credenciais/URLs definidas por **env** e **fixtures** (`support/fixtures`, `config/env`).
3. Ao terminar, o resultado é devolvido no **return value** do job e gravado em **`job_executions`** (SQLite).

### 4.3 Consulta

Lista e detalhe de jobs via API; histórico recente pode ser mesclado a partir do SQLite.

---

## 5. Integrações externas

Dependem do **script** executado (não da API em si):

- **Salesforce** (OAuth, APIs REST, integrações Aura quando aplicável).
- **PEGA** (token, APIs de ordem de serviço, fluxos de designação/configuração — conforme script).

Conectividade: **HTTPS** (e demais protocolos exigidos pelos fluxos) **apenas para endpoints de TI/TRG**, conforme política de rede.

---

## 6. Dados e persistência

| Dado | Onde |
|------|------|
| Fila de jobs | Redis (estruturas BullMQ) |
| Histórico de execuções | Tabela `job_executions` (SQLite) |
| Catálogo de tipos de massa | `server/config.js` (`MASS_TYPES` → arquivo em `scripts/`) |

**Evolução corporativa:** migração para **MySQL** (ou outro SGBD do catálogo) implica substituir/estender a camada em `server/database.js` e manter schema equivalente.

---

## 7. Segurança e ambientes

- Uso **interno**; exposição atrás de rede corporativa/VPN/Ingress conforme padrão da empresa.
- **Segredos:** variáveis de ambiente e fixtures — não versionar credenciais reais.

---

## 8. Decisões técnicas

| Decisão | Motivo |
|---------|--------|
| **BullMQ + Redis** | Fila de jobs madura em Node, retries, worker desacoplado |
| **Scripts como processos Node** | Reuso da automação CLI; isolamento por processo |
| **Express + frontend estático** | Deploy e operação simples |
| **SQLite no histórico** | Volume moderado para time interno; caminho claro para SGBD gerido |
| **TI/TRG via `ENVIRONMENT`** | Alinhamento ao negócio (sem produção) |

---

## 9. Implantação sugerida (referência)

- **Containers:** imagens para API e Worker (ou mesma imagem, comando distinto).
- **Redis:** serviço gerenciado ou cluster conforme catálogo de infra.
- **Banco:** MySQL gerido (se adotado) ou volume persistente para SQLite em ambiente controlado.
- **Proxy:** Nginx / Ingress com TLS na borda.

---

## 10. Glossário

| Termo | Significado |
|-------|-------------|
| **TDM** | Test Data Management / dados de teste |
| **DAS** | Documento de Arquitetura da Solução |
| **BullMQ** | Biblioteca de filas em Node.js sobre Redis |
