/**
 * Endereços de teste para geração de massa (cotação / viabilidade / pedido).
 * Região via MASS_ADDRESS_REGION ou ORDER_UF: SP (default) | RJ.
 */

const REGIONS = {
  SP: {
    uf: 'SP',
    city: 'São Paulo',
    municipioCode: '3550308',
    municLpu: {
      ti: 'a6UHZ0000000Tgk2AE',
      trg: 'a6UHa00000029CwMAI',
    },
    businessAccount: {
      streetType: 'Rua',
      streetName: 'Antonio Fonseca',
      number: 341,
      neighborhood: 'Vila Maria',
      cep: '02112-010',
    },
    codigoLogradouro: '2706',
    addresses: [
      {
        streetType: 'Avenida',
        streetName: 'Paulista',
        number: 1530,
        neighborhood: 'Bela Vista',
        zipCode: '01310917',
        locationCode: '3550308',
        Latitude: '-23.5614',
        Longitude: '-46.6562',
      },
      {
        streetType: 'Avenida',
        streetName: 'Paulista',
        number: 1578,
        neighborhood: 'Bela Vista',
        zipCode: '01310917',
        locationCode: '3550308',
        Latitude: '-23.5614',
        Longitude: '-46.6562',
      },
      {
        streetType: 'Avenida',
        streetName: 'Paulista',
        number: 1842,
        neighborhood: 'Bela Vista',
        zipCode: '01310917',
        locationCode: '3550308',
        Latitude: '-23.5614',
        Longitude: '-46.6562',
      },
      {
        streetType: 'Avenida',
        streetName: 'Paulista',
        number: 2000,
        neighborhood: 'Bela Vista',
        zipCode: '01310917',
        locationCode: '3550308',
        Latitude: '-23.5614',
        Longitude: '-46.6562',
      },
      {
        streetType: 'Avenida',
        streetName: 'Paulista',
        number: 2100,
        neighborhood: 'Bela Vista',
        zipCode: '01310917',
        locationCode: '3550308',
        Latitude: '-23.5614',
        Longitude: '-46.6562',
      },
    ],
    ldAddresses: [
      {
        streetType: 'Avenida',
        streetName: 'Paulista',
        number: 500,
        neighborhood: 'Bela Vista',
        zipCode: '01310917',
        locationCode: '3550308',
        Latitude: '-23.5680106',
        Longitude: '-46.6482312',
      },
      {
        streetType: 'Avenida',
        streetName: 'Paulista',
        number: 600,
        neighborhood: 'Bela Vista',
        zipCode: '01310917',
        locationCode: '3550308',
        Latitude: '-23.5664976',
        Longitude: '-46.6501995',
      },
    ],
    defaultAddressId: 40373338,
  },
  RJ: {
    uf: 'RJ',
    city: 'Rio De Janeiro',
    municipioCode: '3304557',
    municLpu: {
      ti: 'a6UHZ0000000TXX2A2',
      trg: 'a6UHa000000292WMAQ',
    },
    businessAccount: {
      streetType: 'Avenida',
      streetName: 'Rene Laclette',
      number: 1530,
      neighborhood: 'Recreio Bandeirantes',
      cep: '22790-903',
    },
    codigoLogradouro: '16370',
    addresses: [
      {
        streetType: 'Avenida',
        streetName: 'Rene Laclette',
        number: 100,
        neighborhood: 'Recreio Bandeirantes',
        zipCode: '22790903',
        locationCode: '21000',
        Latitude: '',
        Longitude: '',
        id: 16615201,
        complement: 'BLOCO 1, APARTAMENTO 101',
        complement1: { type: 'BLOCO', complement: '1', acronym: 'BL' },
        complement2: { type: 'APARTAMENTO', complement: '101', acronym: 'AP' },
      },
    ],
    ldAddresses: null,
    defaultAddressId: 16615201,
  },
};

function normalizeRegion(raw) {
  const v = String(raw || 'SP')
    .trim()
    .toUpperCase();
  return v === 'RJ' ? 'RJ' : 'SP';
}

function getMassAddressRegion() {
  return normalizeRegion(process.env.MASS_ADDRESS_REGION || process.env.ORDER_UF || 'SP');
}

function getRegionConfig(region = getMassAddressRegion()) {
  return REGIONS[region] || REGIONS.SP;
}

function getOrderUf() {
  return getRegionConfig().uf;
}

function getOrderCity() {
  const cfg = getRegionConfig();
  const fromEnv = process.env.ORDER_CITY && String(process.env.ORDER_CITY).trim();
  return fromEnv || cfg.city;
}

function enrichAddress(addr, region = getMassAddressRegion()) {
  const cfg = getRegionConfig(region);
  return {
    ...addr,
    city: addr.city || cfg.city,
    stateAbbreviation: addr.stateAbbreviation || cfg.uf,
    codigoLogradouro: addr.codigoLogradouro || cfg.codigoLogradouro,
  };
}

function getAddressesToTry(options = {}) {
  const region = getMassAddressRegion();
  const cfg = getRegionConfig(region);
  const source = options.linkDedicado && cfg.ldAddresses ? cfg.ldAddresses : cfg.addresses;
  return source.map((a) => enrichAddress(a, region));
}

function getPrimaryAddress(options = {}) {
  const list = getAddressesToTry(options);
  return list[0] || enrichAddress(REGIONS.SP.addresses[0]);
}

function formatZipDisplay(zipCode) {
  const z = String(zipCode || '').replace(/\D/g, '');
  return z.length >= 8 ? `${z.slice(0, 5)}-${z.slice(5, 8)}` : z;
}

