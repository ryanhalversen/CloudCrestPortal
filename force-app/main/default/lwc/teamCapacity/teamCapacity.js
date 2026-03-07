import { LightningElement, wire, track } from 'lwc';
import getCapacityData from '@salesforce/apex/TeamCapacityController.getCapacityData';
import getBillingHistory from '@salesforce/apex/TeamCapacityController.getBillingHistory';

// ── Team configuration ─────────────────────────────────────────────────────
// Weekly billable hour targets per person.
// Add/remove entries here. 'match' is a substring of the Salesforce User Name.
const TEAM_CONFIG = [
    { match: 'Ryan',  weeklyTarget: 35, role: 'FTE', exclude: true },
    { match: 'Chris', weeklyTarget: 35, role: 'FTE' },
    { match: 'Terri', weeklyTarget: 35, role: 'FTE' }
    // Example contractor entries:
    // { match: 'Alec',  weeklyTarget: 20, role: 'Contractor' },
];
const DEFAULT_TARGET = 35;

const PACE_CLASSES = {
    'On Pace': 'pace-badge pace-on',
    'Ahead':   'pace-badge pace-ahead',
    'Behind':  'pace-badge pace-behind'
};

export default class TeamCapacity extends LightningElement {
    @track _data        = null;
    @track _selectedId  = null;
    @track _activeTab   = 'total';
    @track isLoading    = true;
    @track error        = null;

    // ── Billing history state ──────────────────────────────────────────────
    @track _billingUserId  = null;
    @track _billingWeeks   = 8;
    @track _billingView    = 'week';   // 'week' | 'month'
    @track _billingData    = [];
    @track _billingLoading = false;

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

    // ── Wire: billing history ──────────────────────────────────────────────
    @wire(getBillingHistory, { userId: '$_billingUserId', weeks: '$_billingWeeks' })
    wiredBilling({ data, error }) {
        this._billingLoading = false;
        this._billingData = data || [];
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
            person.demand       += Math.max(0, p.onTimeWeeklyPace || 0) * ownerSplit;
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
            person.demand       += Math.max(0, p.onTimeWeeklyPace || 0) * split;
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
        const filtered = this._selectedId
            ? projects.filter(p => p.ownerId === this._selectedId || p.supportLeadId === this._selectedId)
            : projects;

        return filtered.map(p => {
            const pct      = p.contractedHours > 0
                             ? Math.round((p.hoursDelivered / p.contractedHours) * 100) : 0;
            const remaining = Math.max(0, (p.contractedHours || 0) - (p.hoursDelivered || 0));
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
            return {
                id:               p.id,
                name:             p.name,
                clientName:       p.clientName,
                ownerName:        p.ownerName,
                supportLeadName:  p.supportLeadName,
                weeklyPace:       effectivePace > 0
                                  ? `${Math.round(effectivePace * 10) / 10}h/wk` : '—',
                contractedHours:  p.contractedHours || 0,
                hoursDelivered:   p.hoursDelivered  || 0,
                remainingHours:   remaining,
                remainingWeeks:   p.remainingWeeks != null ? `${p.remainingWeeks}w` : '—',
                endDate,
                paceStatus:       p.paceStatus || '—',
                paceClass:        PACE_CLASSES[p.paceStatus] || 'pace-badge pace-none',
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
        if (!this._selectedId) return 'All active projects';
        const person = this.personCards.find(p => p.id === this._selectedId);
        return person ? `${person.name}'s projects` : 'Filtered projects';
    }

    // ── Billing panel getters ──────────────────────────────────────────────
    get showBillingPanel()  { return !!this._selectedId; }
    get billingPersonName() {
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
        // Set billing userId only for FTEs (contractors are Contacts, not Users)
        const isFte = this.personCards.some(p => p.id === id);
        this._billingUserId = (!same && isFte) ? id : null;
        if (!same && isFte) {
            this._billingLoading = true;
            this._billingView  = 'week';
            this._billingWeeks = 8;
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
        this._billingLoading = true;
    }

    handleBillingRange(e) {
        this._billingWeeks   = Number(e.currentTarget.dataset.weeks);
        this._billingLoading = true;
    }

    // ── Helpers ───────────────────────────────────────────────────────────
    _initials(name) {
        if (!name) return '?';
        return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    }
}
