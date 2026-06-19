/**
 * VPN Massa Pronta + CPE porte P.
 * Igual a gerar-pedido-massa-pronta-vpn.js, com CPE incluído antes da viabilidade
 * no ProductsValidation (advance) — trace cpe.har.
 */
process.env.INCLUDE_VPN_CPE = '1';
require('./gerar-pedido-massa-pronta-vpn.js');
