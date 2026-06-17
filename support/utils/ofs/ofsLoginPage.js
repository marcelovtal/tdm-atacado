/**
 * Page object mínimo para login no Oracle OFS (Playwright).
 * Usado só para capturar cookie + CSRF + trust quando o login HTTP falha.
 */

const TIMEOUTS = {
  action: 45_000,
  navigation: 90_000,
  waitSlow: 90_000,
};

async function retry(fn, { attempts = 3, delayMs = 1_500, label = 'ação' } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      console.warn(`[ofs-login] ${label} — tentativa ${attempt}/${attempts} falhou`);
    }
  }
  throw lastError;
}

async function clickWithRetry(locator, options = {}) {
  const { label = 'clique', force = false } = options;
  await retry(() => locator.click({ timeout: TIMEOUTS.action, force }), { label });
}

async function fillWithRetry(locator, value, options = {}) {
  const { label = 'preencher campo' } = options;
  await retry(() => locator.fill(value, { timeout: TIMEOUTS.action }), { label });
}

class OfsLoginPage {
  /**
   * @param {import('playwright').Page} page
   * @param {{ baseUrl?: string, username?: string, password?: string }} [config]
   */
  constructor(page, config = {}) {
    this.page = page;
    this.baseUrl = config.baseUrl || process.env.OFS_BASE_URL || '';
    this.username = config.username || process.env.OFS_USERNAME || '';
    this.password = config.password || process.env.OFS_PASSWORD || '';
  }

  async dialogoSessaoExpiradaVisivel() {
    return this.page
      .getByRole('dialog', { name: /Sua sess[aã]o atingiu o tempo limite/i })
      .first()
      .isVisible({ timeout: 2_000 })
      .catch(() => false);
  }

  async tratarSessaoExpiradaOfs() {
    if (!(await this.dialogoSessaoExpiradaVisivel())) return false;
    console.log('[ofs-login] sessão expirada — reautenticando com senha');
    const senha = this.page
      .locator('input[data-label="restore"], input.form-item[type="password"]')
      .first()
      .or(this.page.getByRole('textbox', { name: /Senha/i }).first())
      .or(this.page.locator('dialog input[type="password"]').first());
    await senha.waitFor({ state: 'visible', timeout: TIMEOUTS.waitSlow });
    await fillWithRetry(senha, this.password, { label: 'senha (sessão expirada OFS)' });
    const enviar = this.page
      .getByRole('button', { name: /^Enviar$/i })
      .filter({ visible: true })
      .first()
      .or(this.page.locator('button.button.submit').filter({ hasText: /^Enviar$/i }).first());
    await clickWithRetry(enviar, { label: 'Enviar (reativar sessão OFS)' });
    await this.aguardarCarregamentoInicialOfs(25_000);
    await this.page
      .getByRole('dialog', { name: /Sua sess[aã]o atingiu o tempo limite/i })
      .first()
      .waitFor({ state: 'hidden', timeout: TIMEOUTS.waitSlow })
      .catch(() => {});
    return true;
  }

  campoPesquisaTecnico() {
    return this.page
      .getByRole('textbox', { name: /Pesquisar Entrada/i })
      .filter({ visible: true })
      .first()
      .or(
        this.page
          .locator('input[aria-label="Pesquisar Entrada"], input[name="searchInput"]')
          .filter({ visible: true })
          .first(),
      );
  }

  campoPesquisaAtividades() {
    return this.page
      .locator(
        'input.search-bar-input[aria-label="Pesquisa em atividades"], input.search-bar-input.global-search-bar-input-button',
      )
      .first();
  }

  async estaLogadoNoOfs() {
    if (await this.campoPesquisaTecnico().isVisible({ timeout: 3_000 }).catch(() => false)) {
      return true;
    }
    if (await this.campoPesquisaAtividades().isVisible({ timeout: 3_000 }).catch(() => false)) {
      return true;
    }
    return this.page
      .getByText(/Console de Aloca[cç][aã]o/i)
      .first()
      .isVisible({ timeout: 3_000 })
      .catch(() => false);
  }

  async goto() {
    if (!this.baseUrl) throw new Error('OFS_BASE_URL não definido no ambiente.');
    await this.page.goto(this.baseUrl, {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUTS.navigation,
    });
    await this.aguardarCarregamentoInicialOfs();
  }

  async aguardarCarregamentoInicialOfs(timeoutMs = 90_000) {
    const loading = this.page.getByText(/^Carregando$/i).first();
    if (await loading.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await loading.waitFor({ state: 'hidden', timeout: timeoutMs }).catch(() => {});
    }
    await this.page.waitForTimeout(2_000);
  }

  camposLogin() {
    return {
      username: this.page
        .locator('#username')
        .first()
        .or(this.page.getByRole('textbox', { name: /Nome de Usu[aá]rio/i }).first()),
      password: this.page
        .locator('#password')
        .first()
        .or(this.page.getByRole('textbox', { name: /^Senha$/i }).first()),
      signIn: this.page
        .locator('#sign-in')
        .first()
        .or(this.page.getByRole('button', { name: /^Conectar$/i }).first()),
    };
  }

  async aguardarBotaoConectarHabilitado(signIn) {
    for (let i = 0; i < 20; i += 1) {
      if (!(await signIn.isDisabled().catch(() => true))) return;
      await this.page.waitForTimeout(500);
    }
  }

  async temSessaoExcedida() {
    return this.page
      .getByText(/N[uú]mero m[aá]ximo de sess[oõ]es excedido/i)
      .first()
      .isVisible({ timeout: 5_000 })
      .catch(() => false);
  }

