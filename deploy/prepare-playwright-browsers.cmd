@echo off
REM Prepara Chromium Linux do Playwright para empacotar na imagem OpenShift.
REM Preferencia: download via npx (sem Docker). Fallback: Docker Desktop.
REM Uso: deploy\prepare-playwright-browsers.cmd

setlocal EnableExtensions
cd /d %~dp0\..\..
if errorlevel 1 exit /b 1

REM Manter alinhado com package-lock.json (playwright 1.58.0)
set PW_VERSION=1.58.0
set OUT_DIR=deploy\playwright-browsers

echo === Preparando Chromium Playwright %PW_VERSION% ^(Linux^) ===
echo Destino: %OUT_DIR%
echo.

REM --- Caminho 1: npx (funciona no Windows com override de plataforma) ---
where node >nul 2>&1
if not errorlevel 1 (
  echo === Tentando download via npx playwright ===
  if exist "%OUT_DIR%" rmdir /s /q "%OUT_DIR%"
  mkdir "%OUT_DIR%"
  set "PLAYWRIGHT_BROWSERS_PATH=%CD%\%OUT_DIR%"
  set "PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu22.04-x64"
  set "NODE_OPTIONS=--use-system-ca"
  call npx playwright install chromium
  REM Exit code pode ser !=0 por causa do winldd; chromium ja basta.
  dir /b "%OUT_DIR%" 2>nul | findstr /I "chromium-" >nul
  if not errorlevel 1 (
    echo.
    echo === OK ^(npx^) ===
    echo Chromium pronto em %OUT_DIR%
    dir /b "%OUT_DIR%"
    echo.
    echo Agora rode: deploy\openshift\deploy.cmd
    endlocal
    exit /b 0
  )
  echo [AVISO] npx nao deixou chromium utilizavel. Tentando Docker...
)

REM --- Caminho 2: Docker ---
where docker >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Sem Chromium via npx e Docker nao encontrado.
  echo Abra o Docker Desktop ou corrija o certificado/rede do npx.
  exit /b 1
)

docker info >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Docker instalado, mas o daemon nao esta rodando.
  echo Abra o Docker Desktop e rode este script de novo.
  exit /b 1
)

set PW_IMAGE=mcr.microsoft.com/playwright:v%PW_VERSION%-jammy
set CONTAINER_NAME=tdm-qa-pw-extract

echo.
echo === docker pull %PW_IMAGE% ===
docker pull %PW_IMAGE%
if errorlevel 1 (
  echo [ERRO] Falha ao puxar a imagem Playwright.
  exit /b 1
)

docker rm -f %CONTAINER_NAME% >nul 2>&1
docker create --name %CONTAINER_NAME% %PW_IMAGE%
if errorlevel 1 (
  echo [ERRO] docker create falhou.
  exit /b 1
)

if exist "%OUT_DIR%" rmdir /s /q "%OUT_DIR%"
mkdir "%OUT_DIR%"
docker cp %CONTAINER_NAME%:/ms-playwright/. "%OUT_DIR%\"
if errorlevel 1 (
  echo [ERRO] docker cp falhou.
  docker rm -f %CONTAINER_NAME% >nul 2>&1
  exit /b 1
)
docker rm -f %CONTAINER_NAME% >nul 2>&1

dir /b "%OUT_DIR%" | findstr /I "chromium" >nul
if errorlevel 1 (
  echo [ERRO] Pasta %OUT_DIR% sem chromium apos extracao.
  exit /b 1
)

echo.
echo === OK ^(Docker^) ===
echo Chromium pronto em %OUT_DIR%
dir /b "%OUT_DIR%"
echo.
echo Agora rode: deploy\openshift\deploy.cmd
endlocal
exit /b 0
