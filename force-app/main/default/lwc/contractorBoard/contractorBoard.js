// force-app/main/default/lwc/contractorBoard/contractorBoard.js
import { LightningElement, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex }   from '@salesforce/apex';
import getProjects        from '@salesforce/apex/ContractorBoardController.getProjects';
import getStories         from '@salesforce/apex/ContractorBoardController.getStories';
import getTimeEntries     from '@salesforce/apex/ContractorBoardController.getTimeEntries';
import getNextSteps       from '@salesforce/apex/ContractorBoardController.getNextSteps';
import getChatMessages    from '@salesforce/apex/ContractorBoardController.getChatMessages';
import getAttachments     from '@salesforce/apex/ContractorBoardController.getAttachments';
import searchUsers        from '@salesforce/apex/ContractorBoardController.searchUsers';
import postChatMessage    from '@salesforce/apex/ContractorBoardController.postChatMessage';
import logTime            from '@salesforce/apex/ContractorBoardController.logTime';
import addNextStep        from '@salesforce/apex/ContractorBoardController.addNextStep';
import createStory        from '@salesforce/apex/ContractorBoardController.createStory';
import uploadAttachment   from '@salesforce/apex/ContractorBoardController.uploadAttachment';

// ── Constants ──────────────────────────────────────────────────────────────────

const STATUS_COLS = [
    { status: 'Backlog',     label: 'Backlog',      color: '#6b7280' },
    { status: 'Blocked',     label: 'Blocked',      color: '#ef4444' },
    { status: 'New',         label: 'New',          color: '#3b82f6' },
    { status: 'In Progress', label: 'In Progress',  color: '#f59e0b' },
    { status: 'In QA',       label: 'In QA',        color: '#8b5cf6' },
    { status: 'Closed',      label: 'Closed',       color: '#10b981' },
];

const STATUS_COLOR_MAP = {};
STATUS_COLS.forEach(c => { STATUS_COLOR_MAP[c.status] = c.color; });

const PRIORITY_CLASS_MAP = {
    Low:      'priority-badge priority-low',
    Medium:   'priority-badge priority-medium',
    High:     'priority-badge priority-high',
    Critical: 'priority-badge priority-critical',
};

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg']);

// ── Component ─────────────────────────────────────────────────────────────────

export default class ContractorBoard extends LightningElement {

    // ── State ─────────────────────────────────────────────────────────────────
    @track columns          = [];
    @track isLoading        = false;
    @track errorMessage     = null;
    @track selectedProjectId = '';
    @track showMineOnly     = false;

    // Story detail modal
    @track selectedStory    = null;
    @track activeTab        = 'chat';   // 'chat' | 'time' | 'nextsteps'

    // Chat
    @track chatMessages     = [];
    @track chatInput        = '';
    @track isSavingChat     = false;
    @track mentionResults   = [];
    @track showMentionDropdown = false;
    _mentionQuery           = '';

    // Time
    @track timeEntries      = [];
    @track logHours         = '';
    @track logDesc          = '';
    @track isSavingTime     = false;
    @track timeLoading      = false;

    // Next steps
    @track nextSteps        = [];
    @track nextStepInput    = '';
    @track isSavingStep     = false;

    // Attachments
    @track attachments      = [];
    @track attachLoading    = false;
    @track viewerAttachment = null;

    // New story modal
    @track showNewStoryModal = false;
    @track newSubject        = '';
    @track newDescription    = '';
    @track newPriority       = 'Medium';
    @track newType           = '';
    @track isCreatingStory   = false;
    @track subjectError      = false;
    @track newStoryError     = null;

    // Misc
    totalCount               = 0;
    @track distBarSegments   = [];
    projectOptions           = [{ label: 'All Projects', value: '' }];
    _allCards                = [];
    _wiredStories;

    typeOptions = [
        { label: '— None —',     value: '' },
        { label: 'Feature',      value: 'Feature' },
        { label: 'Bug',          value: 'Bug' },
        { label: 'Support',      value: 'Support' },
        { label: 'Enhancement',  value: 'Enhancement' },
        { label: 'Task',         value: 'Task' },
    ];

    // ── Wire ──────────────────────────────────────────────────────────────────