  async marcarExcluirSessaoAntiga() {
    const delsession = this.page.locator('#delsession').first();
    if (await delsession.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await delsession.scrollIntoViewIfNeeded().catch(() => {});
      await delsession.click({ force: true }).catch(() => {});
      await delsession.check({ force: true }).catch(() => {});
      if (await delsession.isChecked().catch(() => false)) return;
    }

    const excluirAntiga = this.page
      .getByRole('checkbox', { name: /Excluir a sess[aã]o de usu[aá]rio e login mais antigos/i })
      .first();
    await excluirAntiga.waitFor({ state: 'visible', timeout: TIMEOUTS.waitSlow });
    await excluirAntiga.scrollIntoViewIfNeeded().catch(() => {});
    await excluirAntiga.click({ force: true }).catch(() => {});
    await excluirAntiga.check({ force: true }).catch(() => {});
    const marcado = await excluirAntiga.isChecked().catch(() => false);
    if (!marcado) {
      await this.page
        .locator('label, span, div')
        .filter({ hasText: /Excluir a sess[aã]o de usu[aá]rio e login mais antigos/i })
        .first()
        .click({ force: true })
        .catch(() => {});
    }
  }

  async jaNoConsoleDeAlocacao() {
    if (
      await this.page
        .getByRole('heading', { name: /Detalhes da atividade/i })
        .first()
        .isVisible({ timeout: 1_500 })
        .catch(() => false)
    ) {
      return false;
    }
    if (await this.campoPesquisaTecnico().isVisible({ timeout: 3_000 }).catch(() => false)) {
      return true;
    }
    if (await this.campoPesquisaAtividades().isVisible({ timeout: 3_000 }).catch(() => false)) {
      return (
        (await this.page
          .getByRole('heading', { name: /^Console de Alocação$/i })
          .first()
          .isVisible({ timeout: 2_000 })
          .catch(() => false)) ||
        (await this.page
          .locator('.toaGantt-timeChart, .toaGantt-canvas')
          .first()
          .isVisible({ timeout: 2_000 })
          .catch(() => false))
      );
    }
    return this.page
      .getByRole('heading', { name: /^Console de Alocação$/i })
      .first()
      .isVisible({ timeout: 3_000 })
      .catch(() => false);
  }

  async aguardarTelaPrincipal() {
    await this.tratarSessaoExpiradaOfs().catch(() => {});
    for (let i = 0; i < 40; i += 1) {
      if (await this.jaNoConsoleDeAlocacao()) {
        console.log('[ofs-login] console de alocação pronto');
        return;
      }
      await this.page.waitForTimeout(2_000);
    }
    console.warn('[ofs-login] console pode não estar totalmente carregado — continuando');
  }

  async login() {
    const { username, password, signIn } = this.camposLogin();

    await this.aguardarCarregamentoInicialOfs();
    await this.tratarSessaoExpiradaOfs().catch(() => {});
    for (let poll = 0; poll < 16; poll += 1) {
      await this.tratarSessaoExpiradaOfs().catch(() => {});
      if (await this.estaLogadoNoOfs()) {
        console.log('[ofs-login] sessão já ativa — pulando login');
        await this.aguardarTelaPrincipal();
        return;
      }
      const loginVisivel = await username.isVisible({ timeout: 2_000 }).catch(() => false);
      if (loginVisivel) break;
      await this.page.waitForTimeout(2_000);
    }

    const loginVisivel = await username.isVisible({ timeout: 15_000 }).catch(() => false);
    if (!loginVisivel) {
      if (await this.estaLogadoNoOfs()) {
        console.log('[ofs-login] sessão já ativa (sem formulário) — pulando login');
        await this.aguardarTelaPrincipal();
        return;
      }
      throw new Error('OFS: não foi possível identificar tela de login nem console autenticado.');
    }

    await username.clear();
    await fillWithRetry(username, this.username, { label: 'usuário OFS' });

    for (let tentativa = 1; tentativa <= 3; tentativa += 1) {
      if (await this.estaLogadoNoOfs()) {
        console.log('[ofs-login] login OK (já no console)');
        await this.aguardarTelaPrincipal();
        return;
      }

      const passwordVisivel = await password.isVisible({ timeout: 5_000 }).catch(() => false);
      if (!passwordVisivel) {
        if (await this.estaLogadoNoOfs()) {
          await this.aguardarTelaPrincipal();
          return;
        }
        break;
      }

      if (await this.temSessaoExcedida()) {
        console.log('[ofs-login] sessões excedidas — marcando checkbox e redigitando senha');
        await this.marcarExcluirSessaoAntiga();
      }

      await password.clear();
      await fillWithRetry(password, this.password, { label: `senha OFS (tentativa ${tentativa})` });
      await this.aguardarBotaoConectarHabilitado(signIn);
      await clickWithRetry(signIn, { label: `Conectar OFS (tentativa ${tentativa})` });

      for (let aguarda = 0; aguarda < 12; aguarda += 1) {
        if (await this.estaLogadoNoOfs()) {
          console.log('[ofs-login] login OK');
          await this.aguardarTelaPrincipal();
          return;
        }
        await this.page.waitForTimeout(2_000);
      }
    }

    if (await this.estaLogadoNoOfs()) {
      await this.aguardarTelaPrincipal();
      return;
    }

    throw new Error('OFS: falha no login após tentativas (verifique credenciais ou sessões excedidas).');
  }
}

module.exports = { OfsLoginPage };
