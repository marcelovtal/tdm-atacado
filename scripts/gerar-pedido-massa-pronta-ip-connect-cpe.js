/**
 * IP Connect Massa Pronta + CPE porte P.
 * Igual a gerar-pedido-massa-pronta-ip-connect.js, com CPE incluído após viabilidade
 * no ProductsValidation (save/advance) — trace cpe.har.
 */
process.env.INCLUDE_IP_CONNECT_CPE = '1';
require('./gerar-pedido-massa-pronta-ip-connect.js');
