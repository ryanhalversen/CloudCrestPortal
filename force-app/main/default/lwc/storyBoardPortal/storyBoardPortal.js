// force-app/main/default/lwc/storyBoardPortal/storyBoardPortal.js
import { LightningElement, track, wire } from 'lwc';
import { subscribe, MessageContext } from 'lightning/messageService';
import PROJECT_SELECTED_CHANNEL from '@salesforce/messageChannel/ProjectSelected__c';
import getStories        from '@salesforce/apex/StoryBoardPortalController.getStories';
import getProjects       from '@salesforce/apex/StoryBoardPortalController.getProjects';
import getAttachments    from '@salesforce/apex/StoryBoardPortalController.getAttachments';
import getEpicsForProject from '@salesforce/apex/EpicManagementPanelController.getEpicsForProject';

// ── Constants ─────────────────────────────────────────────────────────────
const PRIORITY_ORDER = { 'Critical': 0, 'High': 1, 'Medium': 2, 'Low': 3, '': 4 };

const PRIORITY_CLASSES = {
    'Low':      'priority-badge priority-low',
    'Medium':   'priority-badge priority-medium',
    'High':     'priority-badge priority-high',
    'Critical': 'priority-badge priority-critical'
};

const STATUSES = [
    'On Hold', 'Backlog', 'Blocked', 'New', 'Scheduled', 'Work In Progress (WIP)', 'Waiting for User',
    'In Review', 'In UAT', 'Completed', 'Cancelled'
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

export default class StoryBoardPortal extends LightningElement {

    @track columns             = [];
    @track isLoading           = true;
    @track colSortMode         = 'priority-asc';
    @track errorMessage        = '';
    @track projectOptions      = [];
    @track showProjectDropdown = false;

    @track modalCard             = null;
    @track _attachments          = [];
    @track _isLoadingAttachments = false;
    @track _openedAttachment     = null;
    @track _imgZoom              = 1;

    @track selectedProjectId = null;
    @track selectedEpicId    = null;
    @track _epics            = [];
    _selectedEpicName        = null;

    _wiredStoriesResult;
    _subscription = null;

    // ── Projects Wire ─────────────────────────────────────────────────────
    @wire(getProjects)
    wiredProjects({ data, error }) {
        if (data) {
            if (data.length === 1) {
                // Single project — auto-select and hide the dropdown
                this.selectedProjectId    = data[0].Id;
                this.showProjectDropdown  = false;
            } else if (data.length > 1) {
                // Multiple projects — show dropdown scoped to the user's account
                this.projectOptions       = data.map(p => ({ label: p.Name, value: p.Id }));
                this.selectedProjectId    = data[0].Id;
                this.showProjectDropdown  = true;
            }
            // data.length === 0: no matching projects — board stays empty
        } else if (error) {
            console.error('Failed to load projects', error);
        }
    }

    // ── Epics Wire ────────────────────────────────────────────────────────
    @wire(getEpicsForProject, { projectId: '$selectedProjectId' })
    wiredEpics({ data }) {
        if (data) this._epics = data;
    }

    // ── Message Service ───────────────────────────────────────────────────
    @wire(MessageContext)
    wiredMessageContext(ctx) {
        if (ctx && !this._subscription) {
            this._subscription = subscribe(ctx, PROJECT_SELECTED_CHANNEL, ({ projectId }) => {
                this.selectedProjectId = projectId || null;
                this.selectedEpicId    = null;
                this.isLoading = true;
            });
        }
    }

    // ── Data Wire ─────────────────────────────────────────────────────────
    @wire(getStories, { projectId: '$selectedProjectId', epicId: '$selectedEpicId' })
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
    get displayColumns() {
        const sortCards = cards => {
            switch (this.colSortMode) {
                case 'age-asc':       return [...cards].sort((a, b) => a.createdAt - b.createdAt);
                case 'age-desc':      return [...cards].sort((a, b) => b.createdAt - a.createdAt);
                case 'priority-desc': return [...cards].sort((a, b) => (PRIORITY_ORDER[b.priority] ?? 4) - (PRIORITY_ORDER[a.priority] ?? 4));
                default:              return [...cards].sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 4) - (PRIORITY_ORDER[b.priority] ?? 4));
            }
        };
        return this.columns.map(col => {
            const sorted = sortCards(col.cards);
            const estHrs = sorted.reduce((s, c) => s + (c.estimatedHours || 0), 0);
            return { ...col, cards: sorted, estHoursLabel: this._fmtHours(estHrs) || '0h' };
        });
    }

    get colSortLabel() {
        const labels = { 'priority-asc': '↑ Priority', 'priority-desc': '↓ Priority', 'age-asc': '↑ Age', 'age-desc': '↓ Age' };
        return labels[this.colSortMode] || '↑ Priority';
    }

    get totalCount() { return this.displayColumns.reduce((sum, c) => sum + c.count, 0); }

    get modalEpicDisplay() { return this.modalCard?.epicName || 'Unassigned'; }

    get modalContainerClass() {
        return this._openedAttachment
            ? 'modal-container modal-container-with-viewer'
            : 'modal-container';
    }

    get epicList() {
        return this._epics.map(e => ({
            epicId:    e.epicId,
            name:      e.name,
            chipClass: 'epic-chip' + (e.epicId === this.selectedEpicId ? ' epic-chip-selected' : '')
        }));
    }

    get allChipClass() {
        return 'epic-chip epic-chip-all' + (!this.selectedEpicId ? ' epic-chip-selected' : '');
    }

    get showNormalModal()  { return !!(this.modalCard && !this._openedAttachment); }
    get hasAttachments()   { return this._attachments.length > 0; }
    get imgZoomStyle()     { return `width: ${this._imgZoom * 100}%; max-width: none; height: auto;`; }
    get imgZoomLabel()     { return `${Math.round(this._imgZoom * 100)}%`; }

    get isClosedStatus() {
        const s = this.modalCard?.status || '';
        return s === 'Completed' || s === 'Cancelled';
    }

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
            const color = STATUS_COLORS[c.status] || '#00b4d8';
            const dim   = c.count === 0;
            return {
                status:     c.status,
                statsLabel: `${c.count}`,
                dotStyle:   dim ? 'background:#d1d5db;'  : `background:${color};`,
                statsStyle: dim ? 'color:#9ca3af;'        : `color:${color};`,
                dimStyle:   dim ? 'opacity:0.5;'          : ''
            };
        });
    }

    // ── Handlers ──────────────────────────────────────────────────────────
    handleColSortClick() {
        const cycle = { 'priority-asc': 'priority-desc', 'priority-desc': 'age-asc', 'age-asc': 'age-desc', 'age-desc': 'priority-asc' };
        this.colSortMode = cycle[this.colSortMode] || 'priority-asc';
    }

    handleProjectChange(e) {
        this.selectedProjectId = e.detail.value || null;
        this.selectedEpicId    = null;
        this._selectedEpicName = null;
        this.isLoading = true;
    }

    handleEpicClick(e) {
        const id = e.currentTarget.dataset.id;
        this.selectedEpicId    = id || null;
        this._selectedEpicName = this._epics.find(ep => ep.epicId === id)?.name || null;
        this.isLoading = true;
    }

    handleAllEpics() {
        this.selectedEpicId    = null;
        this._selectedEpicName = null;
        this.isLoading = true;
    }

    handleCardClick(e) {
        const id = e.currentTarget.dataset.id;
        if (!id) return;
        const card = this.columns.flatMap(c => c.cards).find(c => c.id === id);
        if (!card) return;
        this.modalCard           = { ...card };
        this._attachments        = [];
        this._openedAttachment   = null;
        this._loadAttachments(id);
    }

    handleModalClose() {
        this.modalCard          = null;
        this._attachments       = [];
        this._openedAttachment  = null;
    }

    handleModalBackdropClick()   { this.modalCard = null; }
    handleModalContainerClick(e) { e.stopPropagation(); }

    // ── Attachments (view + download only) ───────────────────────────────
    _loadAttachments(caseId) {
        this._isLoadingAttachments = true;
        getAttachments({ caseId })
            .then(data => { this._attachments = data; })
            .catch(err => { console.error('Failed to load attachments', err); })
            .finally(() => { this._isLoadingAttachments = false; });
    }

    handleOpenAttachment(e) {
        const id = e.currentTarget.dataset.id;
        this._openedAttachment = this._attachments.find(a => a.contentDocumentId === id) || null;
        this._imgZoom = 1;
    }

    handleCloseAttachmentViewer() {
        this._openedAttachment = null;
        this._imgZoom = 1;
    }

    handleZoomIn()    { this._imgZoom = Math.min(+(this._imgZoom + 0.25).toFixed(2), 4); }
    handleZoomOut()   { this._imgZoom = Math.max(+(this._imgZoom - 0.25).toFixed(2), 0.25); }
    handleZoomReset() { this._imgZoom = 1; }

    handleAttachLinkClick(e) { e.stopPropagation(); }

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

    _fmtHours(h) {
        if (!h) return '';
        return `${Number(h.toFixed(2))}h`;
    }

    _stripHtml(html) {
        if (!html) return '';
        let t = html;
        t = t.replace(/<\/p>/gi, '\n')
             .replace(/<\/div>/gi, '\n')
             .replace(/<\/li>/gi, '\n')
             .replace(/<\/h[1-6]>/gi, '\n')
             .replace(/<br\s*\/?>/gi, '\n');
        t = t.replace(/<[^>]*>/g, '');
        t = t.replace(/&nbsp;/g, ' ')
             .replace(/&amp;/g, '&')
             .replace(/&lt;/g, '<')
             .replace(/&gt;/g, '>')
             .replace(/&quot;/g, '"')
             .replace(/&#39;/g, "'")
             .replace(/&apos;/g, "'");
        t = t.replace(/\n{3,}/g, '\n\n');
        return t.trim();
    }

    _mapCard(c) {
        return {
            id:                 c.Id,
            subject:            c.Subject,
            description:        c.Description || '',
            caseNumber:         c.CaseNumber,
            priority:           c.Priority    || '',
            type:               c.Type        || '',
            department:         c.Department__c || '',
            priorityClass:      PRIORITY_CLASSES[c.Priority] || 'priority-badge priority-low',
            cardAge:            this._calcAge(c.CreatedDate),
            createdAt:          c.CreatedDate ? new Date(c.CreatedDate).getTime() : 0,
            estimatedHours:     c.Hours_Estimate_to_Complete__c ?? null,
            ownerId:            c.OwnerId          || null,
            ownerName:          c.Owner?.Name      || '',
            epicId:             c.Epic__c          || null,
            epicName:           c.Epic__r?.Name    || '',
            contactId:          c.ContactId        || null,
            contactName:        c.Contact?.Name    || '',
            status:             c.Status           || '',
            hasSupportMessage:  c.Support_Message_Pending__c || false,
            closingComments:    this._stripHtml(c.Closing_Comments__c),
            solution:           this._stripHtml(c.Solution__c),
            componentsToDeploy: this._stripHtml(c.Components_to_Deploy__c),
            qa:                 this._stripHtml(c.Q_A__c),
            documentation:      this._stripHtml(c.Documentation__c),
            projectId:          c.Projects__c      || null,
            projectName:        c.Projects__r?.Name || '',
            cardClass:          'story-card' + (c.Story_Support__c ? ' story-card-support' : '')
        };
    }

    _calcAge(createdDate) {
        if (!createdDate) return '';
        const days = Math.floor((Date.now() - new Date(createdDate).getTime()) / 86400000);
        if (days === 0)  return 'Today';
        if (days < 7)   return `${days}d ago`;
        if (days < 56)  return `${Math.floor(days / 7)}w ago`;
        return `${Math.floor(days / 30)}mo ago`;
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
