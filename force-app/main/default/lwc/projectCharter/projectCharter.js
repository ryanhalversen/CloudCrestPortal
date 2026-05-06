import { LightningElement, api } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getCharterData  from '@salesforce/apex/CC_ProjectCharterController.getCharterData';
import saveCharter     from '@salesforce/apex/CC_ProjectCharterController.saveCharter';
import saveMilestones  from '@salesforce/apex/CC_ProjectCharterController.saveMilestones';
import saveRaci        from '@salesforce/apex/CC_ProjectCharterController.saveRaci';
import saveRisks       from '@salesforce/apex/CC_ProjectCharterController.saveRisks';
import saveSignoffs    from '@salesforce/apex/CC_ProjectCharterController.saveSignoffs';

// ── Section → charter field mappings ─────────────────────────────────────────
const SECTION_FIELDS = {
    overview:    ['Business_Problem__c', 'Solution_Summary__c'],
    objectives:  ['Objectives__c', 'Success_Criteria__c'],
    scope:       ['Scope_In__c', 'Scope_Out__c'],
    assumptions: ['Assumptions__c', 'Dependencies__c'],
    comms:       ['Communication_Plan__c'],
    changeOrder: ['Change_Order_Process__c']
};

// Salesforce field name → wrapper camelCase key
const FIELD_TO_KEY = {
    Business_Problem__c:   'businessProblem',
    Solution_Summary__c:   'solutionSummary',
    Objectives__c:         'objectives',
    Success_Criteria__c:   'successCriteria',
    Scope_In__c:           'scopeIn',
    Scope_Out__c:          'scopeOut',
    Assumptions__c:        'assumptions',
    Dependencies__c:       'dependencies',
    Communication_Plan__c: 'communicationPlan',
    Change_Order_Process__c: 'changeOrderProcess'
};

const RACI_CYCLE = ['R', 'A', 'C', 'I', ''];

const STATUS_COLORS = {
    Complete:      'bar-green',
    'In Progress': 'bar-blue',
    'At Risk':     'bar-amber',
    'Not Started': 'bar-gray'
};

export default class ProjectCharter extends LightningElement {

    @api recordId;

    _data          = null;
    _error         = null;
    _saving        = false;
    _editSection   = null;

    // Draft state — populated when entering edit mode
    _draftCharter     = {};
    _draftMilestones  = [];
    _draftRaci        = [];
    _draftRisks       = [];
    _draftSignoffs    = [];

    // RACI add-row / add-column input buffers
    _newActivity = '';
    _newRole     = '';

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    connectedCallback() {
        this._load();
    }

    async _load() {
        try {
            this._data  = await getCharterData({ projectId: this.recordId });
            this._error = null;
        } catch (e) {
            this._error = e;
        }
    }

    // ── Simple getters ────────────────────────────────────────────────────────

    get hasData()    { return !!this._data;  }
    get hasError()   { return !!this._error; }
    get isSaving()   { return this._saving;  }

    get data()         { return this._data         || {}; }
    get draftCharter() { return this._draftCharter || {}; }
    get draftMilestones() { return this._draftMilestones; }
    get draftRaci()    { return this._draftRaci;    }
    get draftRisks()   { return this._draftRisks;   }
    get draftSignoffs(){ return this._draftSignoffs;}
    get newActivity()  { return this._newActivity;  }
    get newRole()      { return this._newRole;       }

    // ── Section edit flags ─────────────────────────────────────────────────────

    get isEditing() {
        return {
            overview:    this._editSection === 'overview',
            objectives:  this._editSection === 'objectives',
            scope:       this._editSection === 'scope',
            raci:        this._editSection === 'raci',
            timeline:    this._editSection === 'timeline',
            assumptions: this._editSection === 'assumptions',
            risks:       this._editSection === 'risks',
            comms:       this._editSection === 'comms',
            changeOrder: this._editSection === 'changeOrder',
            signoff:     this._editSection === 'signoff'
        };
    }

    get isAnyEditing() { return this._editSection !== null; }

    // ── Charter header display ────────────────────────────────────────────────

    get statusBadgeClass() {
        const map = { Draft: 'status-badge badge-draft', 'In Review': 'status-badge badge-review', Approved: 'status-badge badge-approved' };
        return map[this._data?.charterStatus] || 'status-badge badge-draft';
    }

    get projectDateRange() {
        const s = this._data?.projectStartDate;
        const e = this._data?.projectEndDate;
        if (!s && !e) return '';
        return [s ? this._fmtDate(s) : '?', e ? this._fmtDate(e) : '?'].join(' → ');
    }

    // ── RACI computed properties ──────────────────────────────────────────────

