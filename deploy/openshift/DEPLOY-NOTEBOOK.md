# Deploy no notebook da empresa (sem Cursor)

Fluxo deste projeto: desenvolve no PC pessoal → GitHub → clone no notebook → OpenShift.

## Erro que você viu

```
COPY deploy/playwright-browsers /ms-playwright: no such file or directory
```

**Causa:** o Chromium do Playwright **não vai no GitHub** (pasta grande).
No notebook a pasta vem vazia / sem `chromium-*`. O build do OpenShift precisa dela.

## Comandos no notebook (CMD)

Na raiz do `fdl-vtal`, **nessa ordem**:

```cmd
deploy\prepare-playwright-browsers.cmd
deploy\openshift\deploy.cmd
```

Não rode só `oc start-build` sem o prepare.

Se o erro for `Error writing tar` / `chrome-headless-shell`:
o Playwright baixou extras que o Windows não consegue empacotar.
O `deploy.cmd` agora limpa isso sozinho; se ainda falhar:

```cmd
deploy\prune-playwright-browsers.cmd
deploy\openshift\deploy.cmd
```

## Se o prepare falhar por rede

No PC pessoal (onde o Chromium já foi baixado):

1. Zipar a pasta `deploy\playwright-browsers`
2. Copiar o zip para o notebook
3. Extrair no mesmo caminho: `fdl-vtal\deploy\playwright-browsers`
4. Rodar só: `deploy\openshift\deploy.cmd`

## Ver log do build no notebook

```cmd
oc get builds -n qualidade-automation-tdm-qa
oc logs -n qualidade-automation-tdm-qa build/NOME_DO_BUILD --tail=80
```

Troque `NOME_DO_BUILD` pelo nome que aparecer em `oc get builds` (ex.: `tdm-qa-42`).
