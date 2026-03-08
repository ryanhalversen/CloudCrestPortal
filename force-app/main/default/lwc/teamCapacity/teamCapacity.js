import { LightningElement, wire, track } from 'lwc';
import getCapacityData from '@salesforce/apex/TeamCapacityController.getCapacityData';
import getBillingHistory from '@salesforce/apex/TeamCapacityController.getBillingHistory';
import getTeamBillingHistory from '@salesforce/apex/TeamCapacityController.getTeamBillingHistory';

// ── Team configuration ─────────────────────────────────────────────────────
// Weekly billable hour targets per person.
// Add/remove entries here. 'match' is a substring of the Salesforce User Name.
const TEAM_CONFIG = [
    { match: 'Ryan',  weeklyTarget: 35, role: 'FTE', exclude: true },
    { match: 'Chris', weeklyTarget: 35, role: 'FTE' },
    { match: 'Terri', weeklyTarget: 35, role: 'FTE' },
    { match: 'Alec',  weeklyTarget: 20, role: 'Head of Delivery' },
];
const DEFAULT_TARGET = 35;

const PACE_CLASSES = {
    'On Pace': 'pace-badge pace-on',
    'Ahead':   'pace-badge pace-ahead',
    'Behind':  'pace-badge pace-behind'
};

// Shared color palette for billing chart — index stays consistent with projectCols order
const CHART_COLORS = ['#0e7490', '#7c3aed', '#16a34a', '#dc2626', '#d97706', '#2563eb', '#db2777', '#059669', '#92400e'];

const TEAM_CARD_ID = 'TEAM';

export default class TeamCapacity extends LightningElement {
    @track _data        = null;
    @track _selectedId  = null;
    @track _activeTab   = 'total';
    @track isLoading    = true;
    @track error        = null;

    // ── Billing history state ──────────────────────────────────────────────
    @track _billingUserId           = null;
    @track _billingWeeks            = 8;
    @track _billingView             = 'week';     // 'week' | 'month'
    @track _billingGrouping         = 'project';  // 'project' | 'total'
    @track _billingData             = [];
    @track _billingLoading          = false;
    @track _billingSelectedProjects = null;   // null = all; Set<string> = specific subset

    // ── Wire: capacity data ────────────────────────────────────────────────
    @wire(getCapacityData)
    wiredData({ data, error }) {
        this.isLoading = false;
        if (data) {
            this._data  = data;
            this.error  = null;
        } else if (error) {
            this.error  = error?.body?.message || 'Failed to load capacity data.';
            this._data  = null;
        }
    }

    // ── Billing history — imperative call (bypasses LWC wire cache) ───────
    async _fetchBillingHistory() {
        if (!this._billingUserId || !this._billingWeeks) {
            this._billingData    = [];
            this._billingLoading = false;
            return;
        }
        this._billingLoading = true;
        try {
            const data = this._billingUserId === TEAM_CARD_ID
                ? await getTeamBillingHistory({ weeks: this._billingWeeks })
                : await getBillingHistory({ userId: this._billingUserId, weeks: this._billingWeeks });
            this._billingData = data || [];
        } catch (e) {
            this._billingData = [];
        } finally {
            this._billingLoading = false;
        }
    }

