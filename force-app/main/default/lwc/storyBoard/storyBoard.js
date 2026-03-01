// force-app/main/default/lwc/storyBoard/storyBoard.js
import { LightningElement, track, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { subscribe, MessageContext } from 'lightning/messageService';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';
import userId from '@salesforce/user/Id';
import STORY_SUBMITTED_CHANNEL  from '@salesforce/messageChannel/StorySubmitted__c';
import PROJECT_SELECTED_CHANNEL from '@salesforce/messageChannel/ProjectSelected__c';
import getStories        from '@salesforce/apex/StoryBoardController.getStories';
import getProjects       from '@salesforce/apex/StoryBoardController.getProjects';
import updateStoryStatus    from '@salesforce/apex/StoryBoardController.updateStoryStatus';
import updatePriority       from '@salesforce/apex/StoryBoardController.updatePriority';
import updateEstimatedHours from '@salesforce/apex/StoryBoardController.updateEstimatedHours';
import getTimeEntries       from '@salesforce/apex/StoryBoardController.getTimeEntries';
import getNextSteps         from '@salesforce/apex/StoryBoardController.getNextSteps';
import addNextStep          from '@salesforce/apex/StoryBoardController.addNextStep';
import updateNextStep       from '@salesforce/apex/StoryBoardController.updateNextStep';
import createStory          from '@salesforce/apex/StoryBoardController.createStory';
import assignEpic           from '@salesforce/apex/StoryBoardController.assignEpic';
import logTime              from '@salesforce/apex/StoryBoardController.logTime';
import closeStory           from '@salesforce/apex/StoryBoardController.closeStory';
import searchUsers            from '@salesforce/apex/StoryBoardController.searchUsers';
import searchContacts         from '@salesforce/apex/StoryBoardController.searchContacts';
import assignStorySupport     from '@salesforce/apex/StoryBoardController.assignStorySupport';
import getEpicsForProject     from '@salesforce/apex/EpicManagementPanelController.getEpicsForProject';
import reassignStory          from '@salesforce/apex/StoryBoardController.reassignStory';
import updateStoryTextFields  from '@salesforce/apex/StoryBoardController.updateStoryTextFields';

// ── Constants ─────────────────────────────────────────────────────────────
const PRIORITY_ORDER = { 'Critical': 0, 'High': 1, 'Medium': 2, 'Low': 3, '': 4 };

const PRIORITY_CLASSES = {
    'Low':      'priority-badge priority-low',
    'Medium':   'priority-badge priority-medium',
    'High':     'priority-badge priority-high',
    'Critical': 'priority-badge priority-critical'
};

const PRIORITY_BTN_CLASSES = {
    'Low':      'priority-btn priority-low',
    'Medium':   'priority-btn priority-medium',
    'High':     'priority-btn priority-high',
    'Critical': 'priority-btn priority-critical'
};

const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];

const STATUSES = [
    'On Hold', 'Backlog', 'New', 'Scheduled', 'Work In Progress (WIP)', 'Waiting for User',
    'In Review', 'In UAT', 'Blocked', 'Completed', 'Cancelled'
];

const STATUS_COLORS = {
    'New':                      '#caf0f8',
    'Scheduled':                '#ade8f4',
    'Work In Progress (WIP)':   '#90e0ef',
    'Waiting for User':         '#48cae4',
    'On Hold':                  '#00b4d8',
    'Backlog':                  '#0096c7',
    'In Review':                '#0077b6',
    'In UAT':                   '#005f8e',
    'Blocked':                  '#004a70',
    'Cancelled':                '#023e5a',
    'Completed':                '#012a3d'
};

const STATUS_MAP = {
    'Closed':  'Completed',
    'Working': 'Work In Progress (WIP)'
};

const DRAG_THRESHOLD = 6;

// ── Module-level drag state (non-reactive) ────────────────────────────────
let _dragCardId       = null;
let _dragFromStatus   = null;
let _startX           = 0;
let _startY           = 0;
let _ghost            = null;
let _isDragging       = false;
let _didDrag          = false;
let _ownerSearchTimer   = null;
let _supportSearchTimer = null;

export default class StoryBoard extends NavigationMixin(LightningElement) {

    @track columns           = [];
    @track isLoading         = true;
    @track errorMessage      = '';
    @track projectOptions    = [];
    @track modalCard           = null;
    @track modalPriority       = null;
    @track isSavingPriority    = false;
    @track modalSaveError      = false;
    @track estHoursInput       = '';
    @track isSavingEstHours    = false;
    @track estHoursSaveError   = false;
    @track timeEntries         = [];
    @track isLoadingTime       = false;
    @track nextSteps           = [];
    @track nextStepInput       = '';
    @track isSavingStep        = false;
    @track editingStepId       = null;
    @track editingStepText     = '';
    @track isSavingStepEdit    = false;
    @track newTimeHours        = '';
    @track newTimeDesc         = '';
    @track isSavingTime        = false;

    // ── Owner reassignment state ──────────────────────────────────────────
    @track showOwnerSearch    = false;
    @track ownerSearchResults = [];
    @track isSearchingOwners  = false;
    @track isReassigning      = false;
    @track reassignError      = '';

    // ── Epic change state ─────────────────────────────────────────────────
    @track showEpicChange    = false;
    @track _epicOptions      = [];
    @track isLoadingEpics    = false;
    @track isChangingEpic    = false;
    @track epicChangeError   = '';

    // ── Story Support state ───────────────────────────────────────────────
    @track showSupportSearch     = false;
    @track supportSearchResults  = [];
    @track isSearchingSupport    = false;
    @track isAssigningSupport    = false;
    @track supportAssignError    = '';

    // ── Story text fields state ───────────────────────────────────────────
    @track solutionInput        = '';
    @track componentsInput      = '';
    @track qaInput              = '';
    @track documentationInput   = '';
    @track isSavingTextFields   = false;
    @track textFieldsSaveError  = false;
    @track textFieldsSaveSuccess = false;

