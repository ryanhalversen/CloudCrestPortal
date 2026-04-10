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
    'Marketing & Partnerships': { label: 'Partnerships & Marketing', css: 'group-label group-label-marketing' },
    'Sales':                    { label: 'Sales',                    css: 'group-label group-label-sales' },
    'Delivery':                 { label: 'Delivery',                 css: 'group-label group-label-delivery' },
    'Finance':                  { label: 'Finance',                  css: 'group-label group-label-finance' },
    'Other':                    { label: 'Other',                    css: 'group-label group-label-other' }
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

    // ── Navigation ────────────────────────────────────────────
    handleSopClick(event) {
        const sopId = event.currentTarget.dataset.id;
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId: sopId, actionName: 'view' }
        });
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

    // ── Board Grouping ────────────────────────────────────────
    get stageGroups() {
        const grouped = {};
        for (const sop of this._sops) {
            const cat = sop.category || 'Other';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(this._processSop(sop, cat));
        }

        return COLUMN_ORDER
            .filter(cat => grouped[cat] && grouped[cat].length > 0)
            .map(cat => ({
                id:         `grp-${cat}`,
                label:      COLUMN_CONFIG[cat].label,
                labelClass: COLUMN_CONFIG[cat].css,
                stages:     grouped[cat]
            }));
    }

    _processSop(sop, cat) {
        const parsed = this._parseName(sop.name);
        return {
            id:       sop.id,
            num:      parsed.num,
            title:    parsed.title,
            body:     sop.body || '',
            category: cat
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
