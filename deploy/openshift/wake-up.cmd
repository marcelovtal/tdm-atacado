@echo off
REM Sobe API + Worker do atacado (tdm-qa) apos build ou queda por quota.
REM Uso: deploy\openshift\wake-up.cmd

oc project qualidade-automation-tdm-qa
if errorlevel 1 exit /b 1

oc apply -f deploy/openshift/deployment-api.yaml
oc apply -f deploy/openshift/deployment-worker.yaml
oc scale deployment/tdm-qa-api deployment/tdm-qa-worker --replicas=1

echo.
echo --- Status ---
oc get deployment tdm-qa-api tdm-qa-worker
oc get pods -l app=tdm-qa
oc get resourcequota resource-quota-large

echo.
echo URL: https://atacado-qualidade-automation-tdm-qa.apps.ocparc-nprd.vtal.intra/login.html
