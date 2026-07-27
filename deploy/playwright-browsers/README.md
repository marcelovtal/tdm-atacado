# Chromium Linux para OpenShift (Playwright)

Esta pasta **não** leva o Chromium no Git (arquivos grandes).
No notebook da empresa ela vem vazia — por isso o build falha com:

```
COPY deploy/playwright-browsers /ms-playwright: no such file or directory
```

## No notebook da empresa (CMD, na raiz do fdl-vtal)

```cmd
deploy\prepare-playwright-browsers.cmd
deploy\openshift\deploy.cmd
```

O prepare baixa o Chromium e **apaga extras** (`chromium_headless_shell`, `ffmpeg`, `.links`)
que quebram o upload do `oc start-build` no Windows.

Se o deploy disser "Chromium ja presente" mas o upload falhar no tar,
rode de novo o prepare (ou só `deploy\prune-playwright-browsers.cmd`) e depois o deploy.

## Alternativa (sem internet no notebook)

No PC pessoal (onde o prepare já rodou), zipar a pasta
`deploy\playwright-browsers` e copiar para o mesmo caminho no notebook.
Depois só:

```cmd
deploy\openshift\deploy.cmd
```
