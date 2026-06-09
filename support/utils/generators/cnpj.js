/**
 * Gerador de CNPJ válido (com dígitos verificadores corretos).
 * Uso: const { generateCNPJ } = require('../../support/utils/generators/cnpj.js');
 */

function randomNumber(length) {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += Math.floor(Math.random() * 10);
  }
  return result;
}

function randomFromArray(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Gera um CNPJ válido (formato 00.000.000/0000-00).
 * @returns {string} CNPJ formatado
 */
function generateCNPJ() {
  const cnpj = randomNumber(12);

  const calcDigit = (base) => {
    const factors = base.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

    let total = 0;
    for (let i = 0; i < factors.length; i++) {
      total += parseInt(base[i], 10) * factors[i];
    }

    const rest = total % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  const digit1 = calcDigit(cnpj);
  const digit2 = calcDigit(cnpj + String(digit1));
  const fullCNPJ = cnpj + String(digit1) + String(digit2);

  return fullCNPJ.replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    '$1.$2.$3/$4-$5'
  );
}

module.exports = { generateCNPJ, randomNumber, randomFromArray };
