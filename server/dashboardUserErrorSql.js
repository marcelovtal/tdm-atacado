/** Condições SQL para reclassificar jobs `failed` como erro do usuário no dashboard. */
export const LEGACY_USER_ERROR_WHERE = `
  (
    (
      error_message LIKE '%GET Org (massa pronta)%'
      OR error_message LIKE '%GET Business (massa pronta)%'
      OR error_message LIKE '%GET Billing (massa pronta)%'
    )
    AND (
      error_message LIKE '%404%'
      OR error_message LIKE '%NOT_FOUND%'
    )
    OR error_message LIKE '%Conta da massa pronta%não existe%'
    OR error_message LIKE '%Conta da massa pronta%nao existe%'
    OR error_message LIKE '%Nenhum contato técnico%'
    OR error_message LIKE '%Contato técnico ausente%'
    OR error_message LIKE '%CONTACT_TECNICO_ID%'
    OR error_message LIKE '%Não foi possível criar contato%'
    OR error_message LIKE '%Nao foi possivel criar contato%'
    OR (
      error_message LIKE '%INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY%'
      AND error_message LIKE '%Contact%'
    )
  )
`;
