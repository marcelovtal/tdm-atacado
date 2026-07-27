@echo off
REM Remove extras do Playwright que quebram o oc start-build no Windows
REM (symlinks .links, chromium_headless_shell, ffmpeg). Mantem so chromium-*.
REM Uso (qualquer pasta): deploy\prune-playwright-browsers.cmd

setlocal EnableExtensions
cd /d %~dp0\..
if errorlevel 1 exit /b 1

set "OUT_DIR=deploy\playwright-browsers"

echo Pasta do projeto: %CD%

if not exist "%OUT_DIR%" (
  echo [prune] pasta %CD%\%OUT_DIR% ausente.
  echo Rode antes: deploy\prepare-playwright-browsers.cmd
  endlocal
  exit /b 1
)

echo === Limpando extras em %OUT_DIR% ^(so chromium-* fica^) ===

if exist "%OUT_DIR%\.links" (
  echo Removendo .links
  rmdir /s /q "%OUT_DIR%\.links"
)

for /d %%D in ("%OUT_DIR%\*") do (
  echo %%~nxD | findstr /I /B /C:"chromium-" >nul
  if errorlevel 1 (
    echo Removendo %%~nxD
    rmdir /s /q "%%D"
  )
)

dir /b "%OUT_DIR%" 2>nul | findstr /I /B /C:"chromium-" >nul
if errorlevel 1 (
  echo [ERRO] Apos limpeza nao restou pasta chromium-*.
  echo Rode: deploy\prepare-playwright-browsers.cmd
  endlocal
  exit /b 1
)

for /d %%D in ("%OUT_DIR%\chromium-*") do (
  if not exist "%%D\chrome-linux64\chrome" if not exist "%%D\chrome-linux\chrome" (
    echo [ERRO] Binario chrome ausente em %%D
    echo Rode: deploy\prepare-playwright-browsers.cmd
    endlocal
    exit /b 1
  )
)

echo Conteudo final:
dir /b "%OUT_DIR%"
endlocal
exit /b 0
