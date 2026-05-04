import { LightningElement, api, wire } from 'lwc';
import getProjectReport from '@salesforce/apex/CC_ProjectMgmtReportingController.getProjectReport';

export default class Cc_ProjectMgmtReporting extends LightningElement {

    @api recordId;

    _raw             = null;
    _error           = false;
    _selectedEpicId  = null;
    _quarterFilter   = null;

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

    handleEpicClick(event) {
        const id = event.currentTarget.dataset.epicId;
        this._selectedEpicId = (this._selectedEpicId === id) ? null : id;
    }

    handleQuarterFilter(event) {
        const q = event.currentTarget.dataset.quarter;
        this._quarterFilter = (this._quarterFilter === q) ? null : q;
    }

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

        const maxEpicHours   = epicsSorted.length > 0 ? Math.max(...epicsSorted.map(e => e.hours), 0.01) : 0.01;
        const totalEpicHours = epicsSorted.reduce((s, e) => s + e.hours, 0);

        const epics = epicsSorted.map(e => {
            const isSelected = e.id === this._selectedEpicId;
            const rawStories = (e.stories || []).slice().sort((a, b) =>
                (Number(b.minutesLogged) || 0) - (Number(a.minutesLogged) || 0)
            );
            const stories = rawStories.map(s => ({
                id:           s.id,
                subject:      s.subject || '(Untitled)',
                hoursDisplay: this._fmt((Number(s.minutesLogged) || 0) / 60)
            }));
            return {
                id:            e.id,
                name:          e.name,
                hoursDisplay:  this._fmt(e.hours),
                pctOfTotal:    totalEpicHours > 0 ? Math.round((e.hours / totalEpicHours) * 100) : 0,
                barStyle:      `width:${Math.round((e.hours / maxEpicHours) * 100)}%`,
                isSelected,
                epicCardClass: 'epic-card' + (isSelected ? ' epic-card-selected' : ''),
                stories,
                hasStories:    stories.length > 0
            };
        });

        // ── Story breakdowns ──────────────────────────────────
        const allStories        = p.allStories || [];
        const statusBreakdown   = this._breakdown(allStories, s => s.status   || '—', null);
        const typeBreakdown     = this._breakdown(allStories, s => s.type     || '—', null);
        const priorityBreakdown = this._breakdown(allStories, s => s.priority || '—',
            ['Critical', 'High', 'Medium', 'Low']);

        // ── Week-over-week ────────────────────────────────────
        const rawWeeks = this._buildWeeklyData(p.timeEntries || []);

        // Quarter buttons (only show quarters present in data)
        const quartersInData = [...new Set(rawWeeks.map(w => w.quarter))].sort();
        const quarterButtons = quartersInData.map(q => ({
            id:       q,
            label:    q,
            cssClass: 'wow-q-btn' + (this._quarterFilter === q ? ' wow-q-btn-active' : '')
        }));

        // Filter by selected quarter
        const filteredWeeks = this._quarterFilter
            ? rawWeeks.filter(w => w.quarter === this._quarterFilter)
            : rawWeeks;

        // Nice max for Y-axis — must cover retained hours too
        const retained     = Number(p.weeklyRetainedHours) || 0;
        const maxWeekHours = filteredWeeks.length > 0
            ? Math.max(...filteredWeeks.map(w => w.hours))
            : 0;
        const niceMax      = this._niceMax(Math.max(maxWeekHours, retained, 1));
        const niceMaxMins  = niceMax * 60;

        // Y-axis ticks: top → bottom = niceMax → 0
        const yTicks = [0, 25, 50, 75, 100].map(pct => ({
            id:       String(pct),
            value:    this._fmt(niceMax * (1 - pct / 100)),
            topStyle: `top:${pct}%`
        }));

        // Retained reference line position
        const retainedPct          = niceMax > 0 ? Math.round((1 - retained / niceMax) * 100) : 0;
        const retainedLineStyle    = `top:${retainedPct}%`;
        const retainedLabelDisplay = this._fmt(retained) + '/wk';
        const hasRetainedLine      = retained > 0;

        // Final weekly data with barStyle relative to niceMax
        const weeklyData = filteredWeeks.map(w => ({
            ...w,
            hoursDisplay: this._fmt(w.hours),
            barStyle:     `height:${niceMaxMins > 0 ? Math.round((w.totalMins / niceMaxMins) * 100) : 0}%`
        }));

        const selectedEpic = epics.find(e => e.isSelected) || null;

