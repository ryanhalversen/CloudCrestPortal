// force-app/main/default/lwc/capacityModal/capacityModal.js
import { LightningElement, api } from 'lwc';
import { loadScript } from 'lightning/platformResourceLoader';
import CHARTJS from '@salesforce/resourceUrl/chartjs';

const CHART_COLORS = ['#00b4d8','#ef4444','#0096c7','#0077b6','#caf0f8','#ade8f4','#48cae4','#023e5a','#012a3d'];

export default class CapacityModal extends LightningElement {
    @api cardData = null;

    _chart       = null;
    _chartLoaded = false;
    chartError   = null;

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    connectedCallback() {
        loadScript(this, CHARTJS)
            .then(() => {
                this._chartLoaded = true;
                this._tryRender();
            })
            .catch(() => {
                this.chartError = 'Failed to load chart library.';
            });
    }

    disconnectedCallback() {
        this._destroyChart();
    }

    // ── Public API ────────────────────────────────────────────────────────────

    renderedCallback() {
        // Re-attempt after each render in case canvas arrived late
        if (this._chartLoaded && !this._chart) {
            this._tryRender();
        }
    }

    // ── Derived Properties ────────────────────────────────────────────────────

    get statusBadgeClass() {
        const s = this.cardData?.status || 'neutral';
        return `status-badge status-badge--${s}`;
    }

    get enrichedKpis() {
        return (this.cardData?.kpis || []).map(k => ({
            ...k,
            trendClass: `modal-kpi-trend modal-kpi-trend--${k.trend || 'neutral'}`,
            trendIcon:  k.trend === 'up' ? '↑' : k.trend === 'down' ? '↓' : ''
        }));
    }

    get hasInsights() {
        return this.cardData?.insights?.length > 0;
    }

    get hasProjects() {
        return this.cardData?.projects?.length > 0;
    }

    get enrichedProjects() {
        return (this.cardData?.projects || []).map(p => {
            const ps = p.paceStatus || '';
            let statusLabel, statusClass;
            if (ps.includes('Ahead')) {
                statusLabel = 'Ahead';    statusClass = 'proj-status proj-status--good';
            } else if (ps.includes('On Pace')) {
                statusLabel = 'On Pace';  statusClass = 'proj-status proj-status--good';
            } else if (ps.includes('Problem') || ps.includes('Houston')) {
                statusLabel = 'Critical'; statusClass = 'proj-status proj-status--critical';
            } else if (ps.includes('Behind')) {
                statusLabel = 'Behind';   statusClass = 'proj-status proj-status--warning';
            } else {
                statusLabel = '—';        statusClass = 'proj-status proj-status--neutral';
            }
            return { name: p.name, paceStatus: p.paceStatus, statusLabel, statusClass };
        });
    }

    // ── Chart rendering ───────────────────────────────────────────────────────

    _tryRender() {
        if (!this._chartLoaded || !this.cardData) return;
        // Defer to let canvas settle in DOM after render
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        setTimeout(() => this._renderChart(), 0);
    }

