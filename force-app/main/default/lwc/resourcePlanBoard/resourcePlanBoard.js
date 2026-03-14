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

    // ── Inline edit (pipeline cards only) ────────────────────────────────────
    _editCell       = null;   // { assignmentId, value }

    // ── UI toggles ────────────────────────────────────────────────────────────
    _rightTab       = 'contractor';
    _viewMode       = 'full';
    _tempId         = 1;
    _showChart      = true;
    _selectedWeek   = 0;

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
            this._assignments = (data.assignments || []).map(a => ({ ...a, _local: false, _deleted: false }));
            this.isLoading = false;
        } catch (e) {
            this.error    = e.body?.message || 'Failed to load board data.';
            this.isLoading = false;
        }
    }

    // ── Computed: Lanes ───────────────────────────────────────────────────────

    get lanes() {
        if (!this._raw) return [];
        return (this._raw.fteRows || []).map(fte => this._buildLane(fte));
    }

    _buildLane(fte) {
        // Project cards: Sprint__c records owned by this FTE
        const ownedProjects = (this._raw.projectCards || []).filter(p => p.ownerId === fte.id);
        // Projects where this FTE is the support lead
        const supportProjects = (this._raw.projectCards || []).filter(
            p => p.supportLeadId === fte.id
        );

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

        // Pipeline cards from RA records
        const pipeCards = this._assignments.filter(
            a => a.userId === fte.id && !a._deleted && a.assignmentType === 'Pipeline'
        ).map(a => {
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

        const allCards = [...cards, ...supportCards, ...pipeCards];
        const alloc =
            ownedProjects.filter(p => !p.isBlock).reduce((s, p) => {
                const splitPct = (p.supportLeadId && p.supportSplit) ? p.supportSplit / 100 : 0;
                return s + (p.weeklyPace || 0) * (1 - splitPct);
            }, 0) +
            supportProjects.filter(p => !p.isBlock).reduce((s, p) => {
                return s + (p.weeklyPace || 0) * ((p.supportSplit || 0) / 100);
            }, 0);
        const cap      = fte.weeklyTarget != null ? fte.weeklyTarget : 35;
        const pct      = cap > 0 ? (alloc / cap) * 100 : 0;
        const barPct   = Math.min(pct, 100);
        const barColor = pct > 100 ? '#ef4444' : pct >= 80 ? '#f59e0b' : '#22c55e';

        return {
            ...fte,
            cards:       allCards,
            hasCards:    allCards.length > 0,
            alloc:       Math.round(alloc * 10) / 10,
            cap,
            pct:         Math.round(pct),
            isOver:      alloc > cap,
            barStyle:    `width:${barPct}%;background:${barColor};`,
            utilLabel:   `${Math.round(alloc * 10) / 10}h / ${cap}h`,
            availLabel:  alloc <= cap
                ? `${Math.round((cap - alloc) * 10) / 10}h available`
                : `${Math.round((alloc - cap) * 10) / 10}h over`,
            laneCls:     `plan-lane${this._dropTarget === fte.id ? ' plan-lane--over' : ''}`,
            isCompact:   this._viewMode === 'compact'
        };
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
            { label: 'Demand Forecast',   value: `${this._round(forecastDemand)}h`,                      trend: forecastDemand > totalCap ? 'down' : 'neutral', sub: `on-time + pipeline${wkStr}` },
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

    // ── Forecast Chart ────────────────────────────────────────────────────────

    get showChart()        { return this._showChart; }
    get chartToggleLabel() { return this._showChart ? 'Hide Forecast' : 'Forecast'; }

    handleToggleChart() { this._showChart = !this._showChart; }

    handlePrevWeek() {
        if (this._selectedWeek > 0) this._selectedWeek = this._selectedWeek - 1;
    }
    handleNextWeek() {
        if (this._selectedWeek < 23) this._selectedWeek = this._selectedWeek + 1;
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
            .reduce((s, o) => s + (o.weeklyHrs || 0) * ((o.probability || 0) / 100), 0);
        return baseDemand + pipeAdded;
    }

    get chartData() {
        if (!this._raw || !this._showChart) return null;

        const WEEKS = 24;
        const SVG_W = 900, SVG_H = 220;
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

        // Y-axis grid lines
        const gridStep = yMax <= 80 ? 10 : yMax <= 160 ? 20 : 30;
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

        // X-axis labels (every 3 weeks)
        const xLabels = [];
        for (let i = 0; i < WEEKS; i += 3) {
            xLabels.push({ key: `xl${i}`, x: xOf(i).toFixed(1), y: MT + CH + 13, label: weeks[i].dateLabel });
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
        if (!this._raw || !this._showChart) return null;
        const weekStart = this._getWeekStart(this._selectedWeek);
        const fteIds = new Set((this._raw.fteRows || []).map(f => f.id));

        const projects = (this._raw.projectCards || [])
            .filter(p => fteIds.has(p.ownerId) || fteIds.has(p.supportLeadId))
            .map(p => ({
                id:         p.id,
                name:       p.name,
                client:     p.client,
                weeklyHrs:  p.isBlock ? null : this._round(p.weeklyPace || 0),
                hrsLabel:   p.isBlock ? 'Block' : `${this._round(p.weeklyPace || 0)}h/wk`,
                isBlock:    !!p.isBlock,
                endDate:    p.endDate || '—',
                colorStyle: `background:${p.color};`
            }));

        const pipeline = (this._raw.pipelineShelf || [])
            .filter(o => o.expectedStart && new Date(o.expectedStart) <= weekStart)
            .map(o => ({
                id:            o.id,
                name:          o.name,
                client:        o.client,
                weeklyHrs:     this._round((o.weeklyHrs || 0) * ((o.probability || 0) / 100)),
                probability:   o.probability || 0,
                expectedStart: o.expectedStart || '—'
            }));

        return { projects, pipeline, hasPipeline: pipeline.length > 0 };
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
        this._drag       = null;
        this._dropTarget = null;
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

        } else {
            this._undoStack.pop();
        }

        this._dropTarget = null;
        this._refresh();
    }

    // Drop zone: project card (for contractors)
    handleCardDragOver(e) {
        if (this._drag?.type === 'contractor') e.preventDefault();
    }

    handleCardDrop(e) {
        e.preventDefault();
        e.stopPropagation();
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
        if (a._local && !a.id.startsWith('0')) {
            this._assignments = this._assignments.filter(x => x.id !== id);
        } else {
            this._assignments = this._assignments.map(x =>
                x.id === id ? { ...x, _deleted: true } : x
            );
            if (!this._whatIfMode && a.id.startsWith('0')) {
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
            if (a.id.startsWith('0')) deleteAssignment({ assignmentId: a.id }).catch(console.error);
            return;
        }
        upsertAssignment({
            assignmentId:   a.id.startsWith('0') ? a.id : null,
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
