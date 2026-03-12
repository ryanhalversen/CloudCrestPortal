// force-app/main/default/lwc/capacityCard/capacityCard.js
import { LightningElement, api } from 'lwc';

export default class CapacityCard extends LightningElement {

    get hasData() {
        return this._cardData != null;
    }

    get cardClass() {
        const status = this._cardData?.status || 'neutral';
        return `capacity-card capacity-card--${status}`;
    }

    get statusDotClass() {
        const status = this._cardData?.status || 'neutral';
        return `status-dot status-dot--${status}`;
    }

    // Map card status → which benchmark level is currently active
    // critical → poor, warning → good, good → great
    get _activeLevel() {
        const s = this._cardData?.status;
        if (s === 'critical') return 'poor';
        if (s === 'warning')  return 'good';
        if (s === 'good')     return 'great';
        return null;
    }

    get poorClass()  { return `bm-chip bm-chip--poor${  this._activeLevel === 'poor'  ? ' bm-chip--active' : ''}`; }
    get goodClass()  { return `bm-chip bm-chip--good${  this._activeLevel === 'good'  ? ' bm-chip--active' : ''}`; }
    get greatClass() { return `bm-chip bm-chip--great${ this._activeLevel === 'great' ? ' bm-chip--active' : ''}`; }

    // Augment each KPI with derived display properties
    @api
    get cardData() {
        return this._cardData;
    }

    set cardData(value) {
        if (!value) { this._cardData = null; return; }
        this._cardData = {
            ...value,
            kpis: (value.kpis || []).map(k => ({
                ...k,
                trendClass: `kpi-trend kpi-trend--${k.trend || 'neutral'}`,
                trendIcon:  k.trend === 'up' ? '↑' : k.trend === 'down' ? '↓' : ''
            }))
        };
    }

    _cardData = null;

    handleClick() {
        if (!this._cardData) return;
        this.dispatchEvent(
            new CustomEvent('cardclick', { detail: { cardData: this._cardData }, bubbles: true, composed: true })
        );
    }
}
