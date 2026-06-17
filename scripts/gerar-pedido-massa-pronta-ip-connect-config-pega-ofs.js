/**
 * IP Connect massa pronta + Config PEGA + instalação OFS (UI AJAX dispatcher).
 * Equivale a gerar-pedido-massa-pronta-ip-connect-config-pega.js com INCLUDE_OFS_INSTALACAO=1.
 *
 * Fluxo OFS (após PEGA, quando subpedido existe no dispatcher):
 *   1. Busca atividade pelo número do subpedido (search UI)
 *   2. Ativa rota do técnico (+ cancela refeição se houver)
 *   3. Move ordem do bucket para o técnico
 *   4. Inicia e conclui a atividade
 *
 * Ambiente TRG: https://ofsvtal3.test.fs.ocs.oraclecloud.com
 *
 * Credenciais supervisor (login dispatcher — distinto do REST Postman):
 *   OFS_USERNAME=vt422570
 *   OFS_PASSWORD=...
 *   node scripts/run-ofs-ui-login-playwright.js  → cache em .auth/trg/ofs-ui-session.json
 *
 * Técnico padrão (GERALDO DE PADUA PAIVA):
 *   OFS_TECH_PID=881
 *   OFS_TECH_SEARCH=geraldo
 *   OFS_TARGET_DATE=2026-06-15   (data na rota do técnico)
 *   OFS_BUCKET_PID=3457
 *
 * Opcionais:
 *   SKIP_OFS=1 — pula OFS
 *   OFS_USE_REST_API=1 — usa REST Postman (legado) em vez da UI AJAX
 *   OFS_ORDEM_NUMERO — força número CRM (senão usa subpedido)
 *   OFS_ACTIVITY_ID — pula busca por appt_number
 *   OFS_PULAR_ATIVACAO=1 — não ativa rota (só se técnico já ativo)
 *   OFS_ACTIVITY_POLL_MAX_TRIES / OFS_ACTIVITY_POLL_MS — espera atividade pós-PEGA no OFS
 */
process.env.INCLUDE_OFS_INSTALACAO = '1';
require('./gerar-pedido-massa-pronta-ip-connect-config-pega.js');