    get raciRoles() {
        const cells = this._editSection === 'raci' ? this._draftRaci : (this._data?.raciCells || []);
        const seen = new Set();
        const roles = [];
        for (const c of cells) {
            if (c.Role__c && !seen.has(c.Role__c)) { seen.add(c.Role__c); roles.push(c.Role__c); }
        }
        return roles.map(r => ({ key: r, name: r }));
    }

    get raciRows() {
        const cells = this._editSection === 'raci' ? this._draftRaci : (this._data?.raciCells || []);
        const roles = this.raciRoles.map(r => r.name);
        const actMap = {};
        for (const c of cells) {
            if (!c.Activity__c) continue;
            if (!actMap[c.Activity__c]) actMap[c.Activity__c] = { order: c.Activity_Order__c || 0, map: {} };
            if (c.Role__c) actMap[c.Activity__c].map[c.Role__c] = c.Assignment__c || '';
        }
        return Object.entries(actMap)
            .sort((a, b) => a[1].order - b[1].order)
            .map(([activity, data]) => ({
                key: activity,
                activity,
                cells: roles.map(role => ({
                    key:         `${activity}::${role}`,
                    role,
                    assignment:  data.map[role] || '',
                    badgeClass:  this._raciBadgeClass(data.map[role])
                }))
            }));
    }

    get hasRaciData() {
        return this.raciRoles.length > 0 && this.raciRows.length > 0;
    }

    // ── Milestone timeline chart ──────────────────────────────────────────────

    get milestonesWithBars() {
        if (!this._data) return [];
        const list    = this._editSection === 'timeline' ? this._draftMilestones : (this._data.milestones || []);
        const pStart  = this._data.projectStartDate ? this._parseDate(this._data.projectStartDate) : null;
        const pEnd    = this._data.projectEndDate   ? this._parseDate(this._data.projectEndDate)   : null;
        const span    = pStart && pEnd ? pEnd - pStart : 0;

        return list.map((m, i) => {
            const mStart = m.Start_Date__c ? this._parseDate(m.Start_Date__c) : null;
            const mEnd   = m.End_Date__c   ? this._parseDate(m.End_Date__c)   : null;
            let barStyle = '', hasBar = false;
            if (mStart && mEnd && span > 0) {
                const left  = Math.max(0, Math.round(((mStart - pStart) / span) * 100));
                const width = Math.max(2, Math.round(((mEnd - mStart) / span) * 100));
                barStyle    = `left:${left}%;width:${Math.min(width, 100 - left)}%`;
                hasBar      = true;
            }
            return {
                ...m,
                key:        m.Id || `new-${i}`,
                idx:        i,
                hasBar,
                barStyle,
                barClass:   'ms-bar ' + (STATUS_COLORS[m.Status__c] || 'bar-gray'),
                startFmt:   m.Start_Date__c ? this._fmtDate(m.Start_Date__c) : '—',
                endFmt:     m.End_Date__c   ? this._fmtDate(m.End_Date__c)   : '—',
                statusOpts: this._milestoneStatusOpts(m.Status__c)
            };
        });
    }

    get hasTimeline() { return this.milestonesWithBars.length > 0; }

    // ── Risk display ──────────────────────────────────────────────────────────

    get risksDisplay() {
        const list = this._editSection === 'risks' ? this._draftRisks : (this._data?.risks || []);
        return list.map((r, i) => ({
            ...r,
            key:            r.Id || `new-${i}`,
            idx:            i,
            likelihoodClass: 'risk-badge risk-' + (r.Likelihood__c || 'low').toLowerCase(),
            impactClass:     'risk-badge risk-' + (r.Impact__c     || 'low').toLowerCase(),
            likelihoodOpts:  this._lhOpts(r.Likelihood__c),
            impactOpts:      this._lhOpts(r.Impact__c)
        }));
    }

    get hasRisks() { return (this._data?.risks || []).length > 0; }

    // ── Signoff display ───────────────────────────────────────────────────────

    get signoffsDisplay() {
        const list = this._editSection === 'signoff' ? this._draftSignoffs : (this._data?.signoffs || []);
        return list.map((s, i) => ({
            ...s,
            key:         s.Id || `new-${i}`,
            idx:         i,
            statusClass: 'signoff-badge signoff-' + (s.Status__c || 'pending').toLowerCase().replace(/\s+/, '-'),
            statusOpts:  this._signoffStatusOpts(s.Status__c)
        }));
    }

    get hasSignoffs() { return (this._data?.signoffs || []).length > 0; }

    // ── Edit / Cancel ─────────────────────────────────────────────────────────

