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
import getActiveTimer   from '@salesforce/apex/StoryBoardController.getActiveTimer';
import stopTimer        from '@salesforce/apex/StoryBoardController.stopTimer';

const PRIORITY_CLASSES = {
    'Critical' : 'tag tag-critical',
    'High'     : 'tag tag-high',
    'Medium'   : 'tag tag-medium',
    'Low'      : 'tag tag-low'
};

const PX_PER_MIN   = 1.5;   // 90px per hour
const MIN_SPAN_MIN = 240;   // show at least 4 hours
const EDGE_PAD_MIN = 30;    // 30-min padding before first / after last entry
const GAP_THRESH   = 15;    // gaps > 15 min are highlighted
const BLOCK_COLORS = ['#0ea5e9','#8b5cf6','#f59e0b','#10b981','#ef4444','#ec4899'];

let _eodTimerInterval = null;

export default class EodTimeRetro extends NavigationMixin(LightningElement) {
    @track stories          = [];
    @track stats            = { todayHours: 0, weekHours: 0, monthHours: 0 };
    @track isLoading        = true;
    @track showEditModal    = false;
    @track userOptions      = [];
    @track selectedUserId   = USER_ID;

    // ── Active Timer state ────────────────────────────────────────────────
    @track _timerTimeId   = null;
    @track _timerCaseId   = null;
    @track _timerSubject  = '';
    @track _timerStartMs  = 0;
    @track _timerElapsed  = '';
    @track _timerNotes    = '';

    // ── Timeline state ────────────────────────────────────────────────────
    @track showTimeline    = false;
    @track _selectedGapIdx = null;
    @track _gapLogStoryId  = null;
    @track _gapLogHours    = '';

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
    _skippedIds = new Set(); // persisted to localStorage by date key

    _skipKey() { return `eod_skipped_${new Date().toISOString().split('T')[0]}`; }

    connectedCallback() {
        try {
            const stored = localStorage.getItem(this._skipKey());
            if (stored) this._skippedIds = new Set(JSON.parse(stored));
        } catch(e) { /* localStorage unavailable */ }
        getActiveTimer()
            .then(w => { if (w) this._restoreEodTimer(w); })
            .catch(() => {});
    }
    disconnectedCallback() {
        if (_eodTimerInterval) clearInterval(_eodTimerInterval);
    }

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

    // ── Timer getters ─────────────────────────────────────────────────────
    get hasActiveTimer() { return !!this._timerTimeId; }
    get eodTimerLabel()  { return `⏱  ${this._timerSubject}  —  ${this._timerElapsed}`; }

    // ── View toggle getters ───────────────────────────────────────────────
    get storyListBtnClass() { return !this.showTimeline ? 'view-tab view-tab-active' : 'view-tab'; }
    get timelineBtnClass()  { return  this.showTimeline ? 'view-tab view-tab-active' : 'view-tab'; }

    handleViewToggle(e) {
        this.showTimeline    = e.currentTarget.dataset.view === 'timeline';
        this._selectedGapIdx = null;
    }

