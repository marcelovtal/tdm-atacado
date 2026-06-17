const { createOfsUiApiClient } = require('./ofsUiApiClient.js');
const { getOfsUiConfigAsync } = require('./getOfsUiConfig.js');
const { todayIsoInTimeZone } = require('./runOfsInstalacaoCompleta.js');

/**
 * Pré-requisito OFS antes de mover ordem para o técnico (paridade vtal-mcp Playwright).
 *
 * Fluxo mapeado dos curls DevTools:
 *  1. sync(load rota) — pid=técnico, requestedAid vazio, dq=data
 *  2. sync(ativar)    — queue mobile_activate_queue (s=253, aId=9), aids=["-1465"]
 *  3. sync(refresh)   — skip_delta=1
 *  4. sync(load refeição) + mobile_cancel_activity (s=309, aId=10) — se aworktype=2 / Refeição
 *
 * Sem refeição cadastrada: passo 4 é ignorado.
 */
async function runOfsAtivarRotaUi(options = {}) {
  const cfg = options.uiConfig || (await getOfsUiConfigAsync(options));
  const client = options.client || createOfsUiApiClient(cfg);

  const techPid = (process.env.OFS_TECH_PID || options.techPid || cfg.tech_pid || '').trim();
  if (!techPid) {
    throw new Error('OFS UI: OFS_TECH_PID obrigatório para ativar rota.');
  }

  const targetDate =
    (process.env.OFS_TARGET_DATE || options.targetDate || '').trim() || todayIsoInTimeZone();

  console.log(`[OFS-UI] ativar rota | técnico pid=${techPid} | data=${targetDate}`);

  const prep = await client.prepareTechnicianRouteForWork({ techPid, targetDate });

  console.log('\n*** OFS ATIVAR ROTA (UI AJAX) ***');
  console.log('  Técnico pid:', techPid);
  console.log('  Data:', targetDate);
  console.log('  Rota:', prep.rota.mensagem);
  console.log('  Refeição:', prep.refeicao.mensagem);

  return {
    ofsTechPid: techPid,
    ofsTargetDate: targetDate,
    ofsRotaAtivada: prep.rota.ativada,
    ofsRotaMensagem: prep.rota.mensagem,
    ofsRefeicaoCancelada: prep.refeicao.cancelada,
    ofsRefeicaoMensagem: prep.refeicao.mensagem,
    ofsRefeicaoAid: prep.refeicao.aid ?? null,
    ofsMode: 'ui-ajax',
  };
}

module.exports = { runOfsAtivarRotaUi };
