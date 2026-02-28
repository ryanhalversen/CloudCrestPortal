import { LightningElement, track, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';
import getTodayStories  from '@salesforce/apex/EodTimeRetroController.getTodayStories';
import getStoriesForDate from '@salesforce/apex/EodTimeRetroController.getStoriesForDate';
import getTimeStats     from '@salesforce/apex/EodTimeRetroController.getTimeStats';
import getTimeBreakdown from '@salesforce/apex/EodTimeRetroController.getTimeBreakdown';
import getTeamUsers     from '@salesforce/apex/EodTimeRetroController.getTeamUsers';
import logTime          from '@salesforce/apex/EodTimeRetroController.logTime';
import updateTime       from '@salesforce/apex/EodTimeRetroController.updateTime';
import USER_ID          from '@salesforce/user/Id';

const PRIORITY_CLASSES = {
    'Critical' : 'tag tag-critical',
    'High'     : 'tag tag-high',
    'Medium'   : 'tag tag-medium',
    'Low'      : 'tag tag-low'
};

export default class EodTimeRetro extends NavigationMixin(LightningElement) {
    @track stories          = [];
    @track stats            = { todayHours: 0, weekHours: 0, monthHours: 0 };
    @track isLoading        = true;
    @track showEditModal    = false;
    @track userOptions      = [];
    @track selectedUserId   = USER_ID;

    // Breakdown state
    @track showBreakdown       = false;
    @track breakdown           = [];
    @track isLoadingBreakdown  = false;
    @track activePeriod        = null; // 'today' | 'week' | 'month'

    // Look-back state
    @track selectedDate = null; // null = today

    editStoryId = null;
    editEpicId  = null;
    editTimeId  = null;
    editHours   = 0;
    editNotes   = '';
    _storiesWire;
    _statsWire;
    _skippedIds = new Set(); // persists skipped stories for the session

    // ── Wire: team users ──────────────────────────────────────────────────
    @wire(getTeamUsers)
    wiredUsers({ data }) {
        if (data) {
            this.userOptions = data.map(u => ({ label: u.Name, value: u.Id }));
            const me = this.userOptions.find(u => u.value === USER_ID);
            if (me) me.label = `${me.label} (me)`;
        }
    }

    // ── Wire: stories (today or selected date) ────────────────────────────
    @wire(getTodayStories, { userId: '$selectedUserId' })
    wiredStories(result) {
        this._storiesWire = result;
        if (result.data) {
            const existing = {};
            this.stories.forEach(s => {
                if (s.newTimeId) existing[s.storyId] = { newTimeId: s.newTimeId, newHours: s.newHours };
            });
            this.stories   = result.data
                .filter(s => !this._skippedIds.has(s.storyId))
                .map(s => {
                const dec = this._decorate(s);
                return existing[s.storyId] ? { ...dec, ...existing[s.storyId] } : dec;
            });
            this.isLoading = false;
        } else if (result.error) {
            this._toast('Error loading stories', result.error.body?.message, 'error');
            this.isLoading = false;
        }
    }

    // ── Wire: stats ───────────────────────────────────────────────────────
    @wire(getTimeStats, { userId: '$selectedUserId' })
    wiredStats(result) {
        this._statsWire = result;
        if (result.data) {
            this.stats = {
                todayHours : this._round(result.data.todayHours),
                weekHours  : this._round(result.data.weekHours),
                monthHours : this._round(result.data.monthHours)
            };
        }
    }

    // ── Computed ──────────────────────────────────────────────────────────
    get isCurrentUser()  { return this.selectedUserId === USER_ID; }
    get unloggedCount()  { return this.stories.filter(s => !s.hasTime && !s.newTimeId).length; }
    get hasUnlogged()    { return this.unloggedCount > 0; }
    get noStories()      { return !this.isLoading && this.stories.length === 0; }
    get noBreakdown()    { return !this.isLoadingBreakdown && this.breakdown.length === 0; }
    get todayEntryCount(){ return this.stories.reduce((n, s) => n + (s.timeEntries?.length || 0), 0); }

    get storiesLabel() {
        if (this.selectedDate) {
            return `Stories touched on ${this._formatDate(this.selectedDate)}`;
        }
        return 'Stories you touched today';
    }

    get breakdownTitle() {
        const map = { today: 'Today\'s time by account', week: 'This week\'s time by account', month: 'This month\'s time by account' };
        return map[this.activePeriod] || 'Time breakdown';
    }

    // Stat card classes — highlight active
    get statCardTodayClass() { return this.activePeriod === 'today' ? 'stat-card stat-card-active' : 'stat-card stat-card-clickable'; }
    get statCardWeekClass()  { return this.activePeriod === 'week'  ? 'stat-card stat-card-active' : 'stat-card stat-card-clickable'; }
    get statCardMonthClass() { return this.activePeriod === 'month' ? 'stat-card stat-card-active' : 'stat-card stat-card-clickable'; }
    get statCardLogClass()   { return this.showBreakdown ? 'stat-card stat-card-clickable stat-card-log-today' : 'stat-card'; }

    // Look-back day buttons (today + last 6 days)
    get lookbackDays() {
        const days = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const val = this._toIsoDate(d);
            const isSelected = i === 0 ? !this.selectedDate : this.selectedDate === val;
            days.push({
                value   : i === 0 ? null : val,
                label   : i === 0 ? 'Today' : this._shortDay(d),
                btnClass: isSelected ? 'lookback-btn lookback-btn-active' : 'lookback-btn'
            });
        }
        return days;
    }

    // Project groups
    get projectGroups() {
        const map = {}, order = [];
        this.stories.forEach(s => {
            const key  = s.projectId   || '__none__';
            const name = s.projectName || 'No Project';
            if (!map[key]) { map[key] = { projectId: key, projectName: name, stories: [], count: 0 }; order.push(key); }
            map[key].stories.push(s);
            map[key].count++;
        });
        return order.map(k => map[k]);
    }

    // ── Stat card click → show breakdown ─────────────────────────────────
    handleStatClick(evt) {
        const period = evt.currentTarget.dataset.period;
        if (this.activePeriod === period) {
            // Toggle off
            this.activePeriod  = null;
            this.showBreakdown = false;
            return;
        }
        this.activePeriod        = period;
        this.showBreakdown       = true;
        this.isLoadingBreakdown  = true;
        this.breakdown           = [];
        getTimeBreakdown({ userId: this.selectedUserId, period })
            .then(data => {
                this.breakdown          = data;
                this.isLoadingBreakdown = false;
            })
            .catch(e => {
                this._toast('Error', e.body?.message, 'error');
                this.isLoadingBreakdown = false;
            });
    }

    handleCloseBreakdown() {
        this.showBreakdown = false;
        this.activePeriod  = null;
        // Also snap date picker back to today
        if (this.selectedDate) {
            this.selectedDate = null;
            this.isLoading    = true;
            this.stories      = [];
            refreshApex(this._storiesWire);
        }
    }

    // ── Look-back date pick ───────────────────────────────────────────────
    handleLookback(evt) {
        const date = evt.currentTarget.dataset.date || null;
        if (date === this.selectedDate) return;
        this.selectedDate = date;
        this.isLoading    = true;
        this.stories      = [];
        // Close breakdown if open
        this.showBreakdown = false;
        this.activePeriod  = null;

        if (!date) {
            // Back to today — wire re-runs automatically via selectedUserId reactive prop trick
            // Force refresh
            refreshApex(this._storiesWire);
        } else {
            getStoriesForDate({ userId: this.selectedUserId, dateStr: date })
                .then(data => {
                    this.stories   = data
                        .filter(s => !this._skippedIds.has(s.storyId))
                        .map(s => this._decorate(s));
                    this.isLoading = false;
                })
                .catch(e => {
                    this._toast('Error', e.body?.message, 'error');
                    this.isLoading = false;
                });
        }
    }

    // ── User switcher ─────────────────────────────────────────────────────
    handleUserChange(evt) {
        this.isLoading      = true;
        this.stories        = [];
        this.selectedUserId = evt.detail.value;
        this.selectedDate   = null;
        this.showBreakdown  = false;
        this.activePeriod   = null;
    }

    // ── Open record in new tab ────────────────────────────────────────────
    _openInNewTab(recordId) {
        window.open(`${window.location.origin}/lightning/r/${recordId}/view`, '_blank');
    }

    handleCardNavigate(evt) {
        const tag = evt.target.tagName;
        if (['LIGHTNING-BUTTON','LIGHTNING-INPUT','BUTTON','INPUT','A'].includes(tag)) return;
        const id = evt.currentTarget.dataset.id;
        if (id) this._openInNewTab(id);
    }

    handleTimeChipNavigate(evt) {
        evt.stopPropagation();
        const id = evt.currentTarget.dataset.id;
        if (id && id !== 'pending') this._openInNewTab(id);
    }

    // ── Log single story ──────────────────────────────────────────────────
    handleLog(evt) {
        evt.stopPropagation();
        const id     = evt.target.dataset.id;
        const hrsEl  = this.template.querySelector(`lightning-input.hrs-input[data-id="${id}"]`);
        const notEl  = this.template.querySelector(`lightning-input.notes-input[data-id="${id}"]`);
        const hrs    = parseFloat((hrsEl?.value || '').replace(',', '.'));
        if (!hrs || hrs <= 0) { this._toast('Hours required', 'Enter a value > 0', 'warning'); return; }
        const story = this.stories.find(x => x.storyId === id);
        // Pass selected date if looking back
        logTime({ storyId: id, epicId: story?.epicId, hours: hrs, notes: notEl?.value || '', logDate: this.selectedDate })
            .then(newTimeId => {
                this.stories = this.stories.map(s =>
                    s.storyId === id ? { ...s, newTimeId: newTimeId || 'pending', newHours: hrs } : s
                );
                this._toast('Time logged!', `${hrs}h saved`, 'success');
                return refreshApex(this._statsWire);
            })
            .catch(e => {
                const msg = e?.body?.message || e?.body?.pageErrors?.[0]?.message || JSON.stringify(e?.body || e);
                this._toast('Error saving time', msg, 'error');
            });
    }

    // ── Skip ──────────────────────────────────────────────────────────────
    handleSkip(evt) {
        evt.stopPropagation();
        const id = evt.target.dataset.id;
        this._skippedIds.add(id);
        this.stories = this.stories.filter(s => s.storyId !== id);
    }

    // ── Edit modal ────────────────────────────────────────────────────────
    handleEdit(evt) {
        evt.stopPropagation();
        const id = evt.target.dataset.id;
        const s  = this.stories.find(x => x.storyId === id);
        if (!s) return;
        this.editStoryId   = id;
        this.editEpicId    = s.epicId;
        this.editTimeId    = s.timeEntries?.[0]?.Id || null;
        this.editHours     = s.totalHours;
        this.editNotes     = s.timeEntries?.[0]?.Additional_Comments__c || '';
        this.showEditModal = true;
    }
    handleEditHoursChange(evt) { this.editHours = evt.detail.value; }
    handleEditNotesChange(evt) { this.editNotes = evt.detail.value; }
    closeModal() { this.showEditModal = false; }

    handleEditSave() {
        const action = this.editTimeId
            ? updateTime({ timeId: this.editTimeId, hours: this.editHours, notes: this.editNotes })
            : logTime({ storyId: this.editStoryId, epicId: this.editEpicId, hours: this.editHours, notes: this.editNotes, logDate: null });
        action
            .then(() => {
                this._toast('Updated!', 'Time entry saved', 'success');
                this.closeModal();
                return Promise.all([refreshApex(this._storiesWire), refreshApex(this._statsWire)]);
            })
            .catch(e => this._toast('Error', e.body?.message, 'error'));
    }

    // ── Helpers ───────────────────────────────────────────────────────────
    _decorate(s) {
        const history = (s.history || []).map(h => ({
            id: h.id, field: h.field,
            oldValue: h.oldValue || '', newValue: h.newValue || '', hasOld: !!h.oldValue
        }));
        return {
            ...s,
            totalHours   : this._round(s.totalHours),
            priorityClass: PRIORITY_CLASSES[s.priority] || 'tag tag-low',
            rowClass     : s.hasTime ? 'story-row logged' : 'story-row needs-log',
            newTimeId    : null, newHours: null,
            history, hasHistory: history.length > 0
        };
    }
    _round(n)       { return Math.round((n || 0) * 10) / 10; }
    _toIsoDate(d)   { return d.toISOString().split('T')[0]; }
    _shortDay(d)    {
        const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        return `${days[d.getDay()]} ${d.getMonth()+1}/${d.getDate()}`;
    }
    _formatDate(iso) {
        const d = new Date(iso + 'T12:00:00');
        return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }
    _toast(t, m, v) { this.dispatchEvent(new ShowToastEvent({ title: t, message: m, variant: v })); }
}