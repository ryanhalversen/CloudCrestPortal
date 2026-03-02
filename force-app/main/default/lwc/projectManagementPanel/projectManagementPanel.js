// force-app/main/default/lwc/projectManagementPanel/projectManagementPanel.js
import { LightningElement, track, wire } from 'lwc';
import { subscribe, MessageContext } from 'lightning/messageService';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import PROJECT_SELECTED_CHANNEL from '@salesforce/messageChannel/ProjectSelected__c';
import getProjects        from '@salesforce/apex/StoryBoardController.getProjects';
import getEventsForDate   from '@salesforce/apex/ProjectManagementPanelController.getEventsForDate';
import getCalendarUsers   from '@salesforce/apex/ProjectManagementPanelController.getCalendarUsers';
import getOverheadCaseIds from '@salesforce/apex/ProjectManagementPanelController.getOverheadCaseIds';
import getLoggedEventIds  from '@salesforce/apex/ProjectManagementPanelController.getLoggedEventIds';
import logTime            from '@salesforce/apex/ProjectManagementPanelController.logTime';

const CATEGORIES = ['Meetings', 'Project Management', 'Helpdesk'];

const _today = () => {
    const d  = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
};

const _offsetDay = (offset, fromDate) => {
    const d  = new Date((fromDate || _today()) + 'T12:00:00');
    d.setDate(d.getDate() + offset);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
};

export default class ProjectManagementPanel extends LightningElement {

    // ── Events ────────────────────────────────────────────────────────────
    @track todayEvents     = [];
    @track isLoadingEvents = true;
    @track eventsError     = '';
    @track selectedDate    = _today();
    @track calendarUsers   = [];
    @track filterUserId    = '';

    // ── Projects ──────────────────────────────────────────────────────────
    @track projectOptions    = [];
    @track selectedProjectId = null;

    // ── Modal ─────────────────────────────────────────────────────────────
    @track showLogModal    = false;
    @track logCategory     = 'Meetings';
    @track logProjectId    = null;
    @track logMinutes      = 30;
    @track logDate         = _today();
    @track logNote         = '';
    @track logEventSubject = '';
    @track isLogging       = false;
    @track logError        = '';

    _subscription      = null;
    _loggedFromEventId = null;
    _pendingNoteUpdate = false; // set before showLogModal=true; cleared by renderedCallback

    // ── Wire: Message Service ─────────────────────────────────────────────
    @wire(MessageContext)
    wiredMessageContext(ctx) {
        if (ctx && !this._subscription) {
            this._subscription = subscribe(ctx, PROJECT_SELECTED_CHANNEL, ({ projectId }) => {
                this.selectedProjectId = projectId || null;
            });
        }
    }

    // ── Wire: Calendar Users ──────────────────────────────────────────────
    @wire(getCalendarUsers)
    wiredCalendarUsers({ data }) {
        if (data) this.calendarUsers = data;
    }

