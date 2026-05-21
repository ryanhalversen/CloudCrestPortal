import { LightningElement, track, wire } from 'lwc';
import getPortalData from '@salesforce/apex/cc_ClientPortalController.getPortalData';
import createStory from '@salesforce/apex/cc_ClientPortalController.createStory';
import getPicklistValues from '@salesforce/apex/cc_ClientPortalController.getPicklistValues';

const STATUS_ORDER = [
    'New',
    'In Progress',
    'Blocked',
    'Waiting on Customer',
    'Ready for Review',
    'Closed'
];

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

export default class CcClientPortal extends LightningElement {
    @track stories = [];
    @track typeOptions = [];
    @track priorityOptions = [];

    hoursConsumed = 0;
    projectedEndDate = null;
    projectName = '';

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

    // ── Computed ──────────────────────────────────────────

    get hasStories() {
        return this.stories.length > 0;
    }

    get statusColumns() {
        const grouped = {};
        STATUS_ORDER.forEach(s => { grouped[s] = []; });

        this.stories.forEach(story => {
            const status = story.Status || 'New';
            if (!grouped[status]) {
                grouped[status] = [];
            }
            grouped[status].push({
                ...story,
                ownerName: story.Owner ? story.Owner.Name : null,
                createdByName: story.CreatedBy ? story.CreatedBy.Name : null,
                createdDateFormatted: this.formatDate(story.CreatedDate),
                priorityClass: 'priority-badge priority-' + (story.Priority || '').toLowerCase()
            });
        });

        return STATUS_ORDER
            .filter(s => grouped[s] && grouped[s].length > 0)
            .map(s => ({
                status: s,
                count: grouped[s].length,
                stories: grouped[s]
            }));
    }

    get hoursConsumedDisplay() {
        return this.hoursConsumed + ' hrs consumed';
    }

    get projectedEndDateDisplay() {
        if (!this.projectedEndDate) return 'No active project found';
        const d = new Date(this.projectedEndDate);
        return 'Projected completion: ' + MONTH_NAMES[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
    }

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

    // ── Handlers ─────────────────────────────────────────

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

    formatDate(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
    }
}
