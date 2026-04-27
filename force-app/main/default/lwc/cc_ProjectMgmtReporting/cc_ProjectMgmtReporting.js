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

        // ── Story breakdowns ──────────────────────────────────
        const allStories = p.allStories || [];
        const statusBreakdown   = this._breakdown(allStories, s => s.status   || '—', null);
        const typeBreakdown     = this._breakdown(allStories, s => s.type     || '—', null);
        const priorityBreakdown = this._breakdown(allStories, s => s.priority || '—',
            ['Critical', 'High', 'Medium', 'Low']);

        return {
            accountName:        p.accountName,
            startDateFormatted: this._formatDate(p.startDate),
            endDateFormatted:   this._formatDate(p.endDate),
            hasDates:           !!(p.startDate || p.endDate),
            weeklyPaceDisplay:    this._fmt(Number(p.weeklyPaceEstimate)   || 0),
            weeklyPaceDelta:      this._paceDelta(p.weeklyPaceEstimate, p.weeklyRetainedHours),
            contractedDisplay:    this._fmt(contracted),
            deliveredDisplay:     this._fmt(delivered),
            remainingDisplay:     this._fmt(remaining),
            pct,
            barStyle:          `width:${pct}%`,
            barColorClass:     'progress-fill ' + this._barColorClass(pct),
            epics,
            hasEpics:          epics.length > 0,
            epicCount:         epics.length,
            totalEpicHrsDisplay: this._fmt(totalEpicHours),
            statusBreakdown,
            typeBreakdown,
            priorityBreakdown,
            totalStoryCount:   allStories.length,
            hasStories:        allStories.length > 0
        };
    }

    // ── Helpers ───────────────────────────────────────────────
    _formatDate(dateStr) {
        if (!dateStr) return '—';
        const [y, m, d] = dateStr.split('-').map(Number);
        return new Date(y, m - 1, d).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric'
        });
    }

    _fmt(h) {
        if (!h && h !== 0) return '—';
        const n = Number(h);
        return n % 1 === 0 ? `${n}h` : `${n.toFixed(1)}h`;
    }

    // Returns { label, cssClass } for the weekly pace delta chip
    _paceDelta(onTimePace, retained) {
        const need = Number(onTimePace) || 0;
        const have = Number(retained)   || 0;
        if (!have) return null;
        const deltaPct = Math.round(((need - have) / have) * 100);
        if (deltaPct === 0) return { label: 'On Pace',         cssClass: 'delta-chip delta-green' };
        if (deltaPct > 0)   return { label: `+${deltaPct}% needed`, cssClass: 'delta-chip delta-red'   };
        return              { label: `${deltaPct}% buffer`,    cssClass: 'delta-chip delta-green' };
    }

    // Aggregate stories by a key, optionally sort by a fixed order array
    _breakdown(stories, keyFn, order) {
        const counts = {};
        for (const s of stories) {
            const k = keyFn(s);
            counts[k] = (counts[k] || 0) + 1;
        }
        const maxCount = Math.max(...Object.values(counts), 1);
        const rows = Object.entries(counts).map(([name, count]) => ({
            id:        name,
            name,
            count,
            barStyle:  `width:${Math.round((count / maxCount) * 100)}%`,
            dotClass:  'pri-dot pri-dot-' + name.toLowerCase().replace(/\s+/g, '-')
        }));
        if (order) {
            rows.sort((a, b) => {
                const ai = order.indexOf(a.name);
                const bi = order.indexOf(b.name);
                return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
            });
        } else {
            rows.sort((a, b) => b.count - a.count);
        }
        return rows;
    }

    _barColorClass(pct) {
        if (pct >= 90) return 'fill-green';
        if (pct >= 50) return 'fill-blue';
        return 'fill-amber';
    }

}
