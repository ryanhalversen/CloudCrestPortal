import { LightningElement, track } from 'lwc';
import parseActionItems from '@salesforce/apex/ActionItemParserController.parseActionItems';

export default class ActionItemParser extends LightningElement {
    @track rawInput = '';
    @track usItems = [];
    @track clientItems = [];
    @track isLoading = false;
    @track isParsed = false;
    @track errorMsg = '';

    handleInputChange(evt) {
        this.rawInput = evt.target.value;
    }

    async handleParse() {
        if (!this.rawInput.trim()) return;
        this.isLoading = true;
        this.errorMsg = '';

        try {
            const text = await parseActionItems({ bulletPoints: this.rawInput });
            const parsed = JSON.parse(text);

            this.usItems = (parsed.us || []).map((item, i) => ({
                id: `us_${Date.now()}_${i}`,
                label: item,
                done: false
            }));
            this.clientItems = (parsed.client || []).map((item, i) => ({
                id: `cl_${Date.now()}_${i}`,
                label: item,
                done: false
            }));

            this.isParsed = true;
        } catch (e) {
            this.errorMsg = 'Failed to parse action items. Please try again.';
            console.error(e);
        }

        this.isLoading = false;
    }

    handleUsCheck(evt) {
        const id = evt.target.dataset.id;
        this.usItems = this.usItems.map(item =>
            item.id === id ? { ...item, done: evt.target.checked } : item
        );
    }

    handleClientCheck(evt) {
        const id = evt.target.dataset.id;
        this.clientItems = this.clientItems.map(item =>
            item.id === id ? { ...item, done: evt.target.checked } : item
        );
    }

    handleMoveToUs(evt) {
        const id = evt.target.dataset.id;
        const item = this.clientItems.find(i => i.id === id);
        if (item) {
            this.clientItems = this.clientItems.filter(i => i.id !== id);
            this.usItems = [...this.usItems, item];
        }
    }

    handleMoveToClient(evt) {
        const id = evt.target.dataset.id;
        const item = this.usItems.find(i => i.id === id);
        if (item) {
            this.usItems = this.usItems.filter(i => i.id !== id);
            this.clientItems = [...this.clientItems, item];
        }
    }

    handleReset() {
        this.isParsed = false;
        this.usItems = [];
        this.clientItems = [];
        this.rawInput = '';
    }

    get usProgress() {
        if (!this.usItems.length) return 0;
        return Math.round((this.usItems.filter(i => i.done).length / this.usItems.length) * 100);
    }

    get clientProgress() {
        if (!this.clientItems.length) return 0;
        return Math.round((this.clientItems.filter(i => i.done).length / this.clientItems.length) * 100);
    }

    get usDoneCount() { return this.usItems.filter(i => i.done).length; }
    get clientDoneCount() { return this.clientItems.filter(i => i.done).length; }
    get parseButtonLabel() { return this.isLoading ? 'Parsing...' : 'Parse Action Items'; }
    get usProgressStyle() { return `width: ${this.usProgress}%`; }
    get clientProgressStyle() { return `width: ${this.clientProgress}%`; }

    get usItemsWithClasses() {
        return this.usItems.map(i => ({
            ...i,
            rowClass: 'item-row',
            textClass: i.done ? 'item-text-done' : 'item-text'
        }));
    }
    get clientItemsWithClasses() {
        return this.clientItems.map(i => ({
            ...i,
            rowClass: 'item-row',
            textClass: i.done ? 'item-text-done' : 'item-text'
        }));
    }
}