    handleEdit(event) {
        const section = event.currentTarget.dataset.section;
        this._editSection     = section;
        this._draftCharter    = { ...(this._data || {}) };
        this._draftMilestones = (this._data?.milestones || []).map(m => ({ ...m }));
        this._draftRaci       = (this._data?.raciCells  || []).map(c => ({ ...c }));
        this._draftRisks      = (this._data?.risks      || []).map(r => ({ ...r }));
        this._draftSignoffs   = (this._data?.signoffs   || []).map(s => ({ ...s }));
        this._newActivity     = '';
        this._newRole         = '';
    }

    handleCancel() {
        this._editSection     = null;
        this._draftCharter    = {};
        this._draftMilestones = [];
        this._draftRaci       = [];
        this._draftRisks      = [];
        this._draftSignoffs   = [];
    }

    // ── Charter field change ──────────────────────────────────────────────────

    handleCharterFieldChange(event) {
        const field = event.target.dataset.field;
        this._draftCharter = { ...this._draftCharter, [field]: event.target.value };
    }

    // ── Save text sections ────────────────────────────────────────────────────

    async handleSaveTextSection(event) {
        const section = event.currentTarget.dataset.section || this._editSection;
        const fields  = SECTION_FIELDS[section];
        if (!fields) return;

        const record = { Id: this._data.charterId };
        for (const f of fields) {
            const key    = FIELD_TO_KEY[f];
            record[f]    = this._draftCharter[key] ?? null;
        }

        this._saving = true;
        try {
            await saveCharter({ charter: record });
            // Reflect changes in live data
            const updated = { ...this._data };
            for (const f of fields) {
                updated[FIELD_TO_KEY[f]] = record[f];
            }
            this._data    = updated;
            this._editSection = null;
            this._toast('Saved', 'success');
        } catch (e) {
            this._toast(this._errMsg(e), 'error');
        } finally {
            this._saving = false;
        }
    }

    // ── Milestone handlers ────────────────────────────────────────────────────

    handleMilestoneFieldChange(event) {
        const idx   = Number(event.target.dataset.idx);
        const field = event.target.dataset.field;
        const copy  = this._draftMilestones.map((m, i) =>
            i === idx ? { ...m, [field]: event.target.value } : m
        );
        this._draftMilestones = copy;
    }

    handleAddMilestone() {
        this._draftMilestones = [
            ...this._draftMilestones,
            { Name: '', Start_Date__c: '', End_Date__c: '', Status__c: 'Not Started',
              Sort_Order__c: this._draftMilestones.length + 1 }
        ];
    }

    handleDeleteMilestone(event) {
        const idx = Number(event.currentTarget.dataset.idx);
        this._draftMilestones = this._draftMilestones.filter((_, i) => i !== idx);
    }

    async handleSaveMilestones() {
        this._saving = true;
        try {
            await saveMilestones({ charterId: this._data.charterId, records: this._draftMilestones });
            this._data        = { ...this._data, milestones: [...this._draftMilestones] };
            this._editSection = null;
            this._toast('Saved', 'success');
        } catch (e) {
            this._toast(this._errMsg(e), 'error');
        } finally {
            this._saving = false;
        }
    }

    // ── RACI handlers ─────────────────────────────────────────────────────────

    handleNewActivityChange(event) { this._newActivity = event.target.value; }
    handleNewRoleChange(event)     { this._newRole     = event.target.value; }

    handleAddActivity() {
        const name = (this._newActivity || '').trim();
        if (!name) return;
        const order    = this.raciRows.length + 1;
        const newCells = this.raciRoles.map(r => ({
            Activity__c: name, Role__c: r.name, Assignment__c: '', Activity_Order__c: order
        }));
        this._draftRaci   = [...this._draftRaci, ...newCells];
        this._newActivity = '';
    }

    handleAddRole() {
        const name = (this._newRole || '').trim();
        if (!name) return;
        // Add one cell per existing activity for the new role
        const activities = [...new Set(this._draftRaci.map(c => c.Activity__c))];
        const newCells   = activities.map((act, i) => ({
            Activity__c: act, Role__c: name, Assignment__c: '',
            Activity_Order__c: this._draftRaci.find(c => c.Activity__c === act)?.Activity_Order__c || i
        }));
        this._draftRaci = [...this._draftRaci, ...newCells];
        this._newRole   = '';
    }

    handleDeleteActivity(event) {
        const activity    = event.currentTarget.dataset.activity;
        this._draftRaci   = this._draftRaci.filter(c => c.Activity__c !== activity);
    }

    handleDeleteRole(event) {
        const role       = event.currentTarget.dataset.role;
        this._draftRaci  = this._draftRaci.filter(c => c.Role__c !== role);
    }

