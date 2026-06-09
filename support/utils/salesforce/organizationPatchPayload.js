/**
 * Payload para PATCH na conta Organization (Account) após conversão do Lead.
 * Preenche vtal_LXD_OrganizationName__c (e Name quando possível) com:
 * 1) vtal_LXD_FantasyName__c do GET (quando existir)
 * 2) Name padrão do Account (ex.: TRG muitas vezes não popula FantasyName, mas já traz Name)
 * 3) Company do Lead (UI-API)
 * 4) fallback (ex.: e2e-1730000000000) — use nos scripts de ativação quando org/TRG vem sem FantasyName
 *
 * Também grava vtal_LXD_FantasyName__c com o mesmo valor resolvido — obrigatório para geração de
 * pedido Link Dedicado / subpedidos em vários fluxos Vlocity.
 */
function resolveLxdFantasyName(fantasyName, options = {}) {
  const { accountName = '', companyFromLead = '', fallback = '' } = options || {};
  return (
    (fantasyName && String(fantasyName).trim()) ||
    (accountName && String(accountName).trim()) ||
    (companyFromLead && String(companyFromLead).trim()) ||
    (fallback && String(fallback).trim()) ||
    ''
  );
}

function buildOrganizationPatchPayload(fantasyName, options = {}) {
  const resolved = resolveLxdFantasyName(fantasyName, options);

  const payload = {
    vtal_LXD_OrganizationName__c: resolved,
  };
  if (resolved) {
    payload.Name = resolved;
    payload.vtal_LXD_FantasyName__c = resolved;
  }
  return payload;
}

module.exports = { buildOrganizationPatchPayload, resolveLxdFantasyName };
