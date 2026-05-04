import { LightningElement, api, wire } from 'lwc';
import getProjectReport from '@salesforce/apex/CC_ProjectMgmtReportingController.getProjectReport';

export default class Cc_ProjectMgmtReporting extends LightningElement {

    @api recordId;

    _raw             = null;
    _error           = false;
    _selectedEpicId  = null;

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

        const maxHours       = epicsSorted.length > 0 ? Math.max(...epicsSorted.map(e => e.hours), 0.01) : 0.01;
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
                barStyle:      `width:${Math.round((e.hours / maxHours) * 100)}%`,
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
        const weeklyData = this._buildWeeklyData(p.timeEntries || []);

        const selectedEpic = epics.find(e => e.isSelected) || null;

        return {
            highlightSections: this._parseHighlight(p.completedWorkHighlight),
            hasHighlight:      !!(p.completedWorkHighlight && p.completedWorkHighlight.trim()),
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
            selectedEpic,
            hasSelectedEpic:   !!selectedEpic,
            statusBreakdown,
            typeBreakdown,
            priorityBreakdown,
            totalStoryCount:   allStories.length,
            hasStories:        allStories.length > 0,
            weeklyData,
            hasWeeklyData:     weeklyData.length > 0
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
        if (deltaPct === 0) return { label: 'On Pace',             cssClass: 'delta-chip delta-green' };
        if (deltaPct > 0)   return { label: `+${deltaPct}% needed`, cssClass: 'delta-chip delta-red'   };
        return              { label: `${deltaPct}% buffer`,        cssClass: 'delta-chip delta-green' };
    }

    _barColorClass(pct) {
        if (pct >= 90) return 'fill-green';
        if (pct >= 50) return 'fill-blue';
        return 'fill-amber';
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

    // Week-over-week grouping
    _weekStart(dateStr) {
        const [y, m, d] = dateStr.split('-').map(Number);
        const dt  = new Date(y, m - 1, d);
        const day = dt.getDay(); // 0=Sun
        dt.setDate(dt.getDate() + (day === 0 ? -6 : 1 - day));
        return dt;
    }

    _weekLabel(monday) {
        const end = new Date(monday);
        end.setDate(end.getDate() + 6);
        const fmt = dt => dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `${fmt(monday)} – ${fmt(end)}`;
    }

    _buildWeeklyData(timeEntries) {
        if (!timeEntries || timeEntries.length === 0) return [];
        const weekMap = {};
        for (const te of timeEntries) {
            const monday = this._weekStart(te.loggedDate);
            const key    = monday.toISOString().slice(0, 10);
            if (!weekMap[key]) weekMap[key] = { monday, totalMins: 0, personMap: {} };
            const mins   = Number(te.minutesLogged) || 0;
            weekMap[key].totalMins += mins;
            const person = te.personName || 'Unknown';
            weekMap[key].personMap[person] = (weekMap[key].personMap[person] || 0) + mins;
        }
        const keys    = Object.keys(weekMap).sort().reverse(); // most recent first
        const maxMins = Math.max(...keys.map(k => weekMap[k].totalMins), 1);
        return keys.map(key => {
            const b     = weekMap[key];
            const hours = b.totalMins / 60;
            const people = Object.entries(b.personMap)
                .sort((a, c) => c[1] - a[1])
                .map(([name, mins]) => ({
                    id:   name,
                    text: `${name.split(' ')[0]} ${this._fmt(mins / 60)}`
                }));
            return {
                id:           key,
                label:        this._weekLabel(b.monday),
                hoursDisplay: this._fmt(hours),
                barStyle:     `width:${Math.round((b.totalMins / maxMins) * 100)}%`,
                people,
                hasPeople:    people.length > 0
            };
        });
    }
}
