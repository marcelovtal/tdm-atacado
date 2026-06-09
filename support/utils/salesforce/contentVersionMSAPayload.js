/**
 * Payload para criação do ContentVersion (anexo MSA).
 * VersionData = conteúdo em base64. Para teste usa texto mínimo; opcionalmente ler de support/fixtures/msa.b64.
 */
const path = require('path');
const fs = require('fs');

const DEFAULT_TITLE = 'Contrato MSA - Empresa Teste';
const DEFAULT_PATH_ON_CLIENT = 'MSA.txt';

// Conteúdo mínimo em base64 para o teste (evita depender de arquivo externo)
const DEFAULT_VERSION_DATA_B64 = Buffer.from('Contrato MSA - documento de teste para automação.', 'utf-8').toString('base64');

/**
 * Retorna o base64 do conteúdo MSA. Tenta ler support/fixtures/msa.b64; senão usa default.
 */
function getVersionDataBase64() {
  const fixturePath = path.resolve(process.cwd(), 'support', 'fixtures', 'msa.b64');
  try {
    if (fs.existsSync(fixturePath)) {
      return fs.readFileSync(fixturePath, 'utf-8').trim();
    }
  } catch (_) {}
  return DEFAULT_VERSION_DATA_B64;
}

/**
 * Payload para POST ContentVersion.
 * @param {{ title?: string, pathOnClient?: string }} options
 */
function buildContentVersionMSAPayload(options = {}) {
  return {
    VersionData: getVersionDataBase64(),
    PathOnClient: options.pathOnClient ?? DEFAULT_PATH_ON_CLIENT,
    Title: options.title ?? DEFAULT_TITLE,
  };
}

module.exports = { buildContentVersionMSAPayload, getVersionDataBase64 };