    // ── Close Story Modal state ───────────────────────────────────────────
    @track showCloseModal          = false;
    @track _pendingCloseCardId     = null;
    @track _pendingCloseFrom       = null;
    @track _pendingCloseTo         = null;
    @track closeFormSubject        = '';
    @track closeFormComments       = '';
    @track closeFormDepartment     = '';
    @track closeFormPriority       = '';
    @track closeFormType           = '';
    @track closeFormCommentsError  = false;
    @track closeFormDeptError      = false;
    @track closeFormPriorityError  = false;
    @track closeFormTypeError      = false;
    @track isClosingStory          = false;
    @track closeStoryError         = '';

    // ── New Story state ───────────────────────────────────────────────────
    @track showNewStoryModal    = false;
    @track newStorySubject      = '';
    @track newStoryDescription  = '';
    @track newStoryPriority     = '';
    @track newStoryDepartment   = '';
    @track newStorySubjectError = false;
    @track isCreatingStory      = false;
    @track newStorySaveError    = false;

    @track selectedProjectId   = null;
    @track selectedEpicId      = null;
    _selectedEpicName          = null;
    @track isCardDragging      = false;
    @track selectedOwnerFilter = '';
    viewMode                   = 'mine';
    _currentUserId             = userId;
    _caseOwnerNames            = {};   // ownerId → name (built from story data)

    _wiredStoriesResult;
    _subscription = null;

    // ── Projects Wire ─────────────────────────────────────────────────────
    @wire(getProjects)
    wiredProjects({ data, error }) {
        if (data) {
            this.projectOptions = [
                { label: 'All Projects', value: '' },
                ...data.map(p => ({ label: p.Name, value: p.Id }))
            ];
            const myProject = data.find(p => p.OwnerId === this._currentUserId);
            if (myProject) {
                this.selectedProjectId = myProject.Id;
            } else if (data.length > 0) {
                this.selectedProjectId = data[0].Id;
            }
        } else if (error) {
            console.error('Failed to load projects', error);
        }
    }

    // ── Message Service ───────────────────────────────────────────────────
    @wire(MessageContext)
    wiredMessageContext(ctx) {
        if (ctx && !this._subscription) {
            this._subscription = subscribe(ctx, STORY_SUBMITTED_CHANNEL, () => {
                refreshApex(this._wiredStoriesResult);
            });
            subscribe(ctx, PROJECT_SELECTED_CHANNEL, ({ projectId }) => {
                this.selectedProjectId = projectId || null;
                this.selectedEpicId    = null;
                this.isLoading = true;
            });
        }
    }

    // ── Data Wire ─────────────────────────────────────────────────────────
    @wire(getStories, { mineOnly: '$mineOnly', projectId: '$selectedProjectId', epicId: '$selectedEpicId' })
    wiredStories(result) {
        this._wiredStoriesResult = result;
        this.isLoading = false;
        if (result.data) {
            this.columns = this._buildColumns(result.data);
            const nameMap = {};
            result.data.forEach(c => {
                if (c.OwnerId && c.Owner?.Name) nameMap[c.OwnerId] = c.Owner.Name;
            });
            this._caseOwnerNames = nameMap;
            this.errorMessage = '';
            requestAnimationFrame(() => this._updateOverflowMarkers());
        } else if (result.error) {
            this.errorMessage = result.error?.body?.message || 'Failed to load stories.';
        }
    }

    // ── Getters ───────────────────────────────────────────────────────────
    get mineOnly()        { return this.viewMode === 'mine'; }
    get myStoriesClass()  { return this.viewMode === 'mine' ? 'toggle-btn active' : 'toggle-btn'; }
    get allStoriesClass() { return this.viewMode === 'all'  ? 'toggle-btn active' : 'toggle-btn'; }

    get ownerOptions() {
        const opts = [{ label: 'All Owners', value: '' }];
        Object.entries(this._caseOwnerNames).forEach(([id, name]) => {
            opts.push({ label: name, value: id });
        });
        opts.sort((a, b) => a.value === '' ? -1 : a.label.localeCompare(b.label));
        return opts;
    }

    get displayColumns() {
        const addHours = col => {
            const estHrs = col.cards.reduce((s, c) => s + (c.estimatedHours || 0), 0);
            return { ...col, estHoursLabel: this._fmtHours(estHrs) || '0h' };
        };
        if (!this.selectedOwnerFilter) return this.columns.map(addHours);
        return this.columns.map(col => {
            const cards = col.cards.filter(c => c.ownerId === this.selectedOwnerFilter);
            return addHours({ ...col, cards, count: cards.length, hasCards: cards.length > 0 });
        });
    }

    get totalCount() { return this.displayColumns.reduce((sum, c) => sum + c.count, 0); }

    get showNewStoryButton() {
        return !!this.selectedProjectId;
    }

    get newStoryProjectName() {
        const opt = this.projectOptions.find(o => o.value === this.selectedProjectId);
        return opt ? opt.label : null;
    }

    get newStoryEpicName() {
        return this._selectedEpicName || null;
    }

    get departmentOptions() {
        return [
            { label: '--None--',   value: ''           },
            { label: 'Finance',    value: 'Finance'    },
            { label: 'Sales',      value: 'Sales'      },
            { label: 'Operations', value: 'Operations' },
            { label: 'IT',         value: 'IT'         },
            { label: 'HR',         value: 'HR'         },
            { label: 'Legal',      value: 'Legal'      },
        ];
    }

    get priorityOptions() {
        return PRIORITIES.map(p => ({
            value:      p,
            label:      p,
            btnClass:   this.modalPriority === p
                            ? `${PRIORITY_BTN_CLASSES[p]} selected`
                            : PRIORITY_BTN_CLASSES[p],
            newBtnClass: this.newStoryPriority === p
                            ? `${PRIORITY_BTN_CLASSES[p]} selected`
                            : PRIORITY_BTN_CLASSES[p]
        }));
    }

