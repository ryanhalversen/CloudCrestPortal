// force-app/main/default/lwc/outpostDevelopment/outpostDevelopment.js
import { LightningElement, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';
import userId from '@salesforce/user/Id';
import getOutpostData    from '@salesforce/apex/OutpostDevelopmentController.getOutpostData';
import updateStatus      from '@salesforce/apex/OutpostDevelopmentController.updateStatus';
import logTime           from '@salesforce/apex/OutpostDevelopmentController.logTime';
import postComment       from '@salesforce/apex/OutpostDevelopmentController.postComment';
import getComments       from '@salesforce/apex/OutpostDevelopmentController.getComments';
import getChatMessages   from '@salesforce/apex/OutpostDevelopmentController.getChatMessages';
import postChatMessage   from '@salesforce/apex/OutpostDevelopmentController.postChatMessage';
import searchChatUsers   from '@salesforce/apex/OutpostDevelopmentController.searchChatUsers';

// ── Module-level drag state (non-reactive) ────────────────────────────────
let _dragCardId     = null;
let _dragFromStatus = null;
let _startX         = 0;
let _startY         = 0;
let _ghost          = null;
let _isDragging     = false;
let _didDrag        = false;
const DRAG_THRESHOLD = 6;

// ── Constants ─────────────────────────────────────────────────────────────
const COLUMNS = [
    'New',
    'Backlog',
    'Scheduled',
    'Work In Progress (WIP)',
    'Waiting for User',
    'On Hold',
    'In Review',
    'In UAT',
    'Blocked',
    'Completed'
];

const COL_COLORS = {
    'New':                     '#e2e8f0',
    'Backlog':                 '#cbd5e1',
    'Scheduled':               '#ade8f4',
    'Work In Progress (WIP)':  '#90e0ef',
    'Waiting for User':        '#c4b5fd',
    'On Hold':                 '#fcd34d',
    'In Review':               '#0077b6',
    'In UAT':                  '#005f8e',
    'Blocked':                 '#dc2626',
    'Completed':               '#166534'
};

const PRIORITY_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 };

export default class OutpostDevelopment extends LightningElement {

    // ── Reactive state ────────────────────────────────────────────────────
    @track _data            = null;
    @track _selectedProject = '';
    @track isLoading        = true;
    @track error            = null;
    @track isCardDragging   = false;

    // Modal: story detail
    @track _activeCard   = null;
    @track _comments     = [];
    @track _commentText  = '';
    @track _logHours     = '';
    @track _logDesc      = '';
    @track _logDate      = '';

    // Modal: chat
    @track _chatMessages       = [];
    @track _chatText           = '';
    @track _mentionQuery       = '';
    @track _mentionResults     = [];
    @track _showMentionDropdown = false;

    _wiredResult;
    _mentionTimer    = null;
    _mentionMap      = {};   // { displayName: userId }
    currentUserId    = userId;

    // ── Wire ──────────────────────────────────────────────────────────────

    @wire(getOutpostData, { projectId: '$_selectedProject' })
    wiredData(result) {
        this._wiredResult = result;
        this.isLoading    = false;
        if (result.data)  { this._data  = result.data; this.error = null; }
        if (result.error) { this.error  = result.error?.body?.message || 'Failed to load data'; }
    }

    // ── Computed: role ────────────────────────────────────────────────────

    get isOwnerView() {
        return !!this._data?.isOwner;
    }

    get roleBadge() {
        return this.isOwnerView ? 'Project Owner' : 'Contractor';
    }

    get roleBadgeClass() {
        return this.isOwnerView ? 'role-badge role-owner' : 'role-badge role-contractor';
    }

    // ── Computed: project dropdown ────────────────────────────────────────

    get projectOptions() {
        const opts = [{ label: 'All Projects', value: '' }];
        if (this._data?.projects) {
            this._data.projects.forEach(p => opts.push({ label: p.label, value: p.value }));
        }
        return opts;
    }

    // ── Computed: board ───────────────────────────────────────────────────

    get boardClass() {
        return 'op-board' + (this.isCardDragging ? ' board-dragging' : '');
    }

