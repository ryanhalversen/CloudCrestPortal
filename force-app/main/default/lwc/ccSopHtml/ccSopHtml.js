import { LightningElement, api } from 'lwc';

export default class CcSopHtml extends LightningElement {
    _html = '';

    @api
    get html() {
        return this._html;
    }
    set html(value) {
        this._html = value || '';
        this._inject();
    }

    renderedCallback() {
        this._inject();
    }

    _inject() {
        const el = this.template.querySelector('.sop-html-body');
        if (el && this._html) {
            // eslint-disable-next-line @lwc/lwc/no-inner-html
            el.innerHTML = this._html;
        }
    }
}
