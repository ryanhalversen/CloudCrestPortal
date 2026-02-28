// force-app/main/default/lwc/epicManagementPanel/epicManagementPanel.js
import { LightningElement, api, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';
import getEpicsForProject from '@salesforce/apex/EpicManagementPanelController.getEpicsForProject';
import createEpic         from '@salesforce/apex/EpicManagementPanelController.createEpic';
import updateEpic         from '@salesforce/apex/EpicManagementPanelController.updateEpic';

export default class EpicManagementPanel extends LightningElement {

    @api projectId;
    @api selectedEpicId = null;  // controlled by parent (storyBoard)
    @api isDragging     = false; // true while a story card is being dragged

    @track _epics = [];

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

    // ── Wire ──────────────────────────────────────────────────────────────
    @wire(getEpicsForProject, { projectId: '$projectId' })
    wiredEpics(result) {
        this._epicsWire = result;
        if (result.data) {
            this._epics = result.data.map(e => this._toVm(e));
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

    // ── Computed ──────────────────────────────────────────────────────────
    get stripClass() {
        return this.isDragging ? 'epic-strip dragging-mode' : 'epic-strip';
    }

    get allChipClass() {
        return !this.selectedEpicId
            ? 'epic-chip epic-chip-all epic-chip-active'
            : 'epic-chip epic-chip-all';
    }

    // Recompute chip active state on every render (selectedEpicId is @api)
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

    // Called by parent to find which epic chip covers a screen coordinate
    @api getEpicIdAtPoint(x, y) {
        for (const chip of this.template.querySelectorAll('.epic-chip[data-id]')) {
            const r = chip.getBoundingClientRect();
            if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
                return chip.dataset.id;
            }
        }
        return null;
    }

    // ── Chip handlers ─────────────────────────────────────────────────────
    handleAllEpics() {
        this.dispatchEvent(new CustomEvent('epicselect', { detail: { epicId: null } }));
    }

    handleEpicClick(evt) {
        const id = evt.currentTarget.dataset.id;
        const newId = id === this.selectedEpicId ? null : id;
        this.dispatchEvent(new CustomEvent('epicselect', { detail: { epicId: newId } }));
    }

    handleEditClick(evt) {
        evt.stopPropagation();
        const id = evt.currentTarget.dataset.id;
        const e  = this._epics.find(x => x.epicId === id);
        if (!e) return;
        this._editEpicId       = id;
        this.modalName         = e.name         || '';
        this.modalStart        = e.startDate    ? e.startDate.split('T')[0]  : '';
        this.modalEnd          = e.endDate      ? e.endDate.split('T')[0]    : '';
        this.modalEstHours     = e.estimatedHours != null ? String(e.estimatedHours) : '';
        this._modalDesc        = e.description  || '';
        this._pendingDescUpdate = true;
        this.modalError        = '';
        this.isSaving          = false;
        this.showModal         = true;
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
    handleModalClose()          { this.showModal = false; }
    handleBackdropClick()       { if (!this.isSaving) this.showModal = false; }
    handleModalContainerClick(e){ e.stopPropagation(); }

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

        const startDate     = this.modalStart    || null;
        const endDate       = this.modalEnd      || null;
        const estimatedHours = this.modalEstHours ? parseFloat(this.modalEstHours) : null;
        const description   = this._modalDesc.trim() || null;
        const name          = this.modalName.trim();

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

    // ── Helpers ───────────────────────────────────────────────────────────
    _toVm(e) {
        const start = e.startDate;
        const end   = e.endDate;
        const total = e.totalStories     || 0;
        const done  = e.completedStories || 0;
        const pct   = total > 0 ? Math.round((done / total) * 100) : 0;

        return {
            ...e,
            dateRange    : this._formatDateRange(start, end),
            progressLabel: total > 0 ? `${done}/${total} done` : 'no stories',
            progressStyle: `width:${pct}%`,
            estLabel     : e.estimatedHours ? `${e.estimatedHours}h est.` : ''
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