    // ── Wire: Projects ────────────────────────────────────────────────────
    @wire(getProjects)
    wiredProjects({ data }) {
        if (data) {
            this.projectOptions = data.map(p => ({ label: p.Name, value: p.Id }));
            if (!this.selectedProjectId && data.length > 0) {
                this.selectedProjectId = data[0].Id;
            }
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────
    connectedCallback() {
        this._loadEvents();
    }

    renderedCallback() {
        if (this._pendingNoteUpdate) {
            const ta = this.template.querySelector('.log-textarea');
            if (ta) {
                ta.value = this.logNote;
                this._pendingNoteUpdate = false;
            }
        }
    }

    _loadEvents() {
        this.isLoadingEvents = true;
        this.eventsError     = '';
        getEventsForDate({ dateStr: this.selectedDate, filterUserId: this.filterUserId || null })
            .then(events => {
                this.todayEvents = events.map(e => this._mapEvent(e));
                const ids = events.map(e => e.Id);
                return ids.length > 0 ? getLoggedEventIds({ eventIds: ids }) : [];
            })
            .then(loggedIds => {
                if (loggedIds.length > 0) {
                    const loggedSet = new Set(loggedIds);
                    this.todayEvents = this.todayEvents.map(ev => ({
                        ...ev, isLogged: loggedSet.has(ev.id)
                    }));
                }
            })
            .catch(err  => { this.eventsError  = err?.body?.message || 'Failed to load events.'; })
            .finally(() => { this.isLoadingEvents = false; });
    }

    _mapEvent(e) {
        const start   = new Date(e.StartDateTime);
        const end     = new Date(e.EndDateTime);
        const minutes = Math.max(1, Math.round((end - start) / 60000));
        const fmt     = dt => dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        return {
            id:            e.Id,
            subject:       e.Subject || '(No title)',
            timeLabel:     `${fmt(start)} – ${fmt(end)}`,
            minutes,
            durationLabel: `${minutes} min`,
            isLogged:      false
        };
    }

    // ── Getters ───────────────────────────────────────────────────────────
    get hasEvents()   { return this.todayEvents.length > 0; }
    get eventCount()  { return this.todayEvents.length; }

    get dateLabel() {
        const today     = _today();
        const yesterday = _offsetDay(-1);
        const tomorrow  = _offsetDay(1);
        const d         = new Date(this.selectedDate + 'T12:00:00');
        const monthDay  = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        if (this.selectedDate === today)     return `Today · ${monthDay}`;
        if (this.selectedDate === yesterday) return `Yesterday · ${monthDay}`;
        if (this.selectedDate === tomorrow)  return `Tomorrow · ${monthDay}`;
        return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }

    get isToday() { return this.selectedDate === _today(); }

    get userFilterOptions() {
        return [
            { label: 'My Calendar', value: '' },
            ...this.calendarUsers.map(u => ({ label: u.Name, value: u.Id }))
        ];
    }

    get categoryOptions() {
        return CATEGORIES.map(c => ({
            value:   c,
            label:   c === 'Project Management' ? 'PM Time' : c,
            btnClass: this.logCategory === c ? 'cat-btn cat-active' : 'cat-btn'
        }));
    }

    // ── Handlers: user filter ─────────────────────────────────────────────
    handleUserFilterChange(e) {
        this.filterUserId = e.detail.value;
        this._loadEvents();
    }

    // ── Handlers: date nav ────────────────────────────────────────────────
    handlePrevDay() { this._shiftDay(-1); }
    handleNextDay() { this._shiftDay(1); }
    handleTodayClick() {
        if (this.isToday) return;
        this.selectedDate = _today();
        this._loadEvents();
    }

    _shiftDay(offset) {
        this.selectedDate = _offsetDay(offset, this.selectedDate);
        this._loadEvents();
    }

    // ── Handlers: events ──────────────────────────────────────────────────
    handleEventLog(e) {
        const ev = this.todayEvents.find(ev => ev.id === e.currentTarget.dataset.id);
        if (!ev) return;
        this._loggedFromEventId = ev.id;
        this._openModal('Meetings', ev.minutes, ev.subject);
    }

    handleQuickLog(e) {
        this._loggedFromEventId = null;
        this._openModal(e.currentTarget.dataset.category, 30, '');
    }

    _openModal(category, minutes, eventSubject) {
        this.logCategory     = category;
        this.logMinutes      = minutes;
        this.logNote            = eventSubject;
        this._pendingNoteUpdate = !!eventSubject;
        this.logDate            = _today();
        this.logEventSubject    = eventSubject;
        this.logProjectId    = this.selectedProjectId || this.projectOptions[0]?.value || null;
        this.logError        = '';
        this.isLogging       = false;
        this.showLogModal    = true;
    }

    // ── Handlers: modal ───────────────────────────────────────────────────
    handleModalClose()           { this.showLogModal = false; }
    handleModalBackdropClick()   { if (!this.isLogging) this.showLogModal = false; }
    handleModalContainerClick(e) { e.stopPropagation(); }

    handleCategorySelect(e) { this.logCategory  = e.currentTarget.dataset.value; }
    handleProjectChange(e)  { this.logProjectId = e.detail.value; }
    handleMinutesChange(e)  { this.logMinutes   = parseInt(e.target.value, 10) || 0; }
    handleMinutesKeyDown(e) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const delta = e.key === 'ArrowUp' ? 5 : -5;
            this.logMinutes = Math.max(5, (this.logMinutes || 0) + delta);
        }
    }
    handleNoteChange(e)     { this.logNote      = e.target.value; }
    handleDateChange(e)     { this.logDate      = e.target.value; }

    async handleLogSubmit() {
        if (!this.logProjectId || this.logMinutes < 1) return;
        this.isLogging = true;
        this.logError  = '';
        try {
            const caseIds = await getOverheadCaseIds({ projectId: this.logProjectId });
            const caseId  = caseIds[this.logCategory];
            if (!caseId) {
                this.logError = `No "${this.logCategory}" story found for this project.`;
                return;
            }
            await logTime({
                caseId,
                minutes: this.logMinutes,
                note:    this.logNote.trim() || null,
                logDate: this.logDate,
                eventId: this._loggedFromEventId || null
            });
            this.showLogModal = false;
            if (this._loggedFromEventId) {
                this.todayEvents = this.todayEvents.map(ev =>
                    ev.id === this._loggedFromEventId ? { ...ev, isLogged: true } : ev
                );
                this._loggedFromEventId = null;
            }
            const hrs = (this.logMinutes / 60).toFixed(1).replace(/\.0$/, '');
            this._toast('Time logged', `${hrs}h logged to ${this.logCategory}`, 'success');
        } catch (err) {
            this.logError = err?.body?.message || 'Failed to log time — please try again.';
        } finally {
            this.isLogging = false;
        }
    }

    _toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}
