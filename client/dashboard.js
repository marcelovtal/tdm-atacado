function api(path) {
  const headers = window.fdlVtalAuth
    ? fdlVtalAuth.authHeaders()
    : { 'Content-Type': 'application/json' };
  return fetch('/api' + path, { headers }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      fdlVtalAuth.clearSession();
      window.location.replace('/login.html');
      throw new Error('Sessão expirada');
    }
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  });
}

function formatDuration(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

function formatNumber(n) {
  return new Intl.NumberFormat('pt-BR').format(n || 0);
}

const axisColor = '#71717a';
const gridColor = 'rgba(113, 113, 122, 0.2)';
const charts = [];

function destroyCharts() {
  while (charts.length) {
    const c = charts.pop();
    try {
      c.destroy();
    } catch (_) {}
  }
}

function chartOptions(extra = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: {
        ticks: { color: axisColor, maxRotation: 45, minRotation: 0 },
        grid: { display: false },
      },
      y: {
        ticks: { color: axisColor, precision: 0, stepSize: 1 },
        grid: { color: gridColor },
        beginAtZero: true,
      },
    },
    ...extra,
  };
}

function renderDashboard(stats) {
  const scopeHint =
    stats.scope === 'all'
      ? 'Visão geral de todos os QAs (histórico no banco).'
      : 'Suas execuções registradas no histórico.';

  const subtitle = document.getElementById('dashboard-subtitle');
  if (subtitle) subtitle.textContent = scopeHint;

  const overviewHint = document.getElementById('overview-hint');
  if (overviewHint) overviewHint.textContent = scopeHint;

  document.getElementById('kpi-avg-duration').textContent = formatDuration(stats.overview.avgDurationMs);
  document.getElementById('kpi-avg-meta').textContent =
    stats.overview.avgDurationSampleSize > 0
      ? `Base: últimas ${stats.overview.avgDurationSampleSize} execuções com duração`
      : 'Sem execuções com duração registrada';

  document.getElementById('kpi-active-sessions').textContent = formatNumber(stats.overview.activeSessions);
  document.getElementById('kpi-total').textContent = formatNumber(stats.overview.totalExecutions);

  document.getElementById('kpi-success-rate').textContent =
    stats.results.total > 0 ? `${stats.results.successRate}%` : '—';
  document.getElementById('kpi-results-avg').textContent = formatDuration(stats.results.avgDurationMs);
  document.getElementById('kpi-results-total').textContent = formatNumber(stats.results.total);
  document.getElementById('kpi-critical').textContent = formatNumber(stats.results.criticalFailures);

  destroyCharts();

  const byDay = stats.byDay || [];
  charts.push(
    new Chart(document.getElementById('chart-massas-dia'), {
      type: 'bar',
      data: {
        labels: byDay.map((d) => d.label),
        datasets: [
          {
            label: 'Massas criadas',
            data: byDay.map((d) => d.count),
            backgroundColor: '#3b82f6',
            borderRadius: 6,
          },
        ],
      },
      options: {
        ...chartOptions(),
        scales: {
          x: {
            ticks: { color: axisColor, maxRotation: 45, minRotation: 0 },
            grid: { display: false },
          },
          y: {
            ticks: { color: axisColor, precision: 0, stepSize: 1 },
            grid: { color: gridColor },
            beginAtZero: true,
            suggestedMax: Math.max(1, ...byDay.map((d) => d.count)),
          },
        },
      },
    })
  );

  const byType = stats.byMassType || [];
  charts.push(
    new Chart(document.getElementById('chart-tipo-massa'), {
      type: 'pie',
      data: {
        labels: byType.length ? byType.map((t) => t.label) : ['Sem dados'],
        datasets: [
          {
            data: byType.length ? byType.map((t) => t.count) : [1],
            backgroundColor: byType.length
              ? byType.map((t) => t.color)
              : ['#d4d4d8'],
            borderColor: '#ffffff',
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: axisColor, boxWidth: 12, usePointStyle: true },
          },
        },
      },
    })
  );

  const topUsers = stats.topUsers || [];
  const usersSection = document.getElementById('users-section-hint');
  if (usersSection) {
    usersSection.textContent =
      stats.scope === 'all'
        ? 'Usuários que mais executaram criação de massa (histórico no banco).'
        : 'Suas execuções no período registrado.';
  }

  charts.push(
    new Chart(document.getElementById('chart-usuarios-top'), {
      type: 'bar',
      data: {
        labels: topUsers.length ? topUsers.map((u) => u.vt) : ['—'],
        datasets: [
          {
            label: 'Execuções',
            data: topUsers.length ? topUsers.map((u) => u.count) : [0],
            backgroundColor: ['#2563eb', '#3b82f6', '#93c5fd', '#60a5fa', '#1d4ed8'],
            borderRadius: 8,
            barThickness: 28,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            ticks: { color: axisColor, precision: 0 },
            grid: { color: gridColor },
            beginAtZero: true,
          },
          y: {
            ticks: { color: axisColor },
            grid: { display: false },
          },
        },
      },
    })
  );

  const success = stats.results.success || 0;
  const failed = stats.results.failed || 0;
  const cancelled = stats.results.cancelled || 0;
  const doughnutLabels = ['Sucesso', 'Falha'];
  const doughnutData = [success, failed];
  const doughnutColors = ['#22c55e', '#ef4444'];
  if (cancelled > 0) {
    doughnutLabels.push('Cancelado');
    doughnutData.push(cancelled);
    doughnutColors.push('#a1a1aa');
  }
  charts.push(
    new Chart(document.getElementById('chart-resultado-teste'), {
      type: 'doughnut',
      data: {
        labels: doughnutLabels,
        datasets: [
          {
            data: success + failed + cancelled > 0 ? doughnutData : [0, 0],
            backgroundColor: doughnutColors,
            borderColor: '#ffffff',
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: axisColor, boxWidth: 12, usePointStyle: true },
          },
        },
      },
    })
  );
}

async function loadDashboard() {
  const errEl = document.getElementById('dashboard-error');
  if (errEl) {
    errEl.hidden = true;
    errEl.textContent = '';
  }
  try {
    const stats = await api('/dashboard/stats');
    renderDashboard(stats);
  } catch (err) {
    if (errEl) {
      errEl.hidden = false;
      errEl.textContent = err.message || 'Não foi possível carregar o dashboard.';
    }
  }
}

document.addEventListener('DOMContentLoaded', function () {
  if (window.fdlVtalAuth) fdlVtalAuth.refreshNavFromServer();
  loadDashboard();
});
