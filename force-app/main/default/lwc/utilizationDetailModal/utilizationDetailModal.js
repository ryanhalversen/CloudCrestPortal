// force-app/main/default/lwc/utilizationDetailModal/utilizationDetailModal.js
import { LightningElement } from 'lwc';
import { loadScript } from 'lightning/platformResourceLoader';
import CHARTJS from '@salesforce/resourceUrl/chartjs';
import getUtilizationDetail from '@salesforce/apex/CommandCenterController.getUtilizationDetail';

export default class UtilizationDetailModal extends LightningElement {

    detail    = null;
    isLoading = true;
    error     = null;
    _chart    = null;
    _chartLoaded = false;

    // ── Lifecycle ──────────────────────────────────────────────────────────────

    connectedCallback() {
        loadScript(this, CHARTJS)
            .then(() => { this._chartLoaded = true; this._tryRender(); })
            .catch(() => { this.error = 'Failed to load chart library.'; });

        getUtilizationDetail()
            .then(data => { this.detail = data; this.isLoading = false; this._tryRender(); })
            .catch(err  => { this.error = err.body?.message || 'Error loading data.'; this.isLoading = false; });
    }

    disconnectedCallback() {
        if (this._chart) { this._chart.destroy(); this._chart = null; }
    }

    renderedCallback() {
        if (this._chartLoaded && this.detail && !this._chart) this._tryRender();
    }

    _tryRender() {
        if (!this._chartLoaded || !this.detail) return;
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        setTimeout(() => this._renderChart(), 0);
    }

    // ── Chart ──────────────────────────────────────────────────────────────────

    _renderChart() {
        const canvas = this.template.querySelector('.detail-chart-canvas');
        if (!canvas || !this.detail) return;
        if (this._chart) { this._chart.destroy(); this._chart = null; }

        const { chartProjectNames, chartProjectColors, chartProjectData, weekLabels, totalCapacity } = this.detail;
        if (!chartProjectNames?.length) return;

        const datasets = chartProjectNames.map((name, i) => ({
            label:           name,
            data:            chartProjectData[i] || [],
            backgroundColor: (chartProjectColors[i] || '#00b4d8') + 'cc',
            borderColor:     chartProjectColors[i] || '#00b4d8',
            borderWidth:     1,
            stack:           'demand'
        }));

        // Capacity reference line
        datasets.push({
            label:       'Internal Capacity (125h)',
            data:        new Array(8).fill(totalCapacity),
            type:        'line',
            borderColor: '#0e7490',
            borderWidth: 2,
            borderDash:  [6, 4],
            pointRadius: 0,
            fill:        false,
            order:       -1
        });

        /* global Chart */
        this._chart = new Chart(canvas, {
            type: 'bar',
            data: { labels: weekLabels, datasets },
            options: {
                responsive:          true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        stacked: true,
                        ticks:   { color: '#94a3b8', font: { size: 11 } },
                        grid:    { color: 'rgba(255,255,255,0.05)' }
                    },
                    y: {
                        stacked:     true,
                        beginAtZero: true,
                        ticks:       { color: '#94a3b8', font: { size: 11 }, stepSize: 10 },
                        grid:        { color: 'rgba(255,255,255,0.07)' }
                    }
                },
                plugins: {
                    legend: {
                        display:  true,
                        position: 'bottom',
                        labels:   { color: '#94a3b8', font: { size: 10 }, boxWidth: 10, padding: 12 }
                    },
                    tooltip: {
                        backgroundColor: '#0f172a',
                        titleColor:      '#e2e8f0',
                        bodyColor:       '#94a3b8',
                        borderColor:     '#334155',
                        borderWidth:     1,
                        mode:            'index',
                        intersect:       false
                    }
                }
            }
        });
    }

    // ── Computed Properties ────────────────────────────────────────────────────

    get hasData()          { return !this.isLoading && !this.error && this.detail != null; }
    get hasError()         { return !!this.error; }
    get hasEndingProjects(){ return (this.detail?.endingProjects?.length || 0) > 0; }
    get hasIncomingOpps()  { return (this.detail?.incomingOpps?.length  || 0) > 0; }

    get kpis() {
        if (!this.detail) return [];
        const d = this.detail;
        const net = d.netBalanceWk8;
        const netStr = (net >= 0 ? '+' : '') + net + 'h';
        return [
            { label: 'Weekly Capacity',     value: d.totalCapacity + 'h',         trend: 'neutral', sub: '3 FTEs + Head of Delivery' },
            { label: 'Current Demand',      value: d.currentWeeklyDemand + 'h',   trend: d.currentWeeklyDemand > d.totalCapacity ? 'down' : 'up', sub: 'active projects / wk' },
            { label: 'Freeing Up (8 Wks)',  value: d.hoursFreeing + 'h',          trend: 'up',      sub: 'from ending projects' },
            { label: 'Incoming (Weighted)', value: d.hoursIncoming + 'h',         trend: 'neutral', sub: 'probability-adjusted pipeline' },
            { label: 'Net Balance Wk 8',    value: netStr,                         trend: net >= 0 ? 'up' : 'down', sub: net >= 0 ? 'surplus capacity' : 'over capacity' }
        ].map(k => ({
            ...k,
            cls:      'strip-kpi strip-kpi--' + k.trend,
            trendCls: 'strip-trend strip-trend--' + k.trend,
            trendIcon: k.trend === 'up' ? '↑' : k.trend === 'down' ? '↓' : ''
        }));
    }

    get activeProjects() {
        return (this.detail?.activeProjects || []).map(p => this._enrichProject(p));
    }

    get endingProjects() {
        return (this.detail?.endingProjects || []).map(p => this._enrichProject(p));
    }

    get incomingOpps() {
        return (this.detail?.incomingOpps || []).map(o => ({
            ...o,
            rowCls:     'detail-row' + (o.isHighProb ? ' detail-row--highprob' : ''),
            probCls:    'prob-badge' + (o.isHighProb ? ' prob-badge--high' : ''),
            probDisplay: o.probability + '%'
        }));
    }

    _enrichProject(p) {
        const isUrgent  = p.urgency === 'critical';
        const isSoon    = p.urgency === 'warning';
        return {
            ...p,
            rowCls:      'detail-row' + (isUrgent ? ' detail-row--critical' : isSoon ? ' detail-row--warning' : ''),
            urgencyCls:  isUrgent ? 'urgency-badge urgency-badge--critical' : isSoon ? 'urgency-badge urgency-badge--warning' : 'urgency-badge urgency-badge--none',
            urgencyLabel: isUrgent ? '< 2 wks' : isSoon ? '2–8 wks' : '—'
        };
    }

    // ── Handlers ───────────────────────────────────────────────────────────────

    handleClose()          { this.dispatchEvent(new CustomEvent('close')); }
    handleBackdropClick()  { this.dispatchEvent(new CustomEvent('close')); }
    stopProp(e)            { e.stopPropagation(); }
}
