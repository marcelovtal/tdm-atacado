/**
 * Paridade com ofsvtal1.test.postman_collection.json e Oracle OFSC Core API.
 * @see https://ofsvtal1.test.fs.ocs.oraclecloud.com/rest/ofscCore/v1/activities/{id}
 */

/** Prefixo REST Core (collection: /rest/ofscCore/v1/activities/...) */
const OFSC_CORE_V1 = '/rest/ofscCore/v1';

/** Hosts por ambiente FDL (TI = v1, TRG = v3). */
const OFS_HOST_BY_ENV = {
  ti: 'https://ofsvtal1.test.fs.ocs.oraclecloud.com',
  trg: 'https://ofsvtal3.test.fs.ocs.oraclecloud.com',
};

/** Organização Oracle OFS no login do supervisor (portal). */
const OFS_UI_ORG_BY_ENV = {
  ti: 'ofsc-4651d6.test',
  trg: 'ofsc-7a9fa8.test',
};

/** Defaults UI dispatcher por ambiente (técnico / bucket). */
const OFS_UI_DEFAULTS_BY_ENV = {
  ti: {
    tech_pid: '93',
    tech_search: 'ANDERSON NA',
    bucket_pid: '489',
  },
  trg: {
    tech_pid: '881',
    tech_search: 'geraldo',
    bucket_pid: '3457',
  },
};

/** Técnicos alternativos (fallback) por ambiente — tentados em ordem se um falhar. */
const OFS_TECH_CANDIDATES_BY_ENV = {
  ti: [
    { label: 'ANDERSON NATALÍCIO SCHEFFER', pid: '93', search: 'ANDERSON NA' },
    { label: 'ANDRE HEIDER DE LIMA', pid: '', search: 'ANDRE HEIDER' },
    { label: 'Técnico Tester 2', pid: '567', search: 'TESTER 2', login: 'TECQA002' },
    { label: 'Técnico Tester 3', pid: '568', search: 'TESTER 3', login: 'TECQA003' },
    { label: 'Técnico Tester 4', pid: '', search: 'TESTER 4', login: 'TECQA004' },
  ],
  trg: [
    { label: 'GERALDO DE PADUA PAIVA', pid: '881', search: 'geraldo' },
    { label: 'MARCELO FAVARO CUNHA NISHYAMA', pid: '625', search: 'MARCELO FAV', login: 'TT164943' },
    { label: 'MARCOS GERALDO GOMES', pid: '698', search: 'MARCOS GERALDO', login: 'TT013984' },
    { label: 'RAFAEL IGOR BORDINI', pid: '675', search: 'RAFAEL IGOR', login: 'TT071069' },
  ],
};

/** Basic Auth da collection (nível collection → auth.basic). */
const OFS_API_USERNAME_DEFAULT = 'qa@ofsvtal1.test';

/** App password Basic Auth — ofsvtal1.test.postman_collection.json (TI e TRG). */
const OFS_API_PASSWORD_DEFAULT = '26b9b936600d8f7eaf4548915539afa20a8133c605cd7c1b742cbed9e460';

/** resourceId usado nos exemplos move/PATCH da collection. */
const OFS_RESOURCE_ID_DEFAULT = 'TEC_TESTE_01';

/** Alternativa na collection (GetActivity Copy PATCH). */
const OFS_RESOURCE_ID_ALT = 'TEC_QA_004';

module.exports = {
  OFSC_CORE_V1,
  OFS_HOST_BY_ENV,
  OFS_UI_ORG_BY_ENV,
  OFS_UI_DEFAULTS_BY_ENV,
  OFS_TECH_CANDIDATES_BY_ENV,
  OFS_API_USERNAME_DEFAULT,
  OFS_API_PASSWORD_DEFAULT,
  OFS_RESOURCE_ID_DEFAULT,
  OFS_RESOURCE_ID_ALT,
};
