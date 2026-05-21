import { LightningElement, track, wire } from 'lwc';
import getPortalData from '@salesforce/apex/cc_ClientPortalController.getPortalData';
import createStory from '@salesforce/apex/cc_ClientPortalController.createStory';
import getPicklistValues from '@salesforce/apex/cc_ClientPortalController.getPicklistValues';

const STATUS_ORDER = [
    'New',
    'Backlog',
    'Scheduled',
    'Work in Progress (WIP)',
    'Waiting for User',
    'On Hold',
    'Blocked',
    'In Review',
    'In UAT',
    'Completed',
    'Cancelled'
];

const STATUS_COLORS = {
    'New':                     '#caf0f8',
    'Backlog':                 '#0096c7',
    'Scheduled':               '#ade8f4',
    'Work in Progress (WIP)':  '#90e0ef',
    'Waiting for User':        '#48cae4',
    'On Hold':                 '#00b4d8',
    'Blocked':                 '#004a70',
    'In Review':               '#0077b6',
    'In UAT':                  '#005f8e',
    'Completed':               '#012a3d',
    'Cancelled':               '#023e5a'
};

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

export default class CcClientPortal extends LightningElement {
    @track stories = [];
    @track epics = [];
    @track typeOptions = [];
    @track priorityOptions = [];

    hoursConsumed = 0;
    projectedEndDate = null;
    projectName = '';
    selectedEpicId = null;

    isLoading = true;
    isSubmitting = false;
    showHelp = false;

    formTitle = '';
    formDescription = '';
    formType = '';
    formPriority = '';

    formError = '';
    titleError = '';
    descriptionError = '';
    typeError = '';
    priorityError = '';

    @wire(getPicklistValues)
    wiredPicklists({ data, error }) {
        if (data) {
            this.typeOptions = data.Type || [];
            this.priorityOptions = data.Priority || [];
        }
        if (error) {
            console.error('Picklist load error', error);
        }
    }

    @wire(getPortalData)
    wiredPortalData({ data, error }) {
        if (data) {
            this.stories = data.stories || [];
            this.epics = data.epics || [];
            this.hoursConsumed = data.hoursConsumed || 0;
            this.projectedEndDate = data.projectedEndDate || null;
            this.projectName = data.projectName || '';
            this.isLoading = false;
        }
        if (error) {
            console.error('Portal data load error', error);
            this.isLoading = false;
        }
    }

    // ── Computed — Board ─────────────────────────────────

    get filteredStories() {
        if (!this.selectedEpicId) return this.stories;
        return this.stories.filter(s => s.Epic__c === this.selectedEpicId);
    }

    get hasStories() {
        return this.stories.length > 0;
    }

    get hasFilteredStories() {
        return this.filteredStories.length > 0;
    }

    get storyCountLabel() {
        const count = this.filteredStories.length;
        return count + ' ' + (count === 1 ? 'story' : 'stories') + ' total';
    }

    get allEpicClass() {
        return 'epic-pill' + (!this.selectedEpicId ? ' epic-pill-active' : '');
    }

    get statusColumns() {
        const grouped = {};
        STATUS_ORDER.forEach(s => { grouped[s] = []; });

        this.filteredStories.forEach(story => {
            const status = story.Status || 'New';
            if (!grouped[status]) {
                grouped[status] = [];
            }
            grouped[status].push(this.enrichStory(story));
        });

        return STATUS_ORDER
            .filter(s => grouped[s] && grouped[s].length > 0)
            .map(s => ({
                status: s,
                count: grouped[s].length,
                headerStyle: 'border-top: 3px solid ' + (STATUS_COLORS[s] || '#e5e7eb'),
                stories: grouped[s]
            }));
    }

    enrichStory(story) {
        const hoursLogged = story.Actual_Hours_to_Complete__c || 0;
        const estHours = story.Hours_Estimate_to_Complete__c;
        const hasEst = estHours != null && estHours !== undefined;
        return {
            ...story,
            CaseNumber: story.CaseNumber,
            epicName: story.Epic__r ? story.Epic__r.Name : null,
            ownerName: story.Owner ? story.Owner.Name : null,
            priorityLabel: story.Priority || 'NEEDS ASSIGNMENT',
            priorityClass: 'priority-badge priority-' + (story.Priority || 'none').toLowerCase().replace(/ /g, '-'),
            hoursLoggedDisplay: hoursLogged.toFixed(1) + 'h',
            estHoursDisplay: 'est ' + (hasEst ? estHours.toFixed(0) : '0') + 'h',
            estHoursClass: 'card-est-hours' + (!hasEst ? ' card-est-missing' : ''),
            timeAgo: this.getTimeAgo(story.CreatedDate)
        };
    }

