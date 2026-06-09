/**
 * Captura logs por BDD step para anexar ao Allure (step by step).
 * startStep() no início do step; getLogsAndClear() no fim e anexar ao step atual.
 */

let buffer = [];
let capturing = false;

function startStep() {
  buffer = [];
  capturing = true;
}

function append(line) {
  if (capturing && line != null) {
    buffer.push(String(line));
  }
}

function getLogsAndClear() {
  const text = buffer.join('\n');
  buffer = [];
  capturing = false;
  return text;
}

function isCapturing() {
  return capturing;
}

module.exports = { startStep, append, getLogsAndClear, isCapturing };
