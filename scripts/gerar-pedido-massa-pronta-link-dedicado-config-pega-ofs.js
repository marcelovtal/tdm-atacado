/**
 * Link Dedicado massa pronta + Config PEGA + instalação OFS (UI AJAX dispatcher).
 * Equivale a gerar-pedido-massa-pronta-link-dedicado-config-pega.js com INCLUDE_OFS_INSTALACAO=1.
 *
 * Fluxo OFS (após PEGA) — sequencial, uma ponta por vez:
 *   1. Ponta A: busca atividade → ativa rota → move → inicia → conclui
 *   2. Ponta B: busca atividade → move → inicia → conclui
 *      (OFS_PULAR_ATIVACAO_PONTA_B=1 ou OFS_PULAR_ATIVACAO_SEGUNDA_PONTA=1 pula ativar rota na B)
 *
 * Overrides opcionais:
 *   OFS_ORDEM_NUMERO_PONTA_A / OFS_ORDEM_NUMERO_PONTA_B
 *   SKIP_OFS=1 · OFS_USE_REST_API=1
 */
process.env.INCLUDE_OFS_INSTALACAO = '1';
require('./gerar-pedido-massa-pronta-link-dedicado.js');
