/**
 * Corpo padrão (massa QA) para PATCH .../actions/DesignarFacilidadeDados
 * Alinhado a fluxo-pega (Postman).
 * @param {{ includeEnderecamentoIp?: boolean }} [opts] — Link Dedicado: omitir bloco EnderecamentoIp (fluxo link dedicado.txt)
 */
function buildDesignarFacilidadeDadosBody(opts = {}) {
  const includeEnderecamentoIp = opts.includeEnderecamentoIp !== false;
  const body = {
    content: {
      DadoLogico: {
        Encaminhar: 'Sucesso (Configuração)',
        JumperSelecionado: false,
        Acesso: [
          {
            Facilidade: [
              {
                Detalhes:
                  'TDM mensagem padrão',
                IdPonta: 'A',
                Ponta: [
                  {
                    CaminhoFibraPon: 'Caminho da Fibra PON',
                    Canalizado: 'Canalizado',
                    CvLan: '1',
                    DistribuidorInterposicional: 'Distribuidor Interposicional',
                    Estacao: 'WMTB',
                    Id: 'A',
                    LineId: 'Line ID',
                    Localidade: 'CTA',
                    NomeEquipamento: 'Nome do Equipamento',
                    Observacao: 'Observação',
                    PortaFisica: 'Porta Física',
                    PortaLogica: 'Porta Lógica',
                    PosicaoDistribuidor: 'Posição Distribuidor',
                    Rack: 'Rack',
                    Slot: 'Slot',
                    Sub: 'Sub',
                    SvLan: '2',
                    TecnologiaInterface: 'Fast Ethernet',
                    TipoInterface: 'Optica',
                    Uf: 'PR',
                    VelocidadePorta: 'Veloc. da Porta',
                  },
                ],
                Rede: 'Acesso',
                Tipo: 'Determinística',
              },
              {
                Detalhes:
                  'TDM mensagem padrão',
                IdPonta: 'A',
                Ponta: [
                  {
                    CaminhoFibraPon: 'Caminho da Fibra PON',
                    Canalizado: 'Canalizado',
                    CvLan: '1',
                    DistribuidorInterposicional: 'Distribuidor Interposicional',
                    Estacao: 'WMTB',
                    Id: 'A',
                    LineId: 'Line ID',
                    Localidade: 'CTA',
                    NomeEquipamento: 'Nome do Equipamento1',
                    Observacao: 'Observação',
                    PortaFisica: 'Porta Física',
                    PortaLogica: 'Porta Lógica',
                    PosicaoDistribuidor: 'Posição Distribuidor',
                    Rack: 'Rack',
                    Slot: 'Slot',
                    Sub: 'Sub',
                    SvLan: '2',
                    TecnologiaInterface: 'Fast Ethernet',
                    TipoInterface: 'Optica',
                    Uf: 'PR',
                    VelocidadePorta: 'Veloc. da Porta',
                  },
                ],
                Rede: 'Transporte',
                Tipo: 'Determinística',
              },
              {
                Detalhes:
                  'Duis semper dapibus enim quis dignissim. Sed faucibus ac nunc vel placerat. Morbi ac dictum justo. Vivamus id purus fringilla mi faucibus imperdiet et non leo. ',
                IdPonta: 'A',
                Ponta: [
                  {
                    CaminhoFibraPon: 'Caminho da Fibra PON',
                    Canalizado: 'Canalizado',
                    CvLan: '1',
                    DistribuidorInterposicional: 'Distribuidor Interposicional',
                    Estacao: 'WMTB',
                    Id: 'A',
                    LineId: 'Line ID',
                    Localidade: 'CTA',
                    NomeEquipamento: 'Nome do Equipamento2',
                    Observacao: 'Observação',
                    PortaFisica: 'Porta Física',
                    PortaLogica: 'Porta Lógica',
                    PosicaoDistribuidor: 'Posição Distribuidor',
                    Rack: 'Rack',
                    Slot: 'Slot',
                    Sub: 'Sub',
                    SvLan: '2',
                    TecnologiaInterface: 'Fast Ethernet',
                    TipoInterface: 'Optica',
                    Uf: 'PR',
                    VelocidadePorta: 'Veloc. da Porta',
                  },
                ],
                Rede: 'Serviço',
                Tipo: 'Determinística',
              },
            ],
          },
        ],
      },
    },
  };
  if (includeEnderecamentoIp) {
    body.content.DadoLogico.EnderecamentoIp = [
      {
        BlocoIp: '192.168.0.0/32',
        EnderecoIpCpe: '192.168.0.1',
        Ip: 'IPV4',
        Mascara: '16',
        Observacao:
          'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Maecenas posuere nibh ac faucibus tempus. Praesent nec tortor ultricies, sagittis ex nec, accumsan est. ',
        Tipo: 'WAN',
      },
      {
        BlocoIp: '192.168.1.0/32',
        EnderecoIpCpe: '192.168.1.1',
        Ip: 'IPV4',
        Mascara: '16',
        Observacao: 'Observação',
        Tipo: 'LAN',
      },
    ];
  }
  return body;
}

module.exports = { buildDesignarFacilidadeDadosBody };
