import { LightningElement, wire, track }  from 'lwc';
import { NavigationMixin }               from 'lightning/navigation';
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

export default class Cc_LeadToCash extends NavigationMixin(LightningElement) {

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

    // ── Card Ordering (per row) ───────────────────────────────
    @track _cardOrders = {}; // { category: [id, id, ...] }

    handleMoveLeft(event) {
        event.stopPropagation();
        const sopId = event.currentTarget.dataset.id;
        const cat   = event.currentTarget.dataset.category;
        // Catch-all cards use a special sentinel category
        if (cat === '__catchall__') {
            const ids = [...this._catchAllIds];
            const idx = ids.indexOf(sopId);
            if (idx <= 0) return;
            [ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]];
            this._catchAllIds = ids;
            return;
        }
        const group = this.stageGroups.find(g => g.category === cat);
        if (!group) return;
        const ids = group.stages.map(s => s.id);
        const idx = ids.indexOf(sopId);
        if (idx <= 0) return;
        [ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]];
        this._cardOrders = { ...this._cardOrders, [cat]: ids };
    }

    handleMoveRight(event) {
        event.stopPropagation();
        const sopId = event.currentTarget.dataset.id;
        const cat   = event.currentTarget.dataset.category;
        if (cat === '__catchall__') {
            const ids = [...this._catchAllIds];
            const idx = ids.indexOf(sopId);
            if (idx >= ids.length - 1) return;
            [ids[idx], ids[idx + 1]] = [ids[idx + 1], ids[idx]];
            this._catchAllIds = ids;
            return;
        }
        const group = this.stageGroups.find(g => g.category === cat);
        if (!group) return;
        const ids = group.stages.map(s => s.id);
        const idx = ids.indexOf(sopId);
        if (idx >= ids.length - 1) return;
        [ids[idx], ids[idx + 1]] = [ids[idx + 1], ids[idx]];
        this._cardOrders = { ...this._cardOrders, [cat]: ids };
    }

    // ── Drag and Drop ─────────────────────────────────────────
    @track _catchAllIds        = [];
    @track _isDragOverCatchAll = false;
    @track _sopInitiatives     = {}; // { sopId: [initiativeId, ...] }
    _dragType                  = null; // 'sop' | 'initiative'
    _dragInitiativeId          = null;

    // SOP card drag (to catch-all)
    handleDragStart(event) {
        this._dragType = 'sop';
        event.dataTransfer.setData('text/plain', event.currentTarget.dataset.id);
        event.dataTransfer.effectAllowed = 'move';
        event.currentTarget.classList.add('stage-dragging');
    }

    handleDragEnd(event) {
        event.currentTarget.classList.remove('stage-dragging');
        this._dragType           = null;
        this._isDragOverCatchAll = false;
    }

    handleCatchAllDragOver(event) {
        if (this._dragType !== 'sop') return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        if (!this._isDragOverCatchAll) this._isDragOverCatchAll = true;
    }

    handleCatchAllDragLeave(event) {
        if (!event.currentTarget.contains(event.relatedTarget)) {
            this._isDragOverCatchAll = false;
        }
    }

    handleCatchAllDrop(event) {
        event.preventDefault();
        const sopId = event.dataTransfer.getData('text/plain');
        if (sopId && !this._catchAllIds.includes(sopId)) {
            this._catchAllIds = [...this._catchAllIds, sopId];
        }
        this._isDragOverCatchAll = false;
    }

    // Initiative drag (to SOP card)
    handleInitiativeDragStart(event) {
        event.stopPropagation();
        this._dragType        = 'initiative';
        this._dragInitiativeId = event.currentTarget.dataset.id;
        event.dataTransfer.effectAllowed = 'link';
        event.currentTarget.classList.add('initiative-dragging');
    }

    handleInitiativeDragEnd(event) {
        event.currentTarget.classList.remove('initiative-dragging');
        this._dragType         = null;
        this._dragInitiativeId = null;
    }

    handleSopDragOver(event) {
        if (this._dragType !== 'initiative') return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'link';
        event.currentTarget.classList.add('sop-drop-target');
    }

    handleSopDragLeave(event) {
        event.currentTarget.classList.remove('sop-drop-target');
    }

    handleSopDrop(event) {
        event.preventDefault();
        event.currentTarget.classList.remove('sop-drop-target');
        if (this._dragType !== 'initiative' || !this._dragInitiativeId) return;
        const sopId   = event.currentTarget.dataset.id;
        const existing = this._sopInitiatives[sopId] || [];
        if (!existing.includes(this._dragInitiativeId)) {
            this._sopInitiatives = { ...this._sopInitiatives, [sopId]: [...existing, this._dragInitiativeId] };
        }
        this._dragType         = null;
        this._dragInitiativeId = null;
    }

    get catchAllZoneClass() {
        return 'catchall-zone' + (this._isDragOverCatchAll ? ' catchall-zone-active' : '');
    }

    get hasCatchAll() {
        return this._catchAllIds.length > 0;
    }

    get catchAllStages() {
        const n = this._catchAllIds.length;
        return this._catchAllIds
            .map((id, i) => {
                const sop = this._sops.find(s => s.id === id);
                if (!sop) return null;
                const cat = sop.category || 'Other';
                return {
                    ...this._processSop(sop, cat),
                    num:         String(i + 1),
                    isFirstCard: i === 0,
                    isLastCard:  i === n - 1,
                    ...this._linkedInitiativesFor(id)
                };
            })
            .filter(Boolean);
    }

    _linkedInitiativesFor(sopId) {
        const ids = this._sopInitiatives[sopId] || [];
        const linked = ids
            .map(initId => (this._initiatives || []).find(i => i.id === initId))
            .filter(Boolean)
            .map(init => ({
                id:        init.id,
                name:      init.name,
                badgeClass: 'init-link-badge ' + this._statusClass(init.status)
            }));
        return { linkedInitiatives: linked, hasLinkedInitiatives: linked.length > 0 };
    }

    // ── Board Grouping ────────────────────────────────────────
    get stageGroups() {
        const grouped = {};
        for (const sop of this._sops) {
            const cat = sop.category || 'Other';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(this._processSop(sop, cat));
        }

        const filtered = COLUMN_ORDER.filter(cat => grouped[cat] && grouped[cat].length > 0);
        return filtered.map((cat, idx) => {
            // Apply saved card order; append any new cards to the end
            // Exclude any cards moved to the catch-all zone
            const available = grouped[cat].filter(s => !this._catchAllIds.includes(s.id));
            const saved = this._cardOrders[cat];
            let ordered = available;
            if (saved && saved.length > 0) {
                ordered = [
                    ...saved.map(id => available.find(s => s.id === id)).filter(Boolean),
                    ...available.filter(s => !saved.includes(s.id))
                ];
            }
            // Number cards 1…n left-to-right; attach linked initiatives
            const stages = ordered.map((s, i) => ({
                ...s,
                num:                  String(i + 1),
                isFirstCard:          i === 0,
                isLastCard:           i === ordered.length - 1,
                ...this._linkedInitiativesFor(s.id)
            }));
            return {
                id:                  `grp-${cat}`,
                label:               COLUMN_CONFIG[cat].label,
                labelClass:          COLUMN_CONFIG[cat].css,
                funnelStyle:         COLUMN_CONFIG[cat].funnelStyle,
                bandClass:           COLUMN_CONFIG[cat].bandClass,
                connectorArrowClass: COLUMN_CONFIG[cat].connectorArrowClass,
                hasConnector:        idx < filtered.length - 1,
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
    @track _initiatives      = [];
    @track _initiativeFilter = 'All';

    @wire(getInitiativesWithActionItems)
    wiredInitiatives({ error, data }) {
        if (data) {
            this._initiatives = data;
        } else if (error) {
            this._initiatives = [];
            console.error('CC_LeadToCash: error loading initiatives', error);
        }
    }

    get initiativeFilters() {
        return ['All', 'In Progress', 'On Hold', 'Completed'].map(v => ({
            label:    v,
            value:    v,
            btnClass: 'filter-btn' + (this._initiativeFilter === v ? ' filter-btn-active' : '')
        }));
    }

    handleFilterClick(event) {
        this._initiativeFilter = event.currentTarget.dataset.filter;
    }

    handleInitiativeClick(event) {
        event.stopPropagation();
        this[NavigationMixin.Navigate]({
            type:       'standard__recordPage',
            attributes: { recordId: event.currentTarget.dataset.id, actionName: 'view' }
        });
    }

    get hasInitiatives() {
        return this.processedInitiatives.length > 0;
    }

    get initiativeCount() {
        const filtered = this.processedInitiatives.length;
        const total    = this._initiatives ? this._initiatives.length : 0;
        return this._initiativeFilter === 'All' ? total : `${filtered}/${total}`;
    }

    get processedInitiatives() {
        const f   = this._initiativeFilter;
        let list  = this._initiatives || [];
        if (f !== 'All') {
            list = list.filter(init => {
                const s = (init.status || '').toLowerCase();
                if (f === 'In Progress') return s.includes('progress') || s.includes('active');
                if (f === 'On Hold')     return s.includes('hold')     || s.includes('block');
                if (f === 'Completed')   return s.includes('complet');
                return true;
            });
        }
        return list.map((init, idx) => {
            const meta = [init.category, init.quarter].filter(Boolean).join(' · ');
            return {
                ...init,
                meta,
                statusBadgeClass: 'init-status-badge ' + this._statusClass(init.status),
                hasActionItems:   init.actionItems && init.actionItems.length > 0,
                actionItems: (init.actionItems || []).map((ai, i) => ({
                    ...ai,
                    rowId:     `${idx}-ai-${i}`,
                    dotClass:  'ai-dot ' + this._statusClass(ai.status),
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