        return {
            highlightSections:     this._parseHighlight(p.completedWorkHighlight),
            hasHighlight:          !!(p.completedWorkHighlight && p.completedWorkHighlight.trim()),
            accountName:           p.accountName,
            startDateFormatted:    this._formatDate(p.startDate),
            endDateFormatted:      this._formatDate(p.endDate),
            hasDates:              !!(p.startDate || p.endDate),
            weeklyPaceDisplay:     this._fmt(Number(p.weeklyPaceEstimate)   || 0),
            weeklyPaceDelta:       this._paceDelta(p.weeklyPaceEstimate, p.weeklyRetainedHours),
            contractedDisplay:     this._fmt(contracted),
            deliveredDisplay:      this._fmt(delivered),
            remainingDisplay:      this._fmt(remaining),
            pct,
            barStyle:              `width:${pct}%`,
            barColorClass:         'progress-fill ' + this._barColorClass(pct),
            epics,
            hasEpics:              epics.length > 0,
            epicCount:             epics.length,
            totalEpicHrsDisplay:   this._fmt(totalEpicHours),
            selectedEpic,
            hasSelectedEpic:       !!selectedEpic,
            statusBreakdown,
            typeBreakdown,
            priorityBreakdown,
            totalStoryCount:       allStories.length,
            hasStories:            allStories.length > 0,
            weeklyData,
            hasWeeklyData:         rawWeeks.length > 0,
            hasWeeklyBars:         weeklyData.length > 0,
            quarterButtons,
            hasQuarterButtons:     quarterButtons.length > 1,
            yTicks,
            retainedLineStyle,
            retainedLabelDisplay,
            hasRetainedLine
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

    _paceDelta(onTimePace, retained) {
        const need = Number(onTimePace) || 0;
        const have = Number(retained)   || 0;
        if (!have) return null;
        const deltaPct = Math.round(((need - have) / have) * 100);
        if (deltaPct === 0) return { label: 'On Pace',              cssClass: 'delta-chip delta-green' };
        if (deltaPct > 0)   return { label: `+${deltaPct}% needed`, cssClass: 'delta-chip delta-red'   };
        return              { label: `${deltaPct}% buffer`,         cssClass: 'delta-chip delta-green' };
    }

    _barColorClass(pct) {
        if (pct >= 90) return 'fill-green';
        if (pct >= 50) return 'fill-blue';
        return 'fill-amber';
    }

    // Round up to a nice number for chart axes
    _niceMax(hours) {
        if (hours <= 0) return 10;
        const exp  = Math.floor(Math.log10(hours));
        const mag  = Math.pow(10, exp);
        const frac = hours / mag; // 1–10
        let nice;
        if      (frac <= 1)   nice = 1;
        else if (frac <= 2)   nice = 2;
        else if (frac <= 2.5) nice = 2.5;
        else if (frac <= 5)   nice = 5;
        else if (frac <= 7.5) nice = 7.5;
        else                  nice = 10;
        return nice * mag;
    }

    _weekQuarter(keyStr) {
        const month = parseInt(keyStr.slice(5, 7), 10);
        return month <= 3 ? 'Q1' : month <= 6 ? 'Q2' : month <= 9 ? 'Q3' : 'Q4';
    }

    // Parse markdown-style text into section cards
    _parseHighlight(text) {
        if (!text || !text.trim()) return [];
        const sections = [];
        let current = null;
        for (const raw of text.split('\n')) {
            const line = raw.trim();
            if (!line) continue;
            if (/^[-=*_]{2,}$/.test(line)) continue;
            if (line.startsWith('#')) {
                current = {
                    id:    String(sections.length),
                    title: line.replace(/^#+\s*/, '').trim(),
                    items: []
                };
                sections.push(current);
            } else {
                if (!current) {
                    current = { id: '0', title: '', items: [] };
                    sections.push(current);
                }
                const item = line.replace(/^[-*•]\s*/, '').trim();
                if (item) current.items.push({ id: String(current.items.length), text: item });
            }
        }
        return sections.filter(s => s.title || s.items.length > 0);
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
            id:       name,
            name,
            count,
            barStyle: `width:${Math.round((count / maxCount) * 100)}%`,
            dotClass: 'pri-dot pri-dot-' + name.toLowerCase().replace(/\s+/g, '-')
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

    // Week-over-week grouping — returns raw data without barStyle

    // Returns 'YYYY-MM-DD' of the Monday for the given date string.
    // Uses UTC throughout so the key never shifts due to browser timezone.
    _weekStart(dateStr) {
        const [y, m, d] = dateStr.split('-').map(Number);
        const dt  = new Date(Date.UTC(y, m - 1, d));
        const day = dt.getUTCDay(); // 0=Sun, 1=Mon … 6=Sat
        dt.setUTCDate(dt.getUTCDate() + (day === 0 ? -6 : 1 - day));
        return dt.toISOString().slice(0, 10); // 'YYYY-MM-DD' of Monday
    }

    // Display the Monday date; use timeZone:'UTC' so the date string matches the key.
    _weekLabel(mondayKey) {
        const [y, m, d] = mondayKey.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d))
            .toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    }

    _buildWeeklyData(timeEntries) {
        if (!timeEntries || timeEntries.length === 0) return [];
        const weekMap = {};
        for (const te of timeEntries) {
            const key  = this._weekStart(te.loggedDate); // always a Monday 'YYYY-MM-DD'
            if (!weekMap[key]) weekMap[key] = { totalMins: 0, personMap: {} };
            const mins = Number(te.minutesLogged) || 0;
            weekMap[key].totalMins += mins;
            const person = te.personName || 'Unknown';
            weekMap[key].personMap[person] = (weekMap[key].personMap[person] || 0) + mins;
        }
        const keys = Object.keys(weekMap).sort(); // ascending → oldest left
        return keys.map(key => {
            const b      = weekMap[key];
            const people = Object.entries(b.personMap)
                .sort((a, c) => c[1] - a[1])
                .map(([name, mins]) => ({
                    id:   name,
                    text: `${name.split(' ')[0]} ${this._fmt(mins / 60)}`
                }));
            return {
                id:        key,
                label:     this._weekLabel(key),
                totalMins: b.totalMins,
                hours:     b.totalMins / 60,
                quarter:   this._weekQuarter(key),
                people,
                hasPeople: people.length > 0
            };
        });
    }
}
