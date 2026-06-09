/**
 * Monta o payload genérico para criação de Lead no Salesforce (Faker + CNPJ).
 * Uso: const payload = buildLeadPayload(); // ou buildLeadPayload({ Company: 'Nome fixo' })
 */
const { faker } = require('@faker-js/faker');
const { generateCNPJ, randomNumber } = require('../generators/cnpj.js');

/**
 * Gera um payload de Lead com dados aleatórios (genérico para testes).
 * @param {Object} overrides - Campos a sobrescrever (ex.: { Company: 'Minha Empresa' })
 * @returns {Object} { apiName, fields } no formato da API ui-api/records
 */
function buildLeadPayload(overrides = {}) {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  const company = faker.company.name();
  const email = faker.internet.email({ firstName, lastName }).toLowerCase();
  const phone = `11${randomNumber(8)}`;
  const mobilePhone = `11${randomNumber(9)}`;
  const cnpj = generateCNPJ();

  const fields = {
    FirstName: firstName,
    LastName: lastName,
    Company: company,
    Email: email,
    Phone: phone,
    MobilePhone: mobilePhone,
    LeadSource: 'Anuncio',
    vtal_LXD_CNPJ__c: cnpj,
    ...overrides,
  };

  return {
    apiName: 'Lead',
    fields,
  };
}

module.exports = { buildLeadPayload };