    // ── Person cards ──────────────────────────────────────────────────────
    get personCards() {
        if (!this._data) return [];

        // Build hours-logged map from weekly hours list
        const loggedMap = new Map();
        (this._data.weeklyHours || []).forEach(w => {
            loggedMap.set(w.userId, w.hours || 0);
        });

        // Aggregate demand per owner
        const personMap = new Map();
        (this._data.projects || []).forEach(p => {
            if (!p.ownerId) return;
            const cfg = TEAM_CONFIG.find(c => (p.ownerName || '').includes(c.match)) || {};
            if (cfg.exclude) return;
            if (!personMap.has(p.ownerId)) {
                personMap.set(p.ownerId, {
                    id:           p.ownerId,
                    name:         p.ownerName,
                    role:         cfg.role || 'FTE',
                    weeklyTarget: cfg.weeklyTarget || DEFAULT_TARGET,
                    demand:       0,
                    projectCount: 0
                });
            }
            const person = personMap.get(p.ownerId);
            const ownerSplit = 1 - ((p.supportSplit || 0) / 100);
            if (p.contractType !== 'Block') {
                person.demand += Math.max(0, p.onTimeWeeklyPace || 0) * ownerSplit;
            }
            person.projectCount += 1;
        });

        // Support lead demand
        (this._data.projects || []).forEach(p => {
            if (!p.supportLeadId) return;
            const cfg = TEAM_CONFIG.find(c => (p.supportLeadName || '').includes(c.match)) || {};
            if (cfg.exclude) return;
            if (!personMap.has(p.supportLeadId)) {
                personMap.set(p.supportLeadId, {
                    id:           p.supportLeadId,
                    name:         p.supportLeadName,
                    role:         cfg.role || 'FTE',
                    weeklyTarget: cfg.weeklyTarget || DEFAULT_TARGET,
                    demand:       0,
                    projectCount: 0
                });
            }
            const person = personMap.get(p.supportLeadId);
            const split  = (p.supportSplit || 0) / 100;
            if (p.contractType !== 'Block') {
                person.demand += Math.max(0, p.onTimeWeeklyPace || 0) * split;
            }
            person.projectCount += 1;
        });

        return Array.from(personMap.values()).map(p => {
            const logged    = loggedMap.get(p.id) || 0;
            const target    = p.weeklyTarget;
            const available = p.demand > 30 ? null : Math.round(Math.max(0, target - p.demand) * 10) / 10;
            const logPct    = Math.min(110, Math.round((logged  / target) * 100));
            const demandPct = Math.min(110, Math.round((p.demand / target) * 100));
            const isAtCap   = p.demand > 30;
            const isSelected = p.id === this._selectedId;

            let statusLabel, statusClass;
            if (isAtCap) { statusLabel = 'At Capacity'; statusClass = 'cap-status cap-over'; }
            else         { statusLabel = 'Available';   statusClass = 'cap-status cap-ok'; }

            return {
                id:           p.id,
                name:         p.name,
                initials:     this._initials(p.name),
                role:         p.role,
                weeklyTarget: target,
                demand:       Math.round(p.demand * 10) / 10,
                logged:       logged,
                available:    available,
                logPct,
                demandPct,
                isOver: isAtCap,
                statusLabel,
                statusClass,
                projectCount: p.projectCount,
                cardClass:    `person-card${isSelected ? ' person-card-selected' : ''}`,
                logBarStyle:  `width:${logPct}%`,
                demandBarStyle: `width:${Math.min(100, demandPct)}%`
            };
        });
    }

    // ── Contractor cards ──────────────────────────────────────────────────
    get contractorCards() {
        if (!this._data?.contractors) return [];
        return (this._data.contractors || []).map(c => ({
            id:          c.id,
            name:        c.name,
            initials:    this._initials(c.name),
            weeklyHours: c.weeklyHours
        }));
    }

    // ── Team overview card ────────────────────────────────────────────────
    get teamCard() {
        const cards = this.personCards;
        if (!cards.length) return null;
        const fteCapacity        = cards.reduce((s, p) => s + p.weeklyTarget, 0);
        const contractorCapacity = (this._data?.contractors || []).reduce((s, c) => s + (c.weeklyHours || 0), 0);
        const totalCapacity      = fteCapacity + contractorCapacity;
        const demand             = Math.round(cards.reduce((s, p) => s + p.demand, 0) * 10) / 10;
        const utilization        = totalCapacity > 0 ? Math.round((demand / totalCapacity) * 100) : 0;
        const isOver             = utilization > 100;
        const isHigh             = !isOver && utilization >= 85;
        const isSelected         = this._selectedId === TEAM_CARD_ID;
        return {
            id:               TEAM_CARD_ID,
            totalCapacity,
            fteCapacity,
            contractorCapacity,
            hasContractors:   contractorCapacity > 0,
            demand,
            utilizationLabel: `${utilization}%`,
            barStyle:         `width:${Math.min(100, utilization)}%`,
            barClass:         isOver ? 'util-bar util-bar-over' : isHigh ? 'util-bar util-bar-high' : 'util-bar util-bar-ok',
            cardClass:        `person-card team-card${isSelected ? ' person-card-selected' : ''}`
        };
    }

