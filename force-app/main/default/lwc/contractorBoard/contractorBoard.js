// force-app/main/default/lwc/contractorBoard/contractorBoard.js
import { LightningElement, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';
import getProjectsForUser    from '@salesforce/apex/ContractorBoardController.getProjectsForUser';
import getStories            from '@salesforce/apex/ContractorBoardController.getStories';
import getTimeEntries        from '@salesforce/apex/ContractorBoardController.getTimeEntries';
import getNextSteps          from '@salesforce/apex/ContractorBoardController.getNextSteps';
import getChatMessages       from '@salesforce/apex/ContractorBoardController.getChatMessages';
import getAttachments        from '@salesforce/apex/ContractorBoardController.getAttachments';
import searchUsers           from '@salesforce/apex/ContractorBoardController.searchUsers';
import postChatMessage       from '@salesforce/apex/ContractorBoardController.postChatMessage';
import logTime               from '@salesforce/apex/ContractorBoardController.logTime';
import addNextStep           from '@salesforce/apex/ContractorBoardController.addNextStep';
import uploadAttachment      from '@salesforce/apex/ContractorBoardController.uploadAttachment';
import updateStoryStatus     from '@salesforce/apex/ContractorBoardController.updateStoryStatus';
import updatePriority        from '@salesforce/apex/ContractorBoardController.updatePriority';
import updateStoryType       from '@salesforce/apex/ContractorBoardController.updateStoryType';
import updateEstimatedHours  from '@salesforce/apex/ContractorBoardController.updateEstimatedHours';
import updateStoryDescription from '@salesforce/apex/ContractorBoardController.updateStoryDescription';
import updateStoryTextFields from '@salesforce/apex/ContractorBoardController.updateStoryTextFields';
import closeStory            from '@salesforce/apex/ContractorBoardController.closeStory';
import updateTimeEntry       from '@salesforce/apex/ContractorBoardController.updateTimeEntry';
import updateNextStep        from '@salesforce/apex/ContractorBoardController.updateNextStep';
import deleteAttachment      from '@salesforce/apex/ContractorBoardController.deleteAttachment';
import getContactsForProject from '@salesforce/apex/ContractorBoardController.getContactsForProject';
import assignContact         from '@salesforce/apex/ContractorBoardController.assignContact';
import createStory           from '@salesforce/apex/ContractorBoardController.createStory';
import getActiveTimer        from '@salesforce/apex/ContractorBoardController.getActiveTimer';
import startTimer            from '@salesforce/apex/ContractorBoardController.startTimer';
import stopTimer             from '@salesforce/apex/ContractorBoardController.stopTimer';
import logTimerSession       from '@salesforce/apex/ContractorBoardController.logTimerSession';
import discardTimer          from '@salesforce/apex/ContractorBoardController.discardTimer';

// ── Constants ──────────────────────────────────────────────────────────────────

const STATUS_COLS = [
    { status: 'On Hold',               label: 'On Hold',     color: '#00b4d8' },
    { status: 'Backlog',               label: 'Backlog',     color: '#0096c7' },
    { status: 'Blocked',               label: 'Blocked',     color: '#004a70' },
    { status: 'New',                   label: 'New',         color: '#caf0f8' },
    { status: 'Scheduled',             label: 'Scheduled',   color: '#ade8f4' },
    { status: 'Work In Progress (WIP)',label: 'In Progress', color: '#90e0ef' },
    { status: 'Waiting for User',      label: 'Waiting',     color: '#48cae4' },
    { status: 'In Review',             label: 'In Review',   color: '#0077b6' },
    { status: 'In UAT',                label: 'In UAT',      color: '#005f8e' },
    { status: 'Completed',             label: 'Completed',   color: '#012a3d' },
    { status: 'Cancelled',             label: 'Cancelled',   color: '#023e5a' },
];

const STATUS_ALIAS = {
    'Closed':  'Completed',
    'Working': 'Work In Progress (WIP)',
};

const STATUS_COLOR_MAP = {};
STATUS_COLS.forEach(c => { STATUS_COLOR_MAP[c.status] = c.color; });

const PRIORITY_CLASS_MAP = {
    Low:      'priority-badge priority-low',
    Medium:   'priority-badge priority-medium',
    High:     'priority-badge priority-high',
    Critical: 'priority-badge priority-critical',
};

const PRIORITY_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 };

const PRIORITY_BTN_CLASS = {
    Critical: 'priority-badge priority-critical',
    High:     'priority-badge priority-high',
    Medium:   'priority-badge priority-medium',
    Low:      'priority-badge priority-low',
};

const CLOSE_STATUSES = new Set(['Completed', 'Cancelled']);
const TYPE_OPTIONS   = ['', 'Bug', 'Feature', 'Enhancement', 'Task', 'Question', 'Other'];
const DEPT_OPTIONS   = ['', 'Finance', 'Sales', 'Operations', 'IT', 'HR', 'Legal'];

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg']);

// ── Module-level drag state ────────────────────────────────────────────────────

let _dragCardId      = null;
let _dragFromStatus  = null;
let _startX          = 0;
let _startY          = 0;
let _ghost           = null;
let _isDragging      = false;
let _didDrag         = false;
let _timerInterval   = null;

// ── Component ─────────────────────────────────────────────────────────────────

export default class ContractorBoard extends LightningElement {

    // ── State ─────────────────────────────────────────────────────────────────
    @track columns           = [];
    @track isLoading         = false;
    @track errorMessage      = null;
    @track selectedProjectId = '';

    // Drag
    @track dragOverStatus    = null;

    // Story detail modal
    @track selectedStory     = null;
    @track activeTab         = 'chat';

    // Chat
    @track chatMessages      = [];
    @track chatInput         = '';
    @track isSavingChat      = false;
    @track mentionResults    = [];
    @track showMentionDropdown = false;
    _mentionQuery            = '';

    // Time
    @track timeEntries       = [];
    @track logHours          = '';
    @track logDesc           = '';
    @track isSavingTime      = false;
    @track timeLoading       = false;

    // Next steps
    @track nextSteps         = [];
    @track nextStepInput     = '';
    @track isSavingStep      = false;

    // Attachments
    @track attachments       = [];
    @track attachLoading     = false;
    @track viewerAttachment  = null;
    @track isDroppingFile    = false;

    // Status
    @track isUpdatingStatus  = false;

    // Close story modal
    @track closeStoryCard     = null;
    @track closeModalStatus   = '';
    @track closingComments    = '';
    @track closeModalPriority = 'Medium';
    @track closeModalType     = '';
    @track closeModalDept     = '';
    @track isClosingStory     = false;
    @track closeErrors        = {};

