// force-app/main/default/lwc/submitAStory/submitAStory.js
import { LightningElement, track, wire } from 'lwc';
import { publish, MessageContext } from 'lightning/messageService';
import STORY_SUBMITTED_CHANNEL from '@salesforce/messageChannel/StorySubmitted__c';
import getPicklistValues from '@salesforce/apex/SubmitAStoryController.getPicklistValues';
import createStory from '@salesforce/apex/SubmitAStoryController.createStory';

const PRIORITY_OPTIONS = [
    { label: 'Low',      value: 'Low'      },
    { label: 'Medium',   value: 'Medium'   },
    { label: 'High',     value: 'High'     },
    { label: 'Critical', value: 'Critical' }
];

const ACCEPTED_FORMATS = ['.pdf', '.png', '.jpg', '.jpeg', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt'];

const EMPTY_FORM = () => ({
    subject:     '',
    description: '',
    priority:    '',
    storyType:   '',
    department:  ''
});

export default class SubmitAStory extends LightningElement {
    @wire(MessageContext) messageContext;

    // ── picklists ──────────────────────────────────────────────────────────
    priorityOptions  = PRIORITY_OPTIONS;
    storyTypeOptions = [];
    loadingPicklists = true;
    acceptedFormats  = ACCEPTED_FORMATS;

    // ── form state ─────────────────────────────────────────────────────────
    @track formData      = EMPTY_FORM();
    @track errors        = {};
    @track uploadedFiles = [];
    @track submittedStory = {};
    submittedStoryVisible = false;
    isSubmitting = false;
    submitted    = false;
    errorMessage = '';
    isDragOver   = false;
    recordId;

    departmentOptions = [];

    // ── wire: load picklists on mount ──────────────────────────────────────
    @wire(getPicklistValues, { objectApiName: 'Case', fieldApiName: 'Type' })
    wiredStoryType({ data, error }) {
        if (data) {
            this.storyTypeOptions = data.map(v => ({ label: v, value: v }));
        } else if (error) {
            console.error('Story Type picklist error', error);
        }
    }

    @wire(getPicklistValues, { objectApiName: 'Case', fieldApiName: 'Department__c' })
    wiredDepartment({ data, error }) {
        this.loadingPicklists = false;
        if (data) {
            this.departmentOptions = data.map(v => ({ label: v, value: v }));
        } else if (error) {
            console.error('Department picklist error', error);
        }
    }

    // ── computed ───────────────────────────────────────────────────────────
    get hasFiles() { return this.uploadedFiles.length > 0; }
    get hasSubmittedStory() { return this.submittedStoryVisible; }
    get uploadZoneClass() {
        return 'upload-zone' + (this.isDragOver ? ' drag-over' : '');
    }

    // ── input handlers ─────────────────────────────────────────────────────
    handleInput(e) {
        const field = e.currentTarget.dataset.field;
        this.formData = { ...this.formData, [field]: e.target.value };
        if (this.errors[field]) {
            this.errors = { ...this.errors, [field]: undefined };
        }
    }

    // ── drag & drop ────────────────────────────────────────────────────────
    handleDragOver(e)  { e.preventDefault(); this.isDragOver = true; }
    handleDragLeave()  { this.isDragOver = false; }
    handleDrop(e) {
        e.preventDefault();
        this.isDragOver = false;
        this.template.querySelector('lightning-file-upload').click();
    }
    handleUploadClick() {
        this.template.querySelector('lightning-file-upload').click();
    }
    handleUploadFinished(e) {
        const newFiles = e.detail.files.map(f => ({ documentId: f.documentId, name: f.name }));
        this.uploadedFiles = [...this.uploadedFiles, ...newFiles];
    }
    handleRemoveFile(e) {
        const id = e.currentTarget.dataset.id;
        this.uploadedFiles = this.uploadedFiles.filter(f => f.documentId !== id);
    }

    // ── validation ─────────────────────────────────────────────────────────
    validate() {
        const e = {};
        if (!this.formData.subject.trim())     e.subject     = 'Subject is required.';
        if (!this.formData.description.trim()) e.description = 'Description is required.';
        if (!this.formData.priority)           e.priority    = 'Please select a priority.';
        if (!this.formData.storyType)          e.storyType   = 'Please select a story type.';
        if (!this.formData.department)         e.department  = 'Please select a department.';
        this.errors = e;
        return Object.keys(e).length === 0;
    }

    // ── submit ─────────────────────────────────────────────────────────────
    async handleSubmit() {
        this.errorMessage = '';
        if (!this.validate()) return;

        this.isSubmitting = true;
        try {
            const result = await createStory({
                subject:     this.formData.subject.trim(),
                description: this.formData.description.trim(),
                priority:    this.formData.priority,
                storyType:   this.formData.storyType  || null,
                department:  this.formData.department.trim() || null
            });
            this.recordId = result;
            this.submittedStory = {
                subject:       this.formData.subject.trim(),
                description:   this.formData.description.trim(),
                priority:      this.formData.priority,
                storyType:     this.formData.storyType,
                department:    this.formData.department,
                priorityClass: `priority-badge priority-${this.formData.priority.toLowerCase()}`
            };
            this.submittedStoryVisible = true;
            this.submitted = true;

            // Broadcast to sibling components (storyBoard, sprintPlanner) to refresh
            console.log('Publishing StorySubmitted message', result);
            publish(this.messageContext, STORY_SUBMITTED_CHANNEL, { recordId: result });
            console.log('Published successfully');
        } catch (err) {
            this.errorMessage = err?.body?.message || err?.message || 'An unexpected error occurred. Please try again.';
            console.error('Story submit error', err);
        } finally {
            this.isSubmitting = false;
        }
    }

    // ── post-submit / cancel ───────────────────────────────────────────────
    handleReset() {
        this.formData             = EMPTY_FORM();
        this.errors               = {};
        this.uploadedFiles        = [];
        this.errorMessage         = '';
        this.recordId             = undefined;
        this.submitted            = false;
        this.submittedStory       = {};
        this.submittedStoryVisible = false;
    }

    handleCancel() {
        this.handleReset();
        this.dispatchEvent(new CustomEvent('cancel'));
    }
}