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
import updateTimeStamps from '@salesforce/apex/EodTimeRetroController.updateTimeStamps';
import USER_ID          from '@salesforce/user/Id';
import getActiveTimer   from '@salesforce/apex/StoryBoardController.getActiveTimer';
import stopTimer        from '@salesforce/apex/StoryBoardController.stopTimer';
import getWeekEntries   from '@salesforce/apex/EodTimeRetroController.getWeekEntries';
import getMonthStats    from '@salesforce/apex/EodTimeRetroController.getMonthStats';

const PRIORITY_CLASSES = {
    'Critical' : 'tag tag-critical',
    'High'     : 'tag tag-high',
    'Medium'   : 'tag tag-medium',
    'Low'      : 'tag tag-low'
};

const PX_PER_MIN      = 0.75;  // 45px per hour — full 16h day ≈ 720px, no internal scroll needed
const MIN_SPAN_MIN    = 240;   // show at least 4 hours
const EDGE_PAD_MIN    = 30;    // 30-min padding before first / after last entry
const GAP_THRESH      = 15;    // gaps > 15 min are highlighted
const BLOCK_COLORS    = ['#0ea5e9','#8b5cf6','#f59e0b','#10b981','#ef4444','#ec4899'];
const FIXED_START_HR  = 0;    // midnight — fixed grid start
const FIXED_END_HR    = 24;   // midnight next day — fixed grid end
const GRID_HEIGHT_PX  = (FIXED_END_HR - FIXED_START_HR) * 60 * PX_PER_MIN; // 1080px

let _eodTimerInterval = null;

export default class EodTimeRetro extends NavigationMixin(LightningElement) {
    @track stories          = [];
    @track stats            = { todayHours: 0, weekHours: 0, monthHours: 0, offCalendarCount: 0, offCalendarHours: 0 };
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

