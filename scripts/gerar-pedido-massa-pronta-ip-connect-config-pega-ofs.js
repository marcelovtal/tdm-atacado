/**
 * IP Connect massa pronta + Config PEGA + instalação OFS (API).
 * Equivale a gerar-pedido-massa-pronta-ip-connect-config-pega.js com INCLUDE_OFS_INSTALACAO=1.
 *
 * OFS — hosts (auto por ENVIRONMENT=ti|trg se omitir OFS_BASE_URL):
 *   TI:  https://ofsvtal1.test.fs.ocs.oraclecloud.com
 *   TRG: https://ofsvtal3.test.fs.ocs.oraclecloud.com
 * API (collection ofsvtal1.test.postman_collection.json):
 *   username: qa@ofsvtal1.test
 *   password: auth.basic da collection (Basic Auth)
 *   resource_id: TEC_TESTE_01 (move/PATCH na collection)
 * Configure em support/fixtures/user.json → ofs ou env:
 *   OFS_BASE_URL, OFS_USERNAME, OFS_PASSWORD, OFS_RESOURCE_ID
 *   (ou OFS_TI_* / OFS_TRG_* no Secret OpenShift)
 *
 * Opcionais:
 *   SKIP_OFS=1 — pula OFS
 *   OFS_ORDEM_NUMERO — força número CRM (senão usa subpedido)
 *   OFS_PULAR_ATIVACAO=1 — não chama bulkUpdateWorkSchedules
 *   OFS_ACTIVITY_POLL_MAX_TRIES / OFS_ACTIVITY_POLL_MS — espera atividade pós-PEGA
 *   OFS_START_BODY_JSON / OFS_COMPLETE_BODY_JSON — corpo customizado start/complete
 */
process.env.INCLUDE_OFS_INSTALACAO = '1';
require('./gerar-pedido-massa-pronta-ip-connect-config-pega.js');
