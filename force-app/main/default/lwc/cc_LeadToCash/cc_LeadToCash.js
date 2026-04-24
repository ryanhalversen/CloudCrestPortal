import { LightningElement, wire, track }  from 'lwc';
import { refreshApex }                   from '@salesforce/apex';
import getSopStages                      from '@salesforce/apex/CC_LeadToCashController.getSopStages';
import getInitiativesWithActionItems     from '@salesforce/apex/CC_LeadToCashController.getInitiativesWithActionItems';
import NAME_FIELD     from '@salesforce/schema/SOP__c.Name';
import CATEGORY_FIELD from '@salesforce/schema/SOP__c.Category__c';
import STATUS_FIELD   from '@salesforce/schema/SOP__c.Status__c';
import BODY_FIELD     from '@salesforce/schema/SOP__c.Body__c';
import SUMMARY_FIELD  from '@salesforce/schema/SOP__c.Summary__c';

// Column order matches Category__c picklist values
const COLUMN_ORDER = ['Marketing & Partnerships', 'Sales', 'Delivery', 'Finance', 'Other'];

const COLUMN_CONFIG = {
    'Marketing & Partnerships': { label: 'Partnerships & Marketing', css: 'group-label group-label-marketing', funnelStyle: 'width:100%', bandClass: 'funnel-band funnel-band-marketing', connectorArrowClass: 'funnel-arrow funnel-arrow-marketing' },
    'Sales':                    { label: 'Sales',                    css: 'group-label group-label-sales',    funnelStyle: 'width:82%',  bandClass: 'funnel-band funnel-band-sales',     connectorArrowClass: 'funnel-arrow funnel-arrow-sales' },
    'Delivery':                 { label: 'Delivery',                 css: 'group-label group-label-delivery', funnelStyle: 'width:65%',  bandClass: 'funnel-band funnel-band-delivery',  connectorArrowClass: 'funnel-arrow funnel-arrow-delivery' },
    'Finance':                  { label: 'Finance',                  css: 'group-label group-label-finance',  funnelStyle: 'width:48%',  bandClass: 'funnel-band funnel-band-finance',   connectorArrowClass: 'funnel-arrow funnel-arrow-finance' },
    'Other':                    { label: 'Other',                    css: 'group-label group-label-other',    funnelStyle: 'width:34%',  bandClass: 'funnel-band funnel-band-other',     connectorArrowClass: 'funnel-arrow funnel-arrow-other' }
};

export default class Cc_LeadToCash extends LightningElement {

    // ── SOP Board ─────────────────────────────────────────────
    @track _sops = [];
    _wiredSopsResult;

    sopFields = [NAME_FIELD, CATEGORY_FIELD, STATUS_FIELD, BODY_FIELD, SUMMARY_FIELD];

    @wire(getSopStages)
    wiredSops(result) {
        this._wiredSopsResult = result;
        const { error, data } = result;
        if (data) {
            this._sops = data;
        } else if (error) {
            this._sops = [];
            console.error('CC_LeadToCash: error loading SOPs', error);
        }
    }

    // ── View Modal ────────────────────────────────────────────
    @track showViewModal = false;
    @track viewStage     = null;

    handleCardClick(event) {
        const sopId = event.currentTarget.dataset.id;
        const allStages = this.stageGroups.flatMap(g => g.stages);
        this.viewStage     = allStages.find(s => s.id === sopId) || null;
        this.showViewModal = true;
    }

    handleViewModalClose() {
        this.showViewModal = false;
        this.viewStage     = null;
    }

    // ── Edit Modal ────────────────────────────────────────────
    @track showEditModal = false;
    @track editSopId     = null;

    handleEditClick(event) {
        event.stopPropagation();
        this.editSopId     = event.currentTarget.dataset.id;
        this.showEditModal = true;
    }

    handleModalClose() {
        this.showEditModal = false;
        this.editSopId     = null;
    }

    handleOverlayClick() {
        this.handleModalClose();
    }

    handleModalBodyClick(event) {
        event.stopPropagation();
    }

    handleSaveSuccess() {
        this.handleModalClose();
        refreshApex(this._wiredSopsResult);
    }

    // ── Add SOP Modal ─────────────────────────────────────────
    @track showAddModal   = false;
    @track addSopCategory = '';
    @track addSopLabel    = '';

    handleAddClick(event) {
        event.stopPropagation();
        this.addSopCategory = event.currentTarget.dataset.category;
        this.addSopLabel    = event.currentTarget.dataset.label;
        this.showAddModal   = true;
    }

    handleAddModalClose() {
        this.showAddModal   = false;
        this.addSopCategory = '';
        this.addSopLabel    = '';
    }

