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
import createStory          from '@salesforce/apex/StoryBoardController.createStory';

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
let _dragCardId     = null;
let _dragFromStatus = null;
let _startX         = 0;
let _startY         = 0;
let _ghost          = null;
let _isDragging     = false;

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

    // ── New Story state ───────────────────────────────────────────────────
    @track showNewStoryModal    = false;
    @track newStorySubject      = '';
    @track newStoryDescription  = '';
    @track newStoryPriority     = '';
    @track newStoryDepartment   = '';
    @track newStorySubjectError = false;
    @track isCreatingStory      = false;
    @track newStorySaveError    = false;

    @track selectedProjectId = null;
    viewMode                 = 'mine';
    _currentUserId           = userId;

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
                this.isLoading = true;
            });
        }
    }

    // ── Data Wire ─────────────────────────────────────────────────────────
    @wire(getStories, { mineOnly: '$mineOnly', projectId: '$selectedProjectId' })
    wiredStories(result) {
        this._wiredStoriesResult = result;
        this.isLoading = false;
        if (result.data) {
            this.columns = this._buildColumns(result.data);
            this.errorMessage = '';
            requestAnimationFrame(() => this._updateOverflowMarkers());
        } else if (result.error) {
            this.errorMessage = result.error?.body?.message || 'Failed to load stories.';
        }
    }

    // ── Getters ───────────────────────────────────────────────────────────
    get mineOnly()        { return this.viewMode === 'mine'; }
    get totalCount()      { return this.columns.reduce((sum, c) => sum + c.count, 0); }
    get myStoriesClass()  { return this.viewMode === 'mine' ? 'toggle-btn active' : 'toggle-btn'; }
    get allStoriesClass() { return this.viewMode === 'all'  ? 'toggle-btn active' : 'toggle-btn'; }

    get showNewStoryButton() {
        return !!this.selectedProjectId;
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

    get newStorySubjectClass() {
        return `new-story-input${this.newStorySubjectError ? ' input-error' : ''}`;
    }

    // ── Distribution Bar Getters ──────────────────────────────────────────
    get distBarSegments() {
        const total = this.totalCount;
        if (!total) return [];
        return this.columns
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
                    status:    c.status,
                    count:     c.count,
                    showLabel: pct > 8,
                    tooltip:   `${c.status}: ${c.count}`,
                    style:     `width:${pct}%;background:${color};border-radius:${radius};`
                };
            });
    }

    get distBarLegend() {
        return this.columns.map(c => {
            const color = STATUS_COLORS[c.status] || '#00b4d8';
            const dim   = c.count === 0;
            return {
                status:     c.status,
                count:      c.count,
                dotStyle:   dim ? 'background:#d1d5db;' : `background:${color};`,
                countStyle: dim ? 'color:#9ca3af;'      : `color:${color};`,
                dimStyle:   dim ? 'opacity:0.5;'        : ''
            };
        });
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
        this.isLoading = true;
    }

    handleCardClick(e) {
        if (_isDragging) return;
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
            _isDragging = true;
            this._startGhost(e);
            this._setDraggingCard(_dragCardId, true);
        }
        if (_isDragging && _ghost) {
            _ghost.style.left = `${e.clientX + 12}px`;
            _ghost.style.top  = `${e.clientY + 12}px`;
            this._highlightColumn(e);
        }
    }

    handlePointerUp(e) {
        if (!_dragCardId) return;
        if (_isDragging) {
            const toStatus = this._getColumnAtPoint(e.clientX, e.clientY);
            this._destroyGhost();
            this._clearColumnHighlights();
            this._setDraggingCard(_dragCardId, false);
            if (toStatus && toStatus !== _dragFromStatus) {
                this._moveCard(_dragCardId, _dragFromStatus, toStatus);
            }
        }
        _dragCardId     = null;
        _dragFromStatus = null;
        _isDragging     = false;
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
            priority:      c.Priority || '',
            type:          c.Type     || '',
            priorityClass: PRIORITY_CLASSES[c.Priority] || 'priority-badge priority-low',
            openedDate:    c.CreatedDate
                               ? new Date(c.CreatedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                               : '',
            estimatedHours: c.Hours_Estimate_to_Complete__c ?? null,
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