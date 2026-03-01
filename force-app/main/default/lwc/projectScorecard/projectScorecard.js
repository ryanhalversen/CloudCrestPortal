import { LightningElement, wire, track } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { publish, MessageContext } from 'lightning/messageService';
import PROJECT_SELECTED_CHANNEL from '@salesforce/messageChannel/ProjectSelected__c';
import getProjects from '@salesforce/apex/ProjectScorecardController.getProjects';

export default class ProjectScorecard extends NavigationMixin(LightningElement) {
    @track _projects      = [];
    @track isLoading      = true;
    @track viewMode       = 'mine'; // 'mine' | 'all' | 'owner'
    @track _apexViewMode  = 'mine'; // actual wire param — 'owner' maps to 'all'
    @track sortField      = null;
    @track sortDir        = 'asc';
    @track filterType     = 'all';  // 'all' | 'retainer' | 'results'

    @wire(MessageContext)
    _msgCtx;

    // ── Toggle handlers ────────────────────────────────────────────────────────
    get myBtnClass()    { return this.viewMode === 'mine'  ? 'toggle-btn active' : 'toggle-btn'; }
    get allBtnClass()   { return this.viewMode === 'all'   ? 'toggle-btn active' : 'toggle-btn'; }
    get ownerBtnClass() { return this.viewMode === 'owner' ? 'toggle-btn active' : 'toggle-btn'; }

    showMine() {
        if (this.viewMode !== 'mine') {
            this.viewMode = 'mine'; this._apexViewMode = 'mine';
            this.isLoading = true;  this.filterType = 'all';
        }
    }
    showAll() {
        if (this.viewMode !== 'all') {
            this.viewMode = 'all'; this._apexViewMode = 'all';
            this.isLoading = true;
        }
    }
    showOwner() {
        if (this.viewMode !== 'owner') {
            this.viewMode = 'owner';
            if (this._apexViewMode !== 'all') {
                this._apexViewMode = 'all';
                this.isLoading = true;
            }
        }
    }

    // ── Wire ───────────────────────────────────────────────────────────────────
    @wire(getProjects, { viewMode: '$_apexViewMode' })
    wiredProjects({ data, error }) {
        this.isLoading = false;
        if (data) {
            this._projects = data.map(p => this._mapProject(p));
        } else if (error) {
            console.error('ProjectScorecard error:', error);
            this._projects = [];
        }
    }

    get hasProjects()  { return this._projects.length > 0; }
    get isAllMode()    { return this.viewMode === 'all'; }
    get isOwnerMode()  { return this.viewMode === 'owner'; }

    get ownerGroups() {
        const map = {};
        this._projects.forEach(p => {
            const key = p.ownerName || 'Unassigned';
            if (!map[key]) map[key] = { ownerName: key, projects: [] };
            map[key].projects.push(p);
        });
        return Object.values(map)
            .sort((a, b) => a.ownerName.localeCompare(b.ownerName))
            .map(g => ({ ...g, projectCount: g.projects.length }));
    }

    get projects() {
        let list = this._projects;

        // Filter
        if (this.filterType === 'results') {
            list = list.filter(p => (p.paceBadgeLabel || '').toLowerCase().includes('results'));
        } else if (this.filterType === 'retainer') {
            list = list.filter(p => !(p.paceBadgeLabel || '').toLowerCase().includes('results'));
        }

        // Sort
        if (!this.sortField) return list;
        const field = this.sortField;
        const dir   = this.sortDir === 'asc' ? 1 : -1;
        return [...list].sort((a, b) => {
            let va = a[field], vb = b[field];
            if (va === '--') va = null;
            if (vb === '--') vb = null;
            if (va == null && vb == null) return 0;
            if (va == null) return dir;
            if (vb == null) return -dir;
            if (typeof va === 'string') return va.localeCompare(vb) * dir;
            return (va - vb) * dir;
        });
    }

    // ── Filter button classes ──────────────────────────────────────────────────
    get filterAllClass()      { return this.filterType === 'all'      ? 'filter-btn filter-active' : 'filter-btn'; }
    get filterRetainerClass() { return this.filterType === 'retainer' ? 'filter-btn filter-active' : 'filter-btn'; }
    get filterResultsClass()  { return this.filterType === 'results'  ? 'filter-btn filter-active' : 'filter-btn'; }

    handleFilterChange(evt) {
        this.filterType    = evt.currentTarget.dataset.filter;
        this.hoverProject  = null;
    }

    // ── Sort header label getters ───────────────────────────────────────────────
    _sortMark(field) {
        if (this.sortField !== field) return '';
        return this.sortDir === 'asc' ? ' ↑' : ' ↓';
    }
    get thLabelName()      { return 'Project'          + this._sortMark('Name'); }
    get thLabelPace()      { return 'Pace'             + this._sortMark('paceBadgeLabel'); }
    get thLabelPurchased() { return 'Purchased'        + this._sortMark('hoursPurchased'); }
    get thLabelDelivered() { return 'Delivered'        + this._sortMark('hoursDelivered'); }
    get thLabelTimeline()  { return 'Timeline / Hours' + this._sortMark('timelinePercent'); }
    get thLabelDelta()     { return 'Delta'            + this._sortMark('deltaRaw'); }
    get thLabelRemaining() { return 'Remaining'        + this._sortMark('hoursRemaining'); }
    get thLabelEndDate()   { return 'End Date'         + this._sortMark('endDate'); }