    // ── Computed — Epics ─────────────────────────────────

    get epics() {
        return this._epics.map(e => ({
            ...e,
            pillClass: 'epic-pill' + (this.selectedEpicId === e.epicId ? ' epic-pill-active' : '')
        }));
    }
    set epics(val) {
        this._epics = val || [];
    }
    _epics = [];

    // ── Computed — Metrics ───────────────────────────────

    get hoursConsumedDisplay() {
        return this.hoursConsumed + ' hrs consumed';
    }

    get projectedEndDateDisplay() {
        if (!this.projectedEndDate) return 'No active project found';
        const d = new Date(this.projectedEndDate);
        return 'Projected completion: ' + MONTH_NAMES[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
    }

    // ── Computed — Form ──────────────────────────────────

    get titleInputClass() {
        return 'form-input' + (this.titleError ? ' input-error' : '');
    }
    get descriptionInputClass() {
        return 'form-textarea' + (this.descriptionError ? ' input-error' : '');
    }
    get typeInputClass() {
        return 'form-select' + (this.typeError ? ' input-error' : '');
    }
    get priorityInputClass() {
        return 'form-select' + (this.priorityError ? ' input-error' : '');
    }

    // ── Handlers — Epic Filter ───────────────────────────

    handleEpicAll() {
        this.selectedEpicId = null;
    }

    handleEpicSelect(e) {
        const epicId = e.currentTarget.dataset.id;
        this.selectedEpicId = epicId === this.selectedEpicId ? null : epicId;
    }

    // ── Handlers — Form ──────────────────────────────────

    toggleHelp() {
        this.showHelp = !this.showHelp;
    }

    handleTitleInput(e) {
        this.formTitle = e.target.value;
        this.titleError = '';
    }

    handleDescriptionInput(e) {
        this.formDescription = e.target.value;
        this.descriptionError = '';
    }

    handleTypeChange(e) {
        this.formType = e.target.value;
        this.typeError = '';
    }

    handlePriorityChange(e) {
        this.formPriority = e.target.value;
        this.priorityError = '';
    }

    async handleSubmit() {
        this.formError = '';
        if (!this.validateForm()) return;

        this.isSubmitting = true;
        try {
            const newStory = await createStory({
                subject: this.formTitle.trim(),
                description: this.formDescription.trim(),
                storyType: this.formType,
                priority: this.formPriority
            });

            this.stories = [newStory, ...this.stories];
            this.resetForm();
        } catch (err) {
            this.formError = err?.body?.message || err?.message || 'An unexpected error occurred. Please try again.';
        } finally {
            this.isSubmitting = false;
        }
    }

    // ── Helpers ──────────────────────────────────────────

    validateForm() {
        let valid = true;

        if (!this.formTitle || !this.formTitle.trim()) {
            this.titleError = 'Title is required';
            valid = false;
        }
        if (!this.formDescription || !this.formDescription.trim()) {
            this.descriptionError = 'Description is required';
            valid = false;
        }
        if (!this.formType) {
            this.typeError = 'Story Type is required';
            valid = false;
        }
        if (!this.formPriority) {
            this.priorityError = 'Priority is required';
            valid = false;
        }
        return valid;
    }

    resetForm() {
        this.formTitle = '';
        this.formDescription = '';
        this.formType = '';
        this.formPriority = '';
        this.titleError = '';
        this.descriptionError = '';
        this.typeError = '';
        this.priorityError = '';
        this.formError = '';
    }

    getTimeAgo(dateStr) {
        if (!dateStr) return '';
        const now = new Date();
        const then = new Date(dateStr);
        const diffMs = now - then;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);
        const diffWeeks = Math.floor(diffDays / 7);
        const diffMonths = Math.floor(diffDays / 30);

        if (diffMins < 1) return 'just now';
        if (diffMins < 60) return diffMins + 'm ago';
        if (diffHours < 24) return diffHours + 'h ago';
        if (diffDays < 7) return diffDays + 'd ago';
        if (diffWeeks < 5) return diffWeeks + 'w ago';
        return diffMonths + 'mo ago';
    }
}
