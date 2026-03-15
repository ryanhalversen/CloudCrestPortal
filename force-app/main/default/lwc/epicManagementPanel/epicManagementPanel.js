// force-app/main/default/lwc/epicManagementPanel/epicManagementPanel.js
import { LightningElement, api, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';
import getEpicsForProject   from '@salesforce/apex/EpicManagementPanelController.getEpicsForProject';
import createEpic            from '@salesforce/apex/EpicManagementPanelController.createEpic';
import updateEpic            from '@salesforce/apex/EpicManagementPanelController.updateEpic';
import getMilestonesForEpic  from '@salesforce/apex/EpicManagementPanelController.getMilestonesForEpic';
import saveMilestone         from '@salesforce/apex/EpicManagementPanelController.saveMilestone';
import deleteMilestone       from '@salesforce/apex/EpicManagementPanelController.deleteMilestone';
import updateEpicDates       from '@salesforce/apex/EpicManagementPanelController.updateEpicDates';

// Module-level epic-bar drag state
let _tlDragEpicId    = null;
let _tlDragType      = null;   // 'body' | 'left' | 'right'
let _tlDragStartX    = 0;
let _tlDragOrigStart = null;
let _tlDragOrigEnd   = null;
let _tlDragging      = false;

// Module-level pan state (drag empty space to shift the visible date window)
let _panActive      = false;
let _panPointerId   = null;
let _panStartX      = 0;
let _panStartPanMs  = 0;   // _tlPanMs value at pan start
let _panMsPerPx     = 1;   // ms per pixel, computed at pan start

// Module-level milestone drag state
let _tlMsDragEpicId     = null;
let _tlMsDragFeedItemId = null;
let _tlMsDragStartX     = 0;
let _tlMsDragOrigDate   = null;
let _tlMsDragging       = false;
let _tlMsPointerId      = null;
let _tlMsTrackWidth     = 600;

export default class EpicManagementPanel extends LightningElement {

    @api projectId;
    @api selectedEpicId = null;  // controlled by parent (storyBoard)
    @api isDragging     = false; // true while a story card is being dragged
    @api readOnly       = false; // portal mode: hide all write controls

    @track _epics = [];

    // View mode
    @track viewMode          = 'chips';   // 'chips' | 'timeline'
    @track _tlPanMs          = 0;         // timeline pan offset in ms (positive = future, negative = past)
    @track _milestones       = {};        // { epicId: [MilestoneWrapper, ...] }
    @track _milestonesLoaded = false;
    @track _editingMilestone = null;      // { epicId, feedItemId|null, label, date, description, top, left }
    @track _hoverMilestone   = null;      // { label, dateLabel, description, changedBy, changedDate, top, left }

    // Modal state
    @track showModal     = false;
    @track modalName     = '';
    @track modalStart    = '';
    @track modalEnd      = '';
    @track modalEstHours = '';
    @track modalError    = '';
    @track isSaving      = false;

    _editEpicId          = null;  // null = create, string = edit
    _modalDesc           = '';
    _pendingDescUpdate   = false;
    _epicsWire;
    _tlTrackWidth        = 600;   // updated on epic bar drag start
    _hoverTimeout        = null;  // delay handle for hover card hide

    // ── Wire ──────────────────────────────────────────────────────────────
    @wire(getEpicsForProject, { projectId: '$projectId' })
    wiredEpics(result) {
        this._epicsWire = result;
        if (result.data) {
            this._epics = result.data.map(e => this._toVm(e));
            // Reload milestones when epics refresh (timeline may be open)
            if (this.viewMode === 'timeline') {
                this._milestonesLoaded = false;
                this._loadMilestones();
            }
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────
    renderedCallback() {
        if (this._pendingDescUpdate) {
            const ta = this.template.querySelector('.epic-desc-textarea');
            if (ta) {
                ta.value = this._modalDesc;
                this._pendingDescUpdate = false;
            }
        }
    }

    // ── Computed: view mode ───────────────────────────────────────────────
    get isChipsView()    { return this.viewMode === 'chips'; }
    get isTimelineView() { return this.viewMode === 'timeline'; }

    get chipsToggleClass() {
        return this.viewMode === 'chips' ? 'view-btn view-btn-active' : 'view-btn';
    }
    get timelineToggleClass() {
        return this.viewMode === 'timeline' ? 'view-btn view-btn-active' : 'view-btn';
    }

    // ── Computed: strip ───────────────────────────────────────────────────
    get stripClass() {
        return this.isDragging ? 'epic-strip dragging-mode' : 'epic-strip';
    }

    get allChipClass() {
        return !this.selectedEpicId
            ? 'epic-chip epic-chip-all epic-chip-active'
            : 'epic-chip epic-chip-all';
    }

    get decoratedEpics() {
        return this._epics.map(e => ({
            ...e,
            chipClass: this.selectedEpicId === e.epicId
                ? 'epic-chip epic-chip-active'
                : 'epic-chip'
        }));
    }

    get modalTitle() { return this._editEpicId ? 'Edit Epic' : 'New Epic'; }
    get saveLabel()  { return this._editEpicId ? 'Save Changes' : 'Create Epic'; }

    // ── Computed: timeline ────────────────────────────────────────────────
    get _tlStart() {
        const dates = this._epics
            .filter(e => e.startDate)
            .map(e => this._parseDate(e.startDate));
        let base;
        if (dates.length === 0) {
            base = new Date();
            base.setDate(1);
            base.setMonth(base.getMonth() - 2);
        } else {
            const min = new Date(Math.min(...dates.map(d => d.getTime())));
            min.setDate(min.getDate() - 14);
            // Snap to month start so labels align with day positions on the track
            base = new Date(min.getFullYear(), min.getMonth(), 1);
        }
        return new Date(base.getTime() + this._tlPanMs);
    }

    get _tlEnd() {
        const dates = this._epics
            .filter(e => e.endDate)
            .map(e => this._parseDate(e.endDate));
        let base;
        if (dates.length === 0) {
            base = new Date();
            base.setDate(1);
            base.setMonth(base.getMonth() + 3);
        } else {
            const max = new Date(Math.max(...dates.map(d => d.getTime())));
            max.setDate(max.getDate() + 14);
            // Snap to start of next month for a clean right boundary
            base = new Date(max.getFullYear(), max.getMonth() + 1, 1);
        }
        return new Date(base.getTime() + this._tlPanMs);
    }

    get timelineEpics() {
        const start = this._tlStart;
        const end   = this._tlEnd;
        return this._epics.map(ep => {
            const hasStart = !!ep.startDate;
            const hasEnd   = !!ep.endDate;
            const hasBar   = hasStart && hasEnd;

            let barStyle = '';
            if (hasBar) {
                const left  = this._datePct(ep.startDate, start, end);
                const right = this._datePct(ep.endDate, start, end);
                const width = Math.max(0.5, right - left);
                barStyle = `left:${left}%;width:${width}%;`;
            }

            const milestones = (this._milestones[ep.epicId] || []).map(m => ({
                ...m,
                dotStyle:  `left:${this._datePct(m.milestoneDate, start, end)}%;`,
                dateLabel: this._formatShortDate(m.milestoneDate)
            }));

            const isSelected = ep.epicId === this.selectedEpicId;
            const barClass   = isSelected ? 'tl-bar tl-bar-active' : 'tl-bar';
            return { ...ep, hasBar, barStyle, barClass, milestones, isSelected };
        });
    }

    get timelineDividers() {
        return this.timelineDateHeaders.map(h => ({ key: h.dividerKey, style: h.dividerStyle }));
    }

    get timelineDateHeaders() {
        const start = this._tlStart;
        const end   = this._tlEnd;
        const total = end - start;
        if (total <= 0) return [];

        const headers = [];
        const cur = new Date(start.getFullYear(), start.getMonth(), 1);
        while (cur < end) {
            const monthStart = new Date(cur);
            const monthEnd   = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
            const leftPct    = Math.max(0,   (monthStart - start) / total * 100);
            const rightPct   = Math.min(100, (monthEnd   - start) / total * 100);
            const label = cur.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            headers.push({
                label,
                style:        `left:${leftPct}%;width:${rightPct - leftPct}%;`,
                dividerStyle: `left:${leftPct}%;`,
                dividerKey:   'div-' + label
            });
            cur.setMonth(cur.getMonth() + 1);
        }
        return headers;
    }

    get todayLineStyle() {
        const today = new Date();
        const start = this._tlStart;
        const end   = this._tlEnd;
        if (today < start || today > end) return 'display:none;';
        // The date axis starts after the 160px label column, so offset accordingly
        const pct = this._datePct(today, start, end);
        return `left:calc(160px + (100% - 160px) * ${pct} / 100);`;
    }

    get milestoneEditorStyle() {
        if (!this._editingMilestone) return 'display:none;';
        const { top, left } = this._editingMilestone;
        const editorWidth   = 220;
        const adjustedLeft  = Math.min(left, (window.innerWidth || 1200) - editorWidth - 10);
        return `top:${top}px;left:${adjustedLeft}px;`;
    }

    get hoverCardStyle() {
        if (!this._hoverMilestone) return 'display:none;';
        const { top, left } = this._hoverMilestone;
        const cardWidth    = 220;
        const vw           = window.innerWidth || 1200;
        const adjustedLeft = Math.max(10, Math.min(left - cardWidth / 2, vw - cardWidth - 10));
        // transform: translateY(-100%) positions card above the diamond
        return `top:${top}px;left:${adjustedLeft}px;transform:translateY(calc(-100% - 10px));`;
    }

    // ── API methods (called by parent storyBoard) ─────────────────────────
    @api getEpicIdAtPoint(x, y) {
        for (const chip of this.template.querySelectorAll('.epic-chip[data-id]')) {
            const r = chip.getBoundingClientRect();
            if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
                return chip.dataset.id;
            }
        }
        return null;
    }

    @api setDragHighlight(x, y) {
        this.template.querySelectorAll('.epic-chip[data-id]').forEach(chip => {
            if (x != null && y != null) {
                const r    = chip.getBoundingClientRect();
                const over = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
                chip.classList.toggle('chip-drag-over', over);
            } else {
                chip.classList.remove('chip-drag-over');
            }
        });
    }

    // ── Toggle handler ────────────────────────────────────────────────────
    handleToggleView(e) {
        const newMode = e.currentTarget.dataset.view;
        if (newMode === this.viewMode) return;
        this.viewMode = newMode;
        if (newMode === 'timeline' && !this._milestonesLoaded) {
            this._loadMilestones();
        }
    }

    // ── Chip handlers ─────────────────────────────────────────────────────
    handleAllEpics() {
        this.dispatchEvent(new CustomEvent('epicselect', { detail: { epicId: null, epicName: null } }));
    }

    handleEpicClick(evt) {
        const id   = evt.currentTarget.dataset.id;
        const newId = id === this.selectedEpicId ? null : id;
        const name  = newId ? (this._epics.find(e => e.epicId === newId)?.name || null) : null;
        this.dispatchEvent(new CustomEvent('epicselect', { detail: { epicId: newId, epicName: name } }));
    }

    handleRecordClick(evt) {
        evt.stopPropagation();
    }

    handleEditClick(evt) {
        evt.stopPropagation();
        const id = evt.currentTarget.dataset.id;
        const e  = this._epics.find(x => x.epicId === id);
        if (!e) return;
        this._editEpicId        = id;
        this.modalName          = e.name          || '';
        this.modalStart         = e.startDate     ? e.startDate.split('T')[0]  : '';
        this.modalEnd           = e.endDate       ? e.endDate.split('T')[0]    : '';
        this.modalEstHours      = e.estimatedHours != null ? String(e.estimatedHours) : '';
        this._modalDesc         = e.description   || '';
        this._pendingDescUpdate = true;
        this.modalError         = '';
        this.isSaving           = false;
        this.showModal          = true;
    }

    handleNewClick() {
        this._editEpicId        = null;
        this.modalName          = '';
        this.modalStart         = '';
        this.modalEnd           = '';
        this.modalEstHours      = '';
        this._modalDesc         = '';
        this._pendingDescUpdate = false;
        this.modalError         = '';
        this.isSaving           = false;
        this.showModal          = true;
    }

    // ── Modal handlers ────────────────────────────────────────────────────
    handleModalClose()           { this.showModal = false; }
    handleBackdropClick()        { if (!this.isSaving) this.showModal = false; }
    handleModalContainerClick(e) { e.stopPropagation(); }

    handleNameChange(e)     { this.modalName     = e.target.value; }
    handleStartChange(e)    { this.modalStart    = e.target.value; }
    handleEndChange(e)      { this.modalEnd      = e.target.value; }
    handleEstHoursChange(e) { this.modalEstHours = e.target.value; }
    handleDescChange(e)     { this._modalDesc    = e.target.value; }

    async handleModalSave() {
        if (!this.modalName.trim()) {
            this.modalError = 'Name is required.';
            return;
        }
        this.isSaving   = true;
        this.modalError = '';

        const startDate      = this.modalStart    || null;
        const endDate        = this.modalEnd      || null;
        const estimatedHours = this.modalEstHours ? parseFloat(this.modalEstHours) : null;
        const description    = this._modalDesc.trim() || null;
        const name           = this.modalName.trim();

        try {
            if (this._editEpicId) {
                await updateEpic({ epicId: this._editEpicId, name, startDate, endDate, estimatedHours, description });
                this._toast('Epic updated', `"${name}" saved`, 'success');
            } else {
                await createEpic({ projectId: this.projectId, name, startDate, endDate, estimatedHours, description });
                this._toast('Epic created', `"${name}" added`, 'success');
            }
            this.showModal = false;
            refreshApex(this._epicsWire);
        } catch (err) {
            this.modalError = err?.body?.message || 'Failed to save — please try again.';
        } finally {
            this.isSaving = false;
        }
    }

    // ── Timeline row label click (select epic → filter story board) ──────
    handleRowLabelClick(e) {
        const epicId = e.currentTarget.dataset.id;
        const newId  = epicId === this.selectedEpicId ? null : epicId;
        const name   = newId ? (this._epics.find(ep => ep.epicId === newId)?.name || null) : null;
        this.dispatchEvent(new CustomEvent('epicselect', { detail: { epicId: newId, epicName: name } }));
    }

    // ── Timeline bar click (select epic → filter story board) ────────────
    handleBarClick(e) {
        if (e.target.dataset.type) return; // click on a resize handle — ignore
        const epicId = e.currentTarget.dataset.id;
        const newId  = epicId === this.selectedEpicId ? null : epicId;
        const name   = newId ? (this._epics.find(ep => ep.epicId === newId)?.name || null) : null;
        this.dispatchEvent(new CustomEvent('epicselect', { detail: { epicId: newId, epicName: name } }));
    }

    // ── Timeline drag handlers (handles only — body is click-to-edit) ─────
    handleBarPointerDown(e) {
        const type = e.target.dataset.type; // 'left' | 'right', undefined for body
        if (!type) return;                  // body click — let handleBarClick handle it
        e.stopPropagation();
        const epicId = e.currentTarget.dataset.id;
        const ep     = this._epics.find(x => x.epicId === epicId);
        if (!ep || !ep.startDate || !ep.endDate) return;

        _tlDragEpicId    = epicId;
        _tlDragType      = type;
        _tlDragStartX    = e.clientX;
        _tlDragOrigStart = this._parseDate(ep.startDate);
        _tlDragOrigEnd   = this._parseDate(ep.endDate);
        _tlDragging      = true;

        // Measure the track width for px-to-date conversion
        const track = e.currentTarget.closest('.tl-track');
        this._tlTrackWidth = track ? track.getBoundingClientRect().width : 600;

        e.currentTarget.setPointerCapture(e.pointerId);
    }

    handleBarPointerMove(e) {
        if (!_tlDragging) return;

        const dx      = e.clientX - _tlDragStartX;
        const total   = this._tlEnd - this._tlStart;
        const msPerPx = total / this._tlTrackWidth;
        const deltaMs = dx * msPerPx;
        const DAY     = 86400000;

        let newStart = _tlDragOrigStart;
        let newEnd   = _tlDragOrigEnd;

        if (_tlDragType === 'left') {
            newStart = new Date(_tlDragOrigStart.getTime() + deltaMs);
            if (newStart >= newEnd) newStart = new Date(newEnd.getTime() - DAY);
        } else {
            newEnd = new Date(_tlDragOrigEnd.getTime() + deltaMs);
            if (newEnd <= newStart) newEnd = new Date(newStart.getTime() + DAY);
        }

        const isoStart = this._toIso(newStart);
        const isoEnd   = this._toIso(newEnd);

        this._epics = this._epics.map(ep => {
            if (ep.epicId !== _tlDragEpicId) return ep;
            return this._toVm({ ...ep, startDate: isoStart, endDate: isoEnd });
        });
    }

    async handleBarPointerUp(e) {
        if (!_tlDragging) return;
        _tlDragging = false;
        e.currentTarget.releasePointerCapture(e.pointerId);

        const ep = this._epics.find(x => x.epicId === _tlDragEpicId);
        if (!ep) { _tlDragEpicId = null; return; }

        try {
            await updateEpicDates({
                epicId:    _tlDragEpicId,
                startDate: ep.startDate ? ep.startDate.split('T')[0] : null,
                endDate:   ep.endDate   ? ep.endDate.split('T')[0]   : null
            });
            refreshApex(this._epicsWire);
        } catch (err) {
            this._toast('Error', 'Failed to save dates', 'error');
            refreshApex(this._epicsWire);
        }

        _tlDragEpicId = null;
        _tlDragType   = null;
    }

    // ── Milestone handlers ────────────────────────────────────────────────
    handleAddMilestone(e) {
        e.stopPropagation();
        const epicId = e.currentTarget.dataset.id;
        const rect   = e.currentTarget.getBoundingClientRect();
        this._editingMilestone = {
            epicId,
            feedItemId:  null,
            label:       '',
            date:        '',
            description: '',
            top:         rect.bottom + 6,
            left:        rect.left
        };
    }

    // ── Milestone drag handlers ───────────────────────────────────────────
    handleMilestonePointerDown(e) {
        e.stopPropagation();
        const epicId     = e.currentTarget.dataset.epicId;
        const feedItemId = e.currentTarget.dataset.id;
        const ms = (this._milestones[epicId] || []).find(m => m.feedItemId === feedItemId);
        if (!ms) return;

        _tlMsDragEpicId     = epicId;
        _tlMsDragFeedItemId = feedItemId;
        _tlMsDragStartX     = e.clientX;
        _tlMsDragOrigDate   = this._parseDate(ms.milestoneDate);
        _tlMsDragging       = false;
        _tlMsPointerId      = e.pointerId;

        const track = e.currentTarget.closest('.tl-track');
        _tlMsTrackWidth = track ? track.getBoundingClientRect().width : 600;

        // Hide hover card when drag starts
        clearTimeout(this._hoverTimeout);
        this._hoverMilestone = null;
    }

    handleMilestonePointerMove(e) {
        if (e.pointerId !== _tlMsPointerId || !_tlMsDragFeedItemId) return;

        const dx = e.clientX - _tlMsDragStartX;
        if (!_tlMsDragging && Math.abs(dx) < 5) return;  // movement threshold

        if (!_tlMsDragging) {
            _tlMsDragging = true;
            e.currentTarget.setPointerCapture(e.pointerId);
        }

        const total    = this._tlEnd - this._tlStart;
        const msPerPx  = total / _tlMsTrackWidth;
        const newDate  = new Date(_tlMsDragOrigDate.getTime() + dx * msPerPx);
        const newIso   = this._toIso(newDate);
        const newLabel = this._formatShortDate(newIso);

        this._milestones = {
            ...this._milestones,
            [_tlMsDragEpicId]: (this._milestones[_tlMsDragEpicId] || []).map(m =>
                m.feedItemId === _tlMsDragFeedItemId
                    ? { ...m, milestoneDate: newIso, dateLabel: newLabel }
                    : m
            )
        };
    }

    async handleMilestonePointerUp(e) {
        if (e.pointerId !== _tlMsPointerId || !_tlMsDragFeedItemId) return;

        const wasDragging   = _tlMsDragging;
        const epicId        = _tlMsDragEpicId;
        const feedItemId    = _tlMsDragFeedItemId;
        const el            = e.currentTarget;

        _tlMsDragging       = false;
        _tlMsDragEpicId     = null;
        _tlMsDragFeedItemId = null;
        _tlMsPointerId      = null;

        if (wasDragging) {
            el.releasePointerCapture(e.pointerId);
            const ms = (this._milestones[epicId] || []).find(m => m.feedItemId === feedItemId);
            if (!ms) return;
            try {
                await saveMilestone({
                    epicId,
                    feedItemId,
                    label:         ms.label,
                    milestoneDate: String(ms.milestoneDate).split('T')[0],
                    description:   ms.description || null
                });
            } catch (err) {
                this._toast('Error', 'Failed to save milestone date', 'error');
                await this._refreshMilestones(epicId);
            }
        } else {
            // Short press = open editor
            const ms = (this._milestones[epicId] || []).find(m => m.feedItemId === feedItemId);
            if (!ms) return;
            const rect = el.getBoundingClientRect();
            this._editingMilestone = {
                epicId,
                feedItemId,
                label:       ms.label,
                date:        ms.milestoneDate ? String(ms.milestoneDate).split('T')[0] : '',
                description: ms.description || '',
                top:         rect.bottom + 6,
                left:        rect.left
            };
        }
    }

    // ── Milestone hover card ──────────────────────────────────────────────
    handleMilestoneMouseEnter(e) {
        if (_tlMsDragFeedItemId) return;  // suppress during drag
        clearTimeout(this._hoverTimeout);
        const epicId     = e.currentTarget.dataset.epicId;
        const feedItemId = e.currentTarget.dataset.id;
        const ms = (this._milestones[epicId] || []).find(m => m.feedItemId === feedItemId);
        if (!ms) return;
        const rect    = e.currentTarget.getBoundingClientRect();
        const today   = new Date(); today.setHours(0, 0, 0, 0);
        const msDate  = this._parseDate(ms.milestoneDate); msDate.setHours(0, 0, 0, 0);
        const diff    = Math.round((msDate - today) / 86400000);
        const daysLabel = diff === 0 ? 'Today'
            : diff > 0 ? `${diff} day${diff === 1 ? '' : 's'} remaining`
            : `${Math.abs(diff)} day${Math.abs(diff) === 1 ? '' : 's'} ago`;
        const daysClass = 'tl-ms-hover-days ' + (diff < 0 ? 'tl-ms-hover-days-overdue' : diff === 0 ? 'tl-ms-hover-days-today' : 'tl-ms-hover-days-ok');
        this._hoverMilestone = {
            label:       ms.label,
            dateLabel:   this._formatShortDate(ms.milestoneDate),
            daysLabel,
            daysClass,
            description: ms.description  || '',
            changedBy:   ms.changedBy    || '',
            changedDate: ms.changedDate  || '',
            top:         rect.top,
            left:        rect.left + rect.width / 2
        };
    }

    handleMilestoneMouseLeave() {
        this._hoverTimeout = setTimeout(() => { this._hoverMilestone = null; }, 150);
    }

    handleHoverCardMouseEnter() {
        clearTimeout(this._hoverTimeout);
    }

    handleHoverCardMouseLeave() {
        this._hoverMilestone = null;
    }

    handleMilestoneLabelChange(e) {
        this._editingMilestone = { ...this._editingMilestone, label: e.target.value };
    }

    handleMilestoneDateChange(e) {
        this._editingMilestone = { ...this._editingMilestone, date: e.target.value };
    }

    handleMilestoneDescChange(e) {
        this._editingMilestone = { ...this._editingMilestone, description: e.target.value };
    }

    async handleMilestoneSave() {
        const { epicId, feedItemId, label, date, description } = this._editingMilestone;
        if (!label.trim() || !date) {
            this._toast('Validation', 'Label and date are required', 'warning');
            return;
        }
        try {
            await saveMilestone({
                epicId,
                feedItemId:    feedItemId || null,
                label:         label.trim(),
                milestoneDate: date,
                description:   description || null
            });
            this._editingMilestone = null;
            await this._refreshMilestones(epicId);
        } catch (err) {
            this._toast('Error', err?.body?.message || 'Failed to save milestone', 'error');
        }
    }

    async handleMilestoneDelete() {
        const { epicId, feedItemId } = this._editingMilestone;
        if (!feedItemId) return;
        try {
            await deleteMilestone({ feedItemId });
            this._editingMilestone = null;
            await this._refreshMilestones(epicId);
        } catch (err) {
            this._toast('Error', err?.body?.message || 'Failed to delete milestone', 'error');
        }
    }

    handleMilestoneCancel() {
        this._editingMilestone = null;
    }

    // ── Pan (drag empty space to shift the visible date window) ──────────
    handleContainerPointerDown(e) {
        // Block pan if the click landed on any interactive element
        if (e.target.closest('.tl-bar, .tl-milestone, .tl-add-ms, .tl-label-col, button, a, input')) return;
        // Compute px→ms ratio: track area width is container minus the 160px label column
        const trackWidth = Math.max(e.currentTarget.getBoundingClientRect().width - 160, 1);
        const totalMs    = this._tlEnd.getTime() - this._tlStart.getTime();
        _panActive     = true;
        _panPointerId  = e.pointerId;
        _panStartX     = e.clientX;
        _panStartPanMs = this._tlPanMs;
        _panMsPerPx    = totalMs / trackWidth;
        e.currentTarget.setPointerCapture(e.pointerId);
    }

    handleContainerPointerMove(e) {
        if (!_panActive || e.pointerId !== _panPointerId) return;
        e.currentTarget.style.cursor = 'grabbing';
        const dx = e.clientX - _panStartX;
        // Drag right → show earlier dates (subtract ms); drag left → show later dates
        this._tlPanMs = Math.round(_panStartPanMs - dx * _panMsPerPx);
    }

    handleContainerPointerUp(e) {
        if (!_panActive || e.pointerId !== _panPointerId) return;
        _panActive    = false;
        _panPointerId = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
        e.currentTarget.style.cursor = '';
    }

    // ── Helpers ───────────────────────────────────────────────────────────
    async _loadMilestones() {
        const loaded = {};
        await Promise.all(this._epics.map(async ep => {
            try {
                loaded[ep.epicId] = await getMilestonesForEpic({ epicId: ep.epicId });
            } catch (_) {
                loaded[ep.epicId] = [];
            }
        }));
        this._milestones       = loaded;
        this._milestonesLoaded = true;
    }

    async _refreshMilestones(epicId) {
        try {
            const ms = await getMilestonesForEpic({ epicId });
            this._milestones = { ...this._milestones, [epicId]: ms };
        } catch (_) {
            // silent refresh failure
        }
    }

    _datePct(dateVal, tlStart, tlEnd) {
        const d     = dateVal instanceof Date ? dateVal : this._parseDate(dateVal);
        const total = tlEnd - tlStart;
        if (total <= 0) return 0;
        return Math.max(0, Math.min(100, (d - tlStart) / total * 100));
    }

    _formatShortDate(iso) {
        if (!iso) return '';
        const [y, m, d] = String(iso).split('T')[0].split('-').map(Number);
        return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    _parseDate(iso) {
        if (!iso) return new Date();
        const s = String(iso).split('T')[0];
        const [y, m, d] = s.split('-').map(Number);
        return new Date(y, m - 1, d);
    }

    _toIso(d) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    _toVm(e) {
        const start  = e.startDate;
        const end    = e.endDate;
        const total  = e.totalStories     || 0;
        const done   = e.completedStories || 0;
        const pct    = total > 0 ? Math.round((done / total) * 100) : 0;
        const logged = e.loggedHours ? Number(Number(e.loggedHours).toFixed(2)) : 0;

        return {
            ...e,
            dateRange    : this._formatDateRange(start, end),
            progressLabel: total > 0 ? `${done}/${total} done` : 'no stories',
            progressStyle: `width:${pct}%`,
            estLabel     : e.estimatedHours ? `${e.estimatedHours}h est.` : '',
            loggedLabel  : logged ? `${logged}h logged` : '',
            recordUrl    : `/lightning/r/Sprint_Items__c/${e.epicId}/view`
        };
    }

    _formatDateRange(start, end) {
        if (!start && !end) return '';
        const fmt = iso => {
            const [y, m, d] = iso.split('T')[0].split('-').map(Number);
            return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        };
        if (start && end) return `${fmt(start)} – ${fmt(end)}`;
        if (start)        return `From ${fmt(start)}`;
        return `Until ${fmt(end)}`;
    }

    _toast(t, m, v) {
        this.dispatchEvent(new ShowToastEvent({ title: t, message: m, variant: v }));
    }
}