function buildFormattedAddress(addr) {
  const a = enrichAddress(addr);
  const num = String(a.number);
  const zipFormatted = formatZipDisplay(a.zipCode);
  return `${a.streetType} ${a.streetName} ${num}, ${a.neighborhood} - ${a.city}, ${a.stateAbbreviation} (${zipFormatted})`;
}

function buildDescriptionBlock(addr, addressInfo = null) {
  const a = enrichAddress(addr);
  const num = String(a.number);
  const descBlock = {
    description: buildFormattedAddress(a),
    streetType: a.streetType,
    streetName: a.streetName,
    number: num,
    neighborhood: a.neighborhood,
    city: a.city,
    stateAbbreviation: a.stateAbbreviation,
    zipCode: a.zipCode,
    country: 'Brasil',
    locationCode: a.locationCode,
    Latitude: a.Latitude,
    Longitude: a.Longitude,
  };
  const resolvedId = addressInfo?.id ?? a.id;
  if (resolvedId != null) descBlock.id = resolvedId;
  if (addressInfo?.hasNumber != null) descBlock.hasNumber = addressInfo.hasNumber;
  if (addressInfo?.hasNoNumber != null) descBlock.hasNoNumber = addressInfo.hasNoNumber;
  if (addressInfo?.hasNumber == null && addressInfo?.hasNoNumber == null) {
    descBlock.hasNumber = true;
    descBlock.hasNoNumber = false;
  }
  return descBlock;
}

function buildComplementoBlock(addr) {
  const a = enrichAddress(addr);
  if (!a.complement) return null;
  const block = {
    label: a.complement,
    value: a.complement,
    Complemento: a.complement,
    complementConcat: a.complement,
  };
  if (a.complement1) block.complement1 = a.complement1;
  if (a.complement2) block.complement2 = a.complement2;
  return block;
}

function buildViabilityComplements(addr) {
  const a = enrichAddress(addr);
  const items = [];
  if (a.complement1) {
    items.push({
      argComplemento: String(a.complement1.type || ''),
      valorComplemento: String(a.complement1.complement || ''),
      tipoComplemento: a.complement1.acronym || '',
    });
  }
  if (a.complement2) {
    items.push({
      argComplemento: String(a.complement2.type || ''),
      valorComplemento: String(a.complement2.complement || ''),
      tipoComplemento: a.complement2.acronym || '',
    });
  }
  if (!items.length) {
    items.push({ argComplemento: '', valorComplemento: '', tipoComplemento: '' });
  }
  return items;
}

function getDefaultAddressId(addr) {
  const a = enrichAddress(addr);
  if (a.id != null) return a.id;
  return getRegionConfig().defaultAddressId;
}

function normalizeZip(z) {
  return String(z || '').replace(/\D/g, '');
}

function findFillAddressRecord(records, originalAddr) {
  if (!Array.isArray(records) || !records.length) return null;
  const cfg = getRegionConfig();
  const targetZip = normalizeZip(originalAddr?.zipCode);

  let rec = records.find((r) => normalizeZip(r.zipCode) === targetZip);
  if (!rec) {
    rec = records.find((r) => r.city === cfg.city && r.stateAbbreviation === cfg.uf);
  }
  if (!rec) {
    rec = records.find((r) => r.stateAbbreviation === cfg.uf);
  }
  return rec || null;
}

function buildPointAddressFields(addr, addressInfo = {}) {
  const a = enrichAddress(addr);
  return {
    description: buildFormattedAddress(a),
    streetType: a.streetType,
    streetName: a.streetName,
    number: String(a.number),
    neighborhood: a.neighborhood,
    city: a.city,
    stateAbbreviation: a.stateAbbreviation,
    zipCode: a.zipCode,
    country: 'Brasil',
    locationCode: addressInfo.locationCode || a.locationCode,
    hasNumber: true,
    hasNoNumber: false,
    id: addressInfo.id ?? a.id ?? null,
  };
}

/** Env vars para fila / UI (MASS_ADDRESS_REGION=SP|RJ). */
function buildAddressEnvFromRegion(region) {
  const r = normalizeRegion(region);
  const cfg = getRegionConfig(r);
  return {
    MASS_ADDRESS_REGION: r,
    ORDER_UF: cfg.uf,
    ORDER_CITY: cfg.city,
  };
}

function getRegionLabel(region = getMassAddressRegion()) {
  return region === 'RJ' ? 'Rio de Janeiro (RJ)' : 'São Paulo (SP)';
}

function getBusinessAccountAddress(region = getMassAddressRegion()) {
  const cfg = getRegionConfig(region);
  return cfg.businessAccount || REGIONS.SP.businessAccount;
}

/** Municipio_LPU__c por ambiente (ti/trg) e região (SP/RJ). Override: VTAL_SF_MUNIC_LPU_ID */
function getMunicLpuId(environment = 'ti', region = getMassAddressRegion()) {
  if (process.env.VTAL_SF_MUNIC_LPU_ID) return process.env.VTAL_SF_MUNIC_LPU_ID;
  const envKey = String(environment || 'ti').toLowerCase() === 'trg' ? 'trg' : 'ti';
  const cfg = getRegionConfig(region);
  return cfg.municLpu?.[envKey] || REGIONS.SP.municLpu[envKey];
}

module.exports = {
  REGIONS,
  getMassAddressRegion,
  getRegionConfig,
  getOrderUf,
  getOrderCity,
  getAddressesToTry,
  getPrimaryAddress,
  formatZipDisplay,
  buildFormattedAddress,
  buildDescriptionBlock,
  buildComplementoBlock,
  buildViabilityComplements,
  getDefaultAddressId,
  findFillAddressRecord,
  buildPointAddressFields,
  buildAddressEnvFromRegion,
  getRegionLabel,
  getBusinessAccountAddress,
  getMunicLpuId,
};
