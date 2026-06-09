/**
 * Contexto com o resultado da conversão de Lead (preenchido ao final do step
 * "Quando eu crio um Lead, marco como Contacted e converto").
 * Usado pelo fluxo orçamento → cotação → viabilidade → pedido.
 */
let conversionOutput = null;
let contactTecnicoIdStored = null;

function setConversionOutput(out) {
  conversionOutput = out;
}

function setContactTecnicoId(id) {
  contactTecnicoIdStored = id;
}

function getContactTecnicoId() {
  return contactTecnicoIdStored || null;
}

function getConversionOutput() {
  return conversionOutput;
}

function getAccountBillingId() {
  return conversionOutput?.AccountBillingId || null;
}

function getAccountBussinessId() {
  return conversionOutput?.AccountBussinessId || null;
}

function getAccountOrganizationId() {
  return conversionOutput?.AccountOrganizationId || null;
}

function getContactId() {
  return conversionOutput?.ContactId || null;
}

function clear() {
  conversionOutput = null;
  contactTecnicoIdStored = null;
}

module.exports = {
  setConversionOutput,
  setContactTecnicoId,
  getConversionOutput,
  getAccountBillingId,
  getAccountBussinessId,
  getAccountOrganizationId,
  getContactId,
  getContactTecnicoId,
  clear,
};
