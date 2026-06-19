/**
 * Link Dedicado Massa Pronta + CPE porte P (Ponta A ou B).
 * Igual a gerar-pedido-massa-pronta-link-dedicado.js; CPE no passo 25 (advance com EVC + pontas + Child.CPE).
 */
process.env.INCLUDE_LD_CPE = '1';
require('./gerar-pedido-massa-pronta-link-dedicado.js');