    get modalEpicDisplay() {
        return this.modalCard?.epicName || 'Unassigned';
    }

    get totalTimeLogged() {
        const total = this.timeEntries.reduce((s, t) => s + t.hours, 0);
        return this._fmtHours(Number(total.toFixed(2))) || '0h';
    }

    get editableNextSteps() {
        return this.nextSteps.map(s => ({ ...s, isEditing: s.id === this.editingStepId }));
    }

    get newStorySubjectClass() {
        return `new-story-input${this.newStorySubjectError ? ' input-error' : ''}`;
    }

    get typeOptions() {
        return [
            { label: '--None--',     value: ''            },
            { label: 'Bug',          value: 'Bug'          },
            { label: 'Feature',      value: 'Feature'      },
            { label: 'Enhancement',  value: 'Enhancement'  },
            { label: 'Task',         value: 'Task'         },
            { label: 'Question',     value: 'Question'     },
            { label: 'Other',        value: 'Other'        },
        ];
    }

    get closeModalTitle() {
        return this._pendingCloseTo === 'Completed' ? 'Complete Story' : 'Cancel Story';
    }

    get closeModalActionLabel() {
        return this._pendingCloseTo === 'Completed' ? 'Mark Completed' : 'Mark Cancelled';
    }

    get closeCommentsClass() {
        return `new-story-textarea${this.closeFormCommentsError ? ' input-error' : ''}`;
    }

    get closePriorityOptions() {
        return PRIORITIES.map(p => ({
            value:    p,
            label:    p,
            btnClass: this.closeFormPriority === p
                          ? `${PRIORITY_BTN_CLASSES[p]} selected`
                          : PRIORITY_BTN_CLASSES[p]
        }));
    }

    // ── Distribution Bar Getters ──────────────────────────────────────────
    get distBarSegments() {
        const total = this.totalCount;
        if (!total) return [];
        return this.displayColumns
            .filter(c => c.count > 0)
            .map((c, i, arr) => {
                const pct     = (c.count / total) * 100;
                const color   = STATUS_COLORS[c.status] || '#00b4d8';
                const isFirst = i === 0;
                const isLast  = i === arr.length - 1;
                const radius  = isFirst && isLast ? '999px'
                              : isFirst           ? '999px 0 0 999px'
                              : isLast            ? '0 999px 999px 0'
                              : '0';
                        return {
                    status:  c.status,
                    tooltip: `${c.status}: ${c.count}`,
                    style:   `width:${pct}%;background:${color};border-radius:${radius};`
                };
            });
    }

    get distBarLegend() {
        return this.displayColumns.map(c => {
            const color   = STATUS_COLORS[c.status] || '#00b4d8';
            const dim     = c.count === 0;
                return {
                status:     c.status,
                statsLabel: `${c.count}`,
                dotStyle:   dim ? 'background:#d1d5db;'  : `background:${color};`,
                statsStyle: dim ? 'color:#9ca3af;'        : `color:${color};`,
                dimStyle:   dim ? 'opacity:0.5;'          : ''
            };
        });
    }

    _fmtHours(h) {
        if (!h) return '';
        return `${Number(h.toFixed(2))}h`;
    }

    _stripHtml(html) {
        if (!html) return '';
        return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    }

