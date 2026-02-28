import { LightningElement, wire, track } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { publish, MessageContext } from 'lightning/messageService';
import PROJECT_SELECTED_CHANNEL from '@salesforce/messageChannel/ProjectSelected__c';
// ↑ channel file on disk must be named: ProjectSelected.messageChannel-meta.xml
import getProjects from '@salesforce/apex/ProjectScorecardController.getProjects';

export default class ProjectScorecard extends NavigationMixin(LightningElement) {
    @track _projects = [];
    @track isLoading = true;
    @track viewMode  = 'mine'; // 'mine' | 'all'

    @wire(MessageContext)
    _msgCtx;

    // ── Toggle handlers ────────────────────────────────────────────────────────
    get myBtnClass()  { return this.viewMode === 'mine' ? 'toggle-btn active' : 'toggle-btn'; }
    get allBtnClass() { return this.viewMode === 'all'  ? 'toggle-btn active' : 'toggle-btn'; }

    showMine() { if (this.viewMode !== 'mine') { this.viewMode = 'mine'; this.isLoading = true; } }
    showAll()  { if (this.viewMode !== 'all')  { this.viewMode = 'all';  this.isLoading = true; } }

    // ── Wire ───────────────────────────────────────────────────────────────────
    @wire(getProjects, { viewMode: '$viewMode' })
    wiredProjects({ data, error }) {
        this.isLoading = false;
        if (data) {
            this._projects = data.map(p => this._mapProject(p));
        } else if (error) {
            console.error('ProjectScorecard error:', error);
            this._projects = [];
        }
    }

    get hasProjects() { return this._projects.length > 0; }
    get projects()    { return this._projects; }

    // ── Card click — publish project selection to Story Board + Sprint Planner ──
    handleCardClick(e) {
        // Don't fire if the "Open Record" button or its children were clicked
        if (e.target.classList.contains('btn-open-record') ||
            e.target.closest && e.target.closest('button.btn-open-record')) return;
        const id   = e.currentTarget.dataset.id;
        const name = e.currentTarget.dataset.name;
        if (!id) return;
        publish(this._msgCtx, PROJECT_SELECTED_CHANNEL, { projectId: id, projectName: name });
    }

    // ── Open Record button ─────────────────────────────────────────────────────
    navigateToRecord(e) {
        e.stopPropagation();
        const id = e.currentTarget.dataset.id;
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId: id, actionName: 'view' }
        });
    }

    // ── Mapping ────────────────────────────────────────────────────────────────
    _mapProject(p) {
        const pct  = this._calcTimeline(p.Project_Start_Date__c, p.Project_End_Date__c);
        const hPct = this._calcHoursPercent(p.Contracted_Hours_Sprint__c, p.Hours_Delivered__c);
        return {
            Id:                p.Id,
            Name:              p.Name,
            hoursPurchased:    p.Contracted_Hours_Sprint__c  ?? '--',
            hoursDelivered:    p.Hours_Delivered__c          ?? '--',
            hoursRemaining:    p.Completed_Delta_Sprint__c   ?? '--',
            weeklySprintHours: p.Weekly_Pace_Estimate__c
                                   ? `${p.Weekly_Pace_Estimate__c} hrs`
                                   : '--',
            startDate:          this._formatDate(p.Project_Start_Date__c),
            endDate:            this._formatDate(p.Project_End_Date__c),
            timelinePercent:    pct,
            progressStyle:      `width:${pct}%`,
            todayMarkerStyle:   `left:${pct}%`,
            hoursPercent:       hPct,
            hoursProgressStyle: this._calcHoursBarStyle(hPct),
            paceBadgeClass:     this._getPaceBadgeClass(p.Pace_Status__c),
            paceBadgeLabel:     p.Pace_Status__c ?? '--'
        };
    }

    // ── Helpers ────────────────────────────────────────────────────────────────
    _formatDate(d) {
        if (!d) return '--';
        const [y, m, day] = d.split('-').map(Number);
        return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    _calcTimeline(start, end) {
        if (!start || !end) return 0;
        const [sy, sm, sd] = start.split('-').map(Number);
        const [ey, em, ed] = end.split('-').map(Number);
        const s   = new Date(sy, sm - 1, sd);
        const e   = new Date(ey, em - 1, ed);
        const pct = Math.round(((Date.now() - s) / (e - s)) * 100);
        return Math.min(Math.max(pct, 0), 100);
    }

    _calcHoursPercent(purchased, delivered) {
        if (!purchased || purchased === 0) return 0;
        return Math.min(Math.round((delivered / purchased) * 100), 100);
    }

    _calcHoursBarStyle(pct) {
        const color = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#0176d3';
        return `width:${pct}%; background:${color};`;
    }

    _getPaceBadgeClass(pace) {
        const base = 'pace-badge';
        if (!pace) return `${base} pace-none`;
        const p = pace.toLowerCase();
        if (p.includes('behind') || p.includes('problem')) return `${base} pace-behind`;
        if (p.includes('on track') || p.includes('on pace')) return `${base} pace-on`;
        if (p.includes('ahead')) return `${base} pace-ahead`;
        return `${base} pace-none`;
    }
}