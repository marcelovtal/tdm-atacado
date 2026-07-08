import { MASS_TYPES } from './config.js';

/** Metadados de UI por tipo — catálogo canônico continua em MASS_TYPES (script/label). */
const UI_BY_ID = {
  'lead-pedido': {
    cardClass: 'choice-card--primary',
    subtitle: 'Fluxo completo até criação do pedido (IP Connect)',
    formVariant: null,
    flowSteps: ['IP', 'Lead', 'SF'],
  },
  'massa-pronta-opp-pedido': {
    cardClass: 'choice-card--massa-pronta',
    subtitle: 'Massa já cadastrada até BRM. Só Opp → Cotação → Pedido',
    formVariant: 'massa-pronta-triple',
    flowSteps: ['IP', 'SF'],
  },
  'massa-pronta-opp-pedido-ip-connect-cpe': {
    cardClass: 'choice-card--massa-pronta-cpe',
    subtitle: 'Massa pronta + CPE porte P após viabilidade (Opp → Cotação → Pedido)',
    formVariant: 'massa-pronta-triple',
    flowSteps: ['IP', 'SF', 'CPE'],
  },
  'massa-pronta-opp-pedido-pega': {
    cardClass: 'choice-card--massa-pronta-pega',
    subtitle: 'Mesmo fluxo + designação/ configuração no (PEGA)',
    formVariant: 'massa-pronta-triple',
    flowSteps: ['IP', 'SF', 'PEGA'],
  },
  'massa-pronta-opp-pedido-pega-ofs': {
    cardClass: 'choice-card--massa-pronta-pega-ofs',
    subtitle: 'Massa pronta + PEGA + instalação OFS (UI dispatcher — até conclusão em campo)',
    formVariant: 'massa-pronta-triple',
    flowSteps: ['IP', 'SF', 'PEGA', 'OFS'],
  },
  'lead-link-dedicado-pedido': {
    cardClass: 'choice-card--link-dedicado',
    subtitle: 'Fluxo completo até criação do pedido (3 pontas: A, B, EVC)',
    formVariant: null,
    flowSteps: ['LD', 'Lead', 'SF'],
  },
  'massa-pronta-opp-pedido-link-dedicado': {
    cardClass: 'choice-card--massa-pronta-link-dedicado',
    subtitle: 'Massa já cadastrada até BRM. Só Opp → Cotação → Pedido com produto Link Dedicado',
    formVariant: 'massa-pronta-triple',
    flowSteps: ['LD', 'SF'],
  },
  'massa-pronta-opp-pedido-link-dedicado-cpe': {
    cardClass: 'choice-card--massa-pronta-cpe',
    subtitle: 'Massa pronta LD + CPE porte P em Ponta A ou B antes da viabilidade',
    formVariant: 'massa-pronta-triple',
    flowSteps: ['LD', 'SF', 'CPE'],
  },
  'massa-pronta-opp-pedido-link-dedicado-pega': {
    cardClass: 'choice-card--massa-pronta-link-dedicado-pega',
    subtitle: 'Mesmo fluxo Salesforce + PEGA nas duas pontas (designação Ponta A; agendamento Ponta B)',
    formVariant: 'massa-pronta-triple',
    flowSteps: ['LD', 'SF', 'PEGA'],
  },
  'massa-pronta-opp-pedido-link-dedicado-pega-ofs': {
    cardClass: 'choice-card--massa-pronta-link-dedicado-pega-ofs',
    subtitle: 'Massa pronta + PEGA LD + OFS nas Pontas A e B (UI dispatcher — sequencial)',
    formVariant: 'massa-pronta-triple',
    flowSteps: ['LD', 'SF', 'PEGA', 'OFS'],
  },
  'lead-vpn-pedido': {
    cardClass: 'choice-card--vpn',
    subtitle: 'Fluxo completo até criação do pedido(VPN)',
    formVariant: null,
    flowSteps: ['VPN', 'Lead', 'SF'],
  },
  'massa-pronta-opp-pedido-vpn': {
    cardClass: 'choice-card--massa-pronta-vpn',
    subtitle: 'Massa já cadastrada até BRM. Só Opp → Cotação → Pedido com produto VPN',
    formVariant: 'massa-pronta-triple',
    flowSteps: ['VPN', 'SF'],
  },
  'massa-pronta-opp-pedido-vpn-cpe': {
    cardClass: 'choice-card--massa-pronta-cpe',
    subtitle: 'Massa pronta VPN + CPE porte P antes da viabilidade (Opp → Cotação → Pedido)',
    formVariant: 'massa-pronta-triple',
    flowSteps: ['VPN', 'SF', 'CPE'],
  },
  'massa-pronta-opp-pedido-vpn-pega': {
    cardClass: 'choice-card--massa-pronta-vpn-pega',
    subtitle: 'Mesmo fluxo VPN + Configuração de rede PEGA e etapas até agendamento',
    formVariant: 'massa-pronta-triple',
    flowSteps: ['VPN', 'SF', 'PEGA'],
  },
  'massa-pronta-opp-pedido-vpn-pega-ofs': {
    cardClass: 'choice-card--massa-pronta-vpn-pega-ofs',
    subtitle: 'Massa pronta + PEGA VPN + instalação OFS (UI dispatcher — até conclusão em campo)',
    formVariant: 'massa-pronta-triple',
    flowSteps: ['VPN', 'SF', 'PEGA', 'OFS'],
  },
  'conta-ativacao-brm': {
    cardClass: 'choice-card--accent',
    subtitle: 'Só até conta Billing ativa no BRM',
    formVariant: null,
    flowSteps: ['BRM'],
  },
  'conta-ativacao-brm-msa': {
    cardClass: 'choice-card--accent',
    subtitle: 'Inclui contrato MSA + PDF + BRM',
    formVariant: null,
    flowSteps: ['SF', 'MSA', 'BRM'],
  },
  'conta-ativacao-brm-massa-pronta': {
    cardClass: 'choice-card--brm-massa-pronta',
    subtitle: 'Massa completa já existe — só integra a Billing no BRM (getAccount + poll)',
    formVariant: 'brm-massa-pronta',
    flowSteps: ['BRM'],
  },
  'test-falha-1-mais-1': {
    cardClass: 'choice-card--test-falha',
    subtitle: 'Sempre falha (1+1≠3). Use para testar inativação após 4 erros técnicos consecutivos',
    formVariant: null,
    flowSteps: ['QA'],
  },
};

