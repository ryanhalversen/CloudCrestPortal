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

        // ── Epics ─────────────────────────────────────────────
        const epicsSorted = (p.epics || [])
            .map(e => ({ ...e, hours: (Number(e.minutesLogged) || 0) / 60 }))
            .sort((a, b) => b.hours - a.hours);

        const maxHours      = epicsSorted.length > 0 ? Math.max(...epicsSorted.map(e => e.hours), 0.01) : 0.01;
        const totalEpicHours = epicsSorted.reduce((s, e) => s + e.hours, 0);

        const epics = epicsSorted.map(e => ({
            id:           e.id,
            name:         e.name,
            hoursDisplay: this._fmt(e.hours),
            pctOfTotal:   totalEpicHours > 0 ? Math.round((e.hours / totalEpicHours) * 100) : 0,
            barStyle:     `width:${Math.round((e.hours / maxHours) * 100)}%`
        }));

        // ── Stories ───────────────────────────────────────────
        const completed  = p.completedStories  || [];
        const inProgress = p.inProgressStories || [];
        const bl         = p.blockedStories    || [];

        return {
            accountName:       p.accountName,
            ownerName:         p.ownerName,
            contractType:      p.contractType,
            deliveryType:      p.deliveryType,
            paceStatus:        p.paceStatus,
            startDateStr:      p.startDate || '',
            endDateStr:        p.endDate   || '',
            hasDates:          !!(p.startDate || p.endDate),
            hasMeta:           !!(p.ownerName || p.contractType || p.deliveryType
                                  || p.paceStatus || p.startDate || p.endDate),
            contractedDisplay: this._fmt(contracted),
            deliveredDisplay:  this._fmt(delivered),
            remainingDisplay:  this._fmt(remaining),
            pct,
            barStyle:          `width:${pct}%`,
            barColorClass:     'progress-fill ' + this._barColorClass(pct),
            paceBadgeClass:    'pace-badge ' + this._paceClass(p.paceStatus),
            // Epics
            epics,
            hasEpics:          epics.length > 0,
            epicCount:         epics.length,
            totalEpicHrsDisplay: this._fmt(totalEpicHours),
            // Stories
            completedStories:  completed,
            completedCount:    completed.length,
            hasCompleted:      completed.length > 0,
            inProgressStories: inProgress,
            inProgressCount:   inProgress.length,
            hasInProgress:     inProgress.length > 0,
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

    _barColorClass(pct) {
        if (pct >= 90) return 'fill-green';
        if (pct >= 50) return 'fill-blue';
        return 'fill-amber';
    }

    _paceClass(pace) {
        const p = (pace || '').toLowerCase();
        if (p.includes('ahead'))   return 'pace-green';
        if (p.includes('on pace')) return 'pace-blue';
        if (p.includes('behind'))  return 'pace-amber';
        if (p.includes('houston')) return 'pace-red';
        return 'pace-none';
    }
}
