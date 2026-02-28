// force-app/main/default/lwc/sprintPlanner/sprintPlanner.js
import { LightningElement, track, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { subscribe, MessageContext } from 'lightning/messageService';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import STORY_SUBMITTED_CHANNEL  from '@salesforce/messageChannel/StorySubmitted__c';
import PROJECT_SELECTED_CHANNEL from '@salesforce/messageChannel/ProjectSelected__c';
import getProjects         from '@salesforce/apex/SprintPlannerController.getProjects';
import getPlannerData      from '@salesforce/apex/SprintPlannerController.getPlannerData';
import updateHoursEstimate from '@salesforce/apex/SprintPlannerController.updateHoursEstimate';
import assignToSprint      from '@salesforce/apex/StoryBoardController.assignToSprint';
import removeFromSprint    from '@salesforce/apex/StoryBoardController.removeFromSprint';

const PRIORITY_ORDER = { 'Critical': 0, 'High': 1, 'Medium': 2, 'Low': 3, '': 4 };
const PRIORITY_CLASSES = {
    'Low':      'priority-badge priority-low',
    'Medium':   'priority-badge priority-medium',
    'High':     'priority-badge priority-high',
    'Critical': 'priority-badge priority-critical'
};

export default class SprintPlanner extends NavigationMixin(LightningElement) {

    @track project           = null;
    @track allStories        = [];
    @track sprintMap         = {};
    @track dragId            = null;
    @track activeDropZone    = null;
    @track tooltipStory      = null;
    @track tooltipStyle      = '';
    @track projectOptions    = [];
    @track selectedProjectId = 'all';

    get departmentOptions() {
        const depts = [...new Set(this.allStories.map(s => s.department).filter(Boolean))].sort();
        return depts;
    }

    isLoading      = true;
    errorMessage   = '';
    filterPriority = '';
    filterDept     = '';
    sortBy         = 'default';
    _tooltipTimer  = null;
    _wiredPlannerResult;
    _subscription  = null;

    _setProject(id) {
        this.selectedProjectId = id || 'all';
    }

    get _apexProjectId() {
        return this.selectedProjectId === 'all' ? null : this.selectedProjectId;
    }

    connectedCallback() {
        this.loadPlannerData();
    }

    loadPlannerData() {
        this.isLoading = true;
        console.log('[SprintPlanner] loadPlannerData called, _apexProjectId:', this._apexProjectId);
        getPlannerData({ projectId: this._apexProjectId })
            .then(data => {
                console.log('[SprintPlanner] getPlannerData success, projects:', data?.projects?.length, 'stories:', data?.stories?.length);
                const projects = data.projects || [];
                this.project = projects.length === 1
                    ? projects[0]
                    : projects.length > 1
                        ? this._mergeProjects(projects)
                        : null;
                this.allStories = (data.stories || []).map(s => this.mapStory(s));
                this.sprintMap  = this._buildSprintMapFromStories(this.allStories);
                this.errorMessage = '';
            })
            .catch(err => {
                console.error('[SprintPlanner] getPlannerData error:', err);
                this.errorMessage = err?.body?.message || 'Failed to load planner data.';
            })
            .finally(() => {
                this.isLoading = false;
                requestAnimationFrame(() => this._scrollToCurrentSprint());
                // Native <select> doesn't react to JS property changes — set it imperatively
                requestAnimationFrame(() => {
                    const sel = this.template.querySelector('.project-select');
                    if (sel) sel.value = this.selectedProjectId;
                });
            });
    }

    _scrollToCurrentSprint() {
        if (!this.project || !this.sprints.length) return;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Find the sprint whose week contains today, using actual stored end dates
        const currentSprint = this.sprints.find(w => {
            const start = this._parseDate(w.weekStartDate);
            const end   = this._parseDate(w.weekEndDate);
            return today >= start && today <= end;
        }) || this.sprints[0];

        if (!currentSprint) return;

        // Find the DOM element for this sprint column and scroll it into view
        const sprintsScroll = this.template.querySelector('.sprints-scroll');
        const col = this.template.querySelector(
            `[data-week="${currentSprint.weekLabel}"]`
        )?.closest('.sprint-col');

        if (sprintsScroll && col) {
            sprintsScroll.scrollLeft = col.offsetLeft - 16;
        }
    }

    @wire(MessageContext)
    wiredMessageContext(ctx) {
        if (ctx && !this._subscription) {
            this._subscription = subscribe(ctx, STORY_SUBMITTED_CHANNEL, () => {
                this.loadPlannerData();
            });
            subscribe(ctx, PROJECT_SELECTED_CHANNEL, ({ projectId }) => {
                console.log('[SprintPlanner] LMS received projectId:', projectId);
                this.sprintMap    = {};
                this.allStories   = [];
                this.project      = null;
                this.tooltipStory = null;
                this._setProject(projectId);
                console.log('[SprintPlanner] selectedProjectId:', this.selectedProjectId, '_apexProjectId:', this._apexProjectId);
                this.loadPlannerData();
            });
        }
    }

    @wire(getProjects)
    wiredProjects({ data }) {
        if (data && data.length > 0) {
            this.projectOptions = [
                { label: 'All In Progress', value: 'all' },
                ...data.map(p => ({ label: p.Name, value: p.Id }))
            ];
        }
    }

    _buildSprintMapFromStories(stories) {
        const map = { backlog: [] };
        stories.forEach(s => {
            if (s.sprintWeek) {
                const label = `Week ${s.sprintWeek}`;
                if (!map[label]) map[label] = [];
                map[label].push(s.id);
            } else {
                map.backlog.push(s.id);
            }
        });
        return map;
    }

    _mergeProjects(projects) {
        const starts  = projects.map(p => this._parseDate(p.Project_Start_Date__c)).filter(Boolean);
        const ends    = projects.map(p => this._parseDate(p.Project_End_Date__c)).filter(Boolean);
        const avgPace = projects.reduce((sum, p) => sum + (p.Weekly_Pace_Estimate__c || 0), 0) / projects.length;
        return {
            Name:                    'All In Progress Projects',
            Project_Start_Date__c:   starts.length ? new Date(Math.min(...starts)).toISOString().split('T')[0] : null,
            Project_End_Date__c:     ends.length   ? new Date(Math.max(...ends)).toISOString().split('T')[0]   : null,
            Weekly_Pace_Estimate__c: Math.round(avgPace)
        };
    }

    mapStory(s) {
        const hrs     = s.Hours_Estimate_to_Complete__c || 0;
        const missing = !s.Hours_Estimate_to_Complete__c || s.Hours_Estimate_to_Complete__c === 0;
        return {
            id:              s.Id,
            subject:         s.Subject || '',
            description:     s.Description || '',
            priority:        s.Priority || '',
            estimatedHours:  hrs,
            missingHours:    missing,
            department:      s.Department__c || '',
            createdDate:     s.CreatedDate || '',
            sprintWeek:      s.Sprint_Week__c || null,
            sprintStartDate: s.Sprint_Start_Date__c || null,
            priorityClass:   PRIORITY_CLASSES[s.Priority] || 'priority-badge priority-low',
            chipClass:       missing ? 'story-chip missing-hours' : 'story-chip',
            draggable:       missing ? 'false' : 'true'
        };
    }

    // ── Computed: backlog ──────────────────────────────────────────────────
    get unassignedStories() { return this.getStoriesForZone('backlog'); }

    get filteredUnassignedStories() {
        let s = this.unassignedStories;
        if (this.filterPriority) s = s.filter(x => x.priority   === this.filterPriority);
        if (this.filterDept)     s = s.filter(x => x.department === this.filterDept);

        if (this.sortBy === 'priority') {
            s = [...s].sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 4) - (PRIORITY_ORDER[b.priority] ?? 4));
        } else if (this.sortBy === 'hours') {
            s = [...s].sort((a, b) => b.estimatedHours - a.estimatedHours);
        } else if (this.sortBy === 'subject') {
            s = [...s].sort((a, b) => a.subject.localeCompare(b.subject));
        } else if (this.sortBy === 'oldest') {
            s = [...s].sort((a, b) => new Date(a.createdDate) - new Date(b.createdDate));
        } else if (this.sortBy === 'newest') {
            s = [...s].sort((a, b) => new Date(b.createdDate) - new Date(a.createdDate));
        }
        return s;
    }

    get filteredUnassignedCount() { return this.filteredUnassignedStories.length; }
    get hasFilteredUnassigned()   { return this.filteredUnassignedStories.length > 0; }
    get unassignedCount()         { return this.unassignedStories.length; }
    get hasActiveFilters()        { return !!(this.filterPriority || this.filterDept); }
    get missingHoursCount()       { return this.unassignedStories.filter(s => s.missingHours).length; }
    get hasMissingHours()         { return this.missingHoursCount > 0; }
    get hoursPerWeek()            { return this.project?.Weekly_Pace_Estimate__c || 0; }
    get totalPlannedHours() {
        return this.allStories
            .filter(s => !this.isInZone(s.id, 'backlog'))
            .reduce((sum, s) => sum + (s.estimatedHours || 0), 0);
    }

    // ── Sprint columns ─────────────────────────────────────────────────────
    _parseDate(str) {
        if (!str) return null;
        const [y, m, d] = str.split('-').map(Number);
        return new Date(y, m - 1, d);
    }

    get sprints() {
        if (!this.project) return [];
        const start    = this._parseDate(this.project.Project_Start_Date__c);
        const end      = this._parseDate(this.project.Project_End_Date__c);
        const capacity = this.hoursPerWeek;
        const weeks    = [];
        let cur = new Date(start), idx = 1;

        while (cur <= end && idx <= 52) {
            // Find the end of this calendar week (Sunday).
            // If cur is already Sunday (0), the week ends today; otherwise advance to the next Sunday.
            const dow = cur.getDay();
            const daysToSunday = dow === 0 ? 0 : 7 - dow;
            const weekEnd = new Date(cur);
            weekEnd.setDate(weekEnd.getDate() + daysToSunday);

            // Cap at project end date so the last sprint absorbs leftover days
            const displayEnd = weekEnd > end ? new Date(end) : new Date(weekEnd);

            const label = `Week ${idx}`;

            const cards = this.getStoriesForZone(label)
                .slice()
                .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 4) - (PRIORITY_ORDER[b.priority] ?? 4));

            const used  = cards.reduce((sum, s) => sum + (s.estimatedHours || 0), 0);
            const pct   = capacity > 0 ? Math.min((used / capacity) * 100, 100) : 0;
            const over  = capacity > 0 && used > capacity;
            const color = over ? '#ef4444' : pct > 80 ? '#f59e0b' : '#00b4d8';

            weeks.push({
                weekLabel:         label,
                weekNumber:        idx,
                weekStartDate:     new Date(cur).toISOString().split('T')[0],
                weekEndDate:       displayEnd.toISOString().split('T')[0],
                dateRange:         this.fmtDate(cur) + ' – ' + this.fmtDate(displayEnd),
                capacityHours:     capacity,
                usedHours:         used,
                hasCards:          cards.length > 0,
                cards,
                headerStyle:       `border-top: 3px solid ${color};`,
                barStyle:          `width:${pct}%; background:${color};`,
                capacityTextStyle: over ? 'color:#ef4444;font-weight:700;' : '',
                dropClass:         this.activeDropZone === label
                                       ? 'sprint-drop-zone drag-over'
                                       : 'sprint-drop-zone'
            });

            // Next week starts on Monday (the day after this Sunday)
            cur = new Date(weekEnd);
            cur.setDate(cur.getDate() + 1);
            idx++;
        }
        return weeks;
    }

    // ── Helpers ────────────────────────────────────────────────────────────
    getStoriesForZone(zone) {
        return (this.sprintMap[zone] || [])
            .map(id => this.allStories.find(s => s.id === id))
            .filter(Boolean);
    }
    isInZone(id, zone)   { return (this.sprintMap[zone] || []).includes(id); }
    findZoneForStory(id) { return Object.keys(this.sprintMap).find(z => (this.sprintMap[z] || []).includes(id)); }
    fmtDate(d)           { return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }

    // ── Filter / Sort ──────────────────────────────────────────────────────
    handlePriorityFilter(e) { this.filterPriority = e.target.value; }
    handleDeptFilter(e)     { this.filterDept     = e.target.value; }
    handleSort(e)           { this.sortBy         = e.target.value; }
    handleProjectChange(e)  {
        this.sprintMap    = {};
        this.allStories   = [];
        this.project      = null;
        this.tooltipStory = null;
        this._setProject(e.target.value);
        this.loadPlannerData();
    }

    // ── Card interactions ──────────────────────────────────────────────────
    handleCardClick(e) {
        if (e.target.classList.contains('btn-remove-sprint')) return;
        if (this.dragId) return;
        const id = e.currentTarget.dataset.id;
        if (!id) return;
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId: id, actionName: 'view' }
        });
    }

    handleCardHover(e) {
        clearTimeout(this._tooltipTimer);
        const id    = e.currentTarget.dataset.id;
        const story = this.allStories.find(s => s.id === id);
        if (!story) return;

        const rect    = e.currentTarget.getBoundingClientRect();
        const wrapper = this.template.querySelector('.planner-wrapper');
        const wRect   = wrapper.getBoundingClientRect();

        let left = rect.right - wRect.left + 10;
        if (left + 380 > wRect.width) left = rect.left - wRect.left - 390;
        left = Math.max(8, left);

        let top = rect.top - wRect.top;
        const estimatedHeight = 80
            + (story.description ? Math.min(story.description.length * 0.6, 300) : 20)
            + 100;
        if (top + estimatedHeight > wRect.height) {
            top = Math.max(8, wRect.height - estimatedHeight - 8);
        }

        this.tooltipStyle = `top:${top}px; left:${left}px;`;
        this.tooltipStory = { ...story };
    }

    handleCardLeave()    { this._tooltipTimer = setTimeout(() => { this.tooltipStory = null; }, 150); }
    handleTooltipEnter() { clearTimeout(this._tooltipTimer); }
    handleTooltipLeave() { this._tooltipTimer = setTimeout(() => { this.tooltipStory = null; }, 150); }

    handleHoursUpdate(e) {
        e.stopPropagation();
        const id  = e.currentTarget.dataset.id;
        const hrs = parseFloat(e.target.value) || 0;

        this.allStories = this.allStories.map(s => {
            if (s.id !== id) return s;
            const missing = hrs === 0;
            return {
                ...s,
                estimatedHours: hrs,
                missingHours:   missing,
                chipClass:      missing ? 'story-chip missing-hours' : 'story-chip',
                draggable:      missing ? 'false' : 'true'
            };
        });

        if (this.tooltipStory?.id === id) {
            this.tooltipStory = { ...this.tooltipStory, estimatedHours: hrs, missingHours: hrs === 0 };
        }

        updateHoursEstimate({ caseId: id, hours: hrs })
            .catch(err => {
                console.error('Failed to save hours estimate', err);
                if (this.tooltipStory?.id === id) {
                    this.tooltipStory = { ...this.tooltipStory, saveError: true };
                }
            });
    }

    handleRemoveFromSprint(e) {
        e.stopPropagation();
        const id = e.currentTarget.dataset.id;
        if (!id) return;
        this.moveStory(id, 'backlog', null, null);
    }

    // ── Drag & Drop ────────────────────────────────────────────────────────
    handleDragStart(e) {
        const id    = e.currentTarget.dataset.id;
        const story = this.allStories.find(s => s.id === id);
        if (story?.missingHours) { e.preventDefault(); return; }
        this.dragId = id;
        this.tooltipStory = null;
        e.currentTarget.classList.add('dragging');
    }
    handleDragEnd(e) {
        e.currentTarget.classList.remove('dragging');
        this.activeDropZone = null;
    }
    handleDragOver(e) {
        e.preventDefault();
        const zone = e.currentTarget.dataset.week || 'backlog';
        if (this.activeDropZone !== zone) this.activeDropZone = zone;
    }
    handleDragLeave()  { this.activeDropZone = null; }

    handleDropSprint(e) {
        e.preventDefault();
        const story = this.allStories.find(s => s.id === this.dragId);
        if (!story || story.missingHours) { this.activeDropZone = null; return; }
        const weekLabel = e.currentTarget.dataset.week;
        const weekMeta  = this.sprints.find(w => w.weekLabel === weekLabel);
        this.moveStory(this.dragId, weekLabel, weekMeta?.weekNumber, weekMeta?.weekStartDate);
        this.activeDropZone = null;
    }

    handleDropBacklog(e) {
        e.preventDefault();
        this.moveStory(this.dragId, 'backlog', null, null);
        this.activeDropZone = null;
    }

    // ── Move + persist ─────────────────────────────────────────────────────
    moveStory(id, targetZone, weekNumber, weekStartDate) {
        if (!id || !targetZone) return;
        const src = this.findZoneForStory(id);
        if (src === targetZone) return;

        const m = { ...this.sprintMap };
        Object.keys(m).forEach(k => { m[k] = [...(m[k] || [])]; });
        if (m[src]) m[src] = m[src].filter(i => i !== id);
        if (!m[targetZone]) m[targetZone] = [];
        m[targetZone] = [...m[targetZone], id];

        if (targetZone !== 'backlog') {
            const capacity = this.hoursPerWeek;
            if (capacity > 0) {
                const weekLabels = this.getWeekLabels();
                weekLabels.forEach((week, i) => {
                    const storiesInWeek = (m[week] || [])
                        .map(sid => this.allStories.find(s => s.id === sid))
                        .filter(Boolean)
                        .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 4) - (PRIORITY_ORDER[b.priority] ?? 4));

                    let used = 0;
                    const keep = [], overflow = [];
                    storiesInWeek.forEach(s => {
                        if (used + s.estimatedHours <= capacity) { keep.push(s.id); used += s.estimatedHours; }
                        else overflow.push(s.id);
                    });

                    m[week] = keep;
                    if (overflow.length > 0) {
                        const nextWeek = weekLabels[i + 1];
                        if (nextWeek) {
                            if (!m[nextWeek]) m[nextWeek] = [];
                            m[nextWeek] = [...overflow, ...m[nextWeek]];
                        } else {
                            m['backlog'] = [...(m['backlog'] || []), ...overflow];
                        }
                    }
                });
            }
        }
        this.sprintMap = m;

        if (targetZone === 'backlog') {
            removeFromSprint({ caseId: id })
                .catch(err => {
                    this._revertMove(id, src, targetZone);
                    this._toast('Failed to save', err?.body?.message || 'Could not remove from sprint.', 'error');
                });
        } else {
            assignToSprint({ caseId: id, sprintWeek: weekNumber, sprintStartDate: weekStartDate })
                .catch(err => {
                    this._revertMove(id, src, targetZone);
                    this._toast('Failed to save', err?.body?.message || 'Could not assign to sprint.', 'error');
                });
        }
    }

    _revertMove(id, originalZone, failedZone) {
        const m = { ...this.sprintMap };
        Object.keys(m).forEach(k => { m[k] = [...(m[k] || [])]; });
        if (m[failedZone]) m[failedZone] = m[failedZone].filter(i => i !== id);
        if (!m[originalZone]) m[originalZone] = [];
        m[originalZone] = [...m[originalZone], id];
        this.sprintMap = m;
    }

    _toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }

    getWeekLabels() {
        if (!this.project) return [];
        const start  = this._parseDate(this.project.Project_Start_Date__c);
        const end    = this._parseDate(this.project.Project_End_Date__c);
        const labels = [];
        let cur = new Date(start), idx = 1;
        while (cur <= end && idx <= 52) {
            labels.push(`Week ${idx}`);
            // Advance to the Monday after this calendar week's Sunday — must match get sprints()
            const dow = cur.getDay();
            const daysToSunday = dow === 0 ? 0 : 7 - dow;
            cur.setDate(cur.getDate() + daysToSunday + 1);
            idx++;
        }
        return labels;
    }

    // handleReset removed per Sprint Planner Safety Guard (US-4)
}