// force-app/main/default/lwc/resourcePlanBoard/resourcePlanBoard.js
import { LightningElement } from 'lwc';
import { NavigationMixin }  from 'lightning/navigation';
import getBoardData         from '@salesforce/apex/ResourcePlanningController.getBoardData';
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
    _assignments    = [];   // flat array of assignment objects (source of truth)
    _whatIfMode     = false;
    _pendingOps     = [];   // for what-if change log display

    // ── Undo ──────────────────────────────────────────────────────────────────
    _undoStack      = [];

    // ── Drag state ────────────────────────────────────────────────────────────
    _drag           = null;   // { type, id, fromUserId } — set on dragstart
    _dropTarget     = null;   // userId currently highlighted as drop zone

    // ── Inline edit ───────────────────────────────────────────────────────────
    _editCell       = null;   // { assignmentId, value }

    // ── UI toggles ────────────────────────────────────────────────────────────
    _rightTab       = 'contractor';  // 'contractor' | 'pipeline'
    _viewMode       = 'full';        // 'full' | 'compact'
    _tempId         = 1;

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
            this._buildAssignments(data);
            this.isLoading = false;
        } catch (e) {
            this.error    = e.body?.message || 'Failed to load board data.';
            this.isLoading = false;
        }
    }

    _buildAssignments(data) {
        // Start from server records
        const serverRows = (data.assignments || []).map(a => ({ ...a, _local: false, _deleted: false }));
        const serverKeys = new Set(serverRows.map(a => `${a.userId || a.contractorId}||${a.sprintId}`));

        // Derive from Sprint__c assignee fields where no RA record exists
        const seeds = [];
        for (const p of (data.projectCards || [])) {
            for (const uid of (p.seedUserIds || [])) {
                if (!uid || serverKeys.has(`${uid}||${p.id}`)) continue;
                const fte = (data.fteRows || []).find(f => f.id === uid);
                if (!fte) continue;
                seeds.push({
                    id:             `seed-${this._tempId++}`,
                    sprintId:       p.id,
                    userId:         uid,
                    contractorId:   null,
                    opportunityId:  null,
                    hoursPerWeek:   p.seedHoursEach || 0,
                    role:           'Contributor',
                    assignmentType: 'Active',
                    isDerived:      true,
                    _local:         true,   // needs to be saved
                    _deleted:       false
                });
            }
        }

        this._assignments = [...serverRows, ...seeds];
    }

    // ── Computed: Lanes ───────────────────────────────────────────────────────

    get lanes() {
        if (!this._raw) return [];
        return (this._raw.fteRows || []).map(fte => this._buildLane(fte));
    }

    _buildLane(fte) {
        const active = this._assignments.filter(
            a => a.userId === fte.id && !a._deleted && a.assignmentType !== 'Pipeline'
        );

        const cards = active.map(a => {
            const proj = (this._raw.projectCards || []).find(p => p.id === a.sprintId);
            if (!proj) return null;
            const chips = this._contractorChipsForProject(a.sprintId);
            const isEditing = this._editCell?.assignmentId === a.id;
            const daysLeft  = this._daysLeft(proj.endDate);
            const urg = daysLeft !== null && daysLeft <= 14 ? 'critical'
                      : daysLeft !== null && daysLeft <= 56 ? 'warning' : '';
            return {
                assignmentId: a.id,
                projectId:    proj.id,
                name:         proj.name,
                client:       proj.client,
                hoursPerWeek: a.hoursPerWeek || 0,
                endDate:      proj.endDate || '—',
                urgency:      urg,
                urgencyLabel: URGENCY_LABEL[urg] || '',
                urgencyCls:   urg ? `urg-badge urg-badge--${urg}` : '',
                showUrgency:  !!urg,
                color:        proj.color,
                colorStyle:   `border-left-color:${proj.color};`,
                recordId:     proj.id,
                isLocal:      !!a._local,
                cardCls:      `plan-card plan-card--${this._viewMode}${urg ? ` plan-card--${urg}` : ''}${a._local ? ' plan-card--new' : ''}`,
                chips,
                hasChips:     chips.length > 0,
                isEditing,
                editValue:    isEditing ? this._editCell.value : a.hoursPerWeek
            };
        }).filter(Boolean);

        // Pipeline cards in this lane
        const pipeCards = this._assignments.filter(
            a => a.userId === fte.id && !a._deleted && a.assignmentType === 'Pipeline'
        ).map(a => {
            const opp = (this._raw.pipelineShelf || []).find(o => o.id === a.opportunityId);
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
                isEditing:    this._editCell?.assignmentId === a.id,
                editValue:    this._editCell?.assignmentId === a.id ? this._editCell.value : a.hoursPerWeek,
                cardCls:      'plan-card plan-card--pipeline'
            };
        });

        const allCards = [...cards, ...pipeCards];
        const alloc    = active.reduce((s, a) => s + (a.hoursPerWeek || 0), 0);
        const cap      = fte.weeklyTarget || 35;
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
        const totalCap  = (this._raw.fteRows || []).reduce((s, f) => s + (f.weeklyTarget || 35), 0);
        const fteDemand = this._assignments
            .filter(a => a.userId && !a._deleted && a.assignmentType !== 'Pipeline')
            .reduce((s, a) => s + (a.hoursPerWeek || 0), 0);
        const contrHrs = this._assignments
            .filter(a => a.contractorId && !a._deleted)
            .reduce((s, a) => s + (a.hoursPerWeek || 0), 0);
        const netAvail  = totalCap - fteDemand;
        const pipWt     = (this._raw.pipelineShelf || []).reduce(
            (s, o) => s + (o.weeklyHrs || 0) * ((o.probability || 0) / 100), 0
        );
        const trend = v => v >= 0 ? 'up' : 'down';
        return [
            { label: 'FTE Capacity',      value: `${totalCap}h`,                              trend: 'neutral', sub: `${(this._raw.fteRows||[]).length} team members` },
            { label: 'FTE Demand',        value: `${this._round(fteDemand)}h`,                 trend: fteDemand > totalCap ? 'down' : 'up', sub: 'active assignments' },
            { label: 'Net Available',     value: `${netAvail >= 0 ? '+' : ''}${this._round(netAvail)}h`, trend: trend(netAvail), sub: netAvail >= 0 ? 'surplus' : 'overallocated' },
            { label: 'Contractor hrs/wk', value: `${this._round(contrHrs)}h`,                trend: 'neutral', sub: 'contractor support' },
            { label: 'Pipeline (wtd)',    value: `${this._round(pipWt)}h`,                   trend: 'neutral', sub: 'probability-adjusted' }
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
    get canUndo()          { return this._undoStack.length > 0; }
    get hasChanges()       { return this._whatIfMode && this._pendingOps.length > 0; }
    get whatIfLabel()      { return this._whatIfMode ? 'Exit What-If' : 'What-If Mode'; }
    get boardCls()         { return `plan-board${this._whatIfMode ? ' plan-board--whatif' : ''}`; }
    get viewModeLabel()    { return this._viewMode === 'full' ? 'Compact View' : 'Full View'; }
    get showContractors()  { return this._rightTab === 'contractor'; }
    get showPipeline()     { return this._rightTab === 'pipeline'; }
    get contractorTabCls() { return `panel-tab${this._rightTab === 'contractor' ? ' panel-tab--active' : ''}`; }
    get pipelineTabCls()   { return `panel-tab${this._rightTab === 'pipeline' ? ' panel-tab--active' : ''}`; }
    get pendingCount()     { return this._pendingOps.length; }

    // Unassigned projects (no active FTE assignment)
    get unassignedProjects() {
        if (!this._raw) return [];
        return (this._raw.projectCards || []).filter(proj => {
            return !this._assignments.some(a =>
                a.sprintId === proj.id && a.userId && !a._deleted && a.assignmentType !== 'Pipeline'
            );
        }).map(p => ({
            ...p,
            cardStyle: `border-left-color:${p.color};`
        }));
    }
    get hasUnassigned() { return this.unassignedProjects.length > 0; }

    // ── Drag & Drop ───────────────────────────────────────────────────────────

    handleDragStart(e) {
        const el   = e.currentTarget;
        const type = el.dataset.dragType;
        this._drag = {
            type,
            id:         el.dataset.id,
            fromUserId: el.dataset.fromUserId || null
        };
        // Push undo snapshot BEFORE the change
        this._pushUndo();
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', type); // LWC allows this minimal use
    }

    handleDragEnd() {
        this._drag       = null;
        this._dropTarget = null;
        this._refresh();
    }

    // Drop zone: FTE swim lane
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

        if (this._drag.type === 'project') {
            // Moving a project card to a different FTE lane
            const a = this._assignments.find(x => x.id === this._drag.id);
            if (a && a.userId !== toUserId) {
                this._assignments = this._assignments.map(x =>
                    x.id === a.id ? { ...x, userId: toUserId, _local: true } : x
                );
                this._recordOp({ action: 'move-project', from: a.userId, to: toUserId, assignmentId: a.id });
                this._autoSave(this._assignments.find(x => x.id === a.id));
            } else {
                this._undoStack.pop(); // no change, discard snapshot
            }
        } else if (this._drag.type === 'pipeline') {
            // Drag opp from pipeline shelf into FTE lane
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
        } else if (this._drag.type === 'unassigned') {
            // Drag from unassigned pool into a lane
            const proj = (this._raw.projectCards || []).find(p => p.id === this._drag.id);
            if (proj) {
                const newA = {
                    id:             `tmp-${this._tempId++}`,
                    sprintId:       proj.id,
                    userId:         toUserId,
                    contractorId:   null,
                    opportunityId:  null,
                    hoursPerWeek:   proj.seedHoursEach || proj.weeklyPace || 0,
                    role:           'Contributor',
                    assignmentType: 'Active',
                    isDerived:      false,
                    _local:         true,
                    _deleted:       false
                };
                this._assignments = [...this._assignments, newA];
                this._recordOp({ action: 'assign-project', projectId: proj.id, userId: toUserId });
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

    // ── Inline hour editing ───────────────────────────────────────────────────

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
            const updated = this._assignments.map(a =>
                a.id === id ? { ...a, hoursPerWeek: Math.round(val * 10) / 10, _local: true } : a
            );
            this._assignments = updated;
            this._recordOp({ action: 'update-hours', assignmentId: id, newValue: val });
            this._autoSave(this._assignments.find(x => x.id === id));
        }
        this._editCell = null;
        this._refresh();
    }

    // ── Remove card ───────────────────────────────────────────────────────────

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
        const snap = JSON.parse(JSON.stringify(this._assignments));
        this._undoStack = [...this._undoStack.slice(-(UNDO_LIMIT - 1)), snap];
    }

    _applyUndo() {
        if (!this._undoStack.length) return;
        const snap = this._undoStack[this._undoStack.length - 1];
        this._undoStack = this._undoStack.slice(0, -1);
        this._assignments = snap;
        this._pendingOps = this._pendingOps.slice(0, -1);
        this._refresh();
    }

    handleUndoClick() { this._applyUndo(); }

    // ── What-If Mode ──────────────────────────────────────────────────────────

    handleToggleWhatIf() {
        if (this._whatIfMode) {
            // Exiting — discard and reload
            this._whatIfMode = false;
            this._pendingOps = [];
            this._load();
        } else {
            this._whatIfMode = true;
            this._pendingOps = [];
        }
    }

    handleCommit() {
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
        if (!all.length) { this._whatIfMode = false; return; }

        batchSaveAssignments({ payloadJson: JSON.stringify(all) })
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
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId: id, actionName: 'view' }
        });
    }

    handleClose()        { this.dispatchEvent(new CustomEvent('close')); }
    handleBackdropClick(){ this.handleClose(); }
    stopProp(e)          { e.stopPropagation(); }

    // ── Auto-save (live mode only) ────────────────────────────────────────────

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
        // Force LWC reactivity
        this._assignments = [...this._assignments];
    }
}
