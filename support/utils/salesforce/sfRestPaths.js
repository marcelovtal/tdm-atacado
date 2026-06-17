/**
 * Paths REST/IPs Salesforce reutilizados nos scripts E2E.
 * Scripts podem estender com constantes locais (produto, LD, etc.).
 */

const UI_API_RECORDS = '/services/data/v62.0/ui-api/records';
const CONVERT_LEAD_URL =
  '/services/apexrest/vlocity_cmt/v1/integrationprocedure/Vtal_LXD_CreateAccountsAndContactCon';
const SOBJECTS_ACCOUNT = '/services/data/v62.0/sobjects/Account';
const SOBJECTS_CONTACT = '/services/data/v62.0/sobjects/Contact';
const SOBJECTS_CONTRACT = '/services/data/v62.0/sobjects/Contract';
const SOBJECTS_CONTENT_VERSION = '/services/data/v62.0/sobjects/ContentVersion';
const SOBJECTS_CONTENT_DOCUMENT_LINK = '/services/data/v62.0/sobjects/ContentDocumentLink';
const SOBJECTS_OPPORTUNITY = '/services/data/v62.0/sobjects/Opportunity';
const SOBJECTS_QUOTE = '/services/data/v62.0/sobjects/Quote';
const SOBJECTS_ORDER = '/services/data/v62.0/sobjects/Order';
const SOBJECTS_ORDER_ITEM = '/services/data/v62.0/sobjects/OrderItem';
const QUERY_URL = '/services/data/v62.0/query';
const TOOLING_EXECUTE_ANONYMOUS = '/services/data/v62.0/tooling/executeAnonymous';

const IP_CREATE_QUOTE_MEMBERS =
  '/services/apexrest/vlocity_cmt/v1/integrationprocedure/Vtal_CreateQuoteMembers';
const IP_PRODUCTS_VALIDATION =
  '/services/apexrest/vlocity_cmt/v1/integrationprocedure/Vtal_Seg_ProductsValidation';
const IP_VIABILITY =
  '/services/apexrest/vlocity_cmt/v1/integrationprocedure/Vtal_ViabilityDetailsForQuote';
const IP_QUOTE_STATUS =
  '/services/apexrest/vlocity_cmt/v1/integrationprocedure/Vtal_Seg_IPQuoteStatusUpdateMassive';
const IP_VALIDATE_CREATE_ORDER =
  '/services/apexrest/vlocity_cmt/v1/integrationprocedure/Vtal_Seg_ValidateCreateOrder';
const IP_CREATE_ORDER_ON_QUOTE =
  '/services/apexrest/vlocity_cmt/v1/integrationprocedure/Vtal_CreateOrderOnQuote';
const IP_FILL_ADDRESS_INFO =
  '/services/apexrest/vlocity_cmt/v1/integrationprocedure/Vtal_FillAddressInfo';
const IP_GET_QUOTE_ADDRESS_VIABILITY =
  '/services/apexrest/vlocity_cmt/v1/integrationprocedure/Vtal_SF_GetQuoteAddressViability';
const IP_IP_CONNECT_QUOTE_INSTALLATION_FEE =
  '/services/apexrest/vlocity_cmt/v1/integrationprocedure/VtalCap_IPIpConnectQuoteInstallationFee';
const IP_XOM_SUBMIT_ORDER =
  process.env.IP_XOM_SUBMIT_ORDER ||
  '/services/apexrest/vlocity_cmt/v1/integrationprocedure/XOMOnSubmitOrder';
const IP_XOM_SUBMIT_ORDER_FALLBACK =
  process.env.IP_XOM_SUBMIT_ORDER_FALLBACK ||
  '/services/apexrest/vlocity_cmt/v1/integrationprocedure/vlocity_cmt__XOMOnSubmitOrder';
const IP_GENERIC_INVOKE =
  process.env.IP_GENERIC_INVOKE ||
  '/services/apexrest/vlocity_cmt/v1/integrationprocedure/GenericInvoke2NoCont';
const IP_CHECKOUT_ORDER_OM =
  process.env.IP_CHECKOUT_ORDER_OM ||
  '/services/apexrest/vlocity_cmt/v1/integrationprocedure/checkoutOrderOMBatch';
const IP_MERGE_TECH_CONTACT =
  process.env.IP_MERGE_TECH_CONTACT ||
  '/services/apexrest/vlocity_cmt/v1/integrationprocedure/Vtal_Seg_MergeTechContacList';
const CART_API_V2_BASE =
  process.env.CART_API_V2_BASE || '/services/apexrest/vlocity_cmt/v2/cpq/carts';
/** CPQ invoke (DuplicateVPNValues etc.) — usado em VPN e Link Dedicado. */
const INVOKE_CPQ_URL = process.env.INVOKE_CPQ_URL || '/services/apexrest/vlocity_cmt/v1/invoke/';
/** Nome do IP Vtal_SF_GetTokenViabilidade (Link Dedicado). */
const IP_GET_TOKEN_VIABILIDADE = 'Vtal_SF_GetTokenViabilidade';

const BRM_POLL_TIMEOUT_MS = 60000;
const BRM_POLL_INTERVAL_MS = 2000;

module.exports = {
  UI_API_RECORDS,
  CONVERT_LEAD_URL,
  SOBJECTS_ACCOUNT,
  SOBJECTS_CONTACT,
  SOBJECTS_CONTRACT,
  SOBJECTS_CONTENT_VERSION,
  SOBJECTS_CONTENT_DOCUMENT_LINK,
  SOBJECTS_OPPORTUNITY,
  SOBJECTS_QUOTE,
  SOBJECTS_ORDER,
  SOBJECTS_ORDER_ITEM,
  QUERY_URL,
  TOOLING_EXECUTE_ANONYMOUS,
  IP_CREATE_QUOTE_MEMBERS,
  IP_PRODUCTS_VALIDATION,
  IP_VIABILITY,
  IP_QUOTE_STATUS,
  IP_VALIDATE_CREATE_ORDER,
  IP_CREATE_ORDER_ON_QUOTE,
  IP_FILL_ADDRESS_INFO,
  IP_GET_QUOTE_ADDRESS_VIABILITY,
  IP_IP_CONNECT_QUOTE_INSTALLATION_FEE,
  IP_XOM_SUBMIT_ORDER,
  IP_XOM_SUBMIT_ORDER_FALLBACK,
  IP_GENERIC_INVOKE,
  IP_CHECKOUT_ORDER_OM,
  IP_MERGE_TECH_CONTACT,
  CART_API_V2_BASE,
  INVOKE_CPQ_URL,
  IP_GET_TOKEN_VIABILIDADE,
  BRM_POLL_TIMEOUT_MS,
  BRM_POLL_INTERVAL_MS,
};
