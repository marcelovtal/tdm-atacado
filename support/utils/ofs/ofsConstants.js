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
  OFS_API_USERNAME_DEFAULT,
  OFS_API_PASSWORD_DEFAULT,
  OFS_RESOURCE_ID_DEFAULT,
  OFS_RESOURCE_ID_ALT,
};