    _renderChart() {
        const canvas = this.refs.canvas;
        if (!canvas) return;

        this._destroyChart();

        const { chartType, chartLabels, datasets } = this.cardData;
        if (!chartType || !datasets?.length) return;

        const chartDatasets = datasets.map((ds, idx) => {
            const baseColor = ds.color || CHART_COLORS[idx % CHART_COLORS.length];
            const isLine    = chartType === 'line';
            const isDoughnut = chartType === 'doughnut';

            return {
                label:                ds.label,
                data:                 ds.data || [],
                backgroundColor:      isDoughnut
                    ? (ds.colors || CHART_COLORS)
                    : `${baseColor}cc`,
                borderColor:          isDoughnut ? (ds.borderColor || '#1e293b') : baseColor,
                borderWidth:          isDoughnut ? 2 : isLine ? 2 : 0,
                borderDash:           ds.isDashed ? [6, 4] : undefined,
                tension:              isLine ? 0.3 : 0,
                pointRadius:          isLine ? 0 : undefined,
                pointHoverRadius:     isLine ? 4 : undefined,
                fill:                 false,
                hoverOffset:          isDoughnut ? 6 : undefined,
                barPercentage:        isDoughnut ? undefined : 0.7,
                categoryPercentage:   isDoughnut ? undefined : 0.85
            };
        });

        const isHorizontal = false; // bar charts are vertical
        const isDoughnut   = chartType === 'doughnut';
        const isLine       = chartType === 'line';

        const scales = isDoughnut ? {} : {
            x: {
                ticks: { color: '#94a3b8', font: { size: 11 }, maxRotation: 45 },
                grid:  { color: 'rgba(255,255,255,0.05)' }
            },
            y: {
                beginAtZero: true,
                ticks: { color: '#94a3b8', font: { size: 11 } },
                grid:  { color: 'rgba(255,255,255,0.07)' }
            }
        };

        // Inline plugin: week-over-week % badges between x-axis ticks (line charts only)
        const wowPlugin = {
            id: 'wowAnnotations',
            afterDraw(chart) {
                if (chart.config.type !== 'line') return;
                const primaryDs = chart.data.datasets[0];
                const vals = primaryDs?.data;
                if (!vals || vals.length < 2) return;
                const { ctx, scales: sc, chartArea } = chart;
                const xScale = sc.x;
                if (!xScale) return;
                ctx.save();
                ctx.font = 'bold 9px -apple-system,BlinkMacSystemFont,sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                for (let i = 1; i < vals.length; i++) {
                    const prev = vals[i - 1];
                    const curr = vals[i];
                    if (prev == null || curr == null || prev === 0) continue;
                    const pct  = Math.round(((curr - prev) / prev) * 100);
                    const sign = pct > 0 ? '+' : '';
                    const text  = sign + pct + '%';
                    const color = pct > 0 ? '#22c55e' : pct < 0 ? '#ef4444' : '#94a3b8';
                    const bgClr = pct > 0 ? 'rgba(34,197,94,.18)' : pct < 0 ? 'rgba(239,68,68,.18)' : 'rgba(148,163,184,.14)';
                    const x1   = xScale.getPixelForTick(i - 1);
                    const x2   = xScale.getPixelForTick(i);
                    const midX = (x1 + x2) / 2;
                    const tw   = ctx.measureText(text).width + 8;
                    const th   = 14;
                    const py   = chartArea.bottom - th - 6;
                    ctx.fillStyle = bgClr;
                    ctx.beginPath();
                    if (ctx.roundRect) {
                        ctx.roundRect(midX - tw / 2, py, tw, th, 3);
                    } else {
                        ctx.rect(midX - tw / 2, py, tw, th);
                    }
                    ctx.fill();
                    ctx.fillStyle = color;
                    ctx.fillText(text, midX, py + th / 2);
                }
                ctx.restore();
            }
        };

        /* global Chart */
        this._chart = new Chart(canvas, {
            type: chartType,
            data: {
                labels:   chartLabels || [],
                datasets: chartDatasets
            },
            options: {
                responsive:          true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display:  datasets.length > 1 || isDoughnut,
                        position: 'bottom',
                        labels:   { color: '#94a3b8', font: { size: 11 }, boxWidth: 12, padding: 16 }
                    },
                    tooltip: {
                        backgroundColor: '#0f172a',
                        titleColor:      '#e2e8f0',
                        bodyColor:       '#94a3b8',
                        borderColor:     '#334155',
                        borderWidth:     1,
                        padding:         10,
                        callbacks: isLine ? {
                            label: (context) => {
                                const v     = context.parsed.y;
                                const label = context.dataset.label || '';
                                const fmt   = Number.isInteger(v) ? v : v.toFixed(1);
                                return ` ${label}: ${fmt}h`;
                            }
                        } : {}
                    }
                },
                scales
            },
            plugins: [wowPlugin]
        });
    }

    _destroyChart() {
        if (this._chart) {
            this._chart.destroy();
            this._chart = null;
        }
    }

    // ── Event handlers ────────────────────────────────────────────────────────

    handleClose() {
        this.dispatchEvent(new CustomEvent('close'));
    }

    handleBackdropClick() {
        this.handleClose();
    }

    stopProp(event) {
        event.stopPropagation();
    }
}