    get columns() {
        if (!this._data) return COLUMNS.map(s => ({ status: s, count: 0, hasCards: false, cards: [], headerStyle: `border-top: 3px solid ${COL_COLORS[s]}` }));
        const stories = this.isOwnerView
            ? (this._data.ownerStories   || [])
            : (this._data.supportStories || []);
        return this._buildColumns(stories);
    }

    _buildColumns(stories) {
        const buckets = {};
        COLUMNS.forEach(col => { buckets[col] = []; });
        stories.forEach(s => {
            if (buckets[s.status] !== undefined) {
                buckets[s.status].push(s);
            }
        });
        return COLUMNS.map(status => {
            const cards = (buckets[status] || [])
                .slice()
                .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99))
                .map(s => ({
                    id:            s.id,
                    subject:       s.subject,
                    status:        s.status,
                    priority:      s.priority  || '',
                    priorityClass: `op-pri op-pri-${(s.priority || 'low').toLowerCase()}`,
                    type:          s.type      || '',
                    ownerName:     s.ownerName   || '',
                    supportName:   s.supportName || '',
                    projectName:   s.projectName || '',
                    hoursLogged:   s.hoursLogged  ?? 0,
                    hoursEstimate: s.hoursEstimate ?? 0,
                    cardClass:     'op-card'
                }));
            return {
                status,
                count:       cards.length,
                hasCards:    cards.length > 0,
                cards,
                headerStyle: `border-top: 3px solid ${COL_COLORS[status] || '#94a3b8'}`
            };
        });
    }

    // ── Computed: modal ───────────────────────────────────────────────────

    get showModal() {
        return !!this._activeCard;
    }

    get statusOptions() {
        if (!this._activeCard) return [];
        return COLUMNS.map(col => ({
            value:    col,
            label:    col,
            btnClass: `op-status-btn${col === this._activeCard.status ? ' active' : ''}`
        }));
    }

    get hasChatMessages() {
        return this._chatMessages.length > 0;
    }

    // ── Project filter ────────────────────────────────────────────────────

    handleProjectChange(e) {
        this._selectedProject = e.detail.value;
    }

    // ── Drag and Drop ─────────────────────────────────────────────────────

    handlePointerDown(e) {
        const card = e.currentTarget;
        _dragCardId     = card.dataset.id;
        _dragFromStatus = (card.closest('[data-status]') || card).dataset.status;
        _startX         = e.clientX;
        _startY         = e.clientY;
        _isDragging     = false;
        _didDrag        = false;
        card.setPointerCapture(e.pointerId);
    }

    handlePointerMove(e) {
        if (!_dragCardId) return;
        const dx = Math.abs(e.clientX - _startX);
        const dy = Math.abs(e.clientY - _startY);
        if (!_isDragging && (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD)) {
            _isDragging         = true;
            _didDrag            = true;
            this.isCardDragging = true;

            _ghost = document.createElement('div');
            _ghost.style.cssText =
                'position:fixed;pointer-events:none;opacity:0.75;z-index:9999;' +
                'min-width:160px;max-width:220px;background:white;border-radius:8px;' +
                'padding:10px 12px;box-shadow:0 8px 24px rgba(0,0,0,0.25);' +
                'font-size:0.8125rem;font-weight:600;color:#1e293b;';
            const subjectEl = e.currentTarget.querySelector('.op-card-subject');
            _ghost.textContent = subjectEl ? subjectEl.textContent : '';
            document.body.appendChild(_ghost);
        }
        if (_isDragging && _ghost) {
            _ghost.style.left = (e.clientX + 14) + 'px';
            _ghost.style.top  = (e.clientY - 18) + 'px';
        }
    }

    handlePointerUp(e) {
        if (!_dragCardId) return;
        const wasCardId     = _dragCardId;
        const wasFromStatus = _dragFromStatus;

        if (_isDragging) {
            try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (ex) { /* ignore */ }
            const el        = document.elementFromPoint(e.clientX, e.clientY);
            const col       = el ? el.closest('[data-status]') : null;
            const newStatus = col ? col.dataset.status : null;

            if (newStatus && newStatus !== wasFromStatus && COLUMNS.includes(newStatus)) {
                updateStatus({ caseId: wasCardId, newStatus })
                    .then(() => refreshApex(this._wiredResult))
                    .catch(err => {
                        this._showToast('Error', err?.body?.message || 'Status update failed', 'error');
                    });
            }
        }

        _dragCardId         = null;
        _dragFromStatus     = null;
        _isDragging         = false;
        this.isCardDragging = false;
        if (_ghost) { _ghost.remove(); _ghost = null; }
    }

    // ── Card click → open modal ───────────────────────────────────────────

    handleCardClick(e) {
        if (_didDrag) { _didDrag = false; return; }
        const cardId   = e.currentTarget.dataset.id;
        const allStories = [
            ...(this._data?.ownerStories   || []),
            ...(this._data?.supportStories || [])
        ];
        const story = allStories.find(s => s.id === cardId);
        if (!story) return;

        this._activeCard        = { ...story };
        this._logHours          = '';
        this._logDesc           = '';
        this._logDate           = this._todayString();
        this._commentText       = '';
        this._comments          = [];
        this._chatMessages      = [];
        this._chatText          = '';
        this._mentionMap        = {};
        this._showMentionDropdown = false;
        this._loadComments(cardId);
        this._loadChatMessages(cardId);
    }

    // ── Modal close ───────────────────────────────────────────────────────

    handleCloseModal(e) {
        if (e.target === e.currentTarget || e.currentTarget.classList.contains('op-backdrop')) {
            this._clearModal();
        }
    }

    handleModalClose() {
        this._clearModal();
    }

    _clearModal() {
        this._activeCard          = null;
        this._comments            = [];
        this._chatMessages        = [];
        this._showMentionDropdown = false;
    }

    // ── Status change ─────────────────────────────────────────────────────

    handleStatusChange(e) {
        const newStatus = e.currentTarget.dataset.status;
        const caseId    = this._activeCard.id;
        if (!newStatus || newStatus === this._activeCard.status) return;

        updateStatus({ caseId, newStatus })
            .then(() => {
                this._activeCard = { ...this._activeCard, status: newStatus };
                return refreshApex(this._wiredResult);
            })
            .catch(err => {
                this._showToast('Error', err?.body?.message || 'Status update failed', 'error');
            });
    }

    // ── Log time ──────────────────────────────────────────────────────────

    handleLogHoursChange(e)  { this._logHours = e.detail.value; }
    handleLogDescChange(e)   { this._logDesc  = e.detail.value; }
    handleLogDateChange(e)   { this._logDate  = e.detail.value; }

    handleLogTime() {
        const hours = parseFloat(this._logHours);
        if (!hours || hours <= 0) {
            this._showToast('Validation', 'Please enter a valid number of hours.', 'warning');
            return;
        }
        const minutes    = Math.round(hours * 60);
        const caseId     = this._activeCard.id;
        const loggedDate = this._logDate || this._todayString();

        logTime({ caseId, minutes, description: this._logDesc, loggedDate })
            .then(() => {
                this._logHours = '';
                this._logDesc  = '';
                this._showToast('Success', `${hours}h logged successfully.`, 'success');
                return refreshApex(this._wiredResult);
            })
            .catch(err => {
                this._showToast('Error', err?.body?.message || 'Failed to log time', 'error');
            });
    }

    // ── Case comments ─────────────────────────────────────────────────────

    handleCommentChange(e) { this._commentText = e.detail.value; }

    handlePostComment() {
        const message = (this._commentText || '').trim();
        if (!message || !this._activeCard) return;
        const caseId = this._activeCard.id;

        postComment({ caseId, message })
            .then(() => {
                this._commentText = '';
                return this._loadComments(caseId);
            })
            .catch(err => {
                this._showToast('Error', err?.body?.message || 'Failed to post comment', 'error');
            });
    }

    async _loadComments(caseId) {
        try {
            const raw = await getComments({ caseId });
            this._comments = raw.map(c => ({
                id:          c.id,
                authorName:  c.authorName,
                body:        c.body,
                createdDate: c.createdDate ? new Date(c.createdDate).toLocaleString() : ''
            }));
        } catch (err) {
            this._showToast('Error', err?.body?.message || 'Failed to load comments', 'error');
        }
    }

    // ── Chat ──────────────────────────────────────────────────────────────

    async _loadChatMessages(caseId) {
        try {
            const raw = await getChatMessages({ caseId });
            this._chatMessages = raw.map(m => ({
                id:            m.id,
                body:          m.body,
                authorName:    m.authorName,
                isCurrentUser: m.isCurrentUser,
                createdDate:   m.createdDate ? new Date(m.createdDate).toLocaleString() : '',
                bubbleClass:   m.isCurrentUser
                    ? 'op-chat-row op-chat-row-mine'
                    : 'op-chat-row op-chat-row-other',
                bubbleInnerClass: m.isCurrentUser
                    ? 'op-chat-bubble op-chat-bubble-mine'
                    : 'op-chat-bubble op-chat-bubble-other',
                metaClass: m.isCurrentUser ? 'op-chat-meta op-chat-meta-mine' : 'op-chat-meta'
            }));
            // Scroll to bottom after render
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            setTimeout(() => {
                const msgList = this.template.querySelector('.op-chat-messages');
                if (msgList) msgList.scrollTop = msgList.scrollHeight;
            }, 50);
        } catch (err) {
            // Non-critical, don't toast
        }
    }

    // @mention detection in the chat textarea
    handleChatInput(e) {
        this._chatText = e.target.value;
        const cursorPos        = e.target.selectionStart;
        const textBeforeCursor = this._chatText.substring(0, cursorPos);

        // Match @word at the tail of text-before-cursor (allows spaces for full names)
        const match = textBeforeCursor.match(/(^|[\s\n])@([^@\n]{0,40})$/);
        if (match) {
            const query = match[2];
            this._mentionQuery = query;
            if (query.length >= 1) {
                clearTimeout(this._mentionTimer);
                // eslint-disable-next-line @lwc/lwc/no-async-operation
                this._mentionTimer = setTimeout(() => {
                    this._fetchMentions(query);
                }, 200);
            } else {
                this._showMentionDropdown = false;
            }
        } else {
            this._showMentionDropdown = false;
            this._mentionResults      = [];
        }
    }

    handleChatKeydown(e) {
        // Close mention dropdown on Escape
        if (e.key === 'Escape' && this._showMentionDropdown) {
            this._showMentionDropdown = false;
            e.preventDefault();
        }
        // Send on Enter (without shift)
        if (e.key === 'Enter' && !e.shiftKey && !this._showMentionDropdown) {
            e.preventDefault();
            this.handleSendChat();
        }
    }

    async _fetchMentions(term) {
        try {
            const results = await searchChatUsers({ term });
            this._mentionResults      = results;
            this._showMentionDropdown = results.length > 0;
        } catch (err) {
            this._showMentionDropdown = false;
        }
    }

    handleSelectMention(e) {
        const uId   = e.currentTarget.dataset.value;
        const uName = e.currentTarget.dataset.label;

        // Replace the trailing @query with @Name in the displayed text
        const escapedQuery = this._mentionQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const replaced = this._chatText.replace(
            new RegExp('(^|[\\s\\n])@' + escapedQuery + '$'),
            (_, pre) => `${pre}@${uName} `
        );
        this._chatText = replaced;

        // Store mapping for submission
        this._mentionMap[uName] = uId;

        this._showMentionDropdown = false;
        this._mentionResults      = [];
        this._mentionQuery        = '';

        // Re-focus textarea
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        setTimeout(() => {
            const ta = this.template.querySelector('.op-chat-textarea');
            if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
        }, 0);
    }

    handleSendChat() {
        const text = (this._chatText || '').trim();
        if (!text || !this._activeCard) return;
        const caseId = this._activeCard.id;

        // Build submit message: replace @Name with @[userId] for Chatter @mentions
        let submitMsg = text;
        Object.entries(this._mentionMap).forEach(([name, uid]) => {
            submitMsg = submitMsg.split('@' + name).join('@[' + uid + ']');
        });

        postChatMessage({ caseId, message: submitMsg })
            .then(() => {
                this._chatText  = '';
                this._mentionMap = {};
                return this._loadChatMessages(caseId);
            })
            .catch(err => {
                this._showToast('Error', err?.body?.message || 'Failed to send message', 'error');
            });
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    _todayString() {
        const d  = new Date();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${d.getFullYear()}-${mm}-${dd}`;
    }

    _showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}
