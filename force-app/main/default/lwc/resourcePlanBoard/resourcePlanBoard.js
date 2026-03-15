// force-app/main/default/lwc/resourcePlanBoard/resourcePlanBoard.js
import { LightningElement } from 'lwc';
import { NavigationMixin }  from 'lightning/navigation';
import getBoardData         from '@salesforce/apex/ResourcePlanningController.getBoardData';
import updateSprintOwner   from '@salesforce/apex/ResourcePlanningController.updateSprintOwner';
import upsertAssignment     from '@salesforce/apex/ResourcePlanningController.upsertAssignment';
import deleteAssignment     from '@salesforce/apex/ResourcePlanningController.deleteAssignment';
import batchSaveAssignments from '@salesforce/apex/ResourcePlanningController.batchSaveAssignments';

const UNDO_LIMIT = 20;
const URGENCY_LABEL = { critical: '< 2 wks', warning: '2–8 wks' };

const DELIVERY_TYPES = {
    'Chris Manring': 'Developer',
    'Holly Worz':    'Dev + PM',
    'Terri Lee':     'Project Manager'
};
const DELIVERY_META = {
    'Developer':       { bg: 'rgba(127,119,221,0.12)', text: '#AFA9EC', short: 'Dev', cls: 'delivery-badge--dev' },
    'Dev + PM':        { bg: 'rgba(127,119,221,0.12)', text: '#AFA9EC', short: 'Dev+PM', cls: 'delivery-badge--dev' },
    'Project Manager': { bg: 'rgba(29,158,117,0.12)',  text: '#5DCAA5', short: 'PM',  cls: 'delivery-badge--pm' }
};

export default class ResourcePlanBoard extends NavigationMixin(LightningElement) {

    // ── Server data ───────────────────────────────────────────────────────────
    _raw        = null;
    isLoading   = true;
    error       = null;

    // ── Working state ─────────────────────────────────────────────────────────
    _assignments    = [];   // RA records only (contractors + pipeline)
    _whatIfMode     = false;
    _pendingOps     = [];

    // ── Undo ──────────────────────────────────────────────────────────────────
    _undoStack      = [];

    // ── Drag state ────────────────────────────────────────────────────────────
    _drag           = null;
    _dropTarget     = null;
    _cardDropTarget = null;  // projectId of card being hovered by contractor drag

    // ── Inline edit (pipeline cards only) ────────────────────────────────────
    _editCell       = null;   // { assignmentId, value }

    // ── UI toggles ────────────────────────────────────────────────────────────
    _rightTab           = 'contractor';
    _viewMode           = 'full';
    _tempId             = 1;
    _showChart          = true;
    _selectedWeek       = 0;
    _breakdownSort      = 'name';   // 'name' | 'endDate' | 'hours'
    _breakdownSortDir   = 1;        // 1 = asc, -1 = desc
    _hoveredWeek        = null;     // { weekIdx, clientX, clientY }
    _chartMode          = 'demand'; // 'demand' | 'timeline'
    _drillFteId         = null;     // FTE id being drilled, or null
    _hodProjectsOpen    = false;    // HoD projects modal open
    _poolTab            = 'contractor'; // 'contractor' | 'pipeline'
    _planOffset         = 0;        // weeks forward for plan projection

