// execOverview.js
import { LightningElement, wire, track } from 'lwc';
import getKpiSummary          from '@salesforce/apex/ExecOverviewController.getKpiSummary';
import getStoriesByDepartment from '@salesforce/apex/ExecOverviewController.getStoriesByDepartment';
import getStoriesByPriority   from '@salesforce/apex/ExecOverviewController.getStoriesByPriority';
import getStoriesByType       from '@salesforce/apex/ExecOverviewController.getStoriesByType';
import getTypeTrend           from '@salesforce/apex/ExecOverviewController.getTypeTrend';

const DEPT_COLORS = ['#4da6ff','#818cf8','#34d399','#fbbf24','#f87171','#a78bfa'];

// Matched to chart colors
const TYPE_COLORS = {
    'System Issue / Bug':      '#f87171',
    'Feature Request':         '#4da6ff',
    'Reports & Dashboards':    '#34d399',
    'Access & Permissions':    '#fbbf24',
    'User Training & Support': '#a78bfa',
    'Data Management':         '#fb923c',
    'Other / Miscellaneous':   '#94a3b8'
};

const TREND_COLORS = {
    'System Issue / Bug':      '#f87171',
    'Feature Request':         '#4da6ff',
    'Reports & Dashboards':    '#34d399',
    'Access & Permissions':    '#fbbf24',
    'User Training & Support': '#a78bfa',
    'Data Management':         '#fb923c',
    'Other / Miscellaneous':   '#94a3b8'
};

const DEFAULT_COLOR = '#94a3b8';
const PRIORITY_COLORS = { 'Critical': '#dc2626', 'High': '#ea580c', 'Medium': '#ca8a04', 'Low': '#16a34a', 'Needs Assignment': '#94a3b8' };
const PRIORITY_BADGE  = { 'Critical': 'eo-badge eo-badge-critical', 'High': 'eo-badge eo-badge-high', 'Medium': 'eo-badge eo-badge-medium', 'Low': 'eo-badge eo-badge-low', 'Needs Assignment': 'eo-badge eo-badge-na' };

export default class ExecOverview extends LightningElement {
    @track kpi = { total:0, completed:0, blocked:0, inProgress:0, inReview:0, backlog:0, inUAT:0, cancelled:0 };
    @track deptRows = [];
    @track priorityRows = [];
    @track typeRows = [];
    @track trendCols = [];

    @wire(getKpiSummary)
    wiredKpi({ data }) {
        if (data) this.kpi = { ...this.kpi, ...data };
    }

    @wire(getStoriesByDepartment)
    wiredDept({ data }) {
        if (!data) return;
        const max = Math.max(...data.map(d => d.count), 1);
        this.deptRows = data.map((d, i) => ({
            dept: d.dept,
            count: d.count,
            barStyle: `width:${Math.round((d.count / max) * 100)}%;background:${DEPT_COLORS[i % DEPT_COLORS.length]}`
        }));
    }

    @wire(getStoriesByPriority)
    wiredPriority({ data }) {
        if (!data) return;
        const max = Math.max(...data.map(d => d.count), 1);
        this.priorityRows = data.map(d => ({
            priority: d.priority,
            count: d.count,
            badgeClass: PRIORITY_BADGE[d.priority] || 'eo-badge eo-badge-na',
            barStyle: `width:${Math.round((d.count / max) * 100)}%;background:${PRIORITY_COLORS[d.priority] || DEFAULT_COLOR}`
        }));
    }

    // Type tiles — now uses TYPE_COLORS map keyed by name
    @wire(getStoriesByType)
    wiredType({ data }) {
        if (!data) return;
        this.typeRows = data.map(d => {
            const color = TYPE_COLORS[d.type] || DEFAULT_COLOR;
            return {
                type: d.type,
                count: d.count,
                colorStyle: `color:${color};font-size:28px;font-weight:800;display:block;line-height:1`,
                tileStyle: `border-top:4px solid ${color}`
            };
        });
    }

    @wire(getTypeTrend)
    wiredTrend({ data }) {
        if (!data) return;
        const weekMap = {};
        data.forEach(r => {
            if (!weekMap[r.week]) weekMap[r.week] = {};
            weekMap[r.week][r.type] = r.count;
        });
        const weeks = Object.keys(weekMap).sort();
        const maxTotal = Math.max(...weeks.map(w => Object.values(weekMap[w]).reduce((a, b) => a + b, 0)), 1);
        this.trendCols = weeks.map((w, i) => {
            const types = weekMap[w];
            const total = Object.values(types).reduce((a, b) => a + b, 0);
            const segs = Object.keys(types).map(t => ({
                type: t,
                style: `height:${Math.round((types[t] / maxTotal) * 160)}px;background:${TREND_COLORS[t] || DEFAULT_COLOR};width:100%`
            }));
            return { week: w, weekLabel: `Wk ${i + 1}`, segments: segs };
        });
    }

    get completionPct() {
        if (!this.kpi.total) return 0;
        return Math.round((this.kpi.completed / this.kpi.total) * 100);
    }

    get ringOffset() {
        return Math.round(339.3 * (1 - this.completionPct / 100));
    }

    get legendItems() {
        return Object.keys(TREND_COLORS).map(k => ({
            label: k,
            dotStyle: `background:${TREND_COLORS[k]};width:10px;height:10px;border-radius:2px;display:inline-block`
        }));
    }

    get trendInsight() {
        const bugCol = this.trendCols.map(c => {
            const seg = c.segments.find(s => s.type === 'System Issue / Bug');
            return seg ? parseInt(seg.style.match(/height:(\d+)/)[1]) : 0;
        });
        if (bugCol.length < 2) return '';
        const declining = bugCol[bugCol.length - 1] < bugCol[0];
        return declining
            ? '✅ Trend looks healthy — Bug volume is decreasing week over week. Product is stabilizing.'
            : '⚠️ Bug volume is not yet declining — monitor closely over the next sprint.';
    }
}