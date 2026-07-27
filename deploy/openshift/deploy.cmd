@echo off
REM Deploy completo: prepare Playwright (obrigatorio) + apply + build + pods.
REM No notebook da empresa rode SEMPRE este script (nao rode oc start-build sozinho).
REM Executar na raiz do repo: deploy\openshift\deploy.cmd

cd /d %~dp0\..\..
if errorlevel 1 exit /b 1

echo === Chromium Playwright ^(OpenShift^) ===
dir /b deploy\playwright-browsers 2>nul | findstr /I /B /C:"chromium-" >nul
if errorlevel 1 (
  echo.
  echo ************************************************************
  echo  FALTA o Chromium em deploy\playwright-browsers
  echo  Isso NAO vem do GitHub — precisa gerar no notebook.
  echo ************************************************************
  echo.
  echo Rodando deploy\prepare-playwright-browsers.cmd ...
  call deploy\prepare-playwright-browsers.cmd
  if errorlevel 1 (
    echo.
    echo ************************************************************
    echo  FALHOU preparar Chromium.
    echo  Sem isso o build OpenShift quebra ^(COPY playwright-browsers^).
    echo.
    echo  Opcoes:
    echo  1^) Rode de novo: deploy\prepare-playwright-browsers.cmd
    echo  2^) Ou copie a pasta deploy\playwright-browsers do PC pessoal
    echo     ^(zip^) para este notebook no mesmo caminho.
    echo ************************************************************
    exit /b 1
  )
) else (
  echo Chromium ja presente em deploy\playwright-browsers — ok.
)

REM Remove headless/ffmpeg/.links — quebram o tar do oc no Windows
call deploy\prune-playwright-browsers.cmd
if errorlevel 1 (
  echo [ERRO] Limpeza do Playwright falhou. Rode: deploy\prepare-playwright-browsers.cmd
  exit /b 1
)

REM Garante que nao vamos subir build sem chromium
dir /b deploy\playwright-browsers 2>nul | findstr /I /B /C:"chromium-" >nul
if errorlevel 1 (
  echo [ERRO] Ainda sem chromium-*. Abortando antes do oc start-build.
  exit /b 1
)

oc project qualidade-automation-tdm-qa
if errorlevel 1 exit /b 1

echo === Aplicando manifests ===
oc apply -f deploy/openshift/serviceaccount.yaml
oc apply -f deploy/openshift/configmap.yaml
oc apply -f deploy/openshift/deployment-api.yaml
oc apply -f deploy/openshift/deployment-worker.yaml
oc apply -f deploy/openshift/route.yaml
oc apply -f deploy/openshift/keepalive-cronjob.yaml

echo === Garantindo 1 replica (API + Worker) ===
oc scale deployment/tdm-qa-api deployment/tdm-qa-worker --replicas=1

echo === Build da imagem ===
oc start-build tdm-qa --from-dir=. --wait
if errorlevel 1 (
  echo.
  echo BUILD FALHOU — pods continuam com imagem antiga.
  echo Ver builds: oc get builds -n qualidade-automation-tdm-qa
  echo Ver log:    oc logs -n qualidade-automation-tdm-qa build/NOME_DO_BUILD --tail=80
  exit /b 1
)

echo === Reiniciando pods com imagem nova ===
oc rollout restart deployment/tdm-qa-api deployment/tdm-qa-worker

echo === Aguardando rollout ===
oc rollout status deployment/tdm-qa-api --timeout=180s
oc rollout status deployment/tdm-qa-worker --timeout=180s

echo.
echo === Status ===
oc get deployment tdm-qa-api tdm-qa-worker
oc get pods -l app=tdm-qa
oc get route atacado

echo.
echo URL: https://atacado-qualidade-automation-tdm-qa.apps.ocparc-nprd.vtal.intra/login.html
