import { LightningElement, api, wire } from 'lwc';
import getProjectReport from '@salesforce/apex/CC_ProjectMgmtReportingController.getProjectReport';

export default class Cc_ProjectMgmtReporting extends LightningElement {

    @api recordId;

    _raw   = null;
    _error = false;

    @wire(getProjectReport, { projectId: '$recordId' })
    wiredData({ data, error }) {
        if (data) {
            this._raw   = data;
            this._error = false;
        } else if (error) {
            this._raw   = null;
            this._error = true;
            console.error('CC_ProjectMgmtReporting:', error);
        }
    }

    get hasData()  { return !!this._raw; }
    get hasError() { return this._error; }

    get project() {
        if (!this._raw) return null;
        const p          = this._raw;
        const contracted = Number(p.contractedHours) || 0;
        const delivered  = Number(p.deliveredHours)  || 0;
        const remaining  = Number(p.remainingHours)  || 0;
        const pct        = contracted > 0 ? Math.min(100, Math.round((delivered / contracted) * 100)) : 0;

        const completed   = p.completedStories  || [];
        const inProgress  = p.inProgressStories || [];
        const bl          = p.blockedStories    || [];

        return {
            accountName:      p.accountName,
            ownerName:        p.ownerName,
            contractType:     p.contractType,
            deliveryType:     p.deliveryType,
            paceStatus:       p.paceStatus,
            startDateStr:     p.startDate || '',
            endDateStr:       p.endDate   || '',
            hasDates:         !!(p.startDate || p.endDate),
            hasMeta:          !!(p.ownerName || p.contractType || p.deliveryType || p.paceStatus),
            contractedDisplay: this._fmt(contracted),
            deliveredDisplay:  this._fmt(delivered),
            remainingDisplay:  this._fmt(remaining),
            pct,
            barStyle:          `width:${pct}%;background:${this._pctColor(pct)}`,
            paceBadgeClass:    'pace-badge ' + this._paceClass(p.paceStatus),
            // Completed stories
            completedStories:  completed,
            completedCount:    completed.length,
            hasCompleted:      completed.length > 0,
            // In-progress stories
            inProgressStories: inProgress,
            inProgressCount:   inProgress.length,
            hasInProgress:     inProgress.length > 0,
            // Blocked stories
            blockedStories:    bl,
            blockedCount:      bl.length,
            hasBlocked:        bl.length > 0
        };
    }

    // ── Helpers ───────────────────────────────────────────────
    _fmt(h) {
        if (!h && h !== 0) return '—';
        const n = Number(h);
        return n % 1 === 0 ? `${n}h` : `${n.toFixed(1)}h`;
    }

    _pctColor(pct) {
        if (pct >= 90) return '#4ade80';
        if (pct >= 50) return '#60a5fa';
        return '#f59e0b';
    }

    _paceClass(pace) {
        const p = (pace || '').toLowerCase();
        if (p.includes('ahead'))   return 'pace-ahead';
        if (p.includes('on pace')) return 'pace-on';
        if (p.includes('behind'))  return 'pace-behind';
        if (p.includes('houston')) return 'pace-critical';
        return 'pace-none';
    }
}