    @wire(getProjects)
    wiredProjects({ data }) {
        if (data) {
            this.projectOptions = [
                { label: 'All Projects', value: '' },
                ...data.map(p => ({ label: p.Name, value: p.Id })),
            ];
        }
    }

    @wire(getStories, { projectId: '$selectedProjectId', mineOnly: '$showMineOnly' })
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

    // ── Data Helpers ──────────────────────────────────────────────────────────

    _buildColumns(records) {
        const map = {};
        STATUS_COLS.forEach(col => {
            map[col.status] = {
                ...col,
                cards:    [],
                count:    0,
                isEmpty:  true,
                dotStyle: `background:${col.color};width:10px;height:10px;border-radius:50%;flex-shrink:0;`,
            };
        });

        records.forEach(r => {
            const card = this._mapCard(r);
            if (map[card.status]) {
                map[card.status].cards.push(card);
                map[card.status].count++;
                map[card.status].isEmpty = false;
            }
        });

        this.columns    = STATUS_COLS.map(c => map[c.status]);
        this.totalCount = records.length;
        this._allCards  = records;
        this._buildDistBar(map);
    }

    _mapCard(r) {
        const days = Math.floor(
            (Date.now() - new Date(r.CreatedDate).getTime()) / 86_400_000
        );
        const status   = r.Status || 'Backlog';
        const priority = r.Priority || 'Medium';
        const color    = STATUS_COLOR_MAP[status] || '#6b7280';

        return {
            id:          r.Id,
            caseNumber:  r.CaseNumber,
            subject:     r.Subject || '(No subject)',
            description: r.Description || '',
            status,
            priority,
            priorityClass:    PRIORITY_CLASS_MAP[priority] || 'priority-badge priority-medium',
            storyType:        r.Story_Type__c || r.Type || '',
            estHours:         r.Hours_Estimate_to_Complete__c || 0,
            hoursLogged:      r.Actual_Hours_to_Complete__c || 0,
            hoursDisplay:     r.Actual_Hours_to_Complete__c ? `${r.Actual_Hours_to_Complete__c}h logged` : '',
            ownerName:        r.Owner?.Name || '',
            epicName:         r.Epic__r?.Name || '',
            projectName:      r.Projects__r?.Name || '',
            createdDate:      r.CreatedDate,
            ageDisplay:       days === 0 ? 'Today' : days === 1 ? '1d' : `${days}d`,
            cardClass:        'story-card',
            // Modal display helpers
            statusChipStyle:  `background:${color}22;color:${color};border:1px solid ${color}55;` +
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

    get allBtnClass()    { return `toggle-btn${!this.showMineOnly ? ' active' : ''}`; }
    get mineBtnClass()   { return `toggle-btn${this.showMineOnly  ? ' active' : ''}`; }

    get chatSendLabel()  { return this.isSavingChat  ? 'Sending...' : 'Send'; }
    get logTimeBtnLabel(){ return this.isSavingTime  ? 'Saving...'  : 'Log'; }
    get addStepBtnLabel(){ return this.isSavingStep  ? 'Saving...'  : 'Add'; }
    get createStoryBtnLabel() { return this.isCreatingStory ? 'Submitting...' : 'Submit Story'; }

    get totalHoursDisplay() {
        const totalMins = this.timeEntries.reduce((s, t) => s + (t.Minutes_Logged__c || 0), 0);
        const hrs = +(totalMins / 60).toFixed(2);
        return hrs ? `${hrs}h total` : '';
    }

    get selectedProjectLabel() {
        const opt = this.projectOptions.find(o => o.value === this.selectedProjectId);
        return (opt && opt.value) ? opt.label : '';
    }

    get newSubjectClass() {
        return `new-story-input${this.subjectError ? ' input-error' : ''}`;
    }

    get newPriorityLowClass()      { return this._prioClass('Low'); }
    get newPriorityMediumClass()   { return this._prioClass('Medium'); }
    get newPriorityHighClass()     { return this._prioClass('High'); }
    get newPriorityCriticalClass() { return this._prioClass('Critical'); }

    _prioClass(p) {
        const sel = this.newPriority === p ? ' selected' : '';
        const map = { Low: 'low', Medium: 'medium', High: 'high', Critical: 'critical' };
        return `priority-btn priority-${map[p]}${sel}`;
    }

    get viewerIsImage() {
        return this.viewerAttachment &&
               IMAGE_EXTS.has((this.viewerAttachment.fileExtension || '').toLowerCase());
    }

    // ── Filter Handlers ───────────────────────────────────────────────────────

    handleProjectChange(evt) {
        this.selectedProjectId = evt.detail.value;
        this.isLoading = true;
    }

    handleShowAll()  { this.showMineOnly = false; }
    handleShowMine() { this.showMineOnly = true; }

    // ── Card Click / Modal ────────────────────────────────────────────────────

    handleCardClick(evt) {
        const id   = evt.currentTarget.dataset.id;
        const card = this._allCards.find(r => r.Id === id);
        if (!card) return;

        this.selectedStory  = this._mapCard(card);
        this.activeTab      = 'chat';
        this.chatMessages   = [];
        this.timeEntries    = [];
        this.nextSteps      = [];
        this.attachments    = [];
        this.chatInput      = '';
        this.logHours       = '';
        this.logDesc        = '';

        this._loadModalData(id);
    }

    _loadModalData(caseId) {
        this.attachLoading = true;
        this.timeLoading   = true;

        // Load all panels in parallel
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
        this.selectedStory  = null;
        this.viewerAttachment = null;
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
        if (query.length >= 1) {
            searchUsers({ searchTerm: query })
                .then(users => {
                    this.mentionResults      = users.map(u => ({ id: u.id, name: u.name }));
                    this.showMentionDropdown = this.mentionResults.length > 0;
                })
                .catch(() => { this.showMentionDropdown = false; });
        } else {
            this.showMentionDropdown = false;
        }
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

    handleViewAttachment(evt) {
        this.viewerAttachment = {
            contentDocumentId: evt.currentTarget.dataset.id,
            downloadUrl:       evt.currentTarget.dataset.url,
            fileExtension:     evt.currentTarget.dataset.ext,
            title:             evt.currentTarget.dataset.title,
        };
    }

    handleCloseViewer() { this.viewerAttachment = null; }

    // ── New Story ─────────────────────────────────────────────────────────────

    handleSubmitStoryClick() {
        this.newSubject       = '';
        this.newDescription   = '';
        this.newPriority      = 'Medium';
        this.newType          = '';
        this.subjectError     = false;
        this.newStoryError    = null;
        this.showNewStoryModal = true;
    }

    handleCloseNewStory()       { this.showNewStoryModal = false; }
    handleNewStoryBackdrop()    { this.showNewStoryModal = false; }

    handleNewSubjectInput(evt)  { this.newSubject     = evt.target.value; this.subjectError = false; }
    handleNewDescInput(evt)     { this.newDescription = evt.target.value; }

    handleNewPrioritySelect(evt) {
        this.newPriority = evt.currentTarget.dataset.priority;
    }

    handleNewTypeChange(evt) { this.newType = evt.detail.value; }

    handleCreateStory() {
        if (!(this.newSubject || '').trim()) {
            this.subjectError = true;
            return;
        }
        this.isCreatingStory = true;
        this.newStoryError   = null;

        createStory({
            subject:     this.newSubject.trim(),
            description: this.newDescription,
            priority:    this.newPriority,
            projectId:   this.selectedProjectId || null,
            storyType:   this.newType || null,
        })
            .then(caseNumber => {
                this._toast(
                    'Story Submitted',
                    `Story ${caseNumber} has been created. Your team has been notified.`,
                    'success'
                );
                this.showNewStoryModal = false;
                return refreshApex(this._wiredStories);
            })
            .catch(err => {
                this.newStoryError = err?.body?.message || 'Could not create story.';
            })
            .finally(() => { this.isCreatingStory = false; });
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
        }));
    }

    _mapNextSteps(steps) {
        return steps.map(s => ({
            ...s,
            authorName:  s.CreatedBy?.Name || '',
            dateDisplay: s.CreatedDate
                ? new Date(s.CreatedDate).toLocaleDateString()
                : '',
        }));
    }

    // ── Utilities ─────────────────────────────────────────────────────────────

    _toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}
