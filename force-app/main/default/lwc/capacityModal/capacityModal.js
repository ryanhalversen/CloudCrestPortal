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
                        borderWidth:     1
                    }
                },
                scales
            }
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
