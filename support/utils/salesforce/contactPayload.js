/**
 * Payload para criação de Contact na conta Business (sobjects/Contact).
 * Principal: vlocity_cmt__Type__c = "Principal".
 * Técnico: vlocity_cmt__Type__c = "Technical" (valor da API) e FirstName com prefixo "Tec " para diferenciar.
 */
const { faker } = require('@faker-js/faker');

const RECORD_TYPE_ID = '012U60000006twIIAQ';

/**
 * @param {string} accountId - AccountBussinessId
 * @param {'Principal' | 'Technical'} contactType
 * @returns {Object} payload para POST /services/data/v62.0/sobjects/Contact
 */
function buildContactPayload(accountId, contactType) {
  const isTecnico = contactType === 'Technical';
  const firstName = isTecnico ? `Tec ${faker.person.firstName()}` : faker.person.firstName();
  const lastName = faker.person.lastName();
  const email = faker.internet.email({ firstName: firstName.replace(/^Tec\s+/, ''), lastName }).toLowerCase();
  const phone = `11${faker.string.numeric(9)}`;
  const mobilePhone = `11${faker.string.numeric(9)}`;

  return {
    FirstName: firstName,
    LastName: lastName,
    Email: email,
    Phone: phone,
    MobilePhone: mobilePhone,
    AccountId: accountId,
    RecordTypeId: RECORD_TYPE_ID,
    vlocity_cmt__Type__c: contactType,
  };
}

module.exports = { buildContactPayload };
