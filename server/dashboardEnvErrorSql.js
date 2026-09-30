/** Condições SQL para reclassificar jobs `failed` como erro de ambiente no dashboard. */
export const LEGACY_ENV_ERROR_WHERE = `
  (
    error_message LIKE '%Não foi alterado o status da ordem para "Em implantação"%'
    OR error_message LIKE '%Nao foi alterado o status da ordem para "Em implantacao"%'
    OR error_message LIKE '%[FDL_INTEGRATION_ERROR]%'
    OR error_message LIKE '%[FDL_ENV_ERROR]%'
    OR error_message LIKE '%Erro no PEGA ou no OFS ao concluir agendamento%'
    OR error_message LIKE '%nenhum subpedido com Status "Em implantação"%'
  )
`;