    handleAddSuccess() {
        this.handleAddModalClose();
        refreshApex(this._wiredSopsResult);
    }

    // ── Row Ordering ──────────────────────────────────────────
    @track _categoryOrder = null; // null = use COLUMN_ORDER default

    handleMoveUp(event) {
        event.stopPropagation();
        const cat    = event.currentTarget.dataset.category;
        const order  = this.stageGroups.map(g => g.category);
        const idx    = order.indexOf(cat);
        if (idx <= 0) return;
        [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]];
        this._categoryOrder = order;
    }

    handleMoveDown(event) {
        event.stopPropagation();
        const cat    = event.currentTarget.dataset.category;
        const order  = this.stageGroups.map(g => g.category);
        const idx    = order.indexOf(cat);
        if (idx >= order.length - 1) return;
        [order[idx], order[idx + 1]] = [order[idx + 1], order[idx]];
        this._categoryOrder = order;
    }

    // ── Board Grouping ────────────────────────────────────────
    get stageGroups() {
        const grouped = {};
        for (const sop of this._sops) {
            const cat = sop.category || 'Other';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(this._processSop(sop, cat));
        }

        // Merge user order with default, appending any newly-seen categories
        const baseOrder = this._categoryOrder
            ? [...this._categoryOrder, ...COLUMN_ORDER.filter(c => !this._categoryOrder.includes(c))]
            : COLUMN_ORDER;

        const filtered = baseOrder.filter(cat => grouped[cat] && grouped[cat].length > 0);
        return filtered.map((cat, idx) => {
            // Number cards 1…n left-to-right within each row
            const stages = grouped[cat].map((s, i) => ({ ...s, num: String(i + 1) }));
            return {
                id:                  `grp-${cat}`,
                label:               COLUMN_CONFIG[cat].label,
                labelClass:          COLUMN_CONFIG[cat].css,
                funnelStyle:         COLUMN_CONFIG[cat].funnelStyle,
                bandClass:           COLUMN_CONFIG[cat].bandClass,
                connectorArrowClass: COLUMN_CONFIG[cat].connectorArrowClass,
                hasConnector:        idx < filtered.length - 1,
                isFirst:             idx === 0,
                isLast:              idx === filtered.length - 1,
                category:            cat,
                stages
            };
        });
    }

    _processSop(sop, cat) {
        const parsed = this._parseName(sop.name);
        return {
            id:         sop.id,
            num:        parsed.num,
            title:      parsed.title,
            status:     sop.status   || '',
            category:   cat,
            body:       sop.body    || '',
            summary:    sop.summary || '',
            hasBody:    !!(sop.body    && sop.body.trim()),
            hasSummary: !!(sop.summary && sop.summary.trim())
        };
    }

    _parseName(name) {
        const match = (name || '').match(/^(\d+)\.\s*(.+)$/);
        return match
            ? { num: match[1], title: match[2] }
            : { num: '',       title: name || '' };
    }

    // ── Initiatives Panel ─────────────────────────────────────
    @track _initiatives = [];

    @wire(getInitiativesWithActionItems)
    wiredInitiatives({ error, data }) {
        if (data) {
            this._initiatives = data;
        } else if (error) {
            this._initiatives = [];
            console.error('CC_LeadToCash: error loading initiatives', error);
        }
    }

    get hasInitiatives() {
        return this._initiatives && this._initiatives.length > 0;
    }

    get initiativeCount() {
        return this._initiatives ? this._initiatives.length : 0;
    }

    get processedInitiatives() {
        return (this._initiatives || []).map((init, idx) => {
            const meta = [init.category, init.quarter].filter(Boolean).join(' · ');
            return {
                ...init,
                meta,
                statusBadgeClass: 'init-status-badge ' + this._statusClass(init.status),
                hasActionItems: init.actionItems && init.actionItems.length > 0,
                actionItems: (init.actionItems || []).map((ai, i) => ({
                    ...ai,
                    rowId:    `${idx}-ai-${i}`,
                    dotClass: 'ai-dot ' + this._statusClass(ai.status),
                    nameClass: 'ai-name' + (this._isComplete(ai.status) ? ' ai-name-done' : '')
                }))
            };
        });
    }

    _statusClass(status) {
        const s = (status || '').toLowerCase();
        if (this._isComplete(status))                        return 'st-complete';
        if (s.includes('progress') || s.includes('active')) return 'st-active';
        if (s.includes('block')    || s.includes('hold'))   return 'st-blocked';
        return 'st-open';
    }

    _isComplete(status) {
        return (status || '').toLowerCase().includes('complet');
    }
}