import { LightningElement, wire, track } from 'lwc';
import getCapacityData from '@salesforce/apex/TeamCapacityController.getCapacityData';

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
    @track isLoading    = true;
    @track error        = null;

    // ── Wire ──────────────────────────────────────────────────────────────
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
            // Demand = remaining hours / remaining weeks (pace needed to finish on time)
            const remaining = Math.max(0, (p.contractedHours || 0) - (p.hoursDelivered || 0));
            const weeks     = p.remainingWeeks || 0;
            const demand    = (p.contractedHours > 0 && weeks > 0)
                              ? remaining / weeks
                              : (p.weeklyPace || 0);
            person.demand       += demand;
            person.projectCount += 1;
        });

        return Array.from(personMap.values()).map(p => {
            const logged    = loggedMap.get(p.id) || 0;
            const target    = p.weeklyTarget;
            const available = Math.max(0, target - logged);
            const logPct    = Math.min(110, Math.round((logged  / target) * 100));
            const demandPct = Math.min(110, Math.round((p.demand / target) * 100));
            const isOver    = logged > target;
            const isNearCap = !isOver && logPct >= 80;
            const isSelected = p.id === this._selectedId;

            let statusLabel, statusClass;
            if (isOver)    { statusLabel = 'Over Capacity'; statusClass = 'cap-status cap-over'; }
            else if (isNearCap) { statusLabel = 'Near Capacity'; statusClass = 'cap-status cap-near'; }
            else            { statusLabel = 'Available';     statusClass = 'cap-status cap-ok'; }

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
                isOver,
                statusLabel,
                statusClass,
                projectCount: p.projectCount,
                cardClass:    `person-card${isSelected ? ' person-card-selected' : ''}`,
                logBarStyle:  `width:${logPct}%`,
                demandBarStyle: `width:${Math.min(100, demandPct)}%`
            };
        });
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
            return {
                id:               p.id,
                name:             p.name,
                clientName:       p.clientName,
                ownerName:        p.ownerName,
                supportLeadName:  p.supportLeadName,
                weeklyPace:       (() => {
                    const rem = Math.max(0, (p.contractedHours || 0) - (p.hoursDelivered || 0));
                    const wks = p.remainingWeeks || 0;
                    if (p.contractedHours > 0 && wks > 0) {
                        return `${Math.round(rem / wks * 10) / 10}h/wk`;
                    }
                    return p.weeklyPace > 0 ? `${p.weeklyPace}h/wk` : '—';
                })(),
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

    get hasProjects()     { return this.projectRows.length > 0; }
    get noProjects()      { return !this.isLoading && !this.hasProjects; }
    get showEmpty()       { return !this.isLoading && !this.error && this.noProjects; }
    get filterLabel()     {
        if (!this._selectedId) return 'All active projects';
        const person = this.personCards.find(p => p.id === this._selectedId);
        return person ? `${person.name}'s projects` : 'Filtered projects';
    }

    // ── Handlers ──────────────────────────────────────────────────────────
    handlePersonClick(e) {
        const id = e.currentTarget.dataset.id;
        this._selectedId = this._selectedId === id ? null : id;
    }

    handleClearFilter() { this._selectedId = null; }

    handleProjectClick(e) {
        const id = e.currentTarget.dataset.id;
        window.open(`/lightning/r/Sprint__c/${id}/view`, '_blank');
    }

    // ── Helpers ───────────────────────────────────────────────────────────
    _initials(name) {
        if (!name) return '?';
        return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    }
}