    // ── Company summary ───────────────────────────────────────────────────
    get companySummary() {
        const cards = this.personCards;
        if (!cards.length) return null;

        const fteCapacity        = cards.reduce((s, p) => s + p.weeklyTarget, 0);
        const contractorCapacity = (this._data.contractors || [])
            .reduce((s, c) => s + (c.weeklyHours || 0), 0);
        const totalCapacity = fteCapacity + contractorCapacity;
        const totalDemand   = cards.reduce((s, p) => s + p.demand, 0);
        const utilization   = totalCapacity > 0
                              ? Math.round((totalDemand / totalCapacity) * 100) : 0;
        const barPct        = Math.min(100, utilization);
        const isOver        = utilization > 100;
        const isHigh        = !isOver && utilization >= 85;

        return {
            totalCapacity,
            fteCapacity,
            contractorCapacity,
            hasContractors:  contractorCapacity > 0,
            totalDemand:     Math.round(totalDemand * 10) / 10,
            utilization,
            barStyle:        `width:${barPct}%`,
            barClass:        isOver ? 'util-bar util-bar-over'
                            : isHigh ? 'util-bar util-bar-high'
                            : 'util-bar util-bar-ok',
            utilizationLabel: `${utilization}%`
        };
    }

    // ── Project rows ──────────────────────────────────────────────────────
    get projectRows() {
        const projects = this._data?.projects || [];
        const filtered = this._selectedId && this._selectedId !== TEAM_CARD_ID
            ? projects.filter(p => p.ownerId === this._selectedId || p.supportLeadId === this._selectedId)
            : projects;

        return filtered.map(p => {
            const pct      = p.contractedHours > 0
                             ? Math.round((p.hoursDelivered / p.contractedHours) * 100) : 0;
            const remaining = Math.round(Math.max(0, (p.contractedHours || 0) - (p.hoursDelivered || 0)) * 100) / 100;
            const endDate  = p.endDate
                             ? new Date(p.endDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
                             : '—';
            // When filtering by person, show their split-adjusted portion of the pace
            const isSupportLeadView = this._selectedId && p.supportLeadId === this._selectedId && p.ownerId !== this._selectedId;
            const isOwnerSplitView  = this._selectedId && p.ownerId === this._selectedId && p.supportSplit;
            const effectivePace = isSupportLeadView
                                  ? (p.onTimeWeeklyPace || 0) * ((p.supportSplit || 0) / 100)
                                  : isOwnerSplitView
                                  ? (p.onTimeWeeklyPace || 0) * (1 - (p.supportSplit || 0) / 100)
                                  : (p.onTimeWeeklyPace || 0);
            const isBlock = p.contractType === 'Block';
            return {
                id:               p.id,
                name:             p.name,
                clientName:       p.clientName,
                ownerName:        p.ownerName,
                supportLeadName:  p.supportLeadName,
                weeklyPace:       isBlock ? '—'
                                  : effectivePace > 0
                                  ? `${Math.round(effectivePace * 10) / 10}h/wk` : '—',
                contractedHours:  p.contractedHours || 0,
                hoursDelivered:   p.hoursDelivered  || 0,
                remainingHours:   remaining,
                remainingWeeks:   p.remainingWeeks != null ? `${p.remainingWeeks}w` : '—',
                endDate,
                paceStatus:       isBlock ? 'Results Based' : (p.paceStatus || '—'),
                paceClass:        isBlock ? 'pace-badge pace-results'
                                  : (PACE_CLASSES[p.paceStatus] || 'pace-badge pace-none'),
                contractType:     p.contractType || '—',
                progressPct:      Math.min(100, pct),
                progressLabel:    `${pct}%`,
                progressStyle:    `width:${Math.min(100, pct)}%`,
                progressClass:    pct >= 90 ? 'prog-bar prog-bar-warn' : 'prog-bar'
            };
        });
    }

    get hasContractors()      { return (this._data?.contractors || []).length > 0; }
    get isTotalTab()          { return this._activeTab === 'total'; }
    get isInternalTab()       { return this._activeTab === 'internal'; }
    get isContractorsTab()    { return this._activeTab === 'contractors'; }
    get personCardCount()     { return this.personCards.length; }
    get contractorCardCount() { return this.contractorCards.length; }
    get totalPeopleCount()    { return this.personCardCount + this.contractorCardCount; }

    get totalTabClass() {
        return `cap-tab-btn${this._activeTab === 'total' ? ' cap-tab-btn-active' : ''}`;
    }
    get internalTabClass() {
        return `cap-tab-btn${this._activeTab === 'internal' ? ' cap-tab-btn-active' : ''}`;
    }
    get contractorsTabClass() {
        return `cap-tab-btn cap-tab-btn-ext${this._activeTab === 'contractors' ? ' cap-tab-btn-active' : ''}`;
    }

    get totalSummary() {
        const cards = this.personCards;
        const contractors = this._data?.contractors || [];
        if (!cards.length) return null;
        const fteCapacity        = cards.reduce((s, p) => s + p.weeklyTarget, 0);
        const contractorCapacity = contractors.reduce((s, c) => s + (c.weeklyHours || 0), 0);
        const totalCapacity      = fteCapacity + contractorCapacity;
        const demand             = cards.reduce((s, p) => s + p.demand, 0);
        const available          = Math.max(0, totalCapacity - demand);
        const utilization        = totalCapacity > 0 ? Math.round((demand / totalCapacity) * 100) : 0;
        const isOver             = utilization > 100;
        const isHigh             = !isOver && utilization >= 85;
        return {
            totalCapacity,
            demand:           Math.round(demand * 10) / 10,
            available:        Math.round(available * 10) / 10,
            utilizationLabel: `${utilization}%`,
            totalPeople:      cards.length + contractors.length,
            barStyle:  `width:${Math.min(100, utilization)}%`,
            barClass:  isOver ? 'util-bar util-bar-over'
                     : isHigh ? 'util-bar util-bar-high'
                     : 'util-bar util-bar-ok'
        };
    }

    get internalSummary() {
        const cards = this.personCards;
        if (!cards.length) return null;
        const capacity    = cards.reduce((s, p) => s + p.weeklyTarget, 0);
        const demand      = cards.reduce((s, p) => s + p.demand, 0);
        const utilization = capacity > 0 ? Math.round((demand / capacity) * 100) : 0;
        const atCapCount  = cards.filter(p => p.isOver).length;
        const isOver      = utilization > 100;
        const isHigh      = !isOver && utilization >= 85;
        return {
            capacity,
            demand:           Math.round(demand * 10) / 10,
            utilizationLabel: `${utilization}%`,
            memberCount:      cards.length,
            atCapCount,
            barStyle:  `width:${Math.min(100, utilization)}%`,
            barClass:  isOver ? 'util-bar util-bar-over' : isHigh ? 'util-bar util-bar-high' : 'util-bar util-bar-ok'
        };
    }

    get contractorSummary() {
        const contractors = this._data?.contractors || [];
        return {
            totalHours: contractors.reduce((s, c) => s + (c.weeklyHours || 0), 0),
            count:      contractors.length
        };
    }

    get hasProjects()     { return this.projectRows.length > 0; }
    get noProjects()      { return !this.isLoading && !this.hasProjects; }
    get showEmpty()       { return !this.isLoading && !this.error && this.noProjects; }
    get filterLabel()     {
        if (!this._selectedId || this._selectedId === TEAM_CARD_ID) return 'All active projects';
        const person = this.personCards.find(p => p.id === this._selectedId);
        return person ? `${person.name}'s projects` : 'Filtered projects';
    }

    // ── Billing panel getters ──────────────────────────────────────────────
    get showBillingPanel()  { return !!this._selectedId; }
    get billingPersonName() {
        if (this._selectedId === TEAM_CARD_ID) return 'Team';
        const p = this.personCards.find(x => x.id === this._selectedId);
        if (p) return p.name;
        const c = this.contractorCards.find(x => x.id === this._selectedId);
        return c ? c.name : '';
    }
    get isContractorSelected() {
        return this._selectedId && this.contractorCards.some(c => c.id === this._selectedId);
    }

    get billingViewWeekClass()  { return `bh-view-btn${this._billingView === 'week'  ? ' bh-view-btn-active' : ''}`; }
    get billingViewMonthClass() { return `bh-view-btn${this._billingView === 'month' ? ' bh-view-btn-active' : ''}`; }
    get billingIsWeekView()     { return this._billingView === 'week'; }
    get billingIsMonthView()    { return this._billingView === 'month'; }

    get bhRange1Active() { return this._billingView === 'week' ? this._billingWeeks === 4  : this._billingWeeks === 13; }
    get bhRange2Active() { return this._billingView === 'week' ? this._billingWeeks === 8  : this._billingWeeks === 26; }
    get bhRange3Active() { return this._billingView === 'week' ? this._billingWeeks === 12 : this._billingWeeks === 52; }
    get bhRange1Class()  { return `bh-range-btn${this.bhRange1Active ? ' bh-range-btn-active' : ''}`; }
    get bhRange2Class()  { return `bh-range-btn${this.bhRange2Active ? ' bh-range-btn-active' : ''}`; }
    get bhRange3Class()  { return `bh-range-btn${this.bhRange3Active ? ' bh-range-btn-active' : ''}`; }

    get billingIsProjectView()      { return this._billingGrouping === 'project'; }
    get billingIsTotalView()        { return this._billingGrouping === 'total'; }
    get billingGroupTotalClass()    { return `bh-view-btn${this._billingGrouping === 'total'   ? ' bh-view-btn-active' : ''}`; }
    get billingGroupProjectClass()  { return `bh-view-btn${this._billingGrouping === 'project' ? ' bh-view-btn-active' : ''}`; }
    get billingEmptyMessage()       {
        return this._billingGrouping === 'total'
            ? 'No time entries found for this period.'
            : 'Select a project above to view billing history.';
    }

    // ── Billing aggregation helpers ────────────────────────────────────────
    _weekStartOf(dateStr) {
        const d = new Date(dateStr + 'T00:00:00');
        const day = d.getDay(); // 0=Sun
        const diff = (day === 0 ? -6 : 1 - day);
        d.setDate(d.getDate() + diff);
        return d.toISOString().slice(0, 10);
    }

    _weekLabel(dateStr) {
        const d = new Date(dateStr + 'T00:00:00');
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    _monthKey(dateStr) { return dateStr.slice(0, 7); }

    _monthLabel(key) {
        const [y, m] = key.split('-');
        return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    }

    // ── billingRows getter ─────────────────────────────────────────────────
    get billingRows() {
        const entries = this._billingData || [];
        const buckets = new Map();   // key → { label, totalMin, byProject: Map }
        const projSet  = new Map();  // projectName → display order

        entries.forEach(e => {
            const key   = this._billingView === 'week'
                          ? this._weekStartOf(e.loggedDate)
                          : this._monthKey(e.loggedDate);
            const label = this._billingView === 'week'
                          ? `Wk of ${this._weekLabel(key)}`
                          : this._monthLabel(key);
            const proj  = e.projectName || 'No Project';
            if (!projSet.has(proj)) projSet.set(proj, projSet.size);
            if (!buckets.has(key))  buckets.set(key, { label, totalMin: 0, byProject: new Map() });
            const b = buckets.get(key);
            b.totalMin += e.minutes || 0;
            b.byProject.set(proj, (b.byProject.get(proj) || 0) + (e.minutes || 0));
        });

        const projectCols = [...projSet.keys()];
        // Sort rows newest-first
        const sortedKeys = [...buckets.keys()].sort((a, b) => b.localeCompare(a));
        const rows = sortedKeys.map(k => {
            const b = buckets.get(k);
            return {
                label:      b.label,
                totalHours: Math.round((b.totalMin / 60) * 10) / 10,
                cells:      projectCols.map(p => ({
                    key:   p,
                    hours: b.byProject.has(p)
                           ? Math.round((b.byProject.get(p) / 60) * 10) / 10
                           : null
                }))
            };
        });

        // Average row
        const avgTotalHours = rows.length
            ? Math.round((rows.reduce((s, r) => s + r.totalHours, 0) / rows.length) * 10) / 10
            : 0;
        const avgCells = projectCols.map((p, i) => {
            const sum = rows.reduce((s, r) => s + (r.cells[i].hours || 0), 0);
            return { key: p, hours: rows.length ? Math.round((sum / rows.length) * 10) / 10 : null };
        });

        return { projectCols, rows, avgTotalHours, avgCells, isEmpty: rows.length === 0 };
    }

    // ── Handlers ──────────────────────────────────────────────────────────
    handlePersonClick(e) {
        const id   = e.currentTarget.dataset.id;
        const same = this._selectedId === id;
        this._selectedId = same ? null : id;
        // Team card and FTEs have billing history; contractors (Contacts) do not
        const isFteOrTeam = id === TEAM_CARD_ID || this.personCards.some(p => p.id === id);
        this._billingUserId = (!same && isFteOrTeam) ? id : null;
        if (!same && isFteOrTeam) {
            this._billingView             = 'week';
            this._billingWeeks            = 8;
            this._billingGrouping         = 'project';
            this._billingSelectedProjects = null;
            this._fetchBillingHistory();
        }
    }

    handleClearFilter() {
        this._selectedId    = null;
        this._billingUserId = null;
    }

    handleTabClick(e) {
        this._activeTab     = e.currentTarget.dataset.tab;
        this._selectedId    = null;
        this._billingUserId = null;
    }

    handleProjectClick(e) {
        const id = e.currentTarget.dataset.id;
        window.open(`/lightning/r/Sprint__c/${id}/view`, '_blank');
    }

    handleBillingView(e) {
        this._billingView  = e.currentTarget.dataset.view;
        this._billingWeeks = this._billingView === 'week' ? 8 : 26;
        this._fetchBillingHistory();
    }

    handleBillingRange(e) {
        this._billingWeeks = Number(e.currentTarget.dataset.weeks);
        this._fetchBillingHistory();
    }

    handleBillingGrouping(e) {
        this._billingGrouping = e.currentTarget.dataset.group;
    }

    handleProjectChipClick(e) {
        const col  = e.currentTarget.dataset.col;
        const { projectCols } = this.billingRows;
        const sel  = this._billingSelectedProjects;

        if (sel === null) {
            // All selected — deselect just this one
            const next = new Set(projectCols);
            next.delete(col);
            this._billingSelectedProjects = next;
        } else {
            const next = new Set(sel);
            if (next.has(col)) { next.delete(col); } else { next.add(col); }
            // If all are re-selected, revert to null (all)
            this._billingSelectedProjects = next.size === projectCols.length ? null : next;
        }
    }

    // ── Billing chart ─────────────────────────────────────────────────────
    get billingChart() {
        const { projectCols, rows } = this.billingRows;
        if (!rows || rows.length === 0 || !projectCols.length) return null;

        const W = 900, H = 240;
        const padLeft = 48, padRight = 60, padTop = 18, padBottom = 58;
        const plotW = W - padLeft - padRight;
        const plotH = H - padTop - padBottom;

        const periods = [...rows].reverse();   // oldest → newest
        const n       = periods.length;
        const xOf = (i) => n <= 1 ? padLeft + plotW / 2 : padLeft + (i / (n - 1)) * plotW;

        // ── Total view: single line ─────────────────────────────────────
        if (this._billingGrouping === 'total') {
            const maxHours = Math.max(...periods.map(r => r.totalHours), 1);
            const yMax     = Math.ceil(maxHours / 5) * 5 || 10;
            const yOf      = (h) => padTop + plotH - ((h || 0) / yMax) * plotH;

            const gridLines = [0, 0.25, 0.5, 0.75, 1].map(f => ({
                y: Math.round(yOf(f * yMax)), label: Math.round(f * yMax) + 'h',
                x1: padLeft, x2: padLeft + plotW
            }));

            const color  = '#0e7490';
            const series = [{
                col:      'Total Hours',
                color,
                dotStyle: `background:${color}`,
                points:   periods.map((row, i) => ({
                    key:    `total-${i}`,
                    x:      Math.round(xOf(i) * 10) / 10,
                    y:      Math.round(yOf(row.totalHours) * 10) / 10,
                    hours:  row.totalHours,
                    period: row.label
                }))
            }];

            const xLabels = periods.map((row, i) => ({
                x: Math.round(xOf(i) * 10) / 10, y: padTop + plotH + 20,
                label: row.label, totalHours: row.totalHours
            }));

            return { W, H, padLeft, padTop, plotW, plotH, gridLines, series, xLabels };
        }

        // ── By-project view: one line per active project ────────────────
        const sel        = this._billingSelectedProjects;
        const activeCols = sel === null ? projectCols : projectCols.filter(c => sel.has(c));
        if (activeCols.length === 0) return null;

        let maxHours = 1;
        periods.forEach(row => {
            activeCols.forEach(col => {
                const h = row.cells[projectCols.indexOf(col)]?.hours || 0;
                if (h > maxHours) maxHours = h;
            });
        });
        const yMax = Math.ceil(maxHours / 5) * 5 || 10;
        const yOf  = (h) => padTop + plotH - ((h || 0) / yMax) * plotH;

        const gridLines = [0, 0.25, 0.5, 0.75, 1].map(f => ({
            y: Math.round(yOf(f * yMax)), label: Math.round(f * yMax) + 'h',
            x1: padLeft, x2: padLeft + plotW
        }));

        const series = activeCols.map(col => {
            const ci    = projectCols.indexOf(col);
            const color = CHART_COLORS[ci % CHART_COLORS.length];
            return {
                col, color, dotStyle: `background:${color}`,
                points: periods.map((row, i) => ({
                    key:    `${col}-${i}`,
                    x:      Math.round(xOf(i) * 10) / 10,
                    y:      Math.round(yOf(row.cells[ci]?.hours || 0) * 10) / 10,
                    hours:  row.cells[ci]?.hours || 0,
                    period: row.label
                }))
            };
        });

        const xLabels = periods.map((row, i) => {
            const activeTotal = activeCols.reduce((sum, col) => {
                return sum + (row.cells[projectCols.indexOf(col)]?.hours || 0);
            }, 0);
            return {
                x: Math.round(xOf(i) * 10) / 10, y: padTop + plotH + 20,
                label: row.label, totalHours: Math.round(activeTotal * 10) / 10
            };
        });

        return { W, H, padLeft, padTop, plotW, plotH, gridLines, series, xLabels };
    }

    get hasBillingEntries() { return !this.billingRows.isEmpty; }
    get billingChartEmpty() { return !this.billingChart; }

    // Weekly + monthly averages for the selected lookback
    get billingSummaryStats() {
        const { rows, projectCols } = this.billingRows;
        if (!rows || rows.length === 0 || !projectCols.length) return null;

        let totalHours;
        if (this._billingGrouping === 'total') {
            totalHours = rows.reduce((s, r) => s + r.totalHours, 0);
        } else {
            const sel        = this._billingSelectedProjects;
            const activeCols = sel === null ? projectCols : projectCols.filter(c => sel.has(c));
            if (activeCols.length === 0) return null;
            totalHours = rows.reduce((sum, row) =>
                sum + activeCols.reduce((s, col) => {
                    return s + (row.cells[projectCols.indexOf(col)]?.hours || 0);
                }, 0), 0);
        }

        const weeklyAvg  = Math.round((totalHours / this._billingWeeks) * 10) / 10;
        const monthlyAvg = Math.round((weeklyAvg * 52 / 12) * 10) / 10;
        return { weeklyAvg, monthlyAvg };
    }

    // Chip row — one button per project, colored to match the chart line
    get billingProjectChips() {
        const { projectCols } = this.billingRows;
        if (!projectCols || !projectCols.length) return [];
        const sel = this._billingSelectedProjects;
        return projectCols.map((col, ci) => {
            const color    = CHART_COLORS[ci % CHART_COLORS.length];
            const selected = sel === null || sel.has(col);
            return {
                col,
                selected,
                chipClass: `bh-chip${selected ? ' bh-chip-active' : ''}`,
                chipStyle: selected
                    ? `background:${color};border-color:${color};color:#fff`
                    : `border-color:${color};color:${color}`
            };
        });
    }

    renderedCallback() {
        const container = this.template.querySelector('.bh-chart-svg');
        if (!container) return;
        container.innerHTML = this._buildChartSVG();

        // Attach tooltip listeners to every dot
        const wrap    = this.template.querySelector('.bh-chart-wrap');
        const tooltip = this.template.querySelector('.bh-tooltip');
        if (!wrap || !tooltip) return;

        container.querySelectorAll('.bh-dot').forEach(dot => {
            dot.addEventListener('mouseenter', (e) => {
                const hours  = e.target.dataset.hours;
                const period = e.target.dataset.period;
                const col    = e.target.dataset.col;
                tooltip.innerHTML =
                    `<div style="font-size:0.88rem;font-weight:700;line-height:1.2">${hours}h</div>` +
                    `<div style="font-size:0.68rem;opacity:0.75;margin-top:2px">${period}</div>` +
                    `<div style="font-size:0.65rem;opacity:0.6;margin-top:1px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${col}</div>`;
                tooltip.style.display = 'block';
                e.target.setAttribute('r', '6.5');

                const wrapRect = wrap.getBoundingClientRect();
                const dotRect  = e.target.getBoundingClientRect();
                tooltip.style.left = `${dotRect.left + dotRect.width / 2 - wrapRect.left}px`;
                tooltip.style.top  = `${dotRect.top - wrapRect.top - 8}px`;
            });
            dot.addEventListener('mouseleave', (e) => {
                tooltip.style.display = 'none';
                e.target.setAttribute('r', '4.5');
            });
        });
    }

    _buildChartSVG() {
        const chart = this.billingChart;
        if (!chart) return '';
        const { W, H, padLeft, padTop, plotW, plotH, gridLines, series, xLabels } = chart;

        let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">`;

        // Grid lines + y-axis labels
        gridLines.forEach(gl => {
            svg += `<line x1="${gl.x1}" y1="${gl.y}" x2="${gl.x2}" y2="${gl.y}" stroke="#f1f5f9" stroke-width="1"/>`;
            svg += `<text x="${padLeft - 10}" y="${gl.y}" fill="#9ca3af" font-size="11" font-family="system-ui,sans-serif" text-anchor="end" dominant-baseline="middle">${gl.label}</text>`;
        });

        // Bottom axis
        svg += `<line x1="${padLeft}" y1="${padTop + plotH}" x2="${padLeft + plotW}" y2="${padTop + plotH}" stroke="#e5e7eb" stroke-width="1"/>`;

        // Area fills (very subtle)
        series.forEach(s => {
            if (s.points.length < 2) return;
            const bottom = padTop + plotH;
            let d = `M ${s.points[0].x} ${bottom} L ${s.points[0].x} ${s.points[0].y}`;
            s.points.slice(1).forEach(p => { d += ` L ${p.x} ${p.y}`; });
            d += ` L ${s.points[s.points.length - 1].x} ${bottom} Z`;
            svg += `<path d="${d}" fill="${s.color}" opacity="0.07"/>`;
        });

        // Lines
        series.forEach(s => {
            if (s.points.length === 0) return;
            const d = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
            svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
        });

        // Dots — rendered last so they're on top and easy to hover
        series.forEach(s => {
            s.points.forEach(p => {
                const h   = p.hours || 0;
                const per = p.period.replace(/"/g, '&quot;');
                const col = s.col.replace(/"/g, '&quot;');
                svg += `<circle cx="${p.x}" cy="${p.y}" r="4.5" fill="${s.color}" stroke="white" stroke-width="1.5" ` +
                       `class="bh-dot" style="cursor:pointer" ` +
                       `data-hours="${h}" data-period="${per}" data-col="${col}"/>`;
            });
        });

        // X-axis labels — period name + total hours on second line
        xLabels.forEach(xl => {
            svg += `<text x="${xl.x}" y="${xl.y}" fill="#9ca3af" font-size="11" font-family="system-ui,sans-serif" text-anchor="middle">${xl.label}</text>`;
            svg += `<text x="${xl.x}" y="${xl.y + 15}" fill="#111827" font-size="12" font-weight="700" font-family="system-ui,sans-serif" text-anchor="middle">${xl.totalHours}h</text>`;
        });

        svg += '</svg>';
        return svg;
    }

    // ── Helpers ───────────────────────────────────────────────────────────
    _initials(name) {
        if (!name) return '?';
        return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    }
}