    // ── Calendar view state ───────────────────────────────────────────────
    @track calendarView     = 'day';  // 'list' | 'day' | 'week' | 'month'
    @track _calendarAnchor  = null;   // null = today, JS Date = specific date
    @track _weekEntries     = [];
    @track _weekLoading     = false;
    @track _monthDayMap     = {};
    @track _monthLoading    = false;
    @track _selectedGapIdx  = null;
    @track _gapLogStoryId   = null;
    @track _gapLogHours     = '';
    @track _chipGhost       = null;  // ghost block shown during chip drag
    @track _chipSubject     = '';    // subject label shown on ghost
    _scrollAfterRender      = false;

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
    _drag       = null; // drag state during block move/resize
    _chipDrag   = null; // drag state for off-calendar chip placement
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
        this._scrollAfterRender = true;
        this._handleExternalTimerStop  = () => { if (this._timerTimeId) this._clearEodTimer(); };
        this._handleExternalTimerStart = (e) => { this._restoreEodTimer(e.detail); };
        window.addEventListener('timerstopped', this._handleExternalTimerStop);
        window.addEventListener('timerstarted',  this._handleExternalTimerStart);
    }

    renderedCallback() {
        if (this._scrollAfterRender) {
            this._scrollAfterRender = false;
            const el = this.template.querySelector('.cal-scroll');
            if (el) el.scrollTop = 360; // 8 AM = 8h × 60min × 0.75px/min from midnight
        }
    }
    disconnectedCallback() {
        if (_eodTimerInterval) clearInterval(_eodTimerInterval);
        if (this._boundDragMove)  window.removeEventListener('mousemove', this._boundDragMove);
        if (this._boundDragUp)    window.removeEventListener('mouseup',   this._boundDragUp);
        if (this._boundChipMove)  window.removeEventListener('mousemove', this._boundChipMove);
        if (this._boundChipUp)    window.removeEventListener('mouseup',   this._boundChipUp);
        window.removeEventListener('timerstopped', this._handleExternalTimerStop);
        window.removeEventListener('timerstarted',  this._handleExternalTimerStart);
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
                todayHours       : this._round(result.data.todayHours),
                weekHours        : this._round(result.data.weekHours),
                monthHours       : this._round(result.data.monthHours),
                offCalendarCount : result.data.offCalendarCount  || 0,
                offCalendarHours : this._round(result.data.offCalendarHours || 0)
            };
            // Populate current-month day map for month view
            const map = {};
            (result.data.byDay || []).forEach(d => {
                map[d.day] = Math.round((d.minutes / 60) * 10) / 10;
            });
            this._monthDayMap = map;
        }
    }

    // ── Timer getters ─────────────────────────────────────────────────────
    get hasActiveTimer() { return !!this._timerTimeId; }
    get eodTimerLabel()  { return `⏱  ${this._timerSubject}  —  ${this._timerElapsed}`; }

    // ── View toggle getters ───────────────────────────────────────────────
    get listBtnClass()  { return this.calendarView === 'list'  ? 'view-tab view-tab-active' : 'view-tab'; }
    get dayBtnClass()   { return this.calendarView === 'day'   ? 'view-tab view-tab-active' : 'view-tab'; }
    get weekBtnClass()  { return this.calendarView === 'week'  ? 'view-tab view-tab-active' : 'view-tab'; }
    get monthBtnClass() { return this.calendarView === 'month' ? 'view-tab view-tab-active' : 'view-tab'; }
    get showList()      { return this.calendarView === 'list'; }
    get showDay()       { return this.calendarView === 'day'; }
    get showWeek()      { return this.calendarView === 'week'; }
    get showMonth()     { return this.calendarView === 'month'; }
    get showCalNav()    { return this.calendarView !== 'list'; }
    get weekIsLoading() { return this._weekLoading; }

    handleViewToggle(e) {
        const view = e.currentTarget.dataset.view;
        if (view === this.calendarView) return;
        this.calendarView    = view;
        this._selectedGapIdx = null;
        if (view === 'day')   { this._scrollAfterRender = true; }
        if (view === 'week')  { this._loadWeekEntries(); this._scrollAfterRender = true; }
        if (view === 'month') { this._loadMonthStats(); }
    }

    // ── Calendar navigation ───────────────────────────────────────────────
    get calendarTitle() {
        const d = this._anchorDate();
        if (this.calendarView === 'day') {
            const isToday = this._toIsoDate(d) === this._toIsoDate(new Date());
            return isToday
                ? `Today — ${d.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' })}`
                : d.toLocaleDateString('en-US', { weekday:'short', month:'long', day:'numeric', year:'numeric' });
        }
        if (this.calendarView === 'week') {
            const sun = this._weekSunday(d);
            const sat = new Date(sun); sat.setDate(sat.getDate() + 6);
            const fmt = { month:'short', day:'numeric' };
            return `${sun.toLocaleDateString('en-US', fmt)} – ${sat.toLocaleDateString('en-US', fmt)}, ${sat.getFullYear()}`;
        }
        if (this.calendarView === 'month') {
            return d.toLocaleDateString('en-US', { month:'long', year:'numeric' });
        }
        return '';
    }

    handlePrev() {
        const d = this._anchorDate();
        if (this.calendarView === 'day')   d.setDate(d.getDate() - 1);
        if (this.calendarView === 'week')  d.setDate(d.getDate() - 7);
        if (this.calendarView === 'month') d.setMonth(d.getMonth() - 1);
        this._calendarAnchor = d;
        this._onCalendarNav();
    }
    handleNext() {
        const d = this._anchorDate();
        if (this.calendarView === 'day')   d.setDate(d.getDate() + 1);
        if (this.calendarView === 'week')  d.setDate(d.getDate() + 7);
        if (this.calendarView === 'month') d.setMonth(d.getMonth() + 1);
        this._calendarAnchor = d;
        this._onCalendarNav();
    }
    handleToday() {
        this._calendarAnchor = null;
        this.selectedDate    = null;
        this._onCalendarNav();
    }
    _onCalendarNav() {
        if (this.calendarView === 'day')   { this._loadDayData(); this._scrollAfterRender = true; }
        if (this.calendarView === 'week')  { this._loadWeekEntries(); this._scrollAfterRender = true; }
        if (this.calendarView === 'month') { this._loadMonthStats(); }
    }
    _anchorDate()   { return this._calendarAnchor ? new Date(this._calendarAnchor) : new Date(); }
    _weekSunday(d) {
        const date = d ? new Date(d) : this._anchorDate();
        date.setDate(date.getDate() - date.getDay()); // Sunday = 0, so subtracting getDay() lands on Sunday
        date.setHours(0, 0, 0, 0);
        return date;
    }
    _loadDayData() {
        const dateStr = this._calendarAnchor ? this._toIsoDate(this._anchorDate()) : null;
        this.selectedDate = dateStr;
        if (!dateStr) { refreshApex(this._storiesWire); return; }
        this.isLoading = true; this.stories = [];
        getStoriesForDate({ userId: this.selectedUserId, dateStr })
            .then(data => {
                this.stories   = data.filter(s => !this._skippedIds.has(s.storyId)).map(s => this._decorate(s));
                this.isLoading = false;
            })
            .catch(e => { this._toast('Error', e.body?.message, 'error'); this.isLoading = false; });
    }
    _loadWeekEntries() {
        const startDate = this._toIsoDate(this._weekSunday());
        this._weekLoading = true; this._weekEntries = [];
        getWeekEntries({ userId: this.selectedUserId, startDate })
            .then(data => { this._weekEntries = data; this._weekLoading = false; })
            .catch(e => { this._toast('Error', e.body?.message, 'error'); this._weekLoading = false; });
    }
    _loadMonthStats() {
        const d = this._anchorDate();
        this._monthLoading = true;
        getMonthStats({ userId: this.selectedUserId, year: d.getFullYear(), month: d.getMonth() + 1 })
            .then(data => {
                const map = {};
                (data || []).forEach(e => { map[e.day] = Math.round((e.minutes / 60) * 10) / 10; });
                this._monthDayMap  = map;
                this._monthLoading = false;
            })
            .catch(e => { this._toast('Error', e.body?.message, 'error'); this._monthLoading = false; });
    }

    handleMonthDayClick(e) {
        const dateStr = e.currentTarget.dataset.date;
        if (!dateStr) return;
        this._calendarAnchor    = new Date(dateStr + 'T12:00:00');
        this.calendarView       = 'day';
        this._scrollAfterRender = true;
        this._loadDayData();
    }

    // ── Week / Month computed getters ─────────────────────────────────────
    get weekHourLabels() {
        const labels = [];
        for (let h = FIXED_START_HR; h <= FIXED_END_HR; h++) {
            const label = h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`;
            labels.push({ key: `wh${h}`, label, style: `top:${(h - FIXED_START_HR) * 60 * PX_PER_MIN}px` });
        }
        return labels;
    }
    get weekHourLines() {
        const lines = [];
        for (let h = FIXED_START_HR; h <= FIXED_END_HR; h++) {
            lines.push({ key: `wl${h}`, style: `top:${(h - FIXED_START_HR) * 60 * PX_PER_MIN}px` });
        }
        return lines;
    }
    get weekGridStyle() { return `height:${GRID_HEIGHT_PX}px`; }

    get weekColumns() {
        const sunday   = this._weekSunday();
        const todayStr = this._toIsoDate(new Date());
        const colorMap = new Map(); let ci = 0;
        (this._weekEntries || []).forEach(e => {
            if (!colorMap.has(String(e.projectId))) colorMap.set(String(e.projectId), BLOCK_COLORS[ci++ % BLOCK_COLORS.length]);
        });
        const byDate = {};
        (this._weekEntries || []).forEach(e => {
            if (!byDate[e.loggedDate]) byDate[e.loggedDate] = [];
            byDate[e.loggedDate].push(e);
        });
        const DAY_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        return DAY_LABELS.map((lbl, i) => {
            const d       = new Date(sunday); d.setDate(d.getDate() + i);
            const dateStr = this._toIsoDate(d);
            const isToday = dateStr === todayStr;
            const fixedMs = new Date(dateStr + 'T00:00:00').getTime();
            const blocks  = (byDate[dateStr] || []).filter(e => e.startTimeMs).map(e => {
                const stopMs = e.stopTimeMs || (e.startTimeMs + (e.minutesLogged || 0) * 60000);
                const durMin = (stopMs - e.startTimeMs) / 60000;
                const topPx  = Math.max(0, (e.startTimeMs - fixedMs) / 60000 * PX_PER_MIN);
                const hPx    = Math.max(20, durMin * PX_PER_MIN);
                const h = Math.floor(durMin / 60), m = Math.round(durMin % 60);
                const wMetaLabel = [e.projectName, e.epicName].filter(Boolean).join(' › ');
                return {
                    timeId: e.timeId, storyId: e.storyId, subject: e.subject || '—', topPx,
                    metaLabel: wMetaLabel, note: e.notes || '',
                    durationLabel: h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`,
                    startMs: e.startTimeMs, stopMs, loggedDate: dateStr, dayMidnightMs: fixedMs,
                    style: `top:${topPx}px; height:${hPx}px; --tl-color:${colorMap.get(String(e.projectId)) || BLOCK_COLORS[0]};`
                };
            });
            // Only show active timer if it started within today's grid (prevents enormous overlays)
            if (isToday && this.hasActiveTimer && this._timerStartMs && this._timerStartMs >= fixedMs) {
                const durMin = (Date.now() - this._timerStartMs) / 60000;
                const topPx  = Math.max(0, (this._timerStartMs - fixedMs) / 60000 * PX_PER_MIN);
                const maxH   = GRID_HEIGHT_PX - topPx;
                const hPx    = Math.min(maxH, Math.max(20, durMin * PX_PER_MIN));
                blocks.push({
                    timeId: this._timerTimeId, storyId: this._timerCaseId, subject: this._timerSubject,
                    metaLabel: '', topPx, durationLabel: this._timerElapsed,
                    style: `top:${topPx}px; height:${hPx}px; --tl-color:#00b4d8;`
                });
            }
            return {
                key: dateStr, dateStr, dayLabel: lbl,
                dateLabel: `${d.getMonth()+1}/${d.getDate()}`,
                isToday, headerClass: isToday ? 'week-col-header week-col-today' : 'week-col-header',
                blocks
            };
        });
    }

    get monthGrid() {
        const anchor  = this._anchorDate();
        const year    = anchor.getFullYear(), month = anchor.getMonth();
        const today   = this._toIsoDate(new Date());
        const lastDay = new Date(year, month + 1, 0).getDate();
        let startDow  = new Date(year, month, 1).getDay();
        startDow      = startDow === 0 ? 6 : startDow - 1; // Mon-based
        const weeks = []; let week = [];
        for (let i = 0; i < startDow; i++) week.push({ key: `e${i}`, isEmpty: true });
        for (let day = 1; day <= lastDay; day++) {
            const d       = new Date(year, month, day);
            const dateStr = this._toIsoDate(d);
            const hours   = this._monthDayMap[dateStr] || 0;
            const isToday = dateStr === today;
            week.push({
                key: dateStr, dateStr, dayNum: day, isEmpty: false,
                hours, hasHours: hours > 0, hoursLabel: hours > 0 ? `${hours}h` : '', isToday,
                cellClass: 'month-cell' + (isToday ? ' month-cell-today' : '') + (hours > 0 ? ' month-cell-has-time' : '')
            });
            if (week.length === 7) { weeks.push({ key: week[0].key, days: week }); week = []; }
        }
        if (week.length > 0) {
            while (week.length < 7) week.push({ key: `t${week.length}`, isEmpty: true });
            weeks.push({ key: week[0].key, days: week });
        }
        return { weeks };
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
                        timeId      : te.timeId,
                        storyId     : s.storyId,
                        subject     : s.subject,
                        caseNumber  : s.caseNumber,
                        projectId   : s.projectId,
                        projectName : s.projectName || '',
                        epicName    : s.epicName    || '',
                        note        : te.note       || '',
                        startMs     : te.startTimeMs,
                        stopMs      : te.stopTimeMs || (te.startTimeMs + (te.minutesLogged || 0) * 60000),
                        color       : colorMap.get(s.projectId)
                    });
                }
            });
        });

        // 2. Fixed midnight→midnight grid (always shows all 24 hours)
        const anchorDay = this._calendarAnchor ? new Date(this._calendarAnchor) : new Date();
        anchorDay.setHours(0, 0, 0, 0);
        const gridStartMs = anchorDay.getTime();
        const gridEndMs   = gridStartMs + 24 * 3600000;
        const totalPx     = 24 * 60 * PX_PER_MIN;

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
            const metaLabel = [e.projectName, e.epicName].filter(Boolean).join(' › ');
            return {
                timeId: e.timeId,
                storyId: e.storyId,
                subject: e.subject,
                caseNumber: e.caseNumber,
                metaLabel,
                note: e.note,
                startMs: e.startMs,
                stopMs: e.stopMs,
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
        // Hide stale timers that started before today's grid — they'd render as enormous overlays
        if (this._timerStartMs < td.gridStartMs) return 'display:none;';
        const topPx    = Math.max(0, ((this._timerStartMs - td.gridStartMs) / 60000) * PX_PER_MIN);
        const maxH     = GRID_HEIGHT_PX - topPx;
        const heightPx = Math.min(maxH, Math.max(20, ((Date.now() - this._timerStartMs) / 60000) * PX_PER_MIN));
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

    // ── Off-calendar entries (logged but no Start_Time__c) ───────────────
    get offCalendarEntries() {
        const view = this.calendarView;
        if (view === 'day' || view === 'list') {
            const colorMap = new Map(); let ci = 0;
            const entries = [];
            (this.stories || []).forEach(s => {
                const k = String(s.projectId);
                if (!colorMap.has(k)) colorMap.set(k, BLOCK_COLORS[ci++ % BLOCK_COLORS.length]);
                const color = colorMap.get(k) || BLOCK_COLORS[0];
                (s.timeEntries || []).forEach(te => {
                    if (!te.startTimeMs) {
                        entries.push({
                            timeId     : te.timeId,
                            subject    : s.subject,
                            hours      : te.hoursLogged || 0,
                            durationMs : Math.max(15, Number(te.minutesLogged) || 0) * 60000,
                            loggedDate : this.selectedDate || this._toIsoDate(new Date()),
                            color,
                            chipStyle  : `--chip-color:${color};`
                        });
                    }
                });
            });
            return entries;
        }
        if (view === 'week') {
            const colorMap = new Map(); let ci = 0;
            return (this._weekEntries || [])
                .filter(e => !e.startTimeMs)
                .map(e => {
                    const k = String(e.projectId);
                    if (!colorMap.has(k)) colorMap.set(k, BLOCK_COLORS[ci++ % BLOCK_COLORS.length]);
                    const color = colorMap.get(k) || BLOCK_COLORS[0];
                    const mins  = Number(e.minutesLogged) || 0;
                    return {
                        timeId     : e.timeId,
                        subject    : e.subject || '—',
                        hours      : Math.round((mins / 60) * 10) / 10,
                        durationMs : Math.max(15, mins) * 60000,
                        loggedDate : e.loggedDate,
                        color,
                        chipStyle  : `--chip-color:${color};`
                    };
                });
        }
        return [];
    }
    get offCalendarCount()  {
        if (this.calendarView === 'month') return this.stats.offCalendarCount || 0;
        return this.offCalendarEntries.length;
    }
    get offCalendarHours()  {
        if (this.calendarView === 'month') return this.stats.offCalendarHours || 0;
        return Math.round(this.offCalendarEntries.reduce((s, e) => s + (e.hours || 0), 0) * 10) / 10;
    }
    get hasOffCalendar()    { return this.offCalendarCount > 0; }
    get showOffCalTray()    { return this.hasOffCalendar && (this.calendarView === 'day' || this.calendarView === 'week'); }
    get chipGhost()         { return this._chipGhost; }

    // ── Chip drag: place off-calendar entry onto timeline ────────────────
    handleChipMouseDown(e) {
        if (e.button !== 0) return;
        const el     = e.currentTarget;
        const timeId = el.dataset.id;
        const entry  = this.offCalendarEntries.find(en => en.timeId === timeId);
        if (!entry) return;
        e.preventDefault();
        this._chipSubject = entry.subject;
        this._chipDrag    = { el, timeId, durationMs: entry.durationMs, color: entry.color };
        el.style.opacity  = '0.4';
        this._boundChipMove = this._onChipMouseMove.bind(this);
        this._boundChipUp   = this._onChipMouseUp.bind(this);
        window.addEventListener('mousemove', this._boundChipMove);
        window.addEventListener('mouseup',   this._boundChipUp);
    }

    _onChipMouseMove(e) {
        const d = this._chipDrag;
        if (!d) return;
        const SNAP_MIN    = 15;
        const durationMin = Math.max(SNAP_MIN, Math.round((d.durationMs / 60000) / SNAP_MIN) * SNAP_MIN);
        const heightPx    = Math.max(11.25, durationMin * PX_PER_MIN);

        if (this.calendarView === 'day') {
            const grid = this.template.querySelector('.timeline-grid');
            if (!grid) { this._chipGhost = null; return; }
            const rect = grid.getBoundingClientRect();
            if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
                this._chipGhost = null; return;
            }
            const snapMin    = Math.round(((e.clientY - rect.top) / PX_PER_MIN) / SNAP_MIN) * SNAP_MIN;
            const clampedMin = Math.max(0, Math.min(snapMin, 24 * 60 - durationMin));
            const anchor     = this._calendarAnchor ? new Date(this._calendarAnchor) : new Date();
            anchor.setHours(0, 0, 0, 0);
            this._chipGhost = {
                style      : `position:fixed;top:${rect.top + clampedMin * PX_PER_MIN}px;left:${rect.left + 4}px;width:${rect.width - 8}px;height:${heightPx}px;--ghost-bg:${d.color};`,
                snapMin    : clampedMin,
                midnightMs : anchor.getTime(),
                dateStr    : this._toIsoDate(anchor)
            };
        } else if (this.calendarView === 'week') {
            const colGrids = Array.from(this.template.querySelectorAll('.week-col-grid'));
            const cols     = this.weekColumns;
            let ghost = null;
            for (let i = 0; i < colGrids.length; i++) {
                const rect = colGrids[i].getBoundingClientRect();
                if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
                    const snapMin    = Math.round(((e.clientY - rect.top) / PX_PER_MIN) / SNAP_MIN) * SNAP_MIN;
                    const clampedMin = Math.max(0, Math.min(snapMin, 24 * 60 - durationMin));
                    ghost = {
                        style      : `position:fixed;top:${rect.top + clampedMin * PX_PER_MIN}px;left:${rect.left + 2}px;width:${rect.width - 4}px;height:${heightPx}px;--ghost-bg:${d.color};`,
                        snapMin    : clampedMin,
                        midnightMs : new Date(cols[i].dateStr + 'T00:00:00').getTime(),
                        dateStr    : cols[i].dateStr
                    };
                    break;
                }
            }
            this._chipGhost = ghost;
        } else {
            this._chipGhost = null;
        }
    }

    _onChipMouseUp(e) {
        window.removeEventListener('mousemove', this._boundChipMove);
        window.removeEventListener('mouseup',   this._boundChipUp);
        const d     = this._chipDrag;
        const ghost = this._chipGhost;
        this._chipDrag    = null;
        this._chipGhost   = null;
        this._chipSubject = '';
        if (!d) return;
        if (d.el) d.el.style.opacity = '';
        if (!ghost) return; // released outside grid — cancel
        const startMs = ghost.midnightMs + ghost.snapMin * 60000;
        const stopMs  = startMs + Math.max(15 * 60000, d.durationMs);
        updateTimeStamps({ timeId: d.timeId, startTimeMs: startMs, stopTimeMs: stopMs, loggedDate: ghost.dateStr })
            .then(() => {
                if (this.calendarView === 'day') return refreshApex(this._storiesWire);
                this._loadWeekEntries();
            })
            .catch(err => this._toast('Error placing entry', err.body?.message, 'error'));
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

    // Stat card classes — highlight active view
    get statCardTodayClass() { return this.calendarView === 'day'   ? 'stat-card stat-card-active' : 'stat-card stat-card-clickable'; }
    get statCardWeekClass()  { return this.calendarView === 'week'  ? 'stat-card stat-card-active' : 'stat-card stat-card-clickable'; }
    get statCardMonthClass() { return this.calendarView === 'month' ? 'stat-card stat-card-active' : 'stat-card stat-card-clickable'; }
    get statCardLogClass()   { return this.calendarView === 'list'  ? 'stat-card stat-card-active stat-card-log-today' : 'stat-card stat-card-clickable stat-card-log-today'; }

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

    // ── Stat card click → switch calendar view ───────────────────────────
    handleStatClick(evt) {
        const period  = evt.currentTarget.dataset.period;
        const viewMap = { today: 'day', week: 'week', month: 'month' };
        const view    = viewMap[period];
        if (!view) return;
        this.calendarView    = view;
        this._calendarAnchor = null;
        this._selectedGapIdx = null;
        if (view === 'day')   { this._scrollAfterRender = true; }
        if (view === 'week')  { this._loadWeekEntries(); this._scrollAfterRender = true; }
        if (view === 'month') { this._loadMonthStats(); }
    }

    handleCloseBreakdown() {
        this.calendarView  = 'list';
        this.showBreakdown = false;
        this.activePeriod  = null;
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
        this.isLoading       = true;
        this.stories         = [];
        this.selectedUserId  = evt.detail.value;
        this.selectedDate    = null;
        this._calendarAnchor = null;
        this._weekEntries    = [];
        this._monthDayMap    = {};
        this.showBreakdown   = false;
        this.activePeriod    = null;
        if (this.calendarView === 'week')  this._loadWeekEntries();
        if (this.calendarView === 'month') this._loadMonthStats();
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

    handleBlockClick(evt) {
        const id = evt.currentTarget.dataset.id;
        if (id) this._openInNewTab(id);
    }

    // ── Block drag-and-drop ───────────────────────────────────────────────
    handleBlockMouseDown(e) {
        if (e.button !== 0) return;
        const el     = e.currentTarget;
        const timeId = el.dataset.id;
        if (!timeId) return;

        const isResize = e.target.classList.contains('tl-resize-handle');
        const view     = this.calendarView;
        let block, loggedDate, dayMidnightMs, colRects = null;

        if (view === 'day') {
            block = (this.timelineData.blocks || []).find(b => b.timeId === timeId);
            const anchor = this._calendarAnchor ? new Date(this._calendarAnchor) : new Date();
            anchor.setHours(0, 0, 0, 0);
            dayMidnightMs = anchor.getTime();
            loggedDate    = this._toIsoDate(anchor);
        } else {
            for (const col of this.weekColumns) {
                const b = col.blocks.find(b => b.timeId === timeId);
                if (b) { block = b; loggedDate = b.loggedDate; dayMidnightMs = b.dayMidnightMs; break; }
            }
            colRects = Array.from(this.template.querySelectorAll('.week-col-grid')).map((colEl, i) => ({
                rect     : colEl.getBoundingClientRect(),
                dateStr  : this.weekColumns[i].dateStr,
                midnightMs: new Date(this.weekColumns[i].dateStr + 'T00:00:00').getTime()
            }));
        }
        // Always continue — block metadata may be absent for newly placed entries,
        // but click-to-navigate must still work.
        e.preventDefault();

        this._drag = {
            el, timeId, view,
            mode         : isResize ? 'resize' : 'move',
            startMouseY  : e.clientY,
            startMouseX  : e.clientX,
            origTopPx    : block?.topPx    ?? 0,
            origHeightPx : block?.heightPx ?? 20,
            origStartMs  : block?.startMs  ?? 0,
            origStopMs   : block?.stopMs   ?? 0,
            canDrag      : !!block,
            loggedDate   : loggedDate   ?? '',
            dayMidnightMs: dayMidnightMs ?? 0,
            colRects
        };
        this._boundDragMove = this._onDragMouseMove.bind(this);
        this._boundDragUp   = this._onDragMouseUp.bind(this);
        window.addEventListener('mousemove', this._boundDragMove);
        window.addEventListener('mouseup',   this._boundDragUp);
    }

    _onDragMouseMove(e) {
        const d = this._drag;
        if (!d || !d.canDrag) return;
        const dy = e.clientY - d.startMouseY;
        if (d.mode === 'resize') {
            d.el.style.height = `${Math.max(11.25, d.origHeightPx + dy)}px`;
        } else {
            const dx = d.view === 'week' ? e.clientX - d.startMouseX : 0;
            d.el.style.transform  = `translate(${dx}px, ${dy}px)`;
            d.el.style.zIndex     = '1000';
            d.el.style.opacity    = '0.85';
            d.el.style.boxShadow  = '0 8px 24px rgba(0,0,0,0.25)';
        }
    }

    _onDragMouseUp(e) {
        window.removeEventListener('mousemove', this._boundDragMove);
        window.removeEventListener('mouseup',   this._boundDragUp);
        const d = this._drag;
        this._drag = null;
        if (!d) return;

        // Reset inline styles set during drag
        d.el.style.transform = '';
        d.el.style.zIndex    = '';
        d.el.style.opacity   = '';
        d.el.style.boxShadow = '';
        d.el.style.height    = '';

        const dy   = e.clientY - d.startMouseY;
        const dx   = e.clientX - d.startMouseX;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Short tap or no block metadata → navigate to record, no Apex call
        if (dist < 5 || !d.canDrag) { this._openInNewTab(d.timeId); return; }

        const SNAP_MIN = 15;
        const SNAP_PX  = SNAP_MIN * PX_PER_MIN;
        let newStartMs, newStopMs, newLoggedDate;

        if (d.mode === 'resize') {
            const rawH    = Math.max(SNAP_PX, d.origHeightPx + dy);
            const durMin  = Math.round((rawH / PX_PER_MIN) / SNAP_MIN) * SNAP_MIN;
            newStartMs    = d.origStartMs;
            newStopMs     = d.origStartMs + Math.max(SNAP_MIN, durMin) * 60000;
            newLoggedDate = d.loggedDate;
        } else {
            let targetMidnightMs = d.dayMidnightMs;
            newLoggedDate        = d.loggedDate;
            if (d.view === 'week' && d.colRects) {
                const col = d.colRects.find(c => e.clientX >= c.rect.left && e.clientX < c.rect.right);
                if (col) { targetMidnightMs = col.midnightMs; newLoggedDate = col.dateStr; }
            }
            const rawStartMin  = (d.origTopPx + dy) / PX_PER_MIN;
            const snapStartMin = Math.round(rawStartMin / SNAP_MIN) * SNAP_MIN;
            const clampedMin   = Math.max(0, Math.min(snapStartMin, 24 * 60 - SNAP_MIN));
            const durMs        = d.origStopMs - d.origStartMs;
            newStartMs = targetMidnightMs + clampedMin * 60000;
            newStopMs  = newStartMs + durMs;
        }

        updateTimeStamps({ timeId: d.timeId, startTimeMs: newStartMs, stopTimeMs: newStopMs, loggedDate: newLoggedDate })
            .then(() => {
                if (d.view === 'day') return refreshApex(this._storiesWire);
                this._loadWeekEntries();
            })
            .catch(err => this._toast('Error moving block', err.body?.message, 'error'));
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
        this.editStoryId = id;
        this.editEpicId  = s.epicId;
        this.editTimeId  = s.timeEntries?.[0]?.timeId || null;
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
    _clearEodTimer() {
        if (_eodTimerInterval) clearInterval(_eodTimerInterval);
        _eodTimerInterval  = null;
        this._timerTimeId  = null;
        this._timerElapsed = '';
        this._timerNotes   = '';
    }

    // ── Timer handlers ────────────────────────────────────────────────────
    handleEodTimerNotesChange(e) { this._timerNotes = e.target.value; }

    async handleEodStopTimer() {
        const timeId      = this._timerTimeId;
        const notes       = this._timerNotes;
        const savedTimer  = { timeId, caseId: this._timerCaseId, subject: this._timerSubject, startTimeMs: this._timerStartMs };
        this._clearEodTimer();                    // own UI clears immediately
        try {
            await stopTimer({ timeId, notes });   // wait for DB commit
            window.dispatchEvent(new CustomEvent('timerstopped')); // then notify storyBoard
            refreshApex(this._storiesWire);
            refreshApex(this._statsWire);
        } catch(err) {
            this._restoreEodTimer(savedTimer);    // put the banner back — DB was NOT updated
            this._toast('Could not stop timer', err?.body?.message || 'Please try again.', 'error');
        }
    }
}