    // New story modal
    @track isNewStoryModalOpen  = false;
    @track newStorySubject      = '';
    @track newStoryDesc         = '';
    @track newStoryPriority     = 'Medium';
    @track newStoryDept         = '';
    @track isCreatingStory      = false;
    @track newStorySubjectError = false;

    // Description edit
    @track isEditingDescription  = false;
    @track descriptionDraft      = '';
    @track isSavingDescription   = false;

    // Est hours edit
    @track isEditingEstHours  = false;
    @track estHoursDraft      = '';
    @track isSavingEstHours   = false;

    // Text fields edit
    @track isEditingTextFields  = false;
    @track solutionDraft        = '';
    @track componentsDraft      = '';
    @track qaDraft              = '';
    @track docDraft             = '';
    @track isSavingTextFields   = false;
    @track textFieldsSaved      = false;

    // Priority/type updating
    @track isUpdatingPriority = false;
    @track isUpdatingType     = false;

    // Time entry edit
    @track editingTimeId    = null;
    @track timeEditHours    = '';
    @track timeEditDesc     = '';
    @track isSavingTimeEdit = false;

    // Next step edit
    @track editingStepId    = null;
    @track stepEditText     = '';
    @track isSavingStepEdit = false;

    // Attachment delete
    @track isDeletingAttach = null;

    // Contact assignment
    @track showContactSearch  = false;
    @track contactResults     = [];
    @track contactLoading     = false;
    @track isAssigningContact = false;

    // Timer
    _activeTimerId       = null;
    _activeTimerCaseId   = null;
    _activeTimerEpicId   = null;
    _activeTimerSubject  = '';
    _activeTimerStartMs  = 0;
    @track timerElapsedLabel = '';
    @track isTimerOnModal    = false;

    // Timer notification
    @track showTimerNotif     = false;
    @track timerNotifSubject  = '';
    @track timerNotifMinutes  = 0;
    @track timerNotifNotes    = '';
    @track isSavingTimerNotes = false;
    _stoppedTimerId           = null;

    // Misc
    totalCount               = 0;
    @track distBarSegments   = [];
    @track projectPills      = [];
    _allCards                = [];
    _wiredStories;

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    connectedCallback() {
        getActiveTimer()
            .then(result => {
                if (result) {
                    this._restoreTimer(result);
                }
            })
            .catch(() => {});
    }

    disconnectedCallback() {
        if (_timerInterval) {
            clearInterval(_timerInterval);
            _timerInterval = null;
        }
    }

    // ── Wire ──────────────────────────────────────────────────────────────────

    @wire(getProjectsForUser)
    wiredProjects({ data }) {
        if (data) {
            this.projectPills = data.map(p => ({
                id:        p.Id,
                name:      p.Name,
                pillClass: this._pillClass(p.Id),
            }));
        }
    }

    @wire(getStories, { projectId: '$selectedProjectId' })
    wiredStories(result) {
        this._wiredStories = result;
        this.isLoading = false;
        if (result.data) {
            this.errorMessage = null;
            this._buildColumns(result.data);
        } else if (result.error) {
            this.errorMessage = result.error?.body?.message || 'Error loading stories.';
        }
    }

    // ── Timer Helpers ─────────────────────────────────────────────────────────

    _restoreTimer(w) {
        this._activeTimerId      = w.timeId;
        this._activeTimerCaseId  = w.caseId;
        this._activeTimerSubject = w.subject || w.caseNumber || '';
        this._activeTimerStartMs = w.startTimeMs || Date.now();
        this._startTimerTick();
    }

