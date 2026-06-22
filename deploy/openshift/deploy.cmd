@echo off
REM Deploy completo: apply + build + garante pods no ar.
REM Executar na raiz do repo: deploy\openshift\deploy.cmd

cd /d %~dp0\..\..
if errorlevel 1 exit /b 1

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
  echo Ver logs: oc logs build/tdm-qa-13 -n qualidade-automation-tdm-qa --tail=50
  echo         oc get builds -n qualidade-automation-tdm-qa
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
