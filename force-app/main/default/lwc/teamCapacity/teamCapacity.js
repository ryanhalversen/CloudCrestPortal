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

        const contractorCapacity = (this._data.contractors || [])
            .reduce((s, c) => s + (c.weeklyHours || 0), 0);
        const totalCapacity = cards.reduce((s, p) => s + p.weeklyTarget, 0) + contractorCapacity;
        const totalDemand   = cards.reduce((s, p) => s + p.demand, 0);
        const utilization   = totalCapacity > 0
                              ? Math.round((totalDemand / totalCapacity) * 100) : 0;
        const barPct        = Math.min(100, utilization);
        const isOver        = utilization > 100;
        const isHigh        = !isOver && utilization >= 85;

        return {
            totalCapacity,
            totalDemand:   Math.round(totalDemand * 10) / 10,
            utilization,
            barStyle:      `width:${barPct}%`,
            barClass:      isOver ? 'util-bar util-bar-over'
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