    _mapNextStep(s) {
        let date = '';
        if (s.CreatedDate) {
            date = new Date(s.CreatedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }
        return {
            id:   s.Id,
            note: s.CommentBody || '',
            date,
            user: s.CreatedBy?.Name || ''
        };
    }

    _mapTimeEntry(t) {
        const hrs  = t.Minutes_Logged__c ? Number((t.Minutes_Logged__c / 60).toFixed(2)) : 0;
        let date   = '';
        if (t.Logged_Date__c) {
            const [y, m, d] = t.Logged_Date__c.split('-').map(Number);
            date = new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }
        return {
            id:          t.Id,
            hours:       hrs,
            hoursLabel:  this._fmtHours(hrs) || '0h',
            description: t.Additional_Comments__c || '',
            date,
            user:        t.CreatedBy?.Name || ''
        };
    }

    // ── Handlers ──────────────────────────────────────────────────────────
    handleToggle(e) {
        const val = e.currentTarget.dataset.value;
        if (val !== this.viewMode) {
            this.viewMode  = val;
            this.isLoading = true;
        }
    }

    handleProjectChange(e) {
        this.selectedProjectId = e.detail.value || null;
        this.selectedEpicId    = null;
        this._selectedEpicName = null;
        this.isLoading = true;
    }

    handleEpicSelect(evt) {
        this.selectedEpicId    = evt.detail.epicId  || null;
        this._selectedEpicName = evt.detail.epicName || null;
        this.isLoading = true;
    }

    handleOwnerFilterChange(e) { this.selectedOwnerFilter = e.detail.value || ''; }

    handleCardClick(e) {
        if (_didDrag) { _didDrag = false; return; }
        const id = e.currentTarget.dataset.id;
        if (!id) return;
        const card = this.columns.flatMap(c => c.cards).find(c => c.id === id);
        if (!card) return;
        this.modalCard          = { ...card };
        this.modalPriority      = card.priority;
        this.modalSaveError     = false;
        this.isSavingPriority   = false;
        this.estHoursInput      = card.estimatedHours != null ? String(card.estimatedHours) : '';
        this.estHoursSaveError  = false;
        this.isSavingEstHours   = false;
        this.timeEntries        = [];
        this.nextSteps          = [];
        this.nextStepInput      = '';
        this.newTimeHours       = '';
        this.newTimeDesc        = '';
        this.isSavingTime       = false;
        this.showOwnerSearch     = false;
        this.ownerSearchResults  = [];
        this.reassignError       = '';
        this.showEpicChange      = false;
        this._epicOptions        = [];
        this.epicChangeError     = '';
        this.showSupportSearch   = false;
        this.supportSearchResults = [];
        this.supportAssignError  = '';
        this.solutionInput       = this._stripHtml(card.solution);
        this.componentsInput     = this._stripHtml(card.componentsToDeploy);
        this.qaInput             = this._stripHtml(card.qa);
        this.documentationInput  = this._stripHtml(card.documentation);
        this.isSavingTextFields  = false;
        this.textFieldsSaveError = false;
        this.textFieldsSaveSuccess = false;
        this.isLoadingTime       = true;
        Promise.all([
            getTimeEntries({ caseId: id }),
            getNextSteps({ caseId: id })
        ]).then(([times, steps]) => {
            this.timeEntries = times.map(t => this._mapTimeEntry(t));
            this.nextSteps   = steps.map(s => this._mapNextStep(s)).reverse();
        }).catch(() => {}).finally(() => { this.isLoadingTime = false; });
    }

    handleModalClose() { this.modalCard = null; }
    handleModalBackdropClick() { this.modalCard = null; }
    handleModalContainerClick(e) { e.stopPropagation(); }

    handlePrioritySelect(e) {
        const newPriority = e.currentTarget.dataset.value;
        if (!this.modalCard || newPriority === this.modalCard.priority) {
            this.modalCard = null;
            return;
        }
        this.modalPriority    = newPriority;
        this.isSavingPriority = true;
        this.modalSaveError   = false;

        const id = this.modalCard.id;

        updatePriority({ caseId: id, priority: newPriority })
            .then(() => {
                this.columns = this.columns.map(col => ({
                    ...col,
                    cards: col.cards.map(c => {
                        if (c.id !== id) return c;
                        return {
                            ...c,
                            priority:      newPriority,
                            priorityClass: PRIORITY_CLASSES[newPriority] || 'priority-badge priority-low'
                        };
                    })
                }));
                this._toast('Priority updated', `Priority set to "${newPriority}"`, 'success');
                this.modalCard = null;
            })
            .catch(err => {
                this.isSavingPriority = false;
                this.modalSaveError   = true;
                console.error('Failed to update priority', err);
            });
    }

    handleModalSave() {}
    handleCardHover() {}
    handleCardLeave() {}

    // ── Estimated Hours ───────────────────────────────────────────────────
    handleEstHoursChange(e) { this.estHoursInput = e.target.value; }

    async handleEstHoursSave() {
        const raw   = (this.estHoursInput || '').toString().trim();
        const hours = raw === '' ? null : parseFloat(raw);
        if (raw !== '' && (isNaN(hours) || hours < 0)) return;
        this.isSavingEstHours  = true;
        this.estHoursSaveError = false;
        const id = this.modalCard.id;
        try {
            await updateEstimatedHours({ caseId: id, hours });
            this.columns = this.columns.map(col => ({
                ...col,
                cards: col.cards.map(c => c.id !== id ? c : { ...c, estimatedHours: hours })
            }));
            this.modalCard = { ...this.modalCard, estimatedHours: hours };
            this._toast('Saved', 'Estimated hours updated', 'success');
        } catch (err) {
            this.estHoursSaveError = true;
            console.error('Failed to save estimated hours', err);
        } finally {
            this.isSavingEstHours = false;
        }
    }

    // ── Next Steps ────────────────────────────────────────────────────────
    handleNextStepChange(e) { this.nextStepInput = e.target.value; }

    async handleNextStepSave() {
        const note = (this.nextStepInput || '').trim();
        if (!note) return;
        this.isSavingStep = true;
        try {
            const newId = await addNextStep({ caseId: this.modalCard.id, note });
            const today = new Date();
            const dateLabel = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            this.nextSteps = [{ id: newId, note, date: dateLabel, user: '' }, ...this.nextSteps];
            this.nextStepInput = '';
            const ta = this.template.querySelector('.next-step-textarea');
            if (ta) ta.value = '';
        } catch (err) {
            console.error('Failed to save next step', err);
        } finally {
            this.isSavingStep = false;
        }
    }

    // ── Log Time ──────────────────────────────────────────────────────────
    handleNewTimeHoursChange(e) { this.newTimeHours = e.target.value; }
    handleNewTimeDescChange(e)   { this.newTimeDesc  = e.target.value; }

    async handleLogTime() {
        const raw   = (this.newTimeHours || '').toString().trim();
        const hours = parseFloat(raw);
        if (!raw || isNaN(hours) || hours <= 0) return;
        this.isSavingTime = true;
        const caseId = this.modalCard.id;
        try {
            const today      = new Date();
            const yyyy       = today.getFullYear();
            const mm         = String(today.getMonth() + 1).padStart(2, '0');
            const dd         = String(today.getDate()).padStart(2, '0');
            const loggedDate = `${yyyy}-${mm}-${dd}`;
            const newId      = await logTime({ caseId, hours, description: this.newTimeDesc.trim(), loggedDate });
            const dateLabel  = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            this.timeEntries = [
                {
                    id:          newId,
                    hours,
                    hoursLabel:  this._fmtHours(hours) || '0h',
                    description: this.newTimeDesc.trim(),
                    date:        dateLabel,
                    user:        ''
                },
                ...this.timeEntries
            ];
            this.newTimeHours = '';
            this.newTimeDesc  = '';
            const hoursEl = this.template.querySelector('.log-time-hours');
            if (hoursEl) hoursEl.value = '';
            const descEl  = this.template.querySelector('.log-time-desc');
            if (descEl)  descEl.value  = '';
        } catch (err) {
            console.error('Failed to log time', err);
        } finally {
            this.isSavingTime = false;
        }
    }

    // ── Edit Next Step ────────────────────────────────────────────────────
    handleEditStep(e) {
        const id = e.currentTarget.dataset.id;
        const step = this.nextSteps.find(s => s.id === id);
        if (!step) return;
        this.editingStepId   = id;
        this.editingStepText = step.note;
    }

    handleEditStepChange(e) { this.editingStepText = e.target.value; }

    handleEditStepCancel() {
        this.editingStepId   = null;
        this.editingStepText = '';
    }

    async handleEditStepSave() {
        const note = (this.editingStepText || '').trim();
        if (!note) return;
        this.isSavingStepEdit = true;
        try {
            await updateNextStep({ commentId: this.editingStepId, note });
            this.nextSteps = this.nextSteps.map(s =>
                s.id === this.editingStepId ? { ...s, note } : s
            );
            this.editingStepId   = null;
            this.editingStepText = '';
        } catch (err) {
            console.error('Failed to update next step', err);
        } finally {
            this.isSavingStepEdit = false;
        }
    }

    // ── Story Text Fields ─────────────────────────────────────────────────
    handleSolutionChange(e)       { this.solutionInput       = e.target.value; }
    handleComponentsChange(e)     { this.componentsInput     = e.target.value; }
    handleQaChange(e)             { this.qaInput             = e.target.value; }
    handleDocumentationChange(e)  { this.documentationInput  = e.target.value; }

    async handleTextFieldsSave() {
        this.isSavingTextFields   = true;
        this.textFieldsSaveError  = false;
        this.textFieldsSaveSuccess = false;
        const caseId = this.modalCard.id;
        try {
            await updateStoryTextFields({
                caseId,
                solution:           this.solutionInput.trim()       || null,
                componentsToDeploy: this.componentsInput.trim()     || null,
                qa:                 this.qaInput.trim()             || null,
                documentation:      this.documentationInput.trim()  || null
            });
            // Update in-memory card
            this.modalCard = {
                ...this.modalCard,
                solution:           this.solutionInput.trim(),
                componentsToDeploy: this.componentsInput.trim(),
                qa:                 this.qaInput.trim(),
                documentation:      this.documentationInput.trim()
            };
            this.columns = this.columns.map(col => ({
                ...col,
                cards: col.cards.map(c => c.id !== caseId ? c : {
                    ...c,
                    solution:           this.solutionInput.trim(),
                    componentsToDeploy: this.componentsInput.trim(),
                    qa:                 this.qaInput.trim(),
                    documentation:      this.documentationInput.trim()
                })
            }));
            this.textFieldsSaveSuccess = true;
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            setTimeout(() => { this.textFieldsSaveSuccess = false; }, 2000);
        } catch (err) {
            this.textFieldsSaveError = true;
            console.error('Failed to save text fields', err);
        } finally {
            this.isSavingTextFields = false;
        }
    }

    // ── Epic Change ───────────────────────────────────────────────────────
    async handleChangeEpicClick() {
        if (this.showEpicChange) {
            this.showEpicChange = false;
            return;
        }
        this.showOwnerSearch   = false;
        this.showSupportSearch = false;
        this.showEpicChange    = true;
        this.isLoadingEpics   = true;
        this.epicChangeError  = '';
        try {
            this._epicOptions = await getEpicsForProject({ projectId: this.modalCard.projectId });
        } catch (err) {
            this.epicChangeError = 'Failed to load epics';
            console.error(err);
        } finally {
            this.isLoadingEpics = false;
        }
    }

    async handleModalEpicPick(e) {
        const epicId   = e.currentTarget.dataset.id;
        const epicName = e.currentTarget.dataset.name;
        const caseId   = this.modalCard.id;
        this.isChangingEpic  = true;
        this.epicChangeError = '';
        try {
            await assignEpic({ caseId, epicId });
            this.modalCard = { ...this.modalCard, epicId, epicName };
            this.columns = this.columns.map(col => ({
                ...col,
                cards: col.cards.map(c => c.id !== caseId ? c : { ...c, epicId, epicName })
            }));
            this.showEpicChange = false;
        } catch (err) {
            this.epicChangeError = 'Failed to assign epic';
            console.error(err);
        } finally {
            this.isChangingEpic = false;
        }
    }

    handleEpicChangeCancel() {
        this.showEpicChange  = false;
        this.epicChangeError = '';
    }

    // ── Story Support ─────────────────────────────────────────────────────
    get modalSupportDisplay() {
        return this.modalCard?.storySupportName || 'None';
    }

    handleSupportAssignClick() {
        this.showOwnerSearch      = false;
        this.showEpicChange       = false;
        this.showSupportSearch    = !this.showSupportSearch;
        this.supportSearchResults = [];
        this.supportAssignError   = '';
    }

    handleSupportSearchChange(e) {
        const term = e.target.value;
        if (term.length < 2) {
            this.supportSearchResults = [];
            return;
        }
        this.isSearchingSupport = true;
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        clearTimeout(_supportSearchTimer);
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        _supportSearchTimer = setTimeout(async () => {
            try {
                const results = await searchContacts({ searchTerm: term });
                this.supportSearchResults = results.map(c => ({
                    id:      c.Id,
                    name:    c.Name,
                    subtitle: [c.Title, c.Account?.Name].filter(Boolean).join(' · ')
                }));
            } catch (err) {
                console.error(err);
            } finally {
                this.isSearchingSupport = false;
            }
        }, 300);
    }

    async handleSupportResultSelect(e) {
        const contactId   = e.currentTarget.dataset.id;
        const contactName = e.currentTarget.dataset.name;
        const caseId      = this.modalCard.id;
        this.isAssigningSupport  = true;
        this.supportAssignError  = '';
        try {
            await assignStorySupport({ caseId, contactId });
            this.modalCard = { ...this.modalCard, storySupportId: contactId, storySupportName: contactName };
            this.columns = this.columns.map(col => ({
                ...col,
                cards: col.cards.map(c => c.id !== caseId ? c : { ...c, storySupportId: contactId, storySupportName: contactName })
            }));
            this.showSupportSearch = false;
        } catch (err) {
            this.supportAssignError = 'Failed to assign — please try again';
            console.error(err);
        } finally {
            this.isAssigningSupport = false;
        }
    }

    handleSupportSearchCancel() {
        this.showSupportSearch    = false;
        this.supportSearchResults = [];
        this.supportAssignError   = '';
    }

    // ── Owner Reassignment ────────────────────────────────────────────────
    handleReassignClick() {
        this.showEpicChange       = false;
        this.showSupportSearch    = false;
        this.showOwnerSearch      = true;
        this.ownerSearchResults = [];
        this.reassignError      = '';
    }

    handleOwnerSearchCancel() {
        clearTimeout(_ownerSearchTimer);
        this.showOwnerSearch    = false;
        this.ownerSearchResults = [];
        this.reassignError      = '';
    }

    handleOwnerSearchChange(e) {
        const term = (e.target.value || '').trim();
        clearTimeout(_ownerSearchTimer);
        this.ownerSearchResults = [];
        if (term.length < 2) return;
        _ownerSearchTimer = setTimeout(() => {
            this.isSearchingOwners = true;
            searchUsers({ searchTerm: term })
                .then(users => {
                    this.ownerSearchResults = users.map(u => ({ id: u.Id, name: u.Name }));
                })
                .catch(() => { this.ownerSearchResults = []; })
                .finally(() => { this.isSearchingOwners = false; });
        }, 300);
    }

    async handleOwnerResultSelect(e) {
        const newOwnerId   = e.currentTarget.dataset.id;
        const newOwnerName = e.currentTarget.dataset.name;
        if (!newOwnerId || !this.modalCard) return;
        this.isReassigning = true;
        this.reassignError = '';
        const caseId = this.modalCard.id;
        try {
            await reassignStory({ caseId, newOwnerId });
            this.modalCard = { ...this.modalCard, ownerId: newOwnerId, ownerName: newOwnerName };
            this.columns = this.columns.map(col => ({
                ...col,
                cards: col.cards.map(c => c.id !== caseId ? c : { ...c, ownerId: newOwnerId, ownerName: newOwnerName })
            }));
            this._caseOwnerNames = { ...this._caseOwnerNames, [newOwnerId]: newOwnerName };
            this.showOwnerSearch    = false;
            this.ownerSearchResults = [];
            this._toast('Owner updated', `Story assigned to ${newOwnerName}`, 'success');
        } catch (err) {
            this.reassignError = err?.body?.message || 'Failed to reassign — please try again.';
        } finally {
            this.isReassigning = false;
        }
    }

    // ── New Story Modal ───────────────────────────────────────────────────
    handleNewStoryClick() {
        this.newStorySubject      = '';
        this.newStoryDescription  = '';
        this.newStoryPriority     = '';
        this.newStoryDepartment   = '';
        this.newStorySubjectError = false;
        this.newStorySaveError    = false;
        this.showNewStoryModal    = true;
    }

    handleNewStoryClose() {
        if (this.isCreatingStory) return;
        this.showNewStoryModal = false;
    }

    handleNewStoryBackdropClick() { this.handleNewStoryClose(); }
    handleNewStorySubjectChange(e) {
        this.newStorySubject      = e.target.value;
        this.newStorySubjectError = false;
    }
    handleNewStoryDescriptionChange(e) { this.newStoryDescription = e.target.value; }
    handleNewStoryPrioritySelect(e)    { this.newStoryPriority = e.currentTarget.dataset.value; }
    handleNewStoryDepartmentChange(e)  { this.newStoryDepartment = e.detail.value; }

    async handleNewStorySubmit() {
        if (!this.newStorySubject.trim()) {
            this.newStorySubjectError = true;
            return;
        }
        this.isCreatingStory   = true;
        this.newStorySaveError = false;
        try {
            await createStory({
                projectId:   this.selectedProjectId,
                subject:     this.newStorySubject.trim(),
                description: this.newStoryDescription.trim() || null,
                priority:    this.newStoryPriority    || null,
                department:  this.newStoryDepartment  || null,
                epicId:      this.selectedEpicId      || null,
            });
            this.showNewStoryModal = false;
            this._toast('Story created', `"${this.newStorySubject.trim()}" was added to the board`, 'success');
            refreshApex(this._wiredStoriesResult);
        } catch (err) {
            console.error('createStory error', err);
            this.newStorySaveError = true;
        } finally {
            this.isCreatingStory = false;
        }
    }

    // ── Close Story Modal ─────────────────────────────────────────────────
    _showCloseModal(cardId, fromStatus, toStatus) {
        const card = this._findCard(fromStatus, cardId);
        this._pendingCloseCardId    = cardId;
        this._pendingCloseFrom      = fromStatus;
        this._pendingCloseTo        = toStatus;
        this.closeFormSubject       = card ? card.subject    : '';
        this.closeFormComments      = '';
        this.closeFormDepartment    = card ? (card.department || '') : '';
        this.closeFormPriority      = card ? (card.priority   || '') : '';
        this.closeFormType          = card ? (card.type       || '') : '';
        this.closeFormCommentsError = false;
        this.closeFormDeptError     = false;
        this.closeFormPriorityError = false;
        this.closeFormTypeError     = false;
        this.isClosingStory         = false;
        this.closeStoryError        = '';
        this.showCloseModal         = true;
    }

    handleCloseModalCancel() {
        if (this.isClosingStory) return;
        this.showCloseModal = false;
    }


    handleCloseFormCommentsChange(e) {
        this.closeFormComments      = e.target.value;
        this.closeFormCommentsError = false;
    }

    handleCloseFormDeptChange(e) {
        this.closeFormDepartment = e.detail.value;
        this.closeFormDeptError  = false;
    }

    handleCloseFormTypeChange(e) {
        this.closeFormType      = e.detail.value;
        this.closeFormTypeError = false;
    }

    handleCloseFormPrioritySelect(e) {
        this.closeFormPriority      = e.currentTarget.dataset.value;
        this.closeFormPriorityError = false;
    }

    async handleCloseStorySubmit() {
        let valid = true;
        if (!(this.closeFormComments || '').trim()) {
            this.closeFormCommentsError = true;
            valid = false;
        }
        if (!this.closeFormDepartment) {
            this.closeFormDeptError = true;
            valid = false;
        }
        if (!this.closeFormPriority) {
            this.closeFormPriorityError = true;
            valid = false;
        }
        if (!this.closeFormType) {
            this.closeFormTypeError = true;
            valid = false;
        }
        if (!valid) return;

        this.isClosingStory  = true;
        this.closeStoryError = '';
        const id       = this._pendingCloseCardId;
        const from     = this._pendingCloseFrom;
        const toStatus = this._pendingCloseTo;
        const priority = this.closeFormPriority;
        const dept     = this.closeFormDepartment;
        const type     = this.closeFormType;
        try {
            await closeStory({
                caseId:          id,
                newStatus:       toStatus,
                closingComments: this.closeFormComments.trim(),
                department:      dept,
                priority,
                type
            });
            this.showCloseModal = false;
            // Optimistic UI: move card to destination column with updated fields
            this.columns = this.columns.map(col => {
                if (col.status === from) {
                    const cards = col.cards.filter(c => c.id !== id);
                    return { ...col, cards, count: cards.length, hasCards: cards.length > 0 };
                }
                if (col.status === toStatus) {
                    const moved = this._findCard(from, id);
                    if (!moved) return col;
                    const updated = {
                        ...moved,
                        priority,
                        type,
                        department:    dept,
                        priorityClass: PRIORITY_CLASSES[priority] || 'priority-badge priority-low'
                    };
                    const cards = [...col.cards, updated]
                        .slice()
                        .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 4) - (PRIORITY_ORDER[b.priority] ?? 4));
                    return { ...col, cards, count: cards.length, hasCards: true };
                }
                return col;
            });
            this._toast('Story closed', `Story moved to "${toStatus}"`, 'success');
        } catch (err) {
            this.closeStoryError = err?.body?.message || 'Failed to close story — please try again.';
        } finally {
            this.isClosingStory = false;
        }
    }

    // ── Drag ──────────────────────────────────────────────────────────────
    handlePointerDown(e) {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        const card      = e.currentTarget;
        _dragCardId     = card.dataset.id;
        _dragFromStatus = card.dataset.status;
        _startX         = e.clientX;
        _startY         = e.clientY;
        _isDragging     = false;
        card.setPointerCapture(e.pointerId);
    }

    handlePointerMove(e) {
        if (!_dragCardId) return;
        const dx = Math.abs(e.clientX - _startX);
        const dy = Math.abs(e.clientY - _startY);
        if (!_isDragging && (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD)) {
            _isDragging          = true;
            this.isCardDragging  = true;
            this._startGhost(e);
            this._setDraggingCard(_dragCardId, true);
        }
        if (_isDragging && _ghost) {
            _ghost.style.left = `${e.clientX + 12}px`;
            _ghost.style.top  = `${e.clientY + 12}px`;
            const epicPanel = this.template.querySelector('c-epic-management-panel');
            const overEpics = epicPanel && (() => {
                const r = epicPanel.getBoundingClientRect();
                return e.clientX >= r.left && e.clientX <= r.right
                    && e.clientY >= r.top  && e.clientY <= r.bottom;
            })();
            if (overEpics) {
                this._clearColumnHighlights();
                epicPanel.setDragHighlight(e.clientX, e.clientY);
            } else {
                if (epicPanel) epicPanel.setDragHighlight(null, null);
                this._highlightColumn(e);
            }
        }
    }

    handlePointerUp(e) {
        if (!_dragCardId) return;
        if (_isDragging) {
            const epicPanel = this.template.querySelector('c-epic-management-panel');
            const epicId    = epicPanel ? epicPanel.getEpicIdAtPoint(e.clientX, e.clientY) : null;

            this._destroyGhost();
            this._clearColumnHighlights();
            this._setDraggingCard(_dragCardId, false);
            if (epicPanel) epicPanel.setDragHighlight(null, null);

            if (epicId) {
                this._assignEpic(_dragCardId, epicId);
            } else {
                const toStatus = this._getColumnAtPoint(e.clientX, e.clientY);
                if (toStatus && toStatus !== _dragFromStatus) {
                    this._moveCard(_dragCardId, _dragFromStatus, toStatus);
                }
            }
        }
        if (_isDragging) _didDrag = true;
        this.isCardDragging = false;
        _dragCardId         = null;
        _dragFromStatus     = null;
        _isDragging         = false;
    }

    // ── Ghost ─────────────────────────────────────────────────────────────
    _startGhost(e) {
        const srcEl = this.template.querySelector(`[data-id="${_dragCardId}"]`);
        if (!srcEl) return;
        const rect = srcEl.getBoundingClientRect();
        _ghost = srcEl.cloneNode(true);
        _ghost.style.cssText = `
            position: fixed;
            width: ${rect.width}px;
            left: ${e.clientX + 12}px;
            top: ${e.clientY + 12}px;
            opacity: 0.85;
            pointer-events: none;
            z-index: 9999;
            transform: rotate(2deg);
            box-shadow: 0 8px 24px rgba(0,0,0,0.18);
            border-radius: 8px;
        `;
        document.body.appendChild(_ghost);
    }

    _destroyGhost() {
        if (_ghost) { _ghost.remove(); _ghost = null; }
    }

    // ── Column highlight ──────────────────────────────────────────────────
    _highlightColumn(e) {
        this.template.querySelectorAll('.board-col').forEach(col => {
            const r    = col.getBoundingClientRect();
            const over = e.clientX >= r.left && e.clientX <= r.right
                      && e.clientY >= r.top  && e.clientY <= r.bottom;
            col.classList.toggle('col-drop-target', over);
        });
    }

    _clearColumnHighlights() {
        this.template.querySelectorAll('.board-col')
            .forEach(col => col.classList.remove('col-drop-target'));
    }

    _getColumnAtPoint(x, y) {
        let found = null;
        this.template.querySelectorAll('.board-col').forEach(col => {
            const r = col.getBoundingClientRect();
            if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
                found = col.dataset.status;
            }
        });
        return found;
    }

    _setDraggingCard(id, dragging) {
        const el = this.template.querySelector(`[data-id="${id}"]`);
        if (el) el.classList.toggle('card-dragging', dragging);
    }

    // ── Optimistic move + Apex save ───────────────────────────────────────
    _moveCard(id, fromStatus, toStatus) {
        if (toStatus === 'Completed' || toStatus === 'Cancelled') {
            this._showCloseModal(id, fromStatus, toStatus);
            return;
        }
        this.columns = this.columns.map(col => {
            if (col.status === fromStatus) {
                const cards = col.cards.filter(c => c.id !== id);
                return { ...col, cards, count: cards.length, hasCards: cards.length > 0 };
            }
            if (col.status === toStatus) {
                const moved = this._findCard(fromStatus, id);
                if (!moved) return col;
                const updated = { ...moved, isSaving: true, cardClass: 'story-card card-saving' };
                const cards = [...col.cards, updated]
                    .slice()
                    .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 4) - (PRIORITY_ORDER[b.priority] ?? 4));
                return { ...col, cards, count: cards.length, hasCards: true };
            }
            return col;
        });

        updateStoryStatus({ caseId: id, newStatus: toStatus })
            .then(() => {
                this.columns = this.columns.map(col => {
                    if (col.status !== toStatus) return col;
                    const cards = col.cards.map(c =>
                        c.id === id ? { ...c, isSaving: false, cardClass: 'story-card' } : c
                    );
                    return { ...col, cards };
                });
                this._toast('Status updated', `Story moved to "${toStatus}"`, 'success');
            })
            .catch(err => {
                this._revertCard(id, fromStatus, toStatus);
                this._toast('Update failed', err?.body?.message || 'Could not update status.', 'error');
            });
    }

    _revertCard(id, fromStatus, toStatus) {
        this.columns = this.columns.map(col => {
            if (col.status === toStatus) {
                const cards = col.cards.filter(c => c.id !== id);
                return { ...col, cards, count: cards.length, hasCards: cards.length > 0 };
            }
            if (col.status === fromStatus) {
                const original = (this._wiredStoriesResult?.data || []).find(c => c.Id === id);
                if (!original) return col;
                const card  = this._mapCard(original);
                const cards = [...col.cards, card]
                    .slice()
                    .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 4) - (PRIORITY_ORDER[b.priority] ?? 4));
                return { ...col, cards, count: cards.length, hasCards: true };
            }
            return col;
        });
    }

    // ── Assign Epic (drag to epic strip) ──────────────────────────────────
    _assignEpic(caseId, epicId) {
        assignEpic({ caseId, epicId })
            .then(() => {
                const epicName = this.template.querySelector('c-epic-management-panel')
                    ?._epics?.find(e => e.epicId === epicId)?.name || 'epic';
                this._toast('Epic assigned', `Story moved to "${epicName}"`, 'success');
                return refreshApex(this._wiredStoriesResult);
            })
            .catch(err => this._toast('Error', err?.body?.message || 'Could not assign epic', 'error'));
    }

    // ── Helpers ───────────────────────────────────────────────────────────
    _updateOverflowMarkers() {
        this.template.querySelectorAll('.board-col').forEach(col => {
            const cards = col.querySelector('.col-cards');
            if (cards) {
                col.classList.toggle('is-overflowing', cards.scrollHeight > cards.clientHeight);
                cards.onscroll = () => {
                    const atBottom = cards.scrollHeight - cards.scrollTop <= cards.clientHeight + 4;
                    col.classList.toggle('is-overflowing', !atBottom);
                };
            }
        });
    }

    _findCard(status, id) {
        const col = this.columns.find(c => c.status === status);
        return col?.cards.find(c => c.id === id) || null;
    }

    _toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }

    _mapCard(c) {
        return {
            id:            c.Id,
            subject:       c.Subject,
            description:   c.Description || '',
            caseNumber:    c.CaseNumber,
            priority:      c.Priority    || '',
            type:          c.Type        || '',
            department:    c.Department__c || '',
            priorityClass: PRIORITY_CLASSES[c.Priority] || 'priority-badge priority-low',
            openedDate:    c.CreatedDate
                               ? new Date(c.CreatedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                               : '',
            estimatedHours: c.Hours_Estimate_to_Complete__c ?? null,
            ownerId:            c.OwnerId             || null,
            ownerName:          c.Owner?.Name         || '',
            epicId:             c.Epic__c             || null,
            epicName:           c.Epic__r?.Name       || '',
            contactName:        c.Contact?.Name       || '',
            storySupportId:     c.Story_Support__c    || null,
            storySupportName:   c.Story_Support__r?.Name || '',
            solution:           c.Solution__c         || '',
            componentsToDeploy: c.Components_to_Deploy__c || '',
            qa:                 c.Q_A__c              || '',
            documentation:      c.Documentation__c    || '',
            projectId:          c.Projects__c         || null,
            recordUrl:  `/lightning/r/Case/${c.Id}/view`,
            isSaving:   false,
            cardClass:  'story-card'
        };
    }

    _buildColumns(cases) {
        const grouped = {};
        STATUSES.forEach(s => { grouped[s] = []; });
        (cases || []).forEach(c => {
            const s = STATUS_MAP[c.Status] || c.Status;
            if (!grouped[s]) grouped[s] = [];
            grouped[s].push(this._mapCard(c));
        });
        return STATUSES.map(s => {
            const sorted = grouped[s]
                .slice()
                .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 4) - (PRIORITY_ORDER[b.priority] ?? 4));
            return {
                status:      s,
                count:       sorted.length,
                hasCards:    sorted.length > 0,
                cards:       sorted,
                headerStyle: `border-top: 3px solid ${STATUS_COLORS[s] || '#00b4d8'};`
            };
        });
    }
}