import { LightningElement, wire, track } from 'lwc';
import getClientReportData from '@salesforce/apex/CC_ProjectMgmtReportingController.getClientReportData';

const STATUS_FILTERS = ['All', 'In Progress', 'Completed', 'On Hold', 'Not Started'];

export default class Cc_ProjectMgmtReporting extends LightningElement {

    @track _clients  = [];
    @track _filter   = 'All';
    @track _expanded = {}; // { accountId: boolean }

    @wire(getClientReportData)
    wiredData({ data, error }) {
        if (data) {
            this._clients = data;
            // Default all clients to expanded
            const expanded = {};
            for (const c of data) expanded[c.accountId] = true;
            this._expanded = expanded;
        } else if (error) {
            this._clients = [];
            console.error('CC_ProjectMgmtReporting: error loading data', error);
        }
    }

    // ── Filter bar ────────────────────────────────────────────
    get statusFilters() {
        return STATUS_FILTERS.map(v => ({
            label:    v,
            value:    v,
            btnClass: 'filter-btn' + (this._filter === v ? ' filter-btn-active' : '')
        }));
    }

    handleFilterClick(event) {
        this._filter = event.currentTarget.dataset.filter;
    }

    // ── Client toggle ─────────────────────────────────────────
    handleClientToggle(event) {
        const id = event.currentTarget.dataset.id;
        this._expanded = { ...this._expanded, [id]: !this._expanded[id] };
    }

    // ── Top-level KPIs (always unfiltered) ───────────────────
    get totalClients() {
        return this._clients.length;
    }

    get totalActiveProjects() {
        return this._clients.reduce((sum, c) =>
            sum + (c.projects || []).filter(p => p.status === 'In Progress').length, 0);
    }

    get _totalContracted() {
        return this._clients.reduce((sum, c) => sum + (Number(c.totalContractedHours) || 0), 0);
    }

    get _totalDelivered() {
        return this._clients.reduce((sum, c) => sum + (Number(c.totalDeliveredHours) || 0), 0);
    }

    get totalContractedDisplay() {
        return this._fmt(this._totalContracted);
    }

    get totalDeliveredDisplay() {
        return this._fmt(this._totalDelivered);
    }

    get overallPct() {
        const c = this._totalContracted;
        const d = this._totalDelivered;
        return c > 0 ? Math.min(100, Math.round((d / c) * 100)) : 0;
    }

    // ── Client list (filtered) ────────────────────────────────
    get hasClients() {
        return this.processedClients.length > 0;
    }

    get processedClients() {
        return this._clients
            .map(client => {
                // Filter projects by status
                const projects = (client.projects || [])
                    .filter(p => this._filter === 'All' || p.status === this._filter)
                    .map(p => this._processProject(p));

                if (projects.length === 0) return null;

                // Recalculate totals from filtered projects
                const contracted = projects.reduce((s, p) => s + (p.contractedHours || 0), 0);
                const delivered  = projects.reduce((s, p) => s + (p.deliveredHours  || 0), 0);
                const pct        = contracted > 0 ? Math.min(100, Math.round((delivered / contracted) * 100)) : 0;
                const isExpanded = !!this._expanded[client.accountId];

                return {
                    accountId:      client.accountId,
                    accountName:    client.accountName,
                    projects,
                    projectCount:   projects.length,
                    contracted,
                    delivered,
                    pct,
                    contractedDisplay: this._fmt(contracted),
                    deliveredDisplay:  this._fmt(delivered),
                    barStyle:   `width:${pct}%;background:${this._pctColor(pct)}`,
                    isExpanded,
                    chevronClass: 'chevron' + (isExpanded ? ' chevron-open' : '')
                };
            })
            .filter(Boolean);
    }

    _processProject(p) {
        const contracted = Number(p.contractedHours) || 0;
        const delivered  = Number(p.deliveredHours)  || 0;
        const pct = contracted > 0 ? Math.min(100, Math.round((delivered / contracted) * 100)) : 0;
        const stories    = p.completedStories || [];
        const totalCount = p.completedStoryCount || 0;
        return {
            id:                p.id,
            name:              p.name,
            status:            p.status,
            paceStatus:        p.paceStatus,
            ownerName:         p.ownerName,
            contractType:      p.contractType,
            deliveryType:      p.deliveryType,
            contractedHours:   contracted,
            deliveredHours:    delivered,
            completedStoryCount: totalCount,
            completedStories:  stories,
            hasStories:        stories.length > 0,
            hasMoreStories:    totalCount > stories.length,
            moreStoryCount:    totalCount - stories.length,
            pct,
            contractedDisplay: this._fmt(contracted),
            deliveredDisplay:  this._fmt(delivered),
            barStyle:          `width:${pct}%`,
            barFillClass:      'proj-bar-fill ' + this._barColorClass(pct),
            statusBadgeClass:  'status-badge '  + this._statusClass(p.status),
            paceBadgeClass:    'pace-badge '    + this._paceClass(p.paceStatus),
            startDateStr:      p.startDate || '',
            endDateStr:        p.endDate   || '',
            hasDates:          !!(p.startDate || p.endDate)
        };
    }

    // ── Helpers ───────────────────────────────────────────────
    _fmt(h) {
        if (!h && h !== 0) return '—';
        const n = Number(h);
        return n % 1 === 0 ? `${n}h` : `${n.toFixed(1)}h`;
    }

    _pctColor(pct) {
        if (pct >= 90) return '#4ade80';
        if (pct >= 50) return '#60a5fa';
        return '#f59e0b';
    }

    _barColorClass(pct) {
        if (pct >= 90) return 'bar-complete';
        if (pct >= 50) return 'bar-progress';
        return 'bar-early';
    }

    _statusClass(status) {
        const s = (status || '').toLowerCase();
        if (s.includes('complet'))          return 'st-complete';
        if (s.includes('progress'))         return 'st-active';
        if (s.includes('hold'))             return 'st-blocked';
        return 'st-open';
    }

    _paceClass(pace) {
        const p = (pace || '').toLowerCase();
        if (p.includes('ahead'))            return 'pace-ahead';
        if (p.includes('on pace'))          return 'pace-on';
        if (p.includes('behind'))           return 'pace-behind';
        if (p.includes('houston'))          return 'pace-critical';
        return 'pace-none';
    }
}
