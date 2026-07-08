/**
 * Script de teste QA — sempre falha (valida propositalmente 1 + 1 = 3).
 * Usado para testar auto-desativação do card após 4 falhas técnicas consecutivas.
 * Não acessa Salesforce, PEGA nem BRM.
 */
console.log('[TEST] Iniciando validação aritmética de teste...');

const a = 1;
const b = 1;
const esperado = 3;
const resultado = a + b;

console.log(`[TEST] Calculando: ${a} + ${b} = ${resultado} (esperado incorreto: ${esperado})`);

if (resultado !== esperado) {
  const msg = `Falha de teste: ${a} + ${b} = ${resultado}, mas a validação exige ${esperado}`;
  console.error(`ERRO (run 1): ${msg}`);
  process.exit(1);
}

console.log('[TEST] OK (não deveria chegar aqui)');
process.exit(0);