    handleRaciCellClick(event) {
        if (this._editSection !== 'raci') return;
        const activity = event.currentTarget.dataset.activity;
        const role     = event.currentTarget.dataset.role;
        const idx      = this._draftRaci.findIndex(c => c.Activity__c === activity && c.Role__c === role);
        if (idx === -1) {
            this._draftRaci = [...this._draftRaci,
                { Activity__c: activity, Role__c: role, Assignment__c: 'R', Activity_Order__c: 0 }];
        } else {
            const current  = this._draftRaci[idx].Assignment__c || '';
            const nextIdx  = (RACI_CYCLE.indexOf(current) + 1) % RACI_CYCLE.length;
            const updated  = this._draftRaci.map((c, i) =>
                i === idx ? { ...c, Assignment__c: RACI_CYCLE[nextIdx] } : c
            );
            this._draftRaci = updated;
        }
    }

    async handleSaveRaci() {
        // Filter out blank-assignment cells before saving
        const toSave = this._draftRaci.filter(c => c.Assignment__c);
        this._saving = true;
        try {
            await saveRaci({ charterId: this._data.charterId, records: toSave });
            this._data        = { ...this._data, raciCells: [...toSave] };
            this._editSection = null;
            this._toast('Saved', 'success');
        } catch (e) {
            this._toast(this._errMsg(e), 'error');
        } finally {
            this._saving = false;
        }
    }

    // ── Risk handlers ─────────────────────────────────────────────────────────

    handleRiskFieldChange(event) {
        const idx   = Number(event.target.dataset.idx);
        const field = event.target.dataset.field;
        this._draftRisks = this._draftRisks.map((r, i) =>
            i === idx ? { ...r, [field]: event.target.value } : r
        );
    }

    handleAddRisk() {
        this._draftRisks = [...this._draftRisks,
            { Risk_Description__c: '', Likelihood__c: 'Low', Impact__c: 'Low',
              Mitigation__c: '', Sort_Order__c: this._draftRisks.length + 1 }
        ];
    }

    handleDeleteRisk(event) {
        const idx        = Number(event.currentTarget.dataset.idx);
        this._draftRisks = this._draftRisks.filter((_, i) => i !== idx);
    }

    async handleSaveRisks() {
        this._saving = true;
        try {
            await saveRisks({ charterId: this._data.charterId, records: this._draftRisks });
            this._data        = { ...this._data, risks: [...this._draftRisks] };
            this._editSection = null;
            this._toast('Saved', 'success');
        } catch (e) {
            this._toast(this._errMsg(e), 'error');
        } finally {
            this._saving = false;
        }
    }

    // ── Signoff handlers ──────────────────────────────────────────────────────

    handleSignoffFieldChange(event) {
        const idx   = Number(event.target.dataset.idx);
        const field = event.target.dataset.field;
        this._draftSignoffs = this._draftSignoffs.map((s, i) =>
            i === idx ? { ...s, [field]: event.target.value } : s
        );
    }

    handleAddSignoff() {
        this._draftSignoffs = [...this._draftSignoffs,
            { Signer_Name__c: '', Role__c: '', Status__c: 'Pending', Signed_Date__c: '' }
        ];
    }

    handleDeleteSignoff(event) {
        const idx           = Number(event.currentTarget.dataset.idx);
        this._draftSignoffs = this._draftSignoffs.filter((_, i) => i !== idx);
    }

    async handleSaveSignoffs() {
        this._saving = true;
        try {
            await saveSignoffs({ charterId: this._data.charterId, records: this._draftSignoffs });
            this._data        = { ...this._data, signoffs: [...this._draftSignoffs] };
            this._editSection = null;
            this._toast('Saved', 'success');
        } catch (e) {
            this._toast(this._errMsg(e), 'error');
        } finally {
            this._saving = false;
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    _toast(msg, variant) {
        this.dispatchEvent(new ShowToastEvent({ title: variant === 'success' ? 'Saved' : 'Error', message: msg, variant }));
    }

    _errMsg(e) {
        return e?.body?.message || e?.message || 'An error occurred';
    }

    _fmtDate(dateStr) {
        if (!dateStr) return '—';
        const [y, m, d] = dateStr.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d))
            .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    }

    _parseDate(dateStr) {
        const [y, m, d] = dateStr.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d));
    }

    _raciBadgeClass(assignment) {
        const map = { R: 'raci-badge raci-r', A: 'raci-badge raci-a', C: 'raci-badge raci-c', I: 'raci-badge raci-i' };
        return map[assignment] || 'raci-badge raci-empty';
    }

    _milestoneStatusOpts(current) {
        return ['Not Started', 'In Progress', 'Complete', 'At Risk'].map(v => ({ label: v, value: v, selected: v === current }));
    }

    _lhOpts(current) {
        return ['Low', 'Medium', 'High'].map(v => ({ label: v, value: v, selected: v === current }));
    }

    _signoffStatusOpts(current) {
        return ['Pending', 'Signed', 'Declined'].map(v => ({ label: v, value: v, selected: v === current }));
    }
}