    _startTimerTick() {
        if (_timerInterval) {
            clearInterval(_timerInterval);
        }
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        _timerInterval = setInterval(() => {
            const elapsed = Date.now() - this._activeTimerStartMs;
            const totalSec = Math.floor(elapsed / 1000);
            const h = Math.floor(totalSec / 3600);
            const m = Math.floor((totalSec % 3600) / 60);
            const s = totalSec % 60;
            this.timerElapsedLabel =
                `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        }, 1000);
    }

    // ── Data Helpers ──────────────────────────────────────────────────────────

    _buildColumns(records) {
        const map = {};
        STATUS_COLS.forEach(col => {
            map[col.status] = {
                ...col,
                cards:    [],
                count:    0,
                isEmpty:  true,
                colClass: 'board-col',
                dotStyle: `background:${col.color};width:10px;height:10px;border-radius:50%;flex-shrink:0;`,
            };
        });

        records.forEach(r => {
            const card = this._mapCard(r);
            const col  = map[card.status] || map[STATUS_ALIAS[card.status]];
            if (col) {
                col.cards.push(card);
                col.count++;
                col.isEmpty = false;
            }
        });

        // Apply drag-over class
        STATUS_COLS.forEach(c => {
            if (map[c.status]) {
                map[c.status].colClass = 'board-col' +
                    (this.dragOverStatus === c.status ? ' col-drag-over' : '');
            }
        });

        this.columns    = STATUS_COLS.map(c => map[c.status]);
        this.totalCount = records.length;
        this._allCards  = records;
        this._buildDistBar(map);
    }

    _mapCard(r) {
        const days = Math.floor(
            (Date.now() - new Date(r.createdDate).getTime()) / 86_400_000
        );
        const status   = STATUS_ALIAS[r.status] || r.status || 'Backlog';
        const priority = r.priority || 'Medium';
        const color    = STATUS_COLOR_MAP[status] || '#6b7280';

        return {
            id:                r.id,
            caseNumber:        r.caseNumber,
            subject:           r.subject || '(No subject)',
            description:       this._decodeHtml(r.description || ''),
            status,
            priority,
            priorityClass:     PRIORITY_CLASS_MAP[priority] || 'priority-badge priority-medium',
            storyType:         r.storyType || '',
            estHours:          r.estHours || 0,
            hoursLogged:       r.hoursLogged || 0,
            hoursDisplay:      r.hoursLogged ? `${r.hoursLogged}h logged` : '',
            ownerName:         r.ownerName || '',
            epicName:          r.epicName || '',
            epicId:            r.epicId || null,
            projectName:       r.projectName || '',
            projectId:         r.projectId || null,
            createdDate:       r.createdDate,
            ageDisplay:        days === 0 ? 'Today' : days === 1 ? '1d' : `${days}d`,
            cardClass:         'story-card',
            solution:          this._decodeHtml(r.solution || ''),
            componentsToDeploy: this._decodeHtml(r.componentsToDeploy || ''),
            qa:                this._decodeHtml(r.qa || ''),
            documentation:     this._decodeHtml(r.documentation || ''),
            department:        r.department || '',
            contactId:         r.contactId || null,
            contactName:       r.contactName || '',
            closingComments:   r.closingComments || '',
            statusChipStyle:   `background:${color}22;color:${color};border:1px solid ${color}55;` +
                               `border-radius:20px;padding:2px 10px;font-size:0.72rem;font-weight:700;`,
        };
    }

    _buildDistBar(map) {
        const total = this.totalCount || 1;
        this.distBarSegments = STATUS_COLS
            .filter(c => map[c.status]?.count > 0)
            .map(c => {
                const col = map[c.status];
                const pct = ((col.count / total) * 100).toFixed(1);
                return {
                    status:    c.status,
                    label:     c.label,
                    count:     col.count,
                    style:     `flex:${pct};background:${c.color};min-width:${pct > 0 ? '4px' : '0'};`,
                    dotStyle:  `background:${c.color};width:10px;height:10px;border-radius:50%;flex-shrink:0;display:inline-block;`,
                    textStyle: `color:${c.color};`,
                    tooltip:   `${c.label}: ${col.count} stories (${pct}%)`,
                };
            });
    }

    _updateCardInAllCards(caseId, updates) {
        this._allCards = this._allCards.map(r => {
            if (r.id === caseId) {
                return { ...r, ...updates };
            }
            return r;
        });
    }

    _reloadColumns() {
        this._buildColumns(this._allCards);
    }

    // ── Computed Properties ───────────────────────────────────────────────────

    get hasStories()     { return this.totalCount > 0; }
    get noAttachments()  { return !this.attachLoading && this.attachments.length === 0; }
    get noTimeEntries()  { return !this.timeLoading  && this.timeEntries.length  === 0; }
    get noNextSteps()    { return this.nextSteps.length === 0; }

    get isChatTab()      { return this.activeTab === 'chat'; }
    get isTimeTab()      { return this.activeTab === 'time'; }
    get isStepsTab()     { return this.activeTab === 'nextsteps'; }

    get chatTabClass()   { return `right-tab${this.isChatTab  ? ' active' : ''}`; }
    get timeTabClass()   { return `right-tab${this.isTimeTab  ? ' active' : ''}`; }
    get stepsTabClass()  { return `right-tab${this.isStepsTab ? ' active' : ''}`; }

    get allPillClass() { return this._pillClass(''); }

    _pillClass(id) {
        return `project-pill${this.selectedProjectId === id ? ' active' : ''}`;
    }

    get chatSendLabel()   { return this.isSavingChat  ? 'Sending...' : 'Send'; }
    get logTimeBtnLabel() { return this.isSavingTime  ? 'Saving...'  : 'Log'; }
    get addStepBtnLabel() { return this.isSavingStep  ? 'Saving...'  : 'Add'; }

    get totalHoursDisplay() {
        const totalMins = this.timeEntries.reduce((s, t) => s + (t.Minutes_Logged__c || 0), 0);
        const hrs = +(totalMins / 60).toFixed(2);
        return hrs ? `${hrs}h total` : '';
    }

    get viewerIsImage() {
        return this.viewerAttachment &&
               IMAGE_EXTS.has((this.viewerAttachment.fileExtension || '').toLowerCase());
    }

    get statusOptions() {
        const current = this.selectedStory?.status;
        return STATUS_COLS.map(c => ({
            value:      c.status,
            label:      c.label,
            isSelected: c.status === current,
        }));
    }

    get hasActiveTimer()    { return !!this._activeTimerId; }
    get isTimerOnThisStory() {
        return !!(this.selectedStory && this._activeTimerCaseId === this.selectedStory.id);
    }

    get hasContact() { return !!(this.selectedStory?.contactId); }
    get noContactResults() { return !this.contactLoading && this.contactResults.length === 0; }

    get noTextFields() {
        const s = this.selectedStory;
        if (!s) return true;
        return !s.solution && !s.componentsToDeploy && !s.qa && !s.documentation;
    }

    get typeOptions() {
        return TYPE_OPTIONS.map(t => ({
            value:      t,
            label:      t || '--None--',
            isSelected: t === (this.selectedStory?.storyType || ''),
        }));
    }

    get deptOptions() {
        return DEPT_OPTIONS.map(d => ({
            value:      d,
            label:      d || '--None--',
            isSelected: d === (this.selectedStory?.department || ''),
        }));
    }

    get closeDeptOptions() {
        return DEPT_OPTIONS.map(d => ({
            value:      d,
            label:      d || '--None--',
            isSelected: d === this.closeModalDept,
        }));
    }

    get closeTypeOptions() {
        return TYPE_OPTIONS.map(t => ({
            value:      t,
            label:      t || '--None--',
            isSelected: t === this.closeModalType,
        }));
    }

    get priorityButtons() {
        return ['Critical', 'High', 'Medium', 'Low'].map(p => ({
            label: p,
            value: p,
            cls:   PRIORITY_BTN_CLASS[p] + (p === this.selectedStory?.priority ? ' active' : ''),
        }));
    }

    get closePriorityButtons() {
        return ['Critical', 'High', 'Medium', 'Low'].map(p => ({
            label: p,
            value: p,
            cls:   PRIORITY_BTN_CLASS[p] + (p === this.closeModalPriority ? ' active' : ''),
        }));
    }

    get newStoryPriorityButtons() {
        return ['Critical', 'High', 'Medium', 'Low'].map(p => ({
            label: p,
            value: p,
            cls:   PRIORITY_BTN_CLASS[p] + (p === this.newStoryPriority ? ' active' : ''),
        }));
    }

    get newStorySubjectClass() {
        return 'new-story-input' + (this.newStorySubjectError ? ' input-error' : '');
    }

    get closeModalTitle() {
        return this.closeModalStatus === 'Completed' ? 'Complete Story' : 'Cancel Story';
    }

    get closeSubmitLabel() {
        return this.isClosingStory
            ? 'Saving...'
            : (this.closeModalStatus === 'Completed' ? 'Mark Complete' : 'Cancel Story');
    }

    get isCreatingStoryLabel() {
        return this.isCreatingStory ? 'Creating...' : 'Create Story';
    }

    // ── Filter Handlers ───────────────────────────────────────────────────────

    handlePillClick(evt) {
        this.selectedProjectId = evt.currentTarget.dataset.id;
        this.isLoading = true;
        this.projectPills = this.projectPills.map(p => ({
            ...p,
            pillClass: this._pillClass(p.id),
        }));
    }

    // ── Drag & Drop ───────────────────────────────────────────────────────────

    handleCardPointerDown(evt) {
        // Only primary button
        if (evt.button !== 0) return;

        _dragCardId     = evt.currentTarget.dataset.id;
        _dragFromStatus = evt.currentTarget.dataset.status;
        _startX         = evt.clientX;
        _startY         = evt.clientY;
        _isDragging     = false;
        _didDrag        = false;

        evt.currentTarget.setPointerCapture(evt.pointerId);

        this._boundPointerMove = this._onPointerMove.bind(this, evt.currentTarget);
        this._boundPointerUp   = this._onPointerUp.bind(this, evt.currentTarget);
        evt.currentTarget.addEventListener('pointermove', this._boundPointerMove);
        evt.currentTarget.addEventListener('pointerup',   this._boundPointerUp);
    }

    _onPointerMove(el, evt) {
        const dx = evt.clientX - _startX;
        const dy = evt.clientY - _startY;

        if (!_isDragging && Math.sqrt(dx * dx + dy * dy) > 6) {
            _isDragging = true;
            _didDrag    = true;

            // Create ghost
            _ghost = el.cloneNode(true);
            _ghost.style.position   = 'fixed';
            _ghost.style.width      = el.offsetWidth + 'px';
            _ghost.style.left       = el.getBoundingClientRect().left + 'px';
            _ghost.style.top        = el.getBoundingClientRect().top + 'px';
            _ghost.style.zIndex     = '9999';
            _ghost.style.opacity    = '0.7';
            _ghost.style.transform  = 'rotate(3deg)';
            _ghost.style.boxShadow  = '0 8px 24px rgba(0,0,0,0.2)';
            _ghost.style.pointerEvents = 'none';
            document.body.appendChild(_ghost);
        }

        if (_ghost) {
            _ghost.style.left = (evt.clientX - el.offsetWidth / 2) + 'px';
            _ghost.style.top  = (evt.clientY - 20) + 'px';
        }

        // Determine column under cursor
        const elements = document.elementsFromPoint(evt.clientX, evt.clientY);
        let foundStatus = null;
        for (const el2 of elements) {
            if (el2.dataset && el2.dataset.status && el2.classList.contains('board-col')) {
                foundStatus = el2.dataset.status;
                break;
            }
        }
        if (foundStatus !== this.dragOverStatus) {
            this.dragOverStatus = foundStatus;
            this._refreshColumnClasses();
        }
    }

    _onPointerUp(el, evt) {
        el.removeEventListener('pointermove', this._boundPointerMove);
        el.removeEventListener('pointerup',   this._boundPointerUp);

        if (_ghost) {
            document.body.removeChild(_ghost);
            _ghost = null;
        }

        if (_didDrag) {
            const elements = document.elementsFromPoint(evt.clientX, evt.clientY);
            let targetStatus = null;
            for (const el2 of elements) {
                if (el2.dataset && el2.dataset.status && el2.classList.contains('board-col')) {
                    targetStatus = el2.dataset.status;
                    break;
                }
            }
            this.dragOverStatus = null;
            this._refreshColumnClasses();
            if (targetStatus) {
                this._dropCard(targetStatus);
            }
            _didDrag    = false;
            _isDragging = false;
        } else {
            // Normal click — open modal
            const id   = _dragCardId;
            const card = this._allCards.find(r => r.id === id);
            if (card) {
                this._openModal(card);
            }
        }

        _dragCardId     = null;
        _dragFromStatus = null;
    }

    _refreshColumnClasses() {
        this.columns = this.columns.map(col => ({
            ...col,
            colClass: 'board-col' + (this.dragOverStatus === col.status ? ' col-drag-over' : ''),
        }));
    }

    _dropCard(targetStatus) {
        if (!targetStatus || targetStatus === _dragFromStatus) return;

        const caseId = _dragCardId;
        if (!caseId) return;

        if (CLOSE_STATUSES.has(targetStatus)) {
            const card = this._allCards.find(r => r.id === caseId);
            if (card) {
                this._openCloseModal(this._mapCard(card), targetStatus);
            }
            return;
        }

        updateStoryStatus({ caseId, newStatus: targetStatus })
            .then(() => {
                this._updateCardInAllCards(caseId, { status: targetStatus });
                this._reloadColumns();
            })
            .catch(err => {
                this._toast('Error', err?.body?.message || 'Could not move story.', 'error');
            });
    }

    // ── Card Click / Modal ────────────────────────────────────────────────────

    handleCardClick(evt) {
        // This is only called via click events when not dragging
        const id   = evt.currentTarget.dataset.id;
        const card = this._allCards.find(r => r.id === id);
        if (!card) return;
        this._openModal(card);
    }

    _openModal(card) {
        this.selectedStory     = this._mapCard(card);
        this.activeTab         = 'chat';
        this.chatMessages      = [];
        this.timeEntries       = [];
        this.nextSteps         = [];
        this.attachments       = [];
        this.chatInput         = '';
        this.logHours          = '';
        this.logDesc           = '';
        // Reset edit states
        this.isEditingDescription  = false;
        this.descriptionDraft      = '';
        this.isEditingTextFields   = false;
        this.isEditingEstHours     = false;
        this.showContactSearch     = false;
        this.contactResults        = [];
        this.editingTimeId         = null;
        this.editingStepId         = null;
        this.textFieldsSaved       = false;

        this._loadModalData(card.id);
    }

    _loadModalData(caseId) {
        this.attachLoading = true;
        this.timeLoading   = true;

        getChatMessages({ caseId })
            .then(msgs => {
                this.chatMessages = msgs.map(m => ({
                    ...m,
                    msgClass: `chat-msg${m.isMine ? ' chat-msg-mine' : ''}`,
                }));
                this._scrollChat();
            })
            .catch(() => {});

        getTimeEntries({ caseId })
            .then(entries => {
                this.timeEntries = this._mapTimeEntries(entries);
            })
            .catch(() => {})
            .finally(() => { this.timeLoading = false; });

        getNextSteps({ caseId })
            .then(steps => { this.nextSteps = this._mapNextSteps(steps); })
            .catch(() => {});

        getAttachments({ caseId })
            .then(atts => { this.attachments = atts; })
            .catch(() => {})
            .finally(() => { this.attachLoading = false; });
    }

    handleCloseModal() {
        this.selectedStory    = null;
        this.viewerAttachment = null;
    }

    handleStatusChange(evt) {
        const newStatus = evt.target.value;
        if (!newStatus || !this.selectedStory || newStatus === this.selectedStory.status) return;

        if (CLOSE_STATUSES.has(newStatus)) {
            this._openCloseModal(this.selectedStory, newStatus);
            return;
        }

        this.isUpdatingStatus = true;
        const caseId = this.selectedStory.id;
        updateStoryStatus({ caseId, newStatus })
            .then(() => {
                this._updateCardInAllCards(caseId, { status: newStatus });
                this._reloadColumns();
                const color = STATUS_COLOR_MAP[newStatus] || '#6b7280';
                this.selectedStory = {
                    ...this.selectedStory,
                    status: newStatus,
                    statusChipStyle: `background:${color}22;color:${color};border:1px solid ${color}55;` +
                                     `border-radius:20px;padding:2px 10px;font-size:0.72rem;font-weight:700;`,
                };
            })
            .catch(err => {
                this._toast('Error', err?.body?.message || 'Could not update status.', 'error');
            })
            .finally(() => { this.isUpdatingStatus = false; });
    }

    handleBackdropClick() { this.handleCloseModal(); }

    stopPropagation(evt) { evt.stopPropagation(); }

    // ── Tabs ──────────────────────────────────────────────────────────────────

    handleTabChange(evt) {
        this.activeTab = evt.currentTarget.dataset.tab;
        if (this.activeTab === 'chat') {
            this._scrollChat();
        }
    }

    // ── Priority editing ──────────────────────────────────────────────────────

    handlePriorityClick(evt) {
        const priority = evt.currentTarget.dataset.priority;
        if (!priority || !this.selectedStory) return;
        this.isUpdatingPriority = true;
        const caseId = this.selectedStory.id;
        updatePriority({ caseId, priority })
            .then(() => {
                this.selectedStory = {
                    ...this.selectedStory,
                    priority,
                    priorityClass: PRIORITY_CLASS_MAP[priority] || 'priority-badge priority-medium',
                };
                this._updateCardInAllCards(caseId, { priority });
                this._reloadColumns();
            })
            .catch(err => {
                this._toast('Error', err?.body?.message || 'Could not update priority.', 'error');
            })
            .finally(() => { this.isUpdatingPriority = false; });
    }

    // ── Type editing ──────────────────────────────────────────────────────────

    handleTypeChange(evt) {
        const type = evt.target.value;
        if (!this.selectedStory) return;
        this.isUpdatingType = true;
        const caseId = this.selectedStory.id;
        updateStoryType({ caseId, type })
            .then(() => {
                this.selectedStory = { ...this.selectedStory, storyType: type };
                this._updateCardInAllCards(caseId, { storyType: type });
                this._reloadColumns();
            })
            .catch(err => {
                this._toast('Error', err?.body?.message || 'Could not update type.', 'error');
            })
            .finally(() => { this.isUpdatingType = false; });
    }

    // ── Estimated hours ───────────────────────────────────────────────────────

    handleEditEstHours() {
        this.isEditingEstHours = true;
        this.estHoursDraft     = this.selectedStory?.estHours || '';
    }

    handleEstHoursDraft(evt) { this.estHoursDraft = evt.target.value; }

    handleSaveEstHours() {
        const hours = parseFloat(this.estHoursDraft);
        if (isNaN(hours) || hours < 0) {
            this._toast('Error', 'Please enter a valid number of hours.', 'error');
            return;
        }
        this.isSavingEstHours = true;
        const caseId = this.selectedStory.id;
        updateEstimatedHours({ caseId, hours })
            .then(() => {
                this.selectedStory = { ...this.selectedStory, estHours: hours };
                this._updateCardInAllCards(caseId, { estHours: hours });
                this.isEditingEstHours = false;
            })
            .catch(err => {
                this._toast('Error', err?.body?.message || 'Could not update hours.', 'error');
            })
            .finally(() => { this.isSavingEstHours = false; });
    }

    handleCancelEstHours() { this.isEditingEstHours = false; }

    // ── Description editing ───────────────────────────────────────────────────

    handleEditDescription() {
        this.isEditingDescription = true;
        this.descriptionDraft     = this.selectedStory?.description || '';
    }

    handleDescDraft(evt) { this.descriptionDraft = evt.target.value; }

    handleSaveDescription() {
        this.isSavingDescription = true;
        const caseId      = this.selectedStory.id;
        const description = this.descriptionDraft;
        updateStoryDescription({ caseId, description })
            .then(() => {
                this.selectedStory = { ...this.selectedStory, description };
                this._updateCardInAllCards(caseId, { description });
                this.isEditingDescription = false;
            })
            .catch(err => {
                this._toast('Error', err?.body?.message || 'Could not update description.', 'error');
            })
            .finally(() => { this.isSavingDescription = false; });
    }

    handleCancelDescription() { this.isEditingDescription = false; }

    // ── Text fields ───────────────────────────────────────────────────────────

    handleEditTextFields() {
        this.isEditingTextFields = true;
        this.solutionDraft       = this.selectedStory?.solution || '';
        this.componentsDraft     = this.selectedStory?.componentsToDeploy || '';
        this.qaDraft             = this.selectedStory?.qa || '';
        this.docDraft            = this.selectedStory?.documentation || '';
    }

    handleSolutionDraft(evt)    { this.solutionDraft    = evt.target.value; }
    handleComponentsDraft(evt)  { this.componentsDraft  = evt.target.value; }
    handleQaDraft(evt)          { this.qaDraft          = evt.target.value; }
    handleDocDraft(evt)         { this.docDraft         = evt.target.value; }

    handleSaveTextFields() {
        this.isSavingTextFields = true;
        const caseId            = this.selectedStory.id;
        const solution          = this.solutionDraft;
        const componentsToDeploy = this.componentsDraft;
        const qa                = this.qaDraft;
        const documentation     = this.docDraft;
        updateStoryTextFields({ caseId, solution, componentsToDeploy, qa, documentation })
            .then(() => {
                this.selectedStory = {
                    ...this.selectedStory,
                    solution,
                    componentsToDeploy,
                    qa,
                    documentation,
                };
                this._updateCardInAllCards(caseId, { solution, componentsToDeploy, qa, documentation });
                this.isEditingTextFields = false;
                this.textFieldsSaved     = true;
                // eslint-disable-next-line @lwc/lwc/no-async-operation
                setTimeout(() => { this.textFieldsSaved = false; }, 2000);
            })
            .catch(err => {
                this._toast('Error', err?.body?.message || 'Could not save work notes.', 'error');
            })
            .finally(() => { this.isSavingTextFields = false; });
    }

    handleCancelTextFields() { this.isEditingTextFields = false; }

    // ── Close Story Modal ─────────────────────────────────────────────────────

    _openCloseModal(card, status) {
        this.closeStoryCard     = card;
        this.closeModalStatus   = status;
        this.closingComments    = '';
        this.closeModalPriority = card.priority || 'Medium';
        this.closeModalType     = card.storyType || '';
        this.closeModalDept     = card.department || '';
        this.closeErrors        = {};
    }

    handleCloseModalDismiss() {
        this.closeStoryCard = null;
    }

    handleClosingCommentsInput(evt) { this.closingComments  = evt.target.value; }
    handleCloseModalDeptChange(evt) { this.closeModalDept   = evt.target.value; }
    handleCloseModalTypeChange(evt) { this.closeModalType   = evt.target.value; }

    handleCloseModalPriorityClick(evt) {
        this.closeModalPriority = evt.currentTarget.dataset.priority;
    }

    handleSubmitCloseStory() {
        const errors = {};
        if (!this.closingComments?.trim())  errors.comments = true;
        if (!this.closeModalDept)           errors.dept     = true;
        if (!this.closeModalPriority)       errors.priority = true;
        if (!this.closeModalType)           errors.type     = true;
        this.closeErrors = errors;
        if (Object.keys(errors).length > 0) return;

        this.isClosingStory = true;
        const caseId          = this.closeStoryCard.id;
        const newStatus       = this.closeModalStatus;
        const closingComments = this.closingComments;
        const department      = this.closeModalDept;
        const priority        = this.closeModalPriority;
        const type            = this.closeModalType;

        closeStory({ caseId, newStatus, closingComments, department, priority, type })
            .then(() => {
                this._updateCardInAllCards(caseId, {
                    status: newStatus,
                    closingComments,
                    department,
                    priority,
                    storyType: type,
                });
                this._reloadColumns();
                if (this.selectedStory && this.selectedStory.id === caseId) {
                    const color = STATUS_COLOR_MAP[newStatus] || '#6b7280';
                    this.selectedStory = {
                        ...this.selectedStory,
                        status:          newStatus,
                        closingComments,
                        department,
                        priority,
                        storyType:       type,
                        priorityClass:   PRIORITY_CLASS_MAP[priority] || 'priority-badge priority-medium',
                        statusChipStyle: `background:${color}22;color:${color};border:1px solid ${color}55;` +
                                         `border-radius:20px;padding:2px 10px;font-size:0.72rem;font-weight:700;`,
                    };
                }
                this.closeStoryCard = null;
                this._toast('Success', `Story marked as ${newStatus}.`, 'success');
            })
            .catch(err => {
                this._toast('Error', err?.body?.message || 'Could not close story.', 'error');
            })
            .finally(() => { this.isClosingStory = false; });
    }

    // ── New Story Modal ───────────────────────────────────────────────────────

    handleNewStoryClick() {
        if (!this.selectedProjectId) {
            this._toast('Info', 'Select a project first.', 'info');
            return;
        }
        this.isNewStoryModalOpen  = true;
        this.newStorySubject      = '';
        this.newStoryDesc         = '';
        this.newStoryPriority     = 'Medium';
        this.newStoryDept         = '';
        this.newStorySubjectError = false;
    }

    handleCloseNewStoryModal() { this.isNewStoryModalOpen = false; }

    handleNewStorySubjectInput(evt) {
        this.newStorySubject      = evt.target.value;
        this.newStorySubjectError = false;
    }

    handleNewStoryDescInput(evt)     { this.newStoryDesc     = evt.target.value; }

    handleNewStoryPriorityClick(evt) {
        this.newStoryPriority = evt.currentTarget.dataset.priority;
    }

    handleCreateStory() {
        if (!this.newStorySubject?.trim()) {
            this.newStorySubjectError = true;
            return;
        }
        this.isCreatingStory = true;
        createStory({
            subject:     this.newStorySubject.trim(),
            description: this.newStoryDesc,
            priority:    this.newStoryPriority,
            projectId:   this.selectedProjectId,
            storyType:   '',
        })
            .then(() => {
                this.isNewStoryModalOpen = false;
                this._toast('Success', 'Story created.', 'success');
                this.isLoading = true;
                return refreshApex(this._wiredStories);
            })
            .then(() => { this.isLoading = false; })
            .catch(err => {
                this._toast('Error', err?.body?.message || 'Could not create story.', 'error');
            })
            .finally(() => { this.isCreatingStory = false; });
    }

    // ── Chat ──────────────────────────────────────────────────────────────────

    handleChatInput(evt) {
        this.chatInput = evt.target.value;
        this._handleMentionDetect();
    }

    handleChatKeydown(evt) {
        if (evt.key === 'Enter' && !evt.shiftKey) {
            evt.preventDefault();
            if (this.showMentionDropdown) return;
            this.handlePostChat();
        }
    }

    _handleMentionDetect() {
        const val    = this.chatInput;
        const cursor = val.length;
        const atIdx  = val.lastIndexOf('@', cursor - 1);
        if (atIdx === -1) {
            this.showMentionDropdown = false;
            return;
        }
        const query = val.substring(atIdx + 1, cursor);
        if (query.includes(' ') && query.length > 20) {
            this.showMentionDropdown = false;
            return;
        }
        this._mentionQuery = query;
        searchUsers({ searchTerm: query })
            .then(users => {
                this.mentionResults      = users.map(u => ({ id: u.id, name: u.name }));
                this.showMentionDropdown = this.mentionResults.length > 0;
            })
            .catch(() => { this.showMentionDropdown = false; });
    }

    handleMentionSelect(evt) {
        const name  = evt.currentTarget.dataset.name;
        const val   = this.chatInput;
        const atIdx = val.lastIndexOf('@');
        this.chatInput           = val.substring(0, atIdx) + `@${name} `;
        this.showMentionDropdown = false;
        this.mentionResults      = [];
        this.template.querySelector('.chat-input-textarea')?.focus();
    }

    handlePostChat() {
        const msg = (this.chatInput || '').trim();
        if (!msg || !this.selectedStory) return;

        this.isSavingChat = true;
        postChatMessage({ caseId: this.selectedStory.id, message: msg })
            .then(() => {
                this.chatInput = '';
                const ta = this.template.querySelector('.chat-input-textarea');
                if (ta) ta.value = '';
                return getChatMessages({ caseId: this.selectedStory.id });
            })
            .then(msgs => {
                this.chatMessages = msgs.map(m => ({
                    ...m,
                    msgClass: `chat-msg${m.isMine ? ' chat-msg-mine' : ''}`,
                }));
                this._scrollChat();
            })
            .catch(err => {
                this._toast('Error', err?.body?.message || 'Could not send message.', 'error');
            })
            .finally(() => { this.isSavingChat = false; });
    }

    _scrollChat() {
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        setTimeout(() => {
            const el = this.template.querySelector('.chat-messages[data-id="chatMessages"]');
            if (el) el.scrollTop = el.scrollHeight;
        }, 50);
    }

    // ── Time ──────────────────────────────────────────────────────────────────

    handleLogHoursInput(evt) { this.logHours = evt.target.value; }
    handleLogDescInput(evt)  { this.logDesc  = evt.target.value; }

    handleLogTimeKeydown(evt) {
        if (evt.key === 'Enter') this.handleLogTime();
    }

    handleLogTime() {
        const hours = parseFloat(this.logHours);
        if (!hours || hours <= 0 || !this.selectedStory) return;

        this.isSavingTime = true;
        logTime({ caseId: this.selectedStory.id, hours, description: this.logDesc || '' })
            .then(() => {
                this.logHours = '';
                this.logDesc  = '';
                const hoursEl = this.template.querySelector('.log-time-hours');
                const descEl  = this.template.querySelector('.log-time-desc');
                if (hoursEl) hoursEl.value = '';
                if (descEl)  descEl.value  = '';
                return getTimeEntries({ caseId: this.selectedStory.id });
            })
            .then(entries => {
                this.timeEntries = this._mapTimeEntries(entries);
                this._toast('Success', 'Time logged.', 'success');
            })
            .catch(err => {
                this._toast('Error', err?.body?.message || 'Could not log time.', 'error');
            })
            .finally(() => { this.isSavingTime = false; });
    }

    // ── Time Entry Edit ───────────────────────────────────────────────────────

    handleEditTimeEntry(evt) {
        const id = evt.currentTarget.dataset.id;
        const te = this.timeEntries.find(t => t.Id === id);
        if (!te) return;
        this.editingTimeId  = id;
        this.timeEditHours  = +(( te.Minutes_Logged__c || 0) / 60).toFixed(2);
        this.timeEditDesc   = te.Additional_Comments__c || '';
        // Refresh isEditing flags
        this.timeEntries = this._mapTimeEntries(this.timeEntries);
    }

    handleTimeEditHoursInput(evt) { this.timeEditHours = evt.target.value; }
    handleTimeEditDescInput(evt)  { this.timeEditDesc  = evt.target.value; }

    handleSaveTimeEdit() {
        const hours       = parseFloat(this.timeEditHours);
        const timeId      = this.editingTimeId;
        const description = this.timeEditDesc;
        if (isNaN(hours) || hours < 0 || !timeId) return;
        this.isSavingTimeEdit = true;
        updateTimeEntry({ timeId, hours, description })
            .then(() => {
                this.editingTimeId = null;
                return getTimeEntries({ caseId: this.selectedStory.id });
            })
            .then(entries => {
                this.timeEntries = this._mapTimeEntries(entries);
            })
            .catch(err => {
                this._toast('Error', err?.body?.message || 'Could not update time entry.', 'error');
            })
            .finally(() => { this.isSavingTimeEdit = false; });
    }

    handleCancelTimeEdit() {
        this.editingTimeId = null;
        this.timeEntries   = this._mapTimeEntries(this.timeEntries);
    }

    // ── Next Steps ────────────────────────────────────────────────────────────

    handleNextStepInput(evt) { this.nextStepInput = evt.target.value; }

    handleAddNextStep() {
        const text = (this.nextStepInput || '').trim();
        if (!text || !this.selectedStory) return;

        this.isSavingStep = true;
        addNextStep({ caseId: this.selectedStory.id, text })
            .then(() => {
                this.nextStepInput = '';
                const ta = this.template.querySelectorAll('.chat-input-textarea')[1];
                if (ta) ta.value = '';
                return getNextSteps({ caseId: this.selectedStory.id });
            })
            .then(steps => { this.nextSteps = this._mapNextSteps(steps); })
            .catch(err => {
                this._toast('Error', err?.body?.message || 'Could not add step.', 'error');
            })
            .finally(() => { this.isSavingStep = false; });
    }

    // ── Next Step Edit ────────────────────────────────────────────────────────

    handleEditNextStep(evt) {
        const id   = evt.currentTarget.dataset.id;
        const step = this.nextSteps.find(s => s.Id === id);
        if (!step) return;
        this.editingStepId = id;
        this.stepEditText  = step.CommentBody || '';
        this.nextSteps     = this._mapNextSteps(this.nextSteps);
    }

    handleStepEditInput(evt) { this.stepEditText = evt.target.value; }

    handleSaveStepEdit() {
        const commentId = this.editingStepId;
        const note      = this.stepEditText;
        if (!commentId) return;
        this.isSavingStepEdit = true;
        updateNextStep({ commentId, note })
            .then(() => {
                this.editingStepId = null;
                return getNextSteps({ caseId: this.selectedStory.id });
            })
            .then(steps => {
                this.nextSteps = this._mapNextSteps(steps);
            })
            .catch(err => {
                this._toast('Error', err?.body?.message || 'Could not update step.', 'error');
            })
            .finally(() => { this.isSavingStepEdit = false; });
    }

    handleCancelStepEdit() {
        this.editingStepId = null;
        this.nextSteps     = this._mapNextSteps(this.nextSteps);
    }

    // ── Attachments ───────────────────────────────────────────────────────────

    handleAttachClick() {
        this.template.querySelector('[data-id="fileInput"]')?.click();
    }

    handleFileSelected(evt) {
        const files = [...evt.target.files];
        if (!files.length || !this.selectedStory) return;

        const uploads = files.map(file => this._uploadOne(file));
        Promise.all(uploads)
            .then(() => getAttachments({ caseId: this.selectedStory.id }))
            .then(atts => { this.attachments = atts; })
            .catch(err => {
                this._toast('Error', err?.body?.message || 'Upload failed.', 'error');
            });
    }

    _uploadOne(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const base64 = reader.result.split(',')[1];
                uploadAttachment({
                    caseId:      this.selectedStory.id,
                    fileName:    file.name,
                    base64Data:  base64,
                    contentType: file.type,
                })
                    .then(resolve)
                    .catch(reject);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    handleDeleteAttachment(evt) {
        if (this.isDeletingAttach) return;
        const contentDocumentId = evt.currentTarget.dataset.id;
        this.isDeletingAttach   = contentDocumentId;
        deleteAttachment({ contentDocumentId })
            .then(() => {
                this.attachments = this.attachments.filter(
                    a => a.contentDocumentId !== contentDocumentId
                );
            })
            .catch(err => {
                this._toast('Error', err?.body?.message || 'Could not delete file.', 'error');
            })
            .finally(() => { this.isDeletingAttach = null; });
    }

    handleViewAttachment(evt) {
        this.viewerAttachment = {
            contentDocumentId: evt.currentTarget.dataset.id,
            downloadUrl:       evt.currentTarget.dataset.url,
            fileExtension:     evt.currentTarget.dataset.ext,
            title:             evt.currentTarget.dataset.title,
        };
    }

    handleCloseViewer() { this.viewerAttachment = null; }

    // ── Contact Assignment ────────────────────────────────────────────────────

    handleAssignContactClick() {
        if (this.showContactSearch) {
            this.showContactSearch = false;
            return;
        }
        const projectId = this.selectedStory?.projectId;
        if (!projectId) {
            this._toast('Info', 'This story is not assigned to a project.', 'info');
            return;
        }
        this.contactLoading    = true;
        this.showContactSearch = true;
        this.contactResults    = [];
        getContactsForProject({ projectId })
            .then(contacts => {
                this.contactResults = contacts;
            })
            .catch(() => {
                this.contactResults = [];
            })
            .finally(() => { this.contactLoading = false; });
    }

    handleContactResultSelect(evt) {
        const contactId   = evt.currentTarget.dataset.id;
        const contactName = evt.currentTarget.dataset.name;
        const caseId      = this.selectedStory.id;
        this.isAssigningContact = true;
        assignContact({ caseId, contactId })
            .then(() => {
                this.selectedStory = { ...this.selectedStory, contactId, contactName };
                this._updateCardInAllCards(caseId, { contactId });
                this.showContactSearch = false;
            })
            .catch(err => {
                this._toast('Error', err?.body?.message || 'Could not assign contact.', 'error');
            })
            .finally(() => { this.isAssigningContact = false; });
    }

    handleRemoveContact() {
        const caseId = this.selectedStory.id;
        assignContact({ caseId, contactId: null })
            .then(() => {
                this.selectedStory = { ...this.selectedStory, contactId: null, contactName: '' };
                this._updateCardInAllCards(caseId, { contactId: null });
            })
            .catch(err => {
                this._toast('Error', err?.body?.message || 'Could not remove contact.', 'error');
            });
    }

    handleContactSearchCancel() {
        this.showContactSearch = false;
    }

    // ── Timer ─────────────────────────────────────────────────────────────────

    handleStartTimer() {
        if (!this.selectedStory) return;
        const caseId = this.selectedStory.id;
        startTimer({ caseId })
            .then(result => {
                if (result.stoppedTimeId) {
                    this._toast('Info',
                        `Previous timer for "${result.stoppedSubject}" saved (${Math.round(result.stoppedMinutes)} min).`,
                        'info');
                }
                if (_timerInterval) {
                    clearInterval(_timerInterval);
                    _timerInterval = null;
                }
                this._activeTimerId      = result.newTimeId;
                this._activeTimerCaseId  = caseId;
                this._activeTimerEpicId  = this.selectedStory.epicId;
                this._activeTimerSubject = this.selectedStory.subject;
                this._activeTimerStartMs = result.startTimeMs;
                this._startTimerTick();
            })
            .catch(err => {
                this._toast('Error', err?.body?.message || 'Could not start timer.', 'error');
            });
    }

    handleStopTimer() {
        const timeId  = this._activeTimerId;
        const subject = this._activeTimerSubject;
        const startMs = this._activeTimerStartMs;
        if (!timeId) return;
        stopTimer({ timeId, notes: '' })
            .then(() => {
                if (_timerInterval) {
                    clearInterval(_timerInterval);
                    _timerInterval = null;
                }
                this.showTimerNotif     = true;
                this.timerNotifSubject  = subject;
                this._stoppedTimerId    = timeId;
                this.timerNotifMinutes  = Math.round((Date.now() - startMs) / 60000);
                this.timerNotifNotes    = '';
                this._activeTimerId     = null;
                this._activeTimerCaseId = null;
                this.timerElapsedLabel  = '';
            })
            .catch(err => {
                this._toast('Error', err?.body?.message || 'Could not stop timer.', 'error');
            });
    }

    handleTimerNotifNotesInput(evt) { this.timerNotifNotes = evt.target.value; }

    handleTimerNotifSave() {
        const notes = (this.timerNotifNotes || '').trim();
        if (!notes) {
            this.handleTimerNotifDismiss();
            return;
        }
        this.isSavingTimerNotes = true;
        updateTimeEntry({ timeId: this._stoppedTimerId, hours: null, description: notes })
            .then(() => {
                this.handleTimerNotifDismiss();
            })
            .catch(err => {
                this._toast('Error', err?.body?.message || 'Could not save notes.', 'error');
            })
            .finally(() => { this.isSavingTimerNotes = false; });
    }

    handleTimerNotifDismiss() {
        this.showTimerNotif    = false;
        this.timerNotifNotes   = '';
        this._stoppedTimerId   = null;
    }

    // ── Data Mappers ──────────────────────────────────────────────────────────

    _mapTimeEntries(entries) {
        return entries.map(t => ({
            ...t,
            hoursDisplay: `${+(( t.Minutes_Logged__c || 0) / 60).toFixed(2)}h`,
            ownerName:    t.CreatedBy?.Name || '',
            dateDisplay:  t.Logged_Date__c
                ? new Date(t.Logged_Date__c).toLocaleDateString()
                : '',
            isEditing:    t.Id === this.editingTimeId,
        }));
    }

    _mapNextSteps(steps) {
        return steps.map(s => ({
            ...s,
            authorName:  s.CreatedBy?.Name || '',
            dateDisplay: s.CreatedDate
                ? new Date(s.CreatedDate).toLocaleDateString()
                : '',
            isEditing:   s.Id === this.editingStepId,
        }));
    }

    // ── Utilities ─────────────────────────────────────────────────────────────

    _decodeHtml(str) {
        if (!str) return '';
        return str
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&#x27;/g, "'")
            .replace(/&apos;/g, "'")
            .replace(/&nbsp;/g, ' ');
    }

    _toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}
