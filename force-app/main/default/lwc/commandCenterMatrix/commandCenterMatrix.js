// force-app/main/default/lwc/commandCenterMatrix/commandCenterMatrix.js
import { LightningElement, wire, track } from 'lwc';
import getPastManagement   from '@salesforce/apex/CommandCenterController.getPastManagement';
import getPastCustomer     from '@salesforce/apex/CommandCenterController.getPastCustomer';
import getPastEmployee     from '@salesforce/apex/CommandCenterController.getPastEmployee';
import getPresentManagement from '@salesforce/apex/CommandCenterController.getPresentManagement';
import getPresentCustomer  from '@salesforce/apex/CommandCenterController.getPresentCustomer';
import getPresentEmployee  from '@salesforce/apex/CommandCenterController.getPresentEmployee';
import getFutureManagement from '@salesforce/apex/CommandCenterController.getFutureManagement';
import getFutureCustomer   from '@salesforce/apex/CommandCenterController.getFutureCustomer';
import getFutureEmployee   from '@salesforce/apex/CommandCenterController.getFutureEmployee';

export default class CommandCenterMatrix extends LightningElement {

    @track activeCard = null;

    // ── Wire: Past ─────────────────────────────────────────────────────────

    @wire(getPastManagement)
    _pastMgmt;

    @wire(getPastCustomer)
    _pastCust;

    @wire(getPastEmployee)
    _pastEmp;

    // ── Wire: Present ──────────────────────────────────────────────────────

    @wire(getPresentManagement)
    _presentMgmt;

    @wire(getPresentCustomer)
    _presentCust;

    @wire(getPresentEmployee)
    _presentEmp;

    // ── Wire: Future ───────────────────────────────────────────────────────

    @wire(getFutureManagement)
    _futureMgmt;

    @wire(getFutureCustomer)
    _futureCust;

    @wire(getFutureEmployee)
    _futureEmp;

    // ── Data getters ───────────────────────────────────────────────────────

    get pastMgmtData()    { return this._pastMgmt?.data    || null; }
    get pastCustData()    { return this._pastCust?.data    || null; }
    get pastEmpData()     { return this._pastEmp?.data     || null; }
    get presentMgmtData() { return this._presentMgmt?.data || null; }
    get presentCustData() { return this._presentCust?.data || null; }
    get presentEmpData()  { return this._presentEmp?.data  || null; }
    get futureMgmtData()  { return this._futureMgmt?.data  || null; }
    get futureCustData()  { return this._futureCust?.data  || null; }
    get futureEmpData()   { return this._futureEmp?.data   || null; }

    get hasError() {
        return !!(
            this._pastMgmt?.error    || this._pastCust?.error    || this._pastEmp?.error    ||
            this._presentMgmt?.error || this._presentCust?.error || this._presentEmp?.error ||
            this._futureMgmt?.error  || this._futureCust?.error  || this._futureEmp?.error
        );
    }

    get currentTime() {
        return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    }

    // ── Event handlers ─────────────────────────────────────────────────────

    handleCardClick(event) {
        this.activeCard = event.detail.cardData;
    }

    handleCloseModal() {
        this.activeCard = null;
    }

    handleRefresh() {
        // Force LWC to re-render by toggling (wire cache is bypassed on next navigation)
        // Simplest approach: reload the page
        // eslint-disable-next-line no-restricted-globals
        location.reload();
    }
}