    // ── Timeline data getter ──────────────────────────────────────────────
    get timelineData() {
        // 1. Collect all entries with timestamps
        const entries = [];
        const colorMap = new Map();
        let colorIdx = 0;
        (this.stories || []).forEach(s => {
            if (!colorMap.has(s.projectId)) {
                colorMap.set(s.projectId, BLOCK_COLORS[colorIdx % BLOCK_COLORS.length]);
                colorIdx++;
            }
            (s.timeEntries || []).forEach(te => {
                if (te.startTimeMs) {
                    entries.push({
                        timeId   : te.timeId,
                        subject  : s.subject,
                        caseNumber: s.caseNumber,
                        projectId: s.projectId,
                        startMs  : te.startTimeMs,
                        stopMs   : te.stopTimeMs || (te.startTimeMs + (te.minutesLogged || 0) * 60000),
                        color    : colorMap.get(s.projectId)
                    });
                }
            });
        });

        if (entries.length === 0 && !this.hasActiveTimer) {
            return { hourLabels: [], hourLines: [], blocks: [], gaps: [], gridStartMs: 0, gridStyle: 'height:360px' };
        }

        // 2. Compute grid bounds
        let minStart = Infinity, maxStop = -Infinity;
        entries.forEach(e => {
            if (e.startMs < minStart) minStart = e.startMs;
            if (e.stopMs  > maxStop)  maxStop  = e.stopMs;
        });
        if (this.hasActiveTimer && this._timerStartMs) {
            if (this._timerStartMs < minStart) minStart = this._timerStartMs;
            if (Date.now() > maxStop)           maxStop  = Date.now();
        }
        if (!isFinite(minStart)) {
            // active timer only
            minStart = this._timerStartMs;
            maxStop  = Date.now();
        }

        const padMs      = EDGE_PAD_MIN * 60000;
        const rawStart   = minStart - padMs;
        const rawEnd     = maxStop  + padMs;
        const gridStartMs = Math.floor(rawStart / 3600000) * 3600000;
        let   gridEndMs   = Math.ceil(rawEnd    / 3600000) * 3600000;

        const spanMin = (gridEndMs - gridStartMs) / 60000;
        if (spanMin < MIN_SPAN_MIN) gridEndMs = gridStartMs + MIN_SPAN_MIN * 60000;

        const totalPx = (gridEndMs - gridStartMs) / 60000 * PX_PER_MIN;

        // 3. Hour labels + lines
        const hourLabels = [], hourLines = [];
        for (let t = gridStartMs; t <= gridEndMs; t += 3600000) {
            const h      = new Date(t).getHours();
            const label  = h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`;
            const topPx  = (t - gridStartMs) / 60000 * PX_PER_MIN;
            hourLabels.push({ label, topPx, style: `top:${topPx}px` });
            hourLines.push({ key: String(t), style: `top:${topPx}px` });
        }

        // 4. Blocks
        const blocks = entries.map(e => {
            const durationMin  = (e.stopMs - e.startMs) / 60000;
            const topPx        = (e.startMs - gridStartMs) / 60000 * PX_PER_MIN;
            const heightPx     = Math.max(20, durationMin * PX_PER_MIN);
            const h = Math.floor(durationMin / 60);
            const m = Math.round(durationMin % 60);
            const durationLabel = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
            return {
                timeId: e.timeId,
                subject: e.subject,
                caseNumber: e.caseNumber,
                topPx, heightPx, durationLabel,
                style: `top:${topPx}px; height:${heightPx}px; --tl-color:${e.color};`,
                isActive: false
            };
        });

        // 5. Gaps
        const sorted = [...blocks].sort((a, b) => a.topPx - b.topPx);
        const gaps = [];
        for (let i = 0; i < sorted.length - 1; i++) {
            const gapTopPx    = sorted[i].topPx + sorted[i].heightPx;
            const gapBotPx    = sorted[i + 1].topPx;
            const gapHeightPx = gapBotPx - gapTopPx;
            const minutes     = gapHeightPx / PX_PER_MIN;
            if (minutes > GAP_THRESH && gapHeightPx > 0) {
                const isSelected = i === this._selectedGapIdx;
                gaps.push({
                    index       : i,
                    topPx       : gapTopPx,
                    heightPx    : gapHeightPx,
                    minutes,
                    minutesLabel: `${Math.round(minutes)} min`,
                    isSelected,
                    cssClass    : 'tl-gap' + (isSelected ? ' tl-gap-selected' : ''),
                    style       : `top:${gapTopPx}px; height:${Math.max(20, gapHeightPx)}px;`
                });
            }
        }

        return { hourLabels, hourLines, blocks, gaps, gridStartMs, gridStyle: `height:${totalPx}px` };
    }

    get activeTimerBlockStyle() {
        const td = this.timelineData;
        if (!this.hasActiveTimer || !td) return 'display:none;';
        const topPx    = Math.max(0, ((this._timerStartMs - td.gridStartMs) / 60000) * PX_PER_MIN);
        const heightPx = Math.max(20, ((Date.now() - this._timerStartMs) / 60000) * PX_PER_MIN);
        return `top:${topPx}px; height:${heightPx}px; --tl-color:#00b4d8;`;
    }

    // ── Gap getters ───────────────────────────────────────────────────────
    get selectedGap()           { return this._selectedGapIdx != null ? this.timelineData?.gaps?.[this._selectedGapIdx] : null; }
    get unloggedStoriesForGap() { return this.stories.filter(s => !s.hasTime && !s.newTimeId); }
    get gapLogStory()           { return this._gapLogStoryId ? this.stories.find(s => s.storyId === this._gapLogStoryId) : null; }
    get gapLogReady()           { return !!this._gapLogStoryId && parseFloat(this._gapLogHours) > 0; }
    get gapLogNotReady()        { return !this.gapLogReady; }

    // ── Gap handlers ──────────────────────────────────────────────────────
    handleGapClick(e) {
        const idx = parseInt(e.currentTarget.dataset.index, 10);
        this._selectedGapIdx = this._selectedGapIdx === idx ? null : idx;
        this._gapLogStoryId  = null;
        this._gapLogHours    = '';
    }
    handleGapClose() { this._selectedGapIdx = null; this._gapLogStoryId = null; }
    handleGapStoryPick(e) {
        this._gapLogStoryId = e.currentTarget.dataset.id;
        const gap = this.selectedGap;
        this._gapLogHours = gap ? String(Math.round(gap.minutes / 6) / 10) : '';
    }
    handleGapHoursChange(e) { this._gapLogHours = e.target.value; }
    async handleGapLog() {
        const storyId = this._gapLogStoryId;
        const story   = this.stories.find(s => s.storyId === storyId);
        const hrs     = parseFloat(this._gapLogHours);
        if (!storyId || !hrs || hrs <= 0) return;
        this._selectedGapIdx = null; this._gapLogStoryId = null;
        try {
            await logTime({ storyId, epicId: story?.epicId, hours: hrs, notes: '', logDate: this.selectedDate });
            await Promise.all([refreshApex(this._storiesWire), refreshApex(this._statsWire)]);
        } catch(err) { this._toast('Error', err.body?.message, 'error'); }
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
        try {
            localStorage.setItem(this._skipKey(), JSON.stringify([...this._skippedIds]));
        } catch(e) { /* localStorage unavailable */ }
    }

    // ── Edit modal ────────────────────────────────────────────────────────
    handleEdit(evt) {
        evt.stopPropagation();
        const id = evt.target.dataset.id;
        const s  = this.stories.find(x => x.storyId === id);
        if (!s) return;
        this.editStoryId   = id;
        this.editEpicId    = s.epicId;
        this.editTimeId    = s.timeEntries?.[0]?.timeId || null;
        this.editHours     = s.totalHours;
        this.editNotes     = s.timeEntries?.[0]?.note || '';
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
            oldValue: h.oldValue || '', newValue: h.newValue || '', hasOld: !!h.oldValue,
            createdDate: h.createdDate || ''
        }));
        const suggested = s.suggestedHours != null && s.suggestedHours > 0
            ? this._round(s.suggestedHours) : null;
        const eventLabels = (s.timeEntries || [])
            .filter(te => te.fromEvent && te.displayLabel)
            .map(te => te.displayLabel);
        const storyLabel = eventLabels.length > 0
            ? `${s.subject} \u2014 ${eventLabels.join(', ')}`
            : s.subject;
        return {
            ...s,
            totalHours        : this._round(s.totalHours),
            priorityClass     : PRIORITY_CLASSES[s.priority] || 'tag tag-low',
            rowClass          : s.hasTime ? 'story-row logged' : 'story-row needs-log',
            newTimeId         : null, newHours: null,
            suggestedHours    : suggested,
            hasSuggestedHours : suggested != null,
            storyLabel,
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

    // ── Timer helpers ─────────────────────────────────────────────────────
    _restoreEodTimer(w) {
        this._timerTimeId  = w.timeId;
        this._timerCaseId  = w.caseId;
        this._timerSubject = w.subject;
        this._timerStartMs = w.startTimeMs;
        if (_eodTimerInterval) clearInterval(_eodTimerInterval);
        _eodTimerInterval = setInterval(() => {
            const ms = Date.now() - this._timerStartMs;
            const h  = Math.floor(ms / 3600000);
            const m  = Math.floor((ms % 3600000) / 60000);
            const s  = Math.floor((ms % 60000) / 1000);
            this._timerElapsed =
                `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        }, 1000);
    }

    // ── Timer handlers ────────────────────────────────────────────────────
    handleEodTimerNotesChange(e) { this._timerNotes = e.target.value; }

    async handleEodStopTimer() {
        const timeId = this._timerTimeId;
        const notes  = this._timerNotes;
        if (_eodTimerInterval) clearInterval(_eodTimerInterval);
        _eodTimerInterval = null;
        this._timerTimeId  = null;
        this._timerElapsed = '';
        this._timerNotes   = '';
        try {
            await stopTimer({ timeId, notes });
            refreshApex(this._storiesWire);
            refreshApex(this._statsWire);
        } catch(err) { console.error('eod stopTimer', err); }
    }
}