export const MASS_CATEGORIES = [
  {
    id: 'ip-connect',
    title: 'IP Connect',
    hint: 'gerar-pedido-ip-connect.js · gerar-pedido-massa-pronta-ip-connect.js · gerar-pedido-massa-pronta-ip-connect-cpe.js · gerar-pedido-massa-pronta-ip-connect-config-pega.js · gerar-pedido-massa-pronta-ip-connect-config-pega-ofs.js',
    typeIds: ['lead-pedido', 'massa-pronta-opp-pedido', 'massa-pronta-opp-pedido-ip-connect-cpe', 'massa-pronta-opp-pedido-pega', 'massa-pronta-opp-pedido-pega-ofs'],
  },
  {
    id: 'link-dedicado',
    title: 'Link Dedicado',
    hint: 'gerar-pedido-link-dedicado.js · gerar-pedido-massa-pronta-link-dedicado.js · gerar-pedido-massa-pronta-link-dedicado-cpe.js · gerar-pedido-massa-pronta-link-dedicado-config-pega.js · gerar-pedido-massa-pronta-link-dedicado-config-pega-ofs.js',
    typeIds: [
      'lead-link-dedicado-pedido',
      'massa-pronta-opp-pedido-link-dedicado',
      'massa-pronta-opp-pedido-link-dedicado-cpe',
      'massa-pronta-opp-pedido-link-dedicado-pega',
      'massa-pronta-opp-pedido-link-dedicado-pega-ofs',
    ],
  },
  {
    id: 'vpn',
    title: 'VPN',
    hint: 'gerar-pedido-vpn.js · gerar-pedido-massa-pronta-vpn.js · gerar-pedido-massa-pronta-vpn-connect-cpe.js · gerar-pedido-massa-pronta-vpn-connect-config-pega.js · gerar-pedido-massa-pronta-vpn-connect-config-pega-ofs.js',
    typeIds: [
      'lead-vpn-pedido',
      'massa-pronta-opp-pedido-vpn',
      'massa-pronta-opp-pedido-vpn-cpe',
      'massa-pronta-opp-pedido-vpn-pega',
      'massa-pronta-opp-pedido-vpn-pega-ofs',
    ],
  },
  {
    id: 'brm',
    title: 'Outros (ativação / BRM)',
    hint: 'ativacao-brm.js · ativacao-brm-msa.js · ativacao-brm-massa-pronta.js',
    typeIds: ['conta-ativacao-brm', 'conta-ativacao-brm-msa', 'conta-ativacao-brm-massa-pronta'],
  },
  {
    id: 'testes-qa',
    title: 'Testes / QA',
    hint: 'test-falha-1-mais-1.js — card propositalmente com erro para validar auto-desativação',
    typeIds: ['test-falha-1-mais-1'],
  },
];

const massTypeById = new Map(MASS_TYPES.map((t) => [t.id, t]));

export function getMassTypeDefinition(id) {
  const base = massTypeById.get(id);
  if (!base) return null;
  const ui = UI_BY_ID[id] || {};
  return {
    id: base.id,
    label: base.label,
    script: base.script,
    cardClass: ui.cardClass || '',
    subtitle: ui.subtitle || '',
    formVariant: ui.formVariant ?? null,
    flowSteps: Array.isArray(ui.flowSteps) ? ui.flowSteps : [],
  };
}

export function listMassTypeDefinitions() {
  return MASS_TYPES.map((t) => getMassTypeDefinition(t.id)).filter(Boolean);
}

export function listMassTypesGrouped() {
  return MASS_CATEGORIES.map((cat) => ({
    ...cat,
    types: cat.typeIds.map((id) => getMassTypeDefinition(id)).filter(Boolean),
  })).filter((cat) => cat.types.length);
}

export function findMassTypeConfig(id) {
  return MASS_TYPES.find((m) => m.id === id) || null;
}
