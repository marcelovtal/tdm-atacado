# Diagnóstico OFS no OpenShift (notebook)

Os 3 testes "Massa Completa até Ativação" usam Playwright + supervisor OFS.
Local usa `support/fixtures/user.json`. No cluster o arquivo **não** entra na imagem.

## Mapa user.json → Secret

| user.json | Secret OpenShift |
|-----------|------------------|
| `ofs.ui_username` | `OFS_UI_USERNAME` (ou `OFS_USERNAME`) |
| `ofs.ui_password` | `OFS_UI_PASSWORD` (ou `OFS_PASSWORD`) |
| `ofs.username` (API REST) | `OFS_API_USERNAME` |
| `ofs.password` (API REST) | `OFS_API_PASSWORD` |
| org / tech / bucket TI vs TRG | **não** colocar `OFS_TECH_PID` / `OFS_BUCKET_PID` global — defaults no código |

São **duas senhas diferentes** no `user.json`:
- `ui_password` = supervisor (login Playwright)
- `password` = app password da API REST (Postman)

## Comandos (CMD no notebook)

```cmd
oc project qualidade-automation-tdm-qa

REM 1) Variaveis no worker
oc exec deploy/tdm-qa-worker -- printenv OFS_UI_USERNAME OFS_UI_PASSWORD OFS_USERNAME OFS_PASSWORD OFS_API_USERNAME PLAYWRIGHT_BROWSERS_PATH

REM 2) Chromium na imagem
oc exec deploy/tdm-qa-worker -- sh -c "ls /ms-playwright | head; test -x /ms-playwright/chromium-1208/chrome-linux64/chrome && echo CHROME_OK || echo CHROME_FALTA"

REM 3) user.json NAO deve existir
oc exec deploy/tdm-qa-worker -- sh -c "test -f support/fixtures/user.json && echo TEM_USER_JSON || echo SEM_USER_JSON"

REM 4) Logs do ultimo job OFS
oc logs deploy/tdm-qa-worker --tail=200 | findstr /I "OFS Playwright CSRF chromium login"
```

## Corrigir Secret (supervisor + API)

```cmd
oc set data secret/tdm-qa-secrets ^
  --from-literal=OFS_UI_USERNAME=vt422570 ^
  --from-literal=OFS_UI_PASSWORD=COLE_UI_PASSWORD ^
  --from-literal=OFS_API_USERNAME=qa@ofsvtal1.test ^
  --from-literal=OFS_API_PASSWORD=COLE_API_PASSWORD ^
  -n qualidade-automation-tdm-qa

oc rollout restart deployment/tdm-qa-api deployment/tdm-qa-worker -n qualidade-automation-tdm-qa
```

`COLE_UI_PASSWORD` = `ui_password` do user.json  
`COLE_API_PASSWORD` = `password` do bloco ofs (a string longa do Postman)

## Se Chromium faltar

```cmd
deploy\prepare-playwright-browsers.cmd
deploy\openshift\deploy.cmd
```
