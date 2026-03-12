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
    _chart2              = null;

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
        if (!this._chartLoaded) return;
        const needsChart1 = !this._chart;
        const needsChart2 = !this._drilldownActive && !this._chart2 && this.cardData?.datasets2?.length > 0;
        if (needsChart1 || needsChart2) {
            this._tryRender();
        }
    }

    // ── Derived Properties ────────────────────────────────────────────────────

    get statusBadgeClass() {
        const s = this.cardData?.status || 'neutral';
        return `status-badge status-badge--${s}`;
    }

    get enrichedKpis() {
        const kpis = this.cardData?.modalKpis?.length > 0
            ? this.cardData.modalKpis
            : (this.cardData?.kpis || []);
        return kpis.map(k => ({
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
        return this.cardData?.chartType === 'bar'
            && this.cardData?.chartProjectIds?.length > 0
            && this.cardData?.chartClickNavigate !== true;
    }

    get hasSecondChart() {
        return !this._drilldownActive && (this.cardData?.datasets2?.length > 0);
    }

    get chart2SectionLabel() {
        return this.cardData?.chartSectionLabel2 || 'Weekly Hours by Team Member';
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
        setTimeout(() => {
            this._renderChart();
            if (!this._drilldownActive && this.cardData?.datasets2?.length > 0) {
                this._renderChart2();
            }
        }, 0);
    }

    _renderChart() {
        const canvas = this.refs.canvas;
        if (!canvas) return;

        // Destroy chart 1 only
        if (this._canvasClickHandler) {
            canvas.removeEventListener('click', this._canvasClickHandler);
            this._canvasClickHandler = null;
        }
        if (this._chart) { this._chart.destroy(); this._chart = null; }

        const { chartType, chartLabels, datasets } = this.cardData;
        if (!chartType || !datasets?.length) return;

        // Separate reference-line datasets from data datasets
        // Use JSON round-trip to fully escape the LWC read-only proxy
        const allDs  = JSON.parse(JSON.stringify(datasets || []));
        const refDs  = allDs.filter(d => d.isRef === true);
        const mainDs = allDs.filter(d => d.isRef !== true);

        const hasMixedTypes = mainDs.some(d => d.chartDatasetType && d.chartDatasetType !== chartType);

        // Parse multi-line labels ("name\ndate") into arrays for Chart.js multi-line x-axis
        const parsedLabels = (chartLabels || []).map(lbl => {
            if (typeof lbl === 'string' && lbl.includes('\n')) return lbl.split('\n');
            return lbl;
        });

        // End dates parallel to labels (for block tooltip)
        const endDates = JSON.parse(JSON.stringify(this.cardData.chartEndDates || []));

        // Section break index: first block project position
        const sectionBreak = this.cardData.chartSectionBreak;

        const chartDatasets = mainDs.map((ds, idx) => {
            const baseColor  = ds.color || CHART_COLORS[idx % CHART_COLORS.length];
            const dsType     = ds.chartDatasetType || chartType;
            const isLine     = dsType === 'line';
            const isDoughnut = chartType === 'doughnut';

            // Per-bar colors: ds.colors array takes priority over single baseColor
            let bgColor;
            if (isDoughnut) {
                bgColor = ds.colors || CHART_COLORS;
            } else if (ds.colors && ds.colors.length > 0) {
                bgColor = ds.colors; // array — Chart.js uses per-bar
            } else {
                bgColor = `${baseColor}cc`;
            }

            const obj = {
                label:              ds.label,
                data:               ds.data || [],
                backgroundColor:    bgColor,
                borderColor:        isDoughnut ? (ds.borderColor || '#1e293b') : baseColor,
                borderWidth:        isDoughnut ? 2 : isLine ? 2 : 0,
                borderDash:         ds.isDashed ? [6, 4] : undefined,
                tension:            isLine ? 0.3 : 0,
                pointRadius:        isLine ? 3 : undefined,
                pointHitRadius:     isLine ? 20 : undefined,
                pointHoverRadius:   isLine ? 5 : undefined,
                fill:               false,
                hoverOffset:        isDoughnut ? 6 : undefined,
                barPercentage:      (!isDoughnut && !isLine) ? 0.7 : undefined,
                categoryPercentage: (!isDoughnut && !isLine) ? 0.85 : undefined
            };
            if (ds.chartDatasetType) obj.type = ds.chartDatasetType;
            return obj;
        });

        // Add invisible legend-only entries for reference lines (all-null data = nothing rendered)
        const nullData = new Array(mainDs[0]?.data?.length || 0).fill(null);
        refDs.forEach(ref => {
            chartDatasets.push({
                label:           ref.label,
                data:            nullData,
                type:            'line',
                backgroundColor: 'transparent',
                borderColor:     ref.borderColor || ref.color || '#ef4444',
                borderWidth:     2,
                pointRadius:     0,
                fill:            false,
                spanGaps:        false
            });
        });

        // Plugin: draw horizontal tick marks on bars at each ref-line Y value
        const refLinesPlugin = {
            id: 'refLines',
            afterDatasetsDraw(chart) {
                if (!refDs.length) return;
                const { ctx, scales: sc } = chart;
                if (!sc.y) return;
                const barMeta = chart.getDatasetMeta(0);
                if (!barMeta?.data?.length) return;
                const labels = chart.data.labels || [];
                ctx.save();
                for (const ref of refDs) {
                    ctx.strokeStyle = ref.borderColor || ref.color || '#ef4444';
                    ctx.lineWidth   = 2.5;
                    ctx.setLineDash(ref.isDashed ? [4, 3] : []);
                    if (ref.isPerBar) {
                        // Per-bar mode: each bar gets a line at its own value
                        const data = ref.data || [];
                        for (let i = 0; i < barMeta.data.length; i++) {
                            const raw = data[i];
                            if (raw == null) continue;
                            const yVal = Number(raw);
                            if (!yVal) continue;
                            const barEl = barMeta.data[i];
                            if (!barEl) continue;
                            const y  = sc.y.getPixelForValue(yVal);
                            const hw = (barEl.width || 20) / 2 + 2;
                            ctx.beginPath();
                            ctx.moveTo(barEl.x - hw, y);
                            ctx.lineTo(barEl.x + hw, y);
                            ctx.stroke();
                        }
                    } else {
                        // Label-match mode: single target value, drawn on matching bars
                        const targetY = (ref.data || []).find(v => v != null);
                        if (targetY == null) continue;
                        const lbl = (ref.label || '').toLowerCase();
                        const isAlecLine = lbl.includes('hod') || lbl.includes('alec') || targetY < 100;
                        for (let i = 0; i < barMeta.data.length; i++) {
                            const barLabel  = String(labels[i] || '').toLowerCase();
                            const isAlecBar = barLabel.includes('alec') || barLabel.includes('head of delivery');
                            if (isAlecLine !== isAlecBar) continue;
                            const barEl = barMeta.data[i];
                            if (!barEl) continue;
                            const y  = sc.y.getPixelForValue(targetY);
                            const hw = (barEl.width || 20) / 2 + 2;
                            ctx.beginPath();
                            ctx.moveTo(barEl.x - hw, y);
                            ctx.lineTo(barEl.x + hw, y);
                            ctx.stroke();
                        }
                    }
                }
                ctx.setLineDash([]);
                ctx.restore();
            }
        };

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

        // Section label plugin: draw "RETAINERS" and "BLOCKS" labels below each group + a divider line
        const sectionLabelPlugin = {
            id: 'sectionLabels',
            afterDraw(chart) {
                if (sectionBreak == null || sectionBreak <= 0) return;
                const { ctx, scales: sc, chartArea } = chart;
                if (!sc.x) return;
                const n = sc.x.ticks.length;
                if (sectionBreak >= n) return;
                ctx.save();

                // Vertical divider between last retainer and first block
                const x1 = sc.x.getPixelForTick(sectionBreak - 1);
                const x2 = sc.x.getPixelForTick(sectionBreak);
                const dividerX = (x1 + x2) / 2;
                ctx.strokeStyle = 'rgba(148,163,184,0.25)';
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(dividerX, chartArea.top);
                ctx.lineTo(dividerX, chartArea.bottom);
                ctx.stroke();
                ctx.setLineDash([]);

                // Label Y: just above the legend (or near canvas bottom if no legend)
                const legendTop = chart.legend?.top ?? chart.height;
                const labelY = legendTop - 4;
                ctx.font = 'bold 10px -apple-system,BlinkMacSystemFont,sans-serif';
                ctx.textBaseline = 'bottom';

                // "RETAINERS" — centered under retainer group
                const retainerMidX = (sc.x.getPixelForTick(0) + x1) / 2;
                ctx.fillStyle = '#00b4d8';
                ctx.textAlign = 'center';
                ctx.fillText('RETAINERS', retainerMidX, labelY);

                // "BLOCKS" — centered under block group
                const lastTickX = sc.x.getPixelForTick(n - 1);
                const blockMidX = (x2 + lastTickX) / 2;
                ctx.fillStyle = '#f59e0b';
                ctx.textAlign = 'center';
                ctx.fillText('BLOCKS', blockMidX, labelY);

                ctx.restore();
            }
        };

        // End-of-project marker plugin: vertical dotted lines + labels for projects ending that week
        const endMarkers = JSON.parse(JSON.stringify(this.cardData.chartEndMarkers || []));
        const endMarkersPlugin = {
            id: 'endMarkers',
            afterDraw(chart) {
                if (!endMarkers.length) return;
                const { ctx, scales: sc, chartArea } = chart;
                if (!sc.x) return;
                ctx.save();
                for (let i = 0; i < endMarkers.length; i++) {
                    const label = endMarkers[i];
                    if (!label) continue;
                    const x = sc.x.getPixelForTick(i);

                    // Dotted vertical line
                    ctx.strokeStyle = 'rgba(239,68,68,0.6)';
                    ctx.lineWidth   = 1.5;
                    ctx.setLineDash([3, 4]);
                    ctx.beginPath();
                    ctx.moveTo(x, chartArea.top);
                    ctx.lineTo(x, chartArea.bottom);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    // Rotated label — drawn along the line, text reads bottom-to-top
                    ctx.save();
                    ctx.translate(x - 9, chartArea.top + 6);
                    ctx.rotate(-Math.PI / 2);
                    ctx.font = 'bold 9px -apple-system,BlinkMacSystemFont,sans-serif';
                    ctx.fillStyle = 'rgba(239,68,68,0.85)';
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(label + ' ends', 0, 0);
                    ctx.restore();
                }
                ctx.restore();
            }
        };

        // Bar click: navigate to record (chartClickNavigate) or drilldown
        const projectIds    = this.cardData.chartProjectIds || [];
        const clickNavigate = this.cardData.chartClickNavigate === true;
        const hasDrilldown  = isBar && projectIds.length > 0;

        /* global Chart */
        this._chart = new Chart(canvas, {
            type: chartType,
            data: {
                labels:   parsedLabels,
                datasets: chartDatasets
            },
            options: {
                responsive:          true,
                maintainAspectRatio: false,
                interaction: (isLine || hasMixedTypes)
                    ? { mode: 'index', intersect: false }
                    : { mode: 'nearest', intersect: true },
                onHover: hasDrilldown ? (event, elements) => {
                    const isLabel = this._getXAxisLabelIndex(event) >= 0;
                    event.native.target.style.cursor =
                        (elements.length || isLabel) ? 'pointer' : 'default';
                } : undefined,
                onClick: hasDrilldown ? (event, elements) => {
                    if (!elements.length) return;
                    const idx       = elements[0].index;
                    const projectId = projectIds[idx];
                    if (!projectId) return;
                    if (clickNavigate) {
                        this._navigateToProject(projectId);
                    } else {
                        const rawLbl = parsedLabels[idx];
                        const rawLabel = (Array.isArray(rawLbl) ? rawLbl[0] : (rawLbl || '')).replace(' ●', '').trim();
                        this._handleBarClick(projectId, rawLabel);
                    }
                } : undefined,
                plugins: {
                    legend: {
                        display:  mainDs.length > 1 || isDoughnut || refDs.length > 0,
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
                        filter: (item) => item.dataset.data?.some(v => v != null),
                        callbacks: {
                            label: (context) => {
                                const idx      = context.dataIndex;
                                const endDate  = endDates[idx];
                                const v        = context.parsed.y;
                                const dsLabel  = context.dataset.label || '';
                                // Block projects: suppress the numeric pace value
                                if (endDate && context.datasetIndex === 0) return null;
                                // Ref legend datasets: suppress (handled by afterBody)
                                if (context.dataset.type === 'line' && context.dataset.data?.every(d => d == null)) return null;
                                if (isLine || hasMixedTypes) {
                                    const fmt = Number.isInteger(v) ? v : v.toFixed(1);
                                    return ` ${dsLabel}: ${fmt}h`;
                                }
                                return undefined; // default Chart.js label
                            },
                            afterBody: (items) => {
                                const idx = items[0]?.dataIndex;
                                if (idx == null) return [];
                                const lines = [];
                                // Retained hours ref line (retainer projects only)
                                if (refDs.some(r => r.isPerBar)) {
                                    refDs.filter(r => r.isPerBar).forEach(r => {
                                        const v = r.data?.[idx];
                                        if (v == null || Number(v) === 0) return;
                                        const fmt = Number.isInteger(Number(v)) ? Number(v) : Number(v).toFixed(1);
                                        lines.push(` ${r.label}: ${fmt}h`);
                                    });
                                }
                                // End date for block projects
                                const endDate = endDates[idx];
                                if (endDate) lines.push(` End Date: ${endDate}`);
                                return lines;
                            }
                        }
                    }
                },
                scales
            },
            plugins: [wowPlugin, refLinesPlugin, sectionLabelPlugin, endMarkersPlugin]
        });

        // Native click listener for x-axis label → open record in new tab
        if (hasDrilldown) {
            if (this._canvasClickHandler) {
                canvas.removeEventListener('click', this._canvasClickHandler);
            }
            this._canvasClickHandler = (e) => {
                if (!this._chart) return;
                const { chartArea, scales } = this._chart;
                if (!scales.x || e.offsetY <= chartArea.bottom) return;
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

    _renderChart2() {
        const canvas = this.refs.canvas2;
        if (!canvas || !this.cardData?.datasets2?.length) return;
        if (this._chart2) { this._chart2.destroy(); this._chart2 = null; }

        const { chartType2: chartType, chartLabels2: chartLabels, datasets2: datasets } = this.cardData;
        if (!chartType || !datasets?.length) return;

        const isHorizontal = this.cardData.chartHorizontal2 === true;
        const refValue2    = this.cardData.chart2RefValue;
        const refLabel2    = this.cardData.chart2RefLabel || 'Threshold';

        // Only use non-ref datasets (ref line handled via chart2RefValue plugin)
        const mainDs2 = datasets.filter(d => d.isRef !== true);

        const chartDatasets = mainDs2.map((d2, idx) => {
            const baseColor = d2.color || CHART_COLORS[idx % CHART_COLORS.length];
            return {
                label:              d2.label,
                data:               d2.data || [],
                backgroundColor:    `${baseColor}cc`,
                borderColor:        baseColor,
                borderWidth:        0,
                fill:               false,
                barPercentage:      isHorizontal ? 0.6 : 0.7,
                categoryPercentage: 0.85
            };
        });

        // Add a legend-only null entry for the reference line
        if (refValue2 != null) {
            chartDatasets.push({
                label:           refLabel2,
                data:            new Array(mainDs2[0]?.data?.length || 0).fill(null),
                backgroundColor: 'transparent',
                borderColor:     '#f59e0b',
                borderWidth:     2,
                fill:            false
            });
        }

        // Plugin: draw threshold line (vertical for horizontal charts, horizontal otherwise)
        const refPlugin2 = {
            id: 'refLines2',
            afterDraw(chart) {
                if (refValue2 == null) return;
                const { ctx, chartArea, scales: sc } = chart;
                if (!chartArea) return;
                ctx.save();
                ctx.strokeStyle = '#f59e0b';
                ctx.lineWidth   = 1.5;
                ctx.setLineDash([5, 3]);
                if (isHorizontal && sc.x) {
                    const x = sc.x.getPixelForValue(refValue2);
                    ctx.beginPath();
                    ctx.moveTo(x, chartArea.top);
                    ctx.lineTo(x, chartArea.bottom);
                    ctx.stroke();
                } else if (!isHorizontal && sc.y) {
                    const y = sc.y.getPixelForValue(refValue2);
                    ctx.beginPath();
                    ctx.moveTo(chartArea.left, y);
                    ctx.lineTo(chartArea.right, y);
                    ctx.stroke();
                }
                ctx.setLineDash([]);
                ctx.restore();
            }
        };

        /* global Chart */
        this._chart2 = new Chart(canvas, {
            type: chartType,
            data: { labels: chartLabels || [], datasets: chartDatasets },
            options: {
                indexAxis:           isHorizontal ? 'y' : 'x',
                responsive:          true,
                maintainAspectRatio: false,
                interaction:         { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        display:  true,
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
                        filter: (item) => item.dataset.data?.some(v => v != null),
                        callbacks: {
                            label: (context) => {
                                const v    = isHorizontal ? context.parsed.x : context.parsed.y;
                                const fmt  = Number.isInteger(v) ? v : v.toFixed(1);
                                const unit = isHorizontal ? 'd' : 'h';
                                return ` ${context.dataset.label}: ${fmt}${unit}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        ticks: { color: '#94a3b8', font: { size: 11 } },
                        grid:  { color: isHorizontal ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.05)' }
                    },
                    y: {
                        beginAtZero: !isHorizontal,
                        ticks: { color: '#94a3b8', font: { size: 10 } },
                        grid:  { color: isHorizontal ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.07)' }
                    }
                }
            },
            plugins: [refPlugin2]
        });
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
        if (this._chart) { this._chart.destroy(); this._chart = null; }
        if (this._chart2) { this._chart2.destroy(); this._chart2 = null; }
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
