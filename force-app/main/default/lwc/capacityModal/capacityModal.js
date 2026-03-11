// force-app/main/default/lwc/capacityModal/capacityModal.js
import { LightningElement, api } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { loadScript } from 'lightning/platformResourceLoader';
import CHARTJS from '@salesforce/resourceUrl/chartjs';
import getProjectWeeklyHours from '@salesforce/apex/CommandCenterController.getProjectWeeklyHours';

const CHART_COLORS = ['#00b4d8','#ef4444','#0096c7','#0077b6','#caf0f8','#ade8f4','#48cae4','#023e5a','#012a3d'];

export default class CapacityModal extends NavigationMixin(LightningElement) {
    @api cardData = null;

    _chart               = null;
    _chartLoaded         = false;
    chartError           = null;
    _drilldownActive     = false;
    _drilldownTitle      = '';
    _drilldownData       = null;
    _canvasClickHandler  = null;

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

    renderedCallback() {
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
            return { id: p.id, name: p.name, paceStatus: p.paceStatus, statusLabel, statusClass };
        });
    }

    get isDrilldown() {
        return this._drilldownActive;
    }

    get drilldownTitle() {
        return this._drilldownTitle;
    }

    get hasBarDrilldown() {
        return this.cardData?.chartType === 'bar' && this.cardData?.chartProjectIds?.length > 0;
    }

    get drilldownKpis() {
        const dd = this._drilldownData;
        if (!dd) return [];

        const hoursStr  = `${dd.totalDelivered != null ? dd.totalDelivered : 0}h`;

        const ratePct   = dd.deliveryRate;
        const rateStr   = ratePct != null ? `${ratePct}%` : '—';
        const rateTrend = ratePct == null ? 'neutral' : ratePct >= 95 ? 'up' : ratePct >= 80 ? 'neutral' : 'down';

        const ps = dd.paceStatus || '';
        let paceLabel, paceTrend;
        if      (ps.includes('Ahead'))                              { paceLabel = 'Ahead';    paceTrend = 'up'; }
        else if (ps.includes('On Pace'))                            { paceLabel = 'On Pace';  paceTrend = 'up'; }
        else if (ps.includes('Problem') || ps.includes('Houston')) { paceLabel = 'Critical'; paceTrend = 'down'; }
        else if (ps.includes('Behind'))                             { paceLabel = 'Behind';   paceTrend = 'down'; }
        else                                                        { paceLabel = '—';        paceTrend = 'neutral'; }

        const trend = (t) => `modal-kpi-trend modal-kpi-trend--${t}`;
        const icon  = (t) => t === 'up' ? '↑' : t === 'down' ? '↓' : '';
        return [
            { label: 'Hours Delivered', value: hoursStr,   trendClass: trend('neutral'), trendIcon: '',           sub: '8-week total' },
            { label: 'Delivery Rate',   value: rateStr,    trendClass: trend(rateTrend), trendIcon: icon(rateTrend), sub: 'vs committed hrs' },
            { label: 'Pace Status',     value: paceLabel,  trendClass: trend(paceTrend), trendIcon: icon(paceTrend), sub: 'current project pace' }
        ];
    }

    get activeKpis() {
        return this._drilldownActive && this._drilldownData ? this.drilldownKpis : this.enrichedKpis;
    }

    // ── Chart rendering ───────────────────────────────────────────────────────

    _tryRender() {
        if (!this._chartLoaded || !this.cardData) return;
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
            const baseColor  = ds.color || CHART_COLORS[idx % CHART_COLORS.length];
            const isLine     = chartType === 'line';
            const isDoughnut = chartType === 'doughnut';

            return {
                label:              ds.label,
                data:               ds.data || [],
                backgroundColor:    isDoughnut
                    ? (ds.colors || CHART_COLORS)
                    : `${baseColor}cc`,
                borderColor:        isDoughnut ? (ds.borderColor || '#1e293b') : baseColor,
                borderWidth:        isDoughnut ? 2 : isLine ? 2 : 0,
                borderDash:         ds.isDashed ? [6, 4] : undefined,
                tension:            isLine ? 0.3 : 0,
                pointRadius:        isLine ? 0 : undefined,
                pointHitRadius:     isLine ? 20 : undefined,
                pointHoverRadius:   isLine ? 5 : undefined,
                fill:               false,
                hoverOffset:        isDoughnut ? 6 : undefined,
                barPercentage:      isDoughnut ? undefined : 0.7,
                categoryPercentage: isDoughnut ? undefined : 0.85
            };
        });

        const isDoughnut = chartType === 'doughnut';
        const isLine     = chartType === 'line';
        const isBar      = chartType === 'bar';

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

        // WoW badge plugin (line charts only)
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

        // Bar drilldown: pointer cursor and click handler
        const projectIds = this.cardData.chartProjectIds || [];
        const hasDrilldown = isBar && projectIds.length > 0;

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
                interaction: isLine
                    ? { mode: 'index', intersect: false }
                    : { mode: 'nearest', intersect: true },
                onHover: hasDrilldown ? (event, elements) => {
                    const isLabel = this._getXAxisLabelIndex(event) >= 0;
                    event.native.target.style.cursor =
                        (elements.length || isLabel) ? 'pointer' : 'default';
                } : undefined,
                onClick: hasDrilldown ? (event, elements) => {
                    if (!elements.length) return;
                    // Bar click → drilldown
                    const idx       = elements[0].index;
                    const projectId = projectIds[idx];
                    const rawLabel  = (chartLabels[idx] || '').replace(' ●', '').trim();
                    if (projectId) this._handleBarClick(projectId, rawLabel);
                } : undefined,
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

        // Native click listener for x-axis label → open record in new tab
        // (Chart.js onClick does not reliably fire in the axis area below chartArea.bottom)
        if (hasDrilldown) {
            if (this._canvasClickHandler) {
                canvas.removeEventListener('click', this._canvasClickHandler);
            }
            this._canvasClickHandler = (e) => {
                if (!this._chart) return;
                const { chartArea, scales } = this._chart;
                if (!scales.x || e.offsetY <= chartArea.bottom) return;
                // Rotated labels anchor at their tick mark (right end of text), so the
                // visible text sits one slot to the LEFT of the tick — shift +1 to correct.
                const xScale = scales.x;
                const n = xScale.ticks.length;
                if (!n) return;
                const segW = (xScale.right - xScale.left) / n;
                const raw  = Math.floor((e.offsetX - xScale.left) / segW);
                const idx  = raw + 1;
                if (idx >= 0 && idx < n && projectIds[idx]) {
                    this._navigateToProject(projectIds[idx]);
                }
            };
            canvas.addEventListener('click', this._canvasClickHandler);
        }
    }

    // ── Drilldown ─────────────────────────────────────────────────────────────

    _handleBarClick(projectId, projectName) {
        this._drilldownTitle  = projectName;
        this._drilldownActive = true;
        this._drilldownData   = null;
        getProjectWeeklyHours({ projectId })
            .then(data => {
                this._drilldownData = data;
                this._renderDrilldownChart(data);
            })
            .catch(() => {
                this._drilldownActive = false;
                this._drilldownData   = null;
                this.chartError = 'Failed to load project trend data.';
            });
    }

    closeDrilldown() {
        this._drilldownActive = false;
        this._drilldownTitle  = '';
        this._drilldownData   = null;
        this._destroyChart();
        this._tryRender();
    }

    _renderDrilldownChart(data) {
        if (!data) return;
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        setTimeout(() => {
            const canvas = this.refs.canvas;
            if (!canvas) return;
            this._destroyChart();

            const isBlock = !data.committed || data.committed.length === 0;
            const chartDatasets = [
                {
                    label:           'Hours Delivered',
                    data:            data.delivered || [],
                    borderColor:     '#00b4d8',
                    backgroundColor: 'rgba(0,180,216,0.08)',
                    borderWidth:     2,
                    tension:         0.3,
                    pointRadius:     3,
                    pointHoverRadius: 6,
                    fill:            true
                }
            ];
            if (!isBlock) {
                chartDatasets.push({
                    label:           'Weekly Commitment',
                    data:            data.committed,
                    borderColor:     '#ef4444',
                    backgroundColor: 'transparent',
                    borderWidth:     2,
                    borderDash:      [6, 4],
                    tension:         0,
                    pointRadius:     0,
                    pointHitRadius:  0,
                    fill:            false
                });
            }

            /* global Chart */
            this._chart = new Chart(canvas, {
                type: 'line',
                data: { labels: data.labels || [], datasets: chartDatasets },
                options: {
                    responsive:          true,
                    maintainAspectRatio: false,
                    interaction:         { mode: 'index', intersect: false },
                    plugins: {
                        legend: {
                            display:  !isBlock,
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
                            callbacks: {
                                label: (ctx) => {
                                    const v   = ctx.parsed.y;
                                    const fmt = Number.isInteger(v) ? v : v.toFixed(1);
                                    return ` ${ctx.dataset.label}: ${fmt}h`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            ticks: { color: '#94a3b8', font: { size: 11 } },
                            grid:  { color: 'rgba(255,255,255,0.05)' }
                        },
                        y: {
                            beginAtZero: true,
                            ticks: { color: '#94a3b8', font: { size: 11 } },
                            grid:  { color: 'rgba(255,255,255,0.07)' }
                        }
                    }
                }
            });
        }, 0);
    }

    // Returns the chart x-axis tick index under the pointer, or -1 if not over a label
    _getXAxisLabelIndex(event) {
        if (!this._chart || event.x == null || event.y == null) return -1;
        const { chartArea, scales } = this._chart;
        if (!scales.x || event.y <= chartArea.bottom) return -1;
        const xScale = scales.x;
        const n = xScale.ticks.length;
        if (!n) return -1;
        const segW = (xScale.right - xScale.left) / n;
        const idx  = Math.floor((event.x - xScale.left) / segW);
        return (idx >= 0 && idx < n) ? idx : -1;
    }

    _navigateToProject(projectId) {
        window.open(`${window.location.origin}/lightning/r/Sprint__c/${projectId}/view`, '_blank');
    }

    _destroyChart() {
        if (this._canvasClickHandler) {
            const c = this.refs.canvas;
            if (c) c.removeEventListener('click', this._canvasClickHandler);
            this._canvasClickHandler = null;
        }
        if (this._chart) {
            this._chart.destroy();
            this._chart = null;
        }
    }

    // ── Event handlers ────────────────────────────────────────────────────────

    handleProjectClick(event) {
        const id = event.currentTarget.dataset.id;
        if (!id) return;
        window.open(`${window.location.origin}/lightning/r/Sprint__c/${id}/view`, '_blank');
    }

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