    // Sort header CSS class
    _thClass(field) {
        return this.sortField === field ? 'th th-sortable th-sorted' : 'th th-sortable';
    }
    get thClsName()      { return this._thClass('Name'); }
    get thClsPace()      { return this._thClass('paceBadgeLabel'); }
    get thClsPurchased() { return this._thClass('hoursPurchased'); }
    get thClsDelivered() { return this._thClass('hoursDelivered'); }
    get thClsTimeline()  { return this._thClass('timelinePercent'); }
    get thClsDelta()     { return this._thClass('deltaRaw'); }
    get thClsRemaining() { return this._thClass('hoursRemaining'); }
    get thClsEndDate()   { return this._thClass('endDate'); }

    // ── Sort handler ───────────────────────────────────────────────────────────
    handleSort(evt) {
        evt.stopPropagation();
        const field = evt.currentTarget.dataset.field;
        if (!field) return;
        if (this.sortField === field) {
            this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortField = field;
            this.sortDir   = 'asc';
        }
    }

    // ── Card click — publish project selection ─────────────────────────────────
    handleCardClick(e) {
        if (e.target.classList.contains('btn-open-record') ||
            e.target.classList.contains('btn-row-open') ||
            (e.target.closest && e.target.closest('button'))) return;
        const id   = e.currentTarget.dataset.id;
        const name = e.currentTarget.dataset.name;
        if (!id) return;
        publish(this._msgCtx, PROJECT_SELECTED_CHANNEL, { projectId: id, projectName: name });
    }

    // ── Open Record button ─────────────────────────────────────────────────────
    navigateToRecord(e) {
        e.stopPropagation();
        const id = e.currentTarget.dataset.id;
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId: id, actionName: 'view' }
        });
    }

    // ── Mapping ────────────────────────────────────────────────────────────────
    _mapProject(p) {
        const pct            = this._calcTimeline(p.Project_Start_Date__c, p.Project_End_Date__c);
        const hPct           = this._calcHoursPercent(p.Contracted_Hours_Sprint__c, p.Hours_Delivered__c);
        const delta          = hPct - pct;
        const isResultsBased = (p.Pace_Status__c || '').toLowerCase().includes('results');
        return {
            Id:                p.Id,
            Name:              p.Name,
            accountName:       p.Accountlu__r?.Name ?? '',
            ownerName:         p.Owner?.Name ?? '',
            hoursPurchased:    p.Contracted_Hours_Sprint__c  ?? '--',
            hoursDelivered:    p.Hours_Delivered__c          ?? '--',
            hoursRemaining:    p.Completed_Delta_Sprint__c   ?? '--',
            weeklySprintHours: p.Weekly_Pace_Estimate__c
                                   ? `${p.Weekly_Pace_Estimate__c} hrs`
                                   : '--',
            startDate:          this._formatDate(p.Project_Start_Date__c),
            endDate:            this._formatDate(p.Project_End_Date__c),
            timelinePercent:    pct,
            progressStyle:      `width:${pct}%`,
            hoursPercent:       hPct,
            hoursBarStyle:      this._calcHoursBarStyle(hPct),
            paceBadgeClass:     this._getPaceBadgeClass(p.Pace_Status__c),
            paceBadgeLabel:     p.Pace_Status__c ?? '--',
            showDelta:          !isResultsBased,
            deltaRaw:           delta,
            deltaLabel:         this._calcDeltaLabel(delta),
            deltaClass:         this._calcDeltaClass(delta)
        };
    }

    // ── Helpers ────────────────────────────────────────────────────────────────
    _formatDate(d) {
        if (!d) return '--';
        const [y, m, day] = d.split('-').map(Number);
        return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    _calcTimeline(start, end) {
        if (!start || !end) return 0;
        const [sy, sm, sd] = start.split('-').map(Number);
        const [ey, em, ed] = end.split('-').map(Number);
        const s   = new Date(sy, sm - 1, sd);
        const e   = new Date(ey, em - 1, ed);
        const pct = Math.round(((Date.now() - s) / (e - s)) * 100);
        return Math.min(Math.max(pct, 0), 100);
    }

    _calcHoursPercent(purchased, delivered) {
        if (!purchased || purchased === 0) return 0;
        return Math.min(Math.round((delivered / purchased) * 100), 100);
    }

    _calcHoursBarStyle(pct) {
        const color = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#0176d3';
        return `width:${pct}%; background:${color};`;
    }

    _calcDeltaLabel(delta) {
        const abs = Math.abs(Math.round(delta));
        if (abs <= 5)    return '≈ On pace';
        if (delta < 0)   return `↓ ${abs}% behind`;
        return `↑ ${abs}% ahead`;
    }

    _calcDeltaClass(delta) {
        if (Math.abs(delta) <= 5) return 'delta-chip delta-on';
        if (delta < -20)          return 'delta-chip delta-way-over';  // way behind = red
        if (delta < 0)            return 'delta-chip delta-over';       // a little behind = amber
        return 'delta-chip delta-under';                                 // ahead = green
    }

    _getPaceBadgeClass(pace) {
        const base = 'pace-badge';
        if (!pace) return `${base} pace-none`;
        const p = pace.toLowerCase();
        if (p.includes('behind') || p.includes('problem')) return `${base} pace-behind`;
        if (p.includes('on track') || p.includes('on pace')) return `${base} pace-on`;
        if (p.includes('ahead')) return `${base} pace-ahead`;
        return `${base} pace-none`;
    }
}
