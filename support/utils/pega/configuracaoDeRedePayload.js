/**
 * PATCH .../CONFIGURACAODEREDE/actions/ConfiguracaoDeRede (fluxo VPN — antes de DesignarFacilidadeDados).
 *
 * IDs de rede seguem **YYYYMMDDHH** (ano + mês + dia + hora 24h), ex.: 2026-04-06 16h → `2026040616`.
 */

/** @returns {{ key: string, num: number }} key com 10 dígitos, num = parseInt(key) */
function redeTimestampFromDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const key = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}`;
  return { key, num: parseInt(key, 10) };
}

/** Compat: mesmo valor numérico YYYYMMDDHH. */
function defaultNumericId() {
  return redeTimestampFromDate().num;
}

function buildConfiguracaoDeRedeBody(overrides = {}) {
  const cr = overrides.configuracaoRede || {};
  const fromEnv = process.env.PEGA_CONFIG_REDE_ID_NUMERIC
    ? parseInt(String(process.env.PEGA_CONFIG_REDE_ID_NUMERIC).trim(), 10)
    : null;
  const ts =
    cr.idNumerico != null
      ? { key: String(cr.idNumerico), num: Number(cr.idNumerico) }
      : Number.isFinite(fromEnv)
        ? { key: String(fromEnv), num: fromEnv }
        : redeTimestampFromDate();

  const n = ts.num;
  /** Postman: RouteDistinguisher costuma ir como string; demais como número. */
  const routeDistinguisher =
    cr.routeDistinguisher != null ? cr.routeDistinguisher : ts.key;

  return {
    content: {
      ConfiguracaoRede: {
        Encaminhar: cr.encaminhar != null ? cr.encaminhar : 'Configurado com Sucesso',
        NomeVpn: cr.nomeVpn != null ? cr.nomeVpn : (process.env.PEGA_VPN_NOME || 'AUTVPN').trim(),
        ServiceIdNokia: cr.serviceIdNokia != null ? cr.serviceIdNokia : n,
        ServiceIdNokiaMetro: cr.serviceIdNokiaMetro != null ? cr.serviceIdNokiaMetro : n,
        RouteDistinguisher: routeDistinguisher,
        RouteTarget: cr.routeTarget != null ? cr.routeTarget : n,
        InformacoesComplementares:
          cr.informacoesComplementares != null
            ? cr.informacoesComplementares
            : (process.env.PEGA_CONFIG_REDE_INFO || 'TESTE').trim(),
      },
    },
    pageInstructions: [],
  };
}

module.exports = { buildConfiguracaoDeRedeBody, defaultNumericId, redeTimestampFromDate };