    // ── Keyboard undo listener ────────────────────────────────────────────────
    _keyHandler     = null;

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    connectedCallback() {
        this._keyHandler = (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
                e.preventDefault();
                this._applyUndo();
            }
        };
        window.addEventListener('keydown', this._keyHandler);
        this._load();
    }

    disconnectedCallback() {
        if (this._keyHandler) window.removeEventListener('keydown', this._keyHandler);
    }

    async _load() {
        this.isLoading = true;
        this.error     = null;
        try {
            const data = await getBoardData();
            this._raw  = data;
            // Deduplicate assignments from server; delete extra records in Salesforce
            const rawAssignments = (data.assignments || []).map(a => ({ ...a, _local: false, _deleted: false }));
            const seenKeys = new Set();
            const duplicateIds = [];
            this._assignments = rawAssignments.filter(a => {
                const key = `${a.contractorId||''}|${a.sprintId||''}|${a.userId||''}|${a.opportunityId||''}`;
                if (seenKeys.has(key)) {
                    if (a.id && !a.id.startsWith('tmp-')) duplicateIds.push(a.id);
                    return false;
                }
                seenKeys.add(key);
                return true;
            });
            for (const dupId of duplicateIds) {
                deleteAssignment({ assignmentId: dupId }).catch(console.error);
            }
            this.isLoading = false;
        } catch (e) {
            this.error    = e.body?.message || 'Failed to load board data.';
            this.isLoading = false;
        }
    }

    // ── Computed: Lanes ───────────────────────────────────────────────────────

    get lanes() {
        if (!this._raw) return [];
        const planDate = this._planOffset > 0 ? this._getPlanDate() : null;
        return (this._raw.fteRows || []).map(fte => this._buildLane(fte, planDate));
    }

    _getPlanDate() {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + this._planOffset * 7);
        return d;
    }

    _buildLane(fte, planDate = null) {
        // Project cards: Sprint__c records owned by this FTE
        let ownedProjects = (this._raw.projectCards || []).filter(p => p.ownerId === fte.id);
        // Projects where this FTE is the support lead
        let supportProjects = (this._raw.projectCards || []).filter(
            p => p.supportLeadId === fte.id
        );

        // When projecting forward, hide projects that have already ended
        if (planDate) {
            ownedProjects   = ownedProjects.filter(p => !p.endDate || new Date(p.endDate) >= planDate);
            supportProjects = supportProjects.filter(p => !p.endDate || new Date(p.endDate) >= planDate);
        }

        const cards = ownedProjects.map(proj => {
            const splitPct   = (proj.supportLeadId && proj.supportSplit) ? proj.supportSplit / 100 : 0;
            const ownerHours = Math.round((proj.weeklyPace || 0) * (1 - splitPct) * 10) / 10;
            const chips      = this._contractorChipsForProject(proj.id);
            const daysLeft   = this._daysLeft(proj.endDate);
            const urg = daysLeft !== null && daysLeft <= 14 ? 'critical'
                      : daysLeft !== null && daysLeft <= 56 ? 'warning' : '';
            return {
                assignmentId: proj.id,
                projectId:    proj.id,
                recordId:     proj.id,
                name:         proj.name,
                client:       proj.client,
                hoursPerWeek: ownerHours,
                isBlock:        !!proj.isBlock,
                remainingHours: proj.remainingHours != null ? proj.remainingHours : null,
                showRemaining:  proj.remainingHours != null && !proj.isBlock,
                endDate:        proj.endDate || '—',
                urgency:        urg,
                urgencyLabel:   URGENCY_LABEL[urg] || '',
                urgencyCls:     urg ? `urg-badge urg-badge--${urg}` : '',
                showUrgency:    !!urg,
                color:          proj.color,
                colorStyle:     `border-left-color:${proj.color};`,
                cardCls:        `plan-card plan-card--${this._viewMode}${urg ? ` plan-card--${urg}` : ''}`,
                chips,
                hasChips:       chips.length > 0,
                isPipeline:     false,
                isSupport:      false,
                canRemove:      false
            };
        });

        // Support lead cards: this FTE is the support lead on someone else's project
        const supportCards = supportProjects.map(proj => {
            const splitPct     = (proj.supportSplit || 0) / 100;
            const supportHours = Math.round((proj.weeklyPace || 0) * splitPct * 10) / 10;
            const daysLeft     = this._daysLeft(proj.endDate);
            const urg = daysLeft !== null && daysLeft <= 14 ? 'critical'
                      : daysLeft !== null && daysLeft <= 56 ? 'warning' : '';
            return {
                assignmentId: `support-${proj.id}`,
                projectId:    proj.id,
                recordId:     proj.id,
                name:         proj.name,
                client:       proj.client,
                hoursPerWeek: supportHours,
                isBlock:        !!proj.isBlock,
                remainingHours: proj.remainingHours != null ? proj.remainingHours : null,
                showRemaining:  proj.remainingHours != null && !proj.isBlock,
                splitPct:       Math.round(splitPct * 100),
                endDate:        proj.endDate || '—',
                urgency:      urg,
                urgencyLabel: URGENCY_LABEL[urg] || '',
                urgencyCls:   urg ? `urg-badge urg-badge--${urg}` : '',
                showUrgency:  !!urg,
                color:        proj.color,
                colorStyle:   `border-left-color:${proj.color};`,
                cardCls:      `plan-card plan-card--support plan-card--${this._viewMode}${urg ? ` plan-card--${urg}` : ''}`,
                chips:        [],
                hasChips:     false,
                isPipeline:   false,
                isSupport:    true,
                canRemove:    false
            };
        });

        // Pipeline cards — split into still-pipeline vs projected-active
        // An opp is "projected active" at planDate if it has started AND not yet ended
        const _isOppActiveAt = (opp, date) => {
            if (!opp?.expectedStart) return false;
            const start = new Date(opp.expectedStart);
            const end   = opp.expectedEnd ? new Date(opp.expectedEnd) : null;
            return start <= date && (!end || end >= date);
        };

        const pipeAssignments = this._assignments.filter(
            a => a.userId === fte.id && !a._deleted && a.assignmentType === 'Pipeline'
        );
        const pipeCards = pipeAssignments
            .filter(a => {
                if (!planDate) return true;
                const opp = (this._raw.pipelineShelf || []).find(o => o.id === a.opportunityId);
                return !_isOppActiveAt(opp, planDate); // not yet projected → stay as pipeline card
            })
            .map(a => {
                const opp = (this._raw.pipelineShelf || []).find(o => o.id === a.opportunityId);
                const isEditing = this._editCell?.assignmentId === a.id;
                return {
                    assignmentId: a.id,
                    oppId:        a.opportunityId,
                    recordId:     a.opportunityId,
                    name:         opp?.name || a.opportunityId,
                    client:       opp?.client || '',
                    hoursPerWeek: a.hoursPerWeek || 0,
                    stage:        opp?.stage || '',
                    probability:  opp?.probability || 0,
                    isPipeline:   true,
                    canRemove:    true,
                    isEditing,
                    editValue:    isEditing ? this._editCell.value : a.hoursPerWeek,
                    cardCls:      'plan-card plan-card--pipeline'
                };
            });

        // When projecting forward: pipeline opps active at planDate become projected cards
        const projectedCards = planDate ? pipeAssignments
            .filter(a => {
                const opp = (this._raw.pipelineShelf || []).find(o => o.id === a.opportunityId);
                return _isOppActiveAt(opp, planDate);
            })
            .map(a => {
                const opp = (this._raw.pipelineShelf || []).find(o => o.id === a.opportunityId);
                return {
                    assignmentId:  `proj-${a.id}`,
                    projectId:     a.opportunityId,
                    recordId:      a.opportunityId,
                    name:          opp?.name || a.opportunityId,
                    client:        opp?.client || '',
                    hoursPerWeek:  a.hoursPerWeek || 0,
                    isBlock:       false,
                    remainingHours: null,
                    showRemaining:  false,
                    endDate:       opp?.expectedEnd || '—',
                    urgency:       '',
                    urgencyLabel:  '',
                    urgencyCls:    '',
                    showUrgency:   false,
                    color:         '#6366f1',
                    colorStyle:    'border-left-color:#6366f1;',
                    cardCls:       `plan-card plan-card--${this._viewMode} plan-card--projected`,
                    chips:         [],
                    hasChips:      false,
                    isPipeline:    false,
                    isProjected:   true,
                    isSupport:     false,
                    canRemove:     false
                };
            }) : [];

        const allCards = [...cards, ...supportCards, ...pipeCards, ...projectedCards];

        // Gross project demand (FTE's share, excluding blocks)
        const alloc =
            ownedProjects.filter(p => !p.isBlock).reduce((s, p) => {
                const splitPct = (p.supportLeadId && p.supportSplit) ? p.supportSplit / 100 : 0;
                return s + (p.weeklyPace || 0) * (1 - splitPct);
            }, 0) +
            supportProjects.filter(p => !p.isBlock).reduce((s, p) => {
                return s + (p.weeklyPace || 0) * ((p.supportSplit || 0) / 100);
            }, 0) +
            projectedCards.reduce((s, c) => s + (c.hoursPerWeek || 0), 0);

        // Contractor hours offsetting this FTE's project demand
        const ownedIds   = new Set(ownedProjects.map(p => p.id));
        const supportIds = new Set(supportProjects.map(p => p.id));
        const contrOffset = this._assignments
            .filter(a => a.contractorId && a.sprintId && !a.userId && !a._deleted)
            .filter(a => ownedIds.has(a.sprintId) || supportIds.has(a.sprintId))
            .reduce((s, a) => s + (a.hoursPerWeek || 0), 0);

        const grossAlloc = Math.round(alloc * 10) / 10;
        const netAlloc   = Math.round(Math.max(0, alloc - contrOffset) * 10) / 10;
        const cap        = fte.weeklyTarget != null ? fte.weeklyTarget : 35;
        const pct        = cap > 0 ? (netAlloc / cap) * 100 : 0;
        const barPct     = Math.min(pct, 100);
        const barColor   = pct > 100 ? '#ef4444' : pct >= 80 ? '#f59e0b' : '#22c55e';
        const hasContr   = contrOffset > 0;

        return {
            ...fte,
            cards:       allCards,
            hasCards:    allCards.length > 0,
            alloc:       grossAlloc,
            contrOffset: Math.round(contrOffset * 10) / 10,
            netAlloc,
            hasContrOffset: hasContr,
            cap,
            pct:         Math.round(pct),
            isOver:      netAlloc > cap,
            barStyle:    `width:${barPct}%;background:${barColor};`,
            utilLabel:   `${netAlloc}h / ${cap}h`,
            availLabel:  netAlloc <= cap
                ? `${Math.round((cap - netAlloc) * 10) / 10}h available`
                : `${Math.round((netAlloc - cap) * 10) / 10}h over`,
            laneCls:     `plan-lane${this._dropTarget === fte.id ? ' plan-lane--over' : ''}`,
            isCompact:   this._viewMode === 'compact'
        };
    }

    _daysLeft2(dateStr, fromDate) {
        if (!dateStr) return null;
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return null;
        return Math.round((d - fromDate) / 86400000);
    }

    _contractorChipsForProject(sprintId) {
        return this._assignments
            .filter(a => a.contractorId && a.sprintId === sprintId && !a._deleted)
            .map(a => {
                const c = (this._raw.contractorPool || []).find(x => x.id === a.contractorId);
                return { id: a.id, name: c?.name || a.contractorId, hours: a.hoursPerWeek || 0 };
            });
    }

    _daysLeft(dateStr) {
        if (!dateStr) return null;
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return null;
        const now = new Date(); now.setHours(0,0,0,0);
        return Math.round((d - now) / 86400000);
    }

    // ── Computed: Contractor Pool ─────────────────────────────────────────────

    get contractorPool() {
        if (!this._raw) return [];
        return (this._raw.contractorPool || []).map(c => {
            const assigned = this._assignments
                .filter(a => a.contractorId === c.id && !a._deleted)
                .reduce((s, a) => s + (a.hoursPerWeek || 0), 0);
            const avail  = c.availableHours || 0;
            const pct    = avail > 0 ? Math.min((assigned / avail) * 100, 100) : 0;
            const color  = pct > 100 ? '#ef4444' : pct >= 80 ? '#f59e0b' : '#22c55e';
            return {
                ...c,
                assigned:  Math.round(assigned * 10) / 10,
                remaining: Math.round(Math.max(0, avail - assigned) * 10) / 10,
                barStyle:  `width:${pct}%;background:${color};`
            };
        });
    }

    // ── Computed: Pipeline shelf ──────────────────────────────────────────────

    get pipelineShelf() {
        if (!this._raw) return [];
        return (this._raw.pipelineShelf || []).map(o => {
            const opacity = (0.35 + (o.probability / 100) * 0.65).toFixed(2);
            return {
                ...o,
                cardStyle:  `opacity:${opacity};`,
                probCls:    `prob-pill${o.probability >= 70 ? ' prob-pill--high' : ''}`,
                isAssigned: this._assignments.some(a => a.opportunityId === o.id && !a._deleted)
            };
        });
    }

    // ── Computed: KPIs ────────────────────────────────────────────────────────

    get kpis() {
        if (!this._raw) return [];

        // When the chart is visible, sync KPIs to the selected week
        const weekIdx   = this._showChart ? this._selectedWeek : 0;
        const weekStart = this._getWeekStart(weekIdx);
        const isProjected = weekIdx > 0;
        const wkStr = isProjected ? ` · wk ${weekIdx + 1}` : '';

        const totalCap = (this._raw.fteRows || []).reduce((s, f) => {
            const t = f.weeklyTarget != null ? f.weeklyTarget : 35;
            return s + t;
        }, 0);

        // Use the same demand helper as the chart for consistency
        const fteDemand = this._demandForWeek(weekStart);

        const contrHrs = this._assignments
            .filter(a => a.contractorId && !a._deleted)
            .reduce((s, a) => s + (a.hoursPerWeek || 0), 0);
        const netAvail = totalCap - fteDemand;

        // Forecast = on-time demand + pipeline that has started by this week (matches chart line)
        const forecastDemand = this._forecastForWeek(weekStart, fteDemand);

        const trend = v => v >= 0 ? 'up' : 'down';
        return [
            { label: 'FTE Capacity',      value: `${totalCap}h`,                                        trend: 'neutral', sub: `${(this._raw.fteRows||[]).length} team members` },
            { label: 'On-Time Demand',    value: `${this._round(fteDemand)}h`,                           trend: fteDemand > totalCap ? 'down' : 'up', sub: `active assignments${wkStr}` },
            { label: 'Demand Forecast',   value: `${this._round(forecastDemand)}h`,                      trend: forecastDemand > totalCap ? 'down' : 'neutral', sub: `active + pipeline${wkStr}` },
            { label: 'Net Available',     value: `${netAvail >= 0 ? '+' : ''}${this._round(netAvail)}h`, trend: trend(netAvail), sub: `${netAvail >= 0 ? 'surplus' : 'overallocated'}${wkStr}` },
            { label: 'Contractor hrs/wk', value: `${this._round(contrHrs)}h`,                           trend: 'neutral', sub: 'contractor support' }
        ].map(k => ({
            ...k,
            cls:       `board-kpi board-kpi--${k.trend}`,
            trendIcon: k.trend === 'up' ? '↑' : k.trend === 'down' ? '↓' : ''
        }));
    }

    _round(v) { return Math.round((v || 0) * 10) / 10; }

    // ── Computed: UI state ────────────────────────────────────────────────────

    get hasData()          { return !this.isLoading && !this.error && !!this._raw; }
    get hasError()         { return !!this.error; }
    get isWhatIf()         { return this._whatIfMode; }
    get canUndo()          { return this._undoStack.length === 0; }
    get hasChanges()       { return this._whatIfMode && this._pendingOps.length > 0; }
    get whatIfLabel()      { return this._whatIfMode ? 'Exit What-If' : 'What-If Mode'; }
    get boardCls()         { return `plan-board${this._whatIfMode ? ' plan-board--whatif' : ''}`; }
    get viewModeLabel()    { return this._viewMode === 'full' ? 'Compact View' : 'Full View'; }
    get showContractors()  { return this._rightTab === 'contractor'; }
    get showPipeline()     { return this._rightTab === 'pipeline'; }
    get contractorTabCls() { return `panel-tab${this._rightTab === 'contractor' ? ' panel-tab--active' : ''}`; }
    get pipelineTabCls()   { return `panel-tab${this._rightTab === 'pipeline' ? ' panel-tab--active' : ''}`; }
    get pendingCount()     { return this._pendingOps.length; }

    // Projects whose owner AND support lead are both not in any FTE lane
    get unassignedProjects() {
        if (!this._raw) return [];
        const fteIds = new Set((this._raw.fteRows || []).map(f => f.id));
        return (this._raw.projectCards || [])
            .filter(p => (!p.ownerId || !fteIds.has(p.ownerId)) && (!p.supportLeadId || !fteIds.has(p.supportLeadId)))
            .map(p => ({ ...p, cardStyle: `border-left-color:${p.color};` }));
    }
    get hasUnassigned() { return this.unassignedProjects.length > 0; }

    // ── Org Chart ─────────────────────────────────────────────────────────────

    get leaderLane() {
        if (!this._raw) return null;
        return this.lanes.find(l => l.role === 'Head of Delivery') || null;
    }

    get leaderMetrics() {
        if (!this._raw) return null;
        const totalCap   = (this._raw.fteRows || []).reduce((s, f) => s + (f.weeklyTarget != null ? f.weeklyTarget : 35), 0);
        const totalAlloc = this.lanes.reduce((s, l) => s + (l.alloc || 0), 0);
        const net        = this._round(totalCap - totalAlloc);
        return {
            capacity: totalCap,
            demand:   this._round(totalAlloc),
            net,
            netStr:   `${net >= 0 ? '+' : ''}${net}h`,
            netCls:   `leader-metric-val${net >= 0 ? ' leader-metric-val--pos' : ' leader-metric-val--neg'}`
        };
    }

    get fteTeamLanes() {
        if (!this._raw) return [];
        const team = this.lanes.filter(l => l.role !== 'Head of Delivery');
        return team.map((lane, i) => {
            const isFirst      = i === 0;
            const isLast       = i === team.length - 1;
            const isOnly       = team.length === 1;
            const deliveryType = DELIVERY_TYPES[lane.name] || 'Developer';
            const dm           = DELIVERY_META[deliveryType] || DELIVERY_META['Developer'];
            const branchCls    = [
                'org-fte-branch',
                isFirst && !isOnly ? 'org-fte-branch--first' : '',
                isLast  && !isOnly ? 'org-fte-branch--last'  : '',
                isOnly             ? 'org-fte-branch--only'  : '',
                this._dropTarget === lane.id ? 'org-fte-branch--over' : ''
            ].filter(Boolean).join(' ');

            const cards = lane.cards.map((card, ci) => {
                const isFirstCard = ci === 0;
                const isLastCard  = ci === lane.cards.length - 1;
                const isOnlyCard  = lane.cards.length === 1;
                let   dbadge, dbadgeCls, dbadgeStyle;
                if (card.isBlock) {
                    dbadge = 'Blocked'; dbadgeCls = 'delivery-badge delivery-badge--blocked'; dbadgeStyle = '';
                } else if (card.isSupport) {
                    dbadge = `Support ${card.splitPct}%`; dbadgeCls = 'delivery-badge delivery-badge--support'; dbadgeStyle = '';
                } else {
                    dbadge = dm.short; dbadgeCls = `delivery-badge ${dm.cls}`; dbadgeStyle = `background:${dm.bg};color:${dm.text};`;
                }
                const projContractors = this._assignments
                    .filter(a => a.contractorId && a.sprintId === card.projectId && !a.userId && !a._deleted)
                    .map(a => {
                        const c = (this._raw.contractorPool || []).find(x => x.id === a.contractorId);
                        return c ? { ...c, assignmentId: a.id } : null;
                    }).filter(Boolean);
                const isContOver = this._cardDropTarget === card.projectId;
                const baseCls = card.cardCls || `plan-card plan-card--${this._viewMode}`;
                return {
                    ...card,
                    cardCls: isContOver ? `${baseCls} plan-card--cont-over` : baseCls,
                    projBranchCls: [
                        'org-proj-branch',
                        isFirstCard && !isOnlyCard ? 'org-proj-branch--first' : '',
                        isLastCard  && !isOnlyCard ? 'org-proj-branch--last'  : '',
                        isOnlyCard                 ? 'org-proj-branch--only'  : ''
                    ].filter(Boolean).join(' '),
                    projContractors,
                    hasProjContractors: projContractors.length > 0,
                    deliveryBadge:      dbadge,
                    deliveryBadgeCls:   dbadgeCls,
                    deliveryBadgeStyle: dbadgeStyle
                };
            });

            const fteContractors = this._assignments
                .filter(a => a.contractorId && a.userId === lane.id && !a.sprintId && !a._deleted)
                .map(a => {
                    const c = (this._raw.contractorPool || []).find(x => x.id === a.contractorId);
                    return c ? { ...c, assignmentId: a.id } : null;
                }).filter(Boolean);
            const isFteContOver = this._dropTarget === lane.id && this._drag?.type === 'contractor';
            return {
                ...lane,
                deliveryType,
                deliveryShort:      dm.short,
                deliveryBadgeStyle: `background:${dm.bg};color:${dm.text};`,
                roleLabel:          `FTE · ${deliveryType}`,
                branchCls,
                fteCardCls: `org-card--fte org-card--fte-clickable${isFteContOver ? ' org-card--fte-cont-over' : ''}`,
                cards,
                fteContractors,
                hasFteContractors:  fteContractors.length > 0
            };
        });
    }

    // ── Org Chart drill-down ─────────────────────────────────────────────────

    get showDrill() { return !!this._drillFteId; }
    get drillFte()  {
        if (!this._drillFteId) return null;
        return this.fteTeamLanes.find(l => l.id === this._drillFteId) || null;
    }

    // ── Plan Week Projection ─────────────────────────────────────────────────

    get isPlanCurrent()  { return this._planOffset === 0; }
    get isPlanFuture()   { return this._planOffset > 0; }
    get planWeekLabel() {
        if (this._planOffset === 0) return 'Current';
        const d = this._getPlanDate();
        return `+${this._planOffset}w · ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    }
    get planBannerLabel() {
        const d = this._getPlanDate();
        return `Projected plan: week of ${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
    }

    handlePlanPrev() { if (this._planOffset > 0) { this._planOffset--; this._refresh(); } }
    handlePlanNext() { if (this._planOffset < 52) { this._planOffset++; this._refresh(); } }

    // ── HoD Projects ─────────────────────────────────────────────────────────

    get hodProjectCards() {
        const cards = this.leaderLane?.cards || [];
        return cards.map(card => {
            let dbadge, dbadgeCls, dbadgeStyle;
            if (card.isBlock) {
                dbadge = 'Blocked'; dbadgeCls = 'delivery-badge delivery-badge--blocked'; dbadgeStyle = '';
            } else if (card.isSupport) {
                dbadge = `Support ${card.splitPct}%`; dbadgeCls = 'delivery-badge delivery-badge--support'; dbadgeStyle = '';
            } else {
                dbadge = 'HoD'; dbadgeCls = 'delivery-badge delivery-badge--dev'; dbadgeStyle = 'background:rgba(0,180,216,0.12);color:#00b4d8;';
            }
            return { ...card, deliveryBadge: dbadge, deliveryBadgeCls: dbadgeCls, deliveryBadgeStyle: dbadgeStyle };
        });
    }
    get hodProjectCount() {
        return this.hodProjectCards.length;
    }
    get hasHodProjects() {
        return this.hodProjectCount > 0;
    }
    get showHodProjects() {
        return this._hodProjectsOpen;
    }

    // ── Contractor Pool (unassigned) ─────────────────────────────────────────

    get contractorPoolUnassigned() {
        if (!this._raw) return [];
        const assignedIds = new Set(
            this._assignments.filter(a => a.contractorId && !a._deleted).map(a => a.contractorId)
        );
        return (this._raw.contractorPool || []).map(c => {
            const assigned = assignedIds.has(c.id);
            return {
                ...c,
                isAssigned:   assigned,
                cardCls:      `cont-pool-card${assigned ? ' cont-pool-card--assigned' : ''}`,
                draggableStr: assigned ? 'false' : 'true'
            };
        });
    }
    get hasContractorPool() { return (this._raw?.contractorPool || []).length > 0; }
    get noUnassignedContractors() { return this.contractorPoolUnassigned.every(c => c.isAssigned); }
    get isPoolContractor() { return this._poolTab === 'contractor'; }
    get isPoolPipeline()   { return this._poolTab === 'pipeline'; }
    get poolContractorCls() { return `pool-tab-btn${this._poolTab === 'contractor' ? ' pool-tab-btn--active' : ''}`; }
    get poolPipelineCls()   { return `pool-tab-btn${this._poolTab === 'pipeline'   ? ' pool-tab-btn--active' : ''}`; }
    get poolHint() {
        return this._poolTab === 'contractor'
            ? 'Drag to an FTE column or onto a project card'
            : 'Drag onto an FTE column to assign pipeline';
    }
    get pipelinePoolCards() {
        if (!this._raw) return [];
        return (this._raw.pipelineShelf || []).map(o => {
            const assignedCount = this._assignments.filter(a => a.opportunityId === o.id && !a._deleted).length;
            return {
                ...o,
                assignedCount,
                isAssigned:   assignedCount > 0,
                assignedLabel: assignedCount > 0 ? `${assignedCount} FTE assigned` : '',
                draggableStr: 'true',
                probCls:      `prob-pill${(o.probability || 0) >= 70 ? ' prob-pill--high' : ''}`
            };
        });
    }
    get hasPipelinePool() { return (this._raw?.pipelineShelf || []).length > 0; }

    handlePoolTabContractor() { this._poolTab = 'contractor'; this._refresh(); }
    handlePoolTabPipeline()   { this._poolTab = 'pipeline';   this._refresh(); }

    // ── Forecast Chart ────────────────────────────────────────────────────────

    get showChart()        { return this._showChart; }
    get chartToggleLabel() { return this._showChart ? 'Hide Forecast' : 'Forecast'; }
    get showDemandChart()      { return this._chartMode === 'demand'; }
    get showTimeline()         { return this._chartMode === 'timeline'; }
    get chartModeDemandCls()   { return `cmode-btn${this._chartMode === 'demand'   ? ' cmode-btn--active' : ''}`; }
    get chartModeTimelineCls() { return `cmode-btn${this._chartMode === 'timeline' ? ' cmode-btn--active' : ''}`; }

    handleToggleChart() { this._showChart = !this._showChart; }

    handlePrevWeek() {
        if (this._selectedWeek > 0) this._selectedWeek = this._selectedWeek - 1;
    }
    handleNextWeek() {
        if (this._selectedWeek < 23) this._selectedWeek = this._selectedWeek + 1;
    }

    handleChartModeDemand()   { this._chartMode = 'demand'; }
    handleChartModeTimeline() { this._chartMode = 'timeline'; }

    handleBreakdownSort(e) {
        const field = e.currentTarget.dataset.sort;
        if (this._breakdownSort === field) {
            this._breakdownSortDir = this._breakdownSortDir === 1 ? -1 : 1;
        } else {
            this._breakdownSort    = field;
            this._breakdownSortDir = field === 'hours' ? -1 : 1; // hours default descending
        }
    }

    handleChartClick(e) {
        e.stopPropagation();
        const svg  = e.currentTarget;
        const rect = svg.getBoundingClientRect();
        const SVG_W = 1400, ML = 42, MR = 16, WEEKS = 24;
        const CW = SVG_W - ML - MR;
        const svgX = (e.clientX - rect.left) / rect.width * SVG_W;
        let minDist = 28, weekIdx = null;
        for (let i = 0; i < WEEKS; i++) {
            const dist = Math.abs(svgX - (ML + (i / (WEEKS - 1)) * CW));
            if (dist < minDist) { minDist = dist; weekIdx = i; }
        }
        // Toggle off if clicking same week or no week close enough
        if (weekIdx === null || (this._hoveredWeek && this._hoveredWeek.weekIdx === weekIdx)) {
            this._hoveredWeek = null;
            return;
        }
        this._hoveredWeek = { weekIdx, clientX: e.clientX, clientY: e.clientY };
    }

    handleTooltipClose(e) {
        e.stopPropagation();
        this._hoveredWeek = null;
    }

    get dotTooltip() {
        if (!this._hoveredWeek || !this._raw) return null;
        const { weekIdx, clientX, clientY } = this._hoveredWeek;
        const weekStart = this._getWeekStart(weekIdx);
        const fteIds    = new Set((this._raw.fteRows || []).map(f => f.id));
        const MONTHS    = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        const day       = weekStart.getDate();
        const ord       = day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th';
        const dateLabel = `${MONTHS[weekStart.getMonth()]} ${day}${ord}`;

        const projects = (this._raw.projectCards || [])
            .filter(p => !p.isBlock && (fteIds.has(p.ownerId) || fteIds.has(p.supportLeadId)))
            .filter(p => !p.endDate || new Date(p.endDate) >= weekStart)
            .map(p => ({ id: p.id, name: p.name, hrs: this._round(p.weeklyPace || 0), colorStyle: `background:${p.color};` }));

        const pipeline = (this._raw.pipelineShelf || [])
            .filter(o => o.expectedStart && new Date(o.expectedStart) <= weekStart)
            .map(o => ({ id: o.id, name: o.name, hrs: this._round(o.weeklyHrs || 0) }));

        const totalDemand   = this._round(projects.reduce((s, p) => s + p.hrs, 0));
        const pipelineTotal = this._round(pipeline.reduce((s, o) => s + o.hrs, 0));
        const totalForecast = this._round(totalDemand + pipelineTotal);
        const left = Math.min(clientX + 14, (typeof window !== 'undefined' ? window.innerWidth : 1400) - 310);
        const top  = Math.max(10, clientY - 50);
        return { style: `left:${left}px;top:${top}px;`, dateLabel, projects, pipeline, hasPipeline: pipeline.length > 0, totalDemand, pipelineTotal, totalForecast };
    }

    _getWeekStart(n) {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        const day = d.getDay();
        const diff = day === 0 ? -6 : 1 - day;  // back to Monday
        d.setDate(d.getDate() + diff + n * 7);
        return d;
    }

    _demandForWeek(weekStart) {
        const fteIds = new Set((this._raw.fteRows || []).map(f => f.id));
        return (this._raw.projectCards || [])
            .filter(p => !p.isBlock && (fteIds.has(p.ownerId) || fteIds.has(p.supportLeadId)))
            .filter(p => !p.endDate || new Date(p.endDate) >= weekStart)
            .reduce((s, p) => s + (p.weeklyPace || 0), 0);
    }

    _forecastForWeek(weekStart, baseDemand) {
        const pipeAdded = (this._raw.pipelineShelf || [])
            .filter(o => o.expectedStart && new Date(o.expectedStart) <= weekStart)
            .reduce((s, o) => s + (o.weeklyHrs || 0), 0);
        return baseDemand + pipeAdded;
    }

    get chartData() {
        if (!this._raw || !this._showChart) return null;

        const WEEKS = 24;
        const SVG_W = 1400, SVG_H = 340;
        const ML = 42, MR = 16, MT = 14, MB = 44;
        const CW = SVG_W - ML - MR;   // 842
        const CH = SVG_H - MT - MB;   // 162

        const capacity = (this._raw.fteRows || []).reduce((s, f) => {
            return s + (f.weeklyTarget != null ? f.weeklyTarget : 35);
        }, 0);

        // Build per-week data
        const weeks = [];
        for (let i = 0; i < WEEKS; i++) {
            const ws   = this._getWeekStart(i);
            const dem  = this._demandForWeek(ws);
            const fore = this._forecastForWeek(ws, dem);
            weeks.push({
                i, ws,
                demand:   Math.round(dem  * 10) / 10,
                forecast: Math.round(fore * 10) / 10,
                dateLabel: `${ws.getMonth() + 1}/${ws.getDate()}`
            });
        }

        const allVals = weeks.flatMap(w => [w.demand, w.forecast, capacity]);
        const yMax = Math.ceil(Math.max(...allVals) / 20) * 20 || 140;

        const xOf = i => ML + (i / (WEEKS - 1)) * CW;
        const yOf = v => MT + CH - (Math.min(Math.max(v, 0), yMax) / yMax) * CH;

        // Y-axis grid lines — always increment by 10
        const gridStep = 10;
        const yGridLines = [];
        for (let v = 0; v <= yMax; v += gridStep) {
            yGridLines.push({ key: `yg${v}`, x1: ML, x2: ML + CW, y1: yOf(v), y2: yOf(v), lx: ML - 5, ly: yOf(v) + 3.5, v });
        }

        // Capacity flat line
        const capY = yOf(capacity);

        // Polylines
        const demandPoints  = weeks.map(w => `${xOf(w.i).toFixed(1)},${yOf(w.demand).toFixed(1)}`).join(' ');
        const forecastPoints = weeks.map(w => `${xOf(w.i).toFixed(1)},${yOf(w.forecast).toFixed(1)}`).join(' ');

        // Dots
        const demandDots   = weeks.map(w => ({ key: `dd${w.i}`, cx: xOf(w.i).toFixed(1), cy: yOf(w.demand).toFixed(1) }));
        const forecastDots = weeks.map(w => ({ key: `fd${w.i}`, cx: xOf(w.i).toFixed(1), cy: yOf(w.forecast).toFixed(1) }));

        // X-axis labels: 1st of each month across the chart range
        const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const xLabels = [];
        const timeStart = weeks[0].ws.getTime();
        const totalChartDays = (WEEKS - 1) * 7;
        let lblDate = new Date(weeks[0].ws.getFullYear(), weeks[0].ws.getMonth(), 1);
        if (lblDate < weeks[0].ws) lblDate = new Date(lblDate.getFullYear(), lblDate.getMonth() + 1, 1);
        const chartEndMs = weeks[WEEKS - 1].ws.getTime() + 6 * 86400000;
        while (lblDate.getTime() <= chartEndMs) {
            const daysDiff = (lblDate.getTime() - timeStart) / 86400000;
            const x = ML + (daysDiff / totalChartDays) * CW;
            if (x >= ML && x <= ML + CW) {
                xLabels.push({ key: `xl${lblDate.getTime()}`, x: x.toFixed(1), y: MT + CH + 13, label: `${MONTH_ABBR[lblDate.getMonth()]} 1` });
            }
            lblDate = new Date(lblDate.getFullYear(), lblDate.getMonth() + 1, 1);
        }

        // Utilization % labels (every other week)
        const utilLabels = [];
        for (let i = 0; i < WEEKS; i += 2) {
            const diff  = capacity > 0 ? Math.round(weeks[i].demand / capacity * 100) - 100 : 0;
            const label = diff > 0 ? `+${diff}%` : `${diff}%`;
            utilLabels.push({
                key: `ul${i}`, x: xOf(i).toFixed(1), y: MT + CH + 28,
                label,
                color: diff > 0 ? '#ef4444' : diff < 0 ? '#22c55e' : '#475569'
            });
        }

        // Project end markers
        const endMarkers = [];
        for (const p of (this._raw.projectCards || [])) {
            if (!p.endDate || p.isBlock) continue;
            const end = new Date(p.endDate);
            for (let i = 1; i < WEEKS; i++) {
                const ws = weeks[i].ws;
                const we = new Date(ws); we.setDate(we.getDate() + 6);
                if (end >= ws && end <= we) {
                    endMarkers.push({ key: `em${p.id}`, x: xOf(i).toFixed(1), y1: MT, y2: MT + CH });
                    break;
                }
            }
        }

        // Selected week
        const sel   = Math.min(this._selectedWeek, WEEKS - 1);
        const selW  = weeks[sel];
        const selUtil = capacity > 0 ? Math.round(selW.demand / capacity * 100) : 0;
        const selNetBal = Math.round((capacity - selW.demand) * 10) / 10;

        const wk4Util = capacity > 0 ? Math.round(weeks[3].demand / capacity * 100) : 0;
        const wk8Util = capacity > 0 ? Math.round(weeks[7].demand / capacity * 100) : 0;

        return {
            viewBox: `0 0 ${SVG_W} ${SVG_H}`,
            capY: capY.toFixed(1), capX1: ML, capX2: ML + CW,
            chartLeft: ML, chartRight: ML + CW, chartTop: MT, chartBottom: MT + CH,
            demandPoints, forecastPoints,
            demandDots, forecastDots,
            yGridLines, xLabels, utilLabels, endMarkers,
            cursorX: xOf(sel).toFixed(1), cursorTop: MT, cursorBottom: MT + CH,
            selDate:    selW.dateLabel,
            selDemand:  selW.demand,
            selUtil,    selUtilOver: selUtil > 100,
            selNetBal,  selNetOver:  selNetBal < 0,
            selNetStr:  `${selNetBal >= 0 ? '+' : ''}${selNetBal}h`,
            wk4Util,    wk4Over: wk4Util > 100,
            wk8Util,    wk8Over: wk8Util > 100,
            weekLabel:  `Week ${sel + 1} of ${WEEKS} — ${selW.dateLabel}`,
            cannotPrev: sel <= 0,
            cannotNext: sel >= WEEKS - 1
        };
    }

    // ── Forecast Breakdown ────────────────────────────────────────────────────

    get forecastBreakdown() {
        if (!this._raw || !this._showChart || this._chartMode !== 'demand') return null;
        const weekStart = this._getWeekStart(this._selectedWeek);
        const fteIds = new Set((this._raw.fteRows || []).map(f => f.id));

        const today = new Date(); today.setHours(0, 0, 0, 0);

        const projects = (this._raw.projectCards || [])
            .filter(p => fteIds.has(p.ownerId) || fteIds.has(p.supportLeadId))
            .map(p => {
                const isOverdue = !!p.endDate && new Date(p.endDate) < today;
                return {
                    id:         p.id,
                    name:       p.name,
                    client:     p.client,
                    weeklyHrs:  p.isBlock ? null : this._round(p.weeklyPace || 0),
                    hrsLabel:   p.isBlock ? 'Block' : `${this._round(p.weeklyPace || 0)}h/wk`,
                    isBlock:    !!p.isBlock,
                    endDate:    p.endDate || '—',
                    endDateMs:  p.endDate ? new Date(p.endDate).getTime() : Infinity,
                    isOverdue,
                    dateCls:    isOverdue ? 'breakdown-date breakdown-date--overdue' : 'breakdown-date',
                    colorStyle: `background:${p.color};`
                };
            });

        // Sort
        const dir = this._breakdownSortDir;
        const sorted = [...projects].sort((a, b) => {
            if (this._breakdownSort === 'endDate') return (a.endDateMs - b.endDateMs) * dir;
            if (this._breakdownSort === 'hours')   return ((a.weeklyHrs || 0) - (b.weeklyHrs || 0)) * dir;
            return a.name.localeCompare(b.name) * dir;
        });

        const sortIcon = this._breakdownSortDir === 1 ? ' ↑' : ' ↓';
        const mkCls = f => `breakdown-sort-btn${this._breakdownSort === f ? ' breakdown-sort-btn--active' : ''}`;

        const pipeline = (this._raw.pipelineShelf || [])
            .map(o => {
                const started = o.expectedStart && new Date(o.expectedStart) <= weekStart;
                return {
                    id:            o.id,
                    name:          o.name,
                    client:        o.client,
                    weeklyHrs:     this._round(o.weeklyHrs || 0),
                    probability:   o.probability || 0,
                    expectedStart: o.expectedStart || '—',
                    started,
                    startCls:      started ? 'breakdown-date' : 'breakdown-date breakdown-date--upcoming'
                };
            })
            .sort((a, b) => {
                // started opps first, then by start date
                if (a.started !== b.started) return a.started ? -1 : 1;
                const da = a.expectedStart === '—' ? Infinity : new Date(a.expectedStart).getTime();
                const db = b.expectedStart === '—' ? Infinity : new Date(b.expectedStart).getTime();
                return da - db;
            });

        return {
            projects: sorted,
            pipeline,
            hasPipeline:    pipeline.length > 0,
            sortEndDateCls: mkCls('endDate'),
            sortHoursCls:   mkCls('hours'),
            sortEndDateLbl: `End Date${this._breakdownSort === 'endDate' ? sortIcon : ''}`,
            sortHoursLbl:   `hrs/wk${this._breakdownSort === 'hours' ? sortIcon : ''}`
        };
    }

    // ── Timeline (Gantt) Chart ────────────────────────────────────────────────

    get timelineData() {
        if (!this._raw || !this._showChart) return null;

        const today = new Date(); today.setHours(0, 0, 0, 0);
        // Window: 2 weeks before today → 30 weeks after
        const BACK_WEEKS   = 2;
        const FWD_WEEKS    = 30;
        const chartStartMs = today.getTime() - BACK_WEEKS * 7 * 86400000;
        const chartEndMs   = today.getTime() + FWD_WEEKS * 7 * 86400000;
        const totalMs      = chartEndMs - chartStartMs;

        const SVG_W   = 1400;
        const LABEL_W = 150;
        const MR      = 12;
        const MT      = 8;
        const MB      = 28;
        const ROW_H   = 22;
        const GRP_H   = 18;
        const CW      = SVG_W - LABEL_W - MR;
        const clamp   = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
        const xOf     = ms => LABEL_W + clamp((ms - chartStartMs) / totalMs, 0, 1) * CW;

        // Build account groups
        const accountMap = new Map();
        const addItem = (acc, item) => {
            if (!accountMap.has(acc)) accountMap.set(acc, []);
            accountMap.get(acc).push(item);
        };

        for (const p of (this._raw.projectCards || [])) {
            const acc = p.client || '—';
            addItem(acc, {
                id: p.id, name: p.name, type: 'project',
                startMs: chartStartMs,
                endMs:   p.endDate ? new Date(p.endDate).getTime() : chartEndMs,
                color:   p.color,  isBlock: !!p.isBlock
            });
        }
        for (const o of (this._raw.pipelineShelf || [])) {
            const acc      = o.client || '—';
            const startMs  = o.expectedStart ? new Date(o.expectedStart).getTime() : today.getTime();
            const endMs    = o.expectedEnd   ? new Date(o.expectedEnd).getTime()
                           : startMs + 10 * 7 * 86400000;
            addItem(acc, { id: o.id, name: o.name, type: 'pipeline', startMs, endMs, color: null });
        }

        const accounts = [...accountMap.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([name, items]) => ({
                name,
                items: items.sort((a, b) => {
                    if (a.type !== b.type) return a.type === 'project' ? -1 : 1;
                    return a.name.localeCompare(b.name);
                })
            }));

        const grpRects   = [];
        const grpTexts   = [];
        const hLines     = [];
        const vGridLines = [];
        const bars       = [];
        const rowLabels  = [];
        const xLabels    = [];

        let y = MT;

        for (const acc of accounts) {
            grpRects.push({ key: `gr-${acc.name}`, y: y.toFixed(1), h: GRP_H });
            grpTexts.push({ key: `gt-${acc.name}`, y: (y + GRP_H * 0.72).toFixed(1), text: acc.name.toUpperCase() });
            y += GRP_H;

            for (const item of acc.items) {
                const x1   = xOf(item.startMs);
                const x2   = Math.max(xOf(item.endMs), x1 + 3);
                const cx1  = Math.max(x1, LABEL_W);
                const cx2  = Math.min(x2, LABEL_W + CW);
                const barW = cx2 - cx1;
                const barY = y + 4;
                const barH = ROW_H - 8;
                const midY = y + ROW_H / 2 + 3;

                if (barW > 0) {
                    bars.push({
                        key:       `bar-${item.id}`,
                        x:         cx1.toFixed(1), y: barY.toFixed(1),
                        width:     barW.toFixed(1), height: barH.toFixed(1),
                        fill:      item.type === 'project' ? item.color : 'rgba(148,163,184,0.18)',
                        stroke:    item.type === 'pipeline' ? '#475569' : 'none',
                        strokeDash: item.type === 'pipeline' ? '4,3' : 'none',
                        opacity:   item.type === 'pipeline' ? '0.85' : '1'
                    });
                }

                const MAX_CH = Math.floor((LABEL_W - 12) / 5.8);
                const lbl    = item.name.length > MAX_CH ? item.name.substring(0, MAX_CH - 1) + '\u2026' : item.name;
                rowLabels.push({
                    key: `rl-${item.id}`,
                    x: 8, y: midY.toFixed(1),
                    text: lbl,
                    fill: item.type === 'project' ? '#cbd5e1' : '#64748b'
                });

                y += ROW_H;
            }
            hLines.push({ key: `hl-${acc.name}`, y: (y + 1).toFixed(1) });
            y += 4;
        }

        const SVG_H  = y + MB;
        const todayX = xOf(today.getTime()).toFixed(1);

        const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        let d = new Date(new Date(chartStartMs).getFullYear(), new Date(chartStartMs).getMonth(), 1);
        if (d.getTime() < chartStartMs) d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
        while (d.getTime() <= chartEndMs) {
            const x = xOf(d.getTime());
            if (x >= LABEL_W && x <= LABEL_W + CW) {
                vGridLines.push({ key: `vg-${d.getTime()}`, x: x.toFixed(1), y1: MT, y2: SVG_H - MB });
                xLabels.push({    key: `xl-${d.getTime()}`, x: x.toFixed(1), y: SVG_H - MB + 13, label: `${MONTH_ABBR[d.getMonth()]} 1` });
            }
            d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
        }

        return {
            viewBox:  `0 0 ${SVG_W} ${SVG_H}`,
            svgW:     SVG_W,
            bgX:      LABEL_W, bgY: MT, bgW: CW, bgH: SVG_H - MT - MB,
            divX:     LABEL_W,
            todayX,   todayY1: MT, todayY2: SVG_H - MB,
            grpRects, grpTexts, hLines, vGridLines, bars, rowLabels, xLabels
        };
    }

    // ── Drag & Drop ───────────────────────────────────────────────────────────

    handleDragStart(e) {
        const el   = e.currentTarget;
        const type = el.dataset.dragType;
        this._drag = {
            type,
            id:         el.dataset.id,
            fromUserId: el.dataset.fromUserId || null
        };
        this._pushUndo();
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', type);
    }

    handleDragEnd() {
        this._drag           = null;
        this._dropTarget     = null;
        this._cardDropTarget = null;
        this._refresh();
    }

    handleLaneDragOver(e) {
        if (!this._drag) return;
        e.preventDefault();
        const uid = e.currentTarget.dataset.userId;
        if (this._dropTarget !== uid) {
            this._dropTarget = uid;
            this._refresh();
        }
    }

    handleLaneDragLeave(e) {
        const uid = e.currentTarget.dataset.userId;
        if (this._dropTarget === uid) {
            if (!e.currentTarget.contains(e.relatedTarget)) {
                this._dropTarget = null;
                this._refresh();
            }
        }
    }

    handleLaneDrop(e) {
        e.preventDefault();
        const toUserId = e.currentTarget.dataset.userId;
        const fte = (this._raw.fteRows || []).find(f => f.id === toUserId);
        if (!fte || !this._drag) { this._dropTarget = null; return; }

        if (this._drag.type === 'project' || this._drag.type === 'unassigned') {
            // Find the project by ID and update its ownerId
            const projId = this._drag.id;
            const proj   = (this._raw.projectCards || []).find(p => p.id === projId);
            if (proj && proj.ownerId !== toUserId) {
                // Update local state
                this._raw = {
                    ...this._raw,
                    projectCards: this._raw.projectCards.map(p =>
                        p.id === projId ? { ...p, ownerId: toUserId } : p
                    )
                };
                this._recordOp({ action: 'move-project', from: proj.ownerId, to: toUserId, projectId: projId });
                // Persist to Salesforce
                if (!this._whatIfMode) {
                    updateSprintOwner({ sprintId: projId, newOwnerId: toUserId }).catch(console.error);
                }
            } else {
                this._undoStack.pop();
            }

        } else if (this._drag.type === 'pipeline') {
            const opp = (this._raw.pipelineShelf || []).find(o => o.id === this._drag.id);
            if (opp && !this._assignments.some(a => a.userId === toUserId && a.opportunityId === opp.id && !a._deleted)) {
                const newA = {
                    id:             `tmp-${this._tempId++}`,
                    sprintId:       null,
                    userId:         toUserId,
                    contractorId:   null,
                    opportunityId:  opp.id,
                    hoursPerWeek:   opp.weeklyHrs || 0,
                    role:           'Contributor',
                    assignmentType: 'Pipeline',
                    isDerived:      false,
                    _local:         true,
                    _deleted:       false
                };
                this._assignments = [...this._assignments, newA];
                this._recordOp({ action: 'add-pipeline', oppId: opp.id, userId: toUserId });
                this._autoSave(newA);
            } else {
                this._undoStack.pop();
            }

        } else if (this._drag.type === 'contractor') {
            const contId = this._drag.id;
            const cont   = (this._raw.contractorPool || []).find(c => c.id === contId);
            const alreadyAssignedToFte = this._assignments.some(
                a => a.contractorId === contId && a.userId === toUserId && !a.sprintId && !a._deleted
            );
            if (cont && !alreadyAssignedToFte) {
                const newA = {
                    id:             `tmp-${this._tempId++}`,
                    sprintId:       null,
                    userId:         toUserId,
                    contractorId:   contId,
                    opportunityId:  null,
                    hoursPerWeek:   cont.availableHours || 20,
                    role:           'Contractor',
                    assignmentType: 'Active',
                    isDerived:      false,
                    _local:         true,
                    _deleted:       false
                };
                this._assignments = [...this._assignments, newA];
                this._recordOp({ action: 'add-fte-contractor', contractorId: contId, userId: toUserId });
                this._autoSave(newA);
            } else {
                this._undoStack.pop();
            }
        } else {
            this._undoStack.pop();
        }

        this._dropTarget = null;
        this._refresh();
    }

    // Drop zone: project card (for contractors)
    handleCardDragOver(e) {
        if (this._drag?.type !== 'contractor') return;
        e.preventDefault();
        const pid = e.currentTarget.dataset.projectId;
        if (this._cardDropTarget !== pid) {
            this._cardDropTarget = pid;
            this._refresh();
        }
    }

    handleCardDragLeave(e) {
        if (!e.currentTarget.contains(e.relatedTarget)) {
            if (this._cardDropTarget !== null) {
                this._cardDropTarget = null;
                this._refresh();
            }
        }
    }

    handleCardDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        this._cardDropTarget = null;
        if (this._drag?.type !== 'contractor') return;

        const sprintId = e.currentTarget.dataset.projectId;
        const contId   = this._drag.id;
        const cont     = (this._raw.contractorPool || []).find(c => c.id === contId);
        if (!cont || !sprintId) return;

        if (!this._assignments.some(a => a.contractorId === contId && a.sprintId === sprintId && !a._deleted)) {
            this._pushUndo();
            const newA = {
                id:             `tmp-${this._tempId++}`,
                sprintId,
                userId:         null,
                contractorId:   contId,
                opportunityId:  null,
                hoursPerWeek:   10,
                role:           'Contractor',
                assignmentType: 'Active',
                isDerived:      false,
                _local:         true,
                _deleted:       false
            };
            this._assignments = [...this._assignments, newA];
            this._recordOp({ action: 'add-contractor', contractorId: contId, sprintId });
            this._autoSave(newA);
            this._refresh();
        }
    }

    // ── FTE drill-down ────────────────────────────────────────────────────────

    handleFteCardClick(e) {
        e.stopPropagation();
        this._drillFteId = e.currentTarget.dataset.fteId;
        this._refresh();
    }

    handleDrillClose() {
        this._drillFteId = null;
        this._refresh();
    }

    handleDrillBackdrop(e) {
        if (e.target === e.currentTarget) this.handleDrillClose();
    }

    // ── HoD Projects modal ───────────────────────────────────────────────────

    handleHodProjectsClick(e) {
        e.stopPropagation();
        this._hodProjectsOpen = true;
        this._refresh();
    }

    handleHodProjectsClose() {
        this._hodProjectsOpen = false;
        this._refresh();
    }

    handleHodProjectsBackdrop(e) {
        if (e.target === e.currentTarget) this.handleHodProjectsClose();
    }

    // ── Inline hour editing (pipeline cards only) ─────────────────────────────

    handleHoursClick(e) {
        const id = e.currentTarget.dataset.assignmentId;
        const a  = this._assignments.find(x => x.id === id);
        if (a) {
            this._editCell = { assignmentId: id, value: a.hoursPerWeek };
            this._refresh();
        }
    }

    renderedCallback() {
        if (this._editCell) {
            const input = this.template.querySelector('.hours-input');
            if (input) { input.focus(); input.select(); }
        }
    }

    handleHoursInput(e) {
        if (this._editCell) this._editCell = { ...this._editCell, value: e.target.value };
    }

    handleHoursKeydown(e) {
        if (e.key === 'Enter') this._commitEdit(e.target.value);
        else if (e.key === 'Escape') { this._editCell = null; this._refresh(); }
    }

    handleHoursBlur(e) { this._commitEdit(e.target.value); }

    _commitEdit(raw) {
        if (!this._editCell) return;
        const val = parseFloat(raw);
        if (!isNaN(val) && val >= 0) {
            this._pushUndo();
            const id = this._editCell.assignmentId;
            this._assignments = this._assignments.map(a =>
                a.id === id ? { ...a, hoursPerWeek: Math.round(val * 10) / 10, _local: true } : a
            );
            this._recordOp({ action: 'update-hours', assignmentId: id, newValue: val });
            this._autoSave(this._assignments.find(x => x.id === id));
        }
        this._editCell = null;
        this._refresh();
    }

    // ── Remove card (pipeline / contractor RA records only) ───────────────────

    handleRemoveCard(e) {
        e.stopPropagation();
        const id = e.currentTarget.dataset.assignmentId;
        const a  = this._assignments.find(x => x.id === id);
        if (!a) return;
        this._pushUndo();
        if (a._local && a.id.startsWith('tmp-')) {
            this._assignments = this._assignments.filter(x => x.id !== id);
        } else {
            this._assignments = this._assignments.map(x =>
                x.id === id ? { ...x, _deleted: true } : x
            );
            if (!this._whatIfMode && !a.id.startsWith('tmp-')) {
                deleteAssignment({ assignmentId: a.id }).catch(console.error);
            }
        }
        this._recordOp({ action: 'remove', assignmentId: id });
        this._refresh();
    }

    // ── Undo ──────────────────────────────────────────────────────────────────

    _pushUndo() {
        const snap = {
            assignments:  JSON.parse(JSON.stringify(this._assignments)),
            projectCards: JSON.parse(JSON.stringify(this._raw?.projectCards || []))
        };
        this._undoStack = [...this._undoStack.slice(-(UNDO_LIMIT - 1)), snap];
    }

    _applyUndo() {
        if (!this._undoStack.length) return;
        const snap = this._undoStack[this._undoStack.length - 1];
        this._undoStack = this._undoStack.slice(0, -1);
        this._assignments = snap.assignments;
        if (this._raw) this._raw = { ...this._raw, projectCards: snap.projectCards };
        this._pendingOps = this._pendingOps.slice(0, -1);
        this._refresh();
    }

    handleUndoClick() { this._applyUndo(); }

    // ── What-If Mode ──────────────────────────────────────────────────────────

    handleToggleWhatIf() {
        if (this._whatIfMode) {
            this._whatIfMode = false;
            this._pendingOps = [];
            this._load();
        } else {
            this._whatIfMode = true;
            this._pendingOps = [];
        }
    }

    handleCommit() {
        // Commit pending ownership changes
        const ownerOps = this._pendingOps.filter(op => op.action === 'move-project');
        const promises = ownerOps.map(op =>
            updateSprintOwner({ sprintId: op.projectId, newOwnerId: op.to }).catch(console.error)
        );

        // Commit RA record changes (contractors/pipeline)
        const toSave = this._assignments
            .filter(a => a._local && !a._deleted)
            .map(a => ({
                action:         'upsert',
                id:             a.id.startsWith('0') ? a.id : null,
                sprintId:       a.sprintId,
                userId:         a.userId,
                contractorId:   a.contractorId,
                opportunityId:  a.opportunityId,
                hoursPerWeek:   a.hoursPerWeek,
                role:           a.role,
                assignmentType: a.assignmentType
            }));
        const toDel = this._assignments
            .filter(a => a._deleted && a.id.startsWith('0'))
            .map(a => ({ action: 'delete', id: a.id }));
        const all = [...toSave, ...toDel];
        if (all.length) {
            promises.push(batchSaveAssignments({ payloadJson: JSON.stringify(all) }));
        }

        Promise.all(promises)
            .then(() => {
                this._whatIfMode = false;
                this._pendingOps = [];
                this._load();
            })
            .catch(e => { this.error = e.body?.message || 'Failed to commit changes.'; });
    }

    handleDiscard() {
        this._whatIfMode = false;
        this._pendingOps = [];
        this._load();
    }

    // ── UI Controls ───────────────────────────────────────────────────────────

    handleTabClick(e) {
        this._rightTab = e.currentTarget.dataset.tab;
    }

    handleToggleView() {
        this._viewMode = this._viewMode === 'full' ? 'compact' : 'full';
        this._refresh();
    }

    handleRecordClick(e) {
        e.stopPropagation();
        const id = e.currentTarget.dataset.recordId;
        if (!id) return;
        this[NavigationMixin.GenerateUrl]({
            type: 'standard__recordPage',
            attributes: { recordId: id, actionName: 'view' }
        }).then(url => { window.open(url, '_blank'); });
    }

    handleClose()        { this.dispatchEvent(new CustomEvent('close')); }
    handleBackdropClick(){ this.handleClose(); }
    stopProp(e)          { e.stopPropagation(); }

    // ── Auto-save (live mode only, RA records) ────────────────────────────────

    _autoSave(a) {
        if (this._whatIfMode || !a) return;
        if (a._deleted) {
            if (!a.id.startsWith('tmp-')) deleteAssignment({ assignmentId: a.id }).catch(console.error);
            return;
        }
        upsertAssignment({
            assignmentId:   a.id.startsWith('tmp-') ? null : a.id,
            sprintId:       a.sprintId || null,
            userId:         a.userId || null,
            contractorId:   a.contractorId || null,
            opportunityId:  a.opportunityId || null,
            hoursPerWeek:   a.hoursPerWeek,
            role:           a.role || 'Contributor',
            assignmentType: a.assignmentType || 'Active',
            isDerived:      false
        }).then(newId => {
            this._assignments = this._assignments.map(x =>
                x.id === a.id ? { ...x, id: newId, _local: false } : x
            );
        }).catch(console.error);
    }

    _recordOp(op) {
        this._pendingOps = [...this._pendingOps, op];
    }

    _refresh() {
        this._assignments = [...this._assignments];
    }
}
