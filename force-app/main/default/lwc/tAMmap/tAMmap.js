import { LightningElement, wire } from 'lwc';
import getAccountCountsByState from '@salesforce/apex/TAMmapController.getAccountCountsByState';

// Tile grid layout — 12-col × 12-row grid covering Canada (rows 0-2) + USA (rows 3-11).
// Row/col are 0-based; CSS grid uses 1-based, so we add 1 in the style string.
const STATE_TILES = [
    // ── Canada: territories (row 0) ─────────────────────────────
    { abbr: 'YT', name: 'Yukon',                      row: 0, col:  1, isCanada: true },
    { abbr: 'NT', name: 'Northwest Territories',      row: 0, col:  3, isCanada: true },
    { abbr: 'NU', name: 'Nunavut',                    row: 0, col:  8, isCanada: true },

    // ── Canada: main provinces (row 1) ──────────────────────────
    { abbr: 'BC', name: 'British Columbia',           row: 1, col:  1, isCanada: true },
    { abbr: 'AB', name: 'Alberta',                    row: 1, col:  3, isCanada: true },
    { abbr: 'SK', name: 'Saskatchewan',               row: 1, col:  4, isCanada: true },
    { abbr: 'MB', name: 'Manitoba',                   row: 1, col:  5, isCanada: true },
    { abbr: 'ON', name: 'Ontario',                    row: 1, col:  7, isCanada: true },
    { abbr: 'QC', name: 'Quebec',                     row: 1, col:  8, isCanada: true },
    { abbr: 'NL', name: 'Newfoundland & Labrador',    row: 1, col: 11, isCanada: true },

    // ── Canada: Maritime provinces (row 2) ──────────────────────
    { abbr: 'NB', name: 'New Brunswick',              row: 2, col:  9, isCanada: true },
    { abbr: 'NS', name: 'Nova Scotia',                row: 2, col: 10, isCanada: true },
    { abbr: 'PE', name: 'Prince Edward Island',       row: 2, col: 11, isCanada: true },

    // ── USA: Northwest ───────────────────────────────────────────
    { abbr: 'WA', name: 'Washington',           row: 3, col:  1 },
    { abbr: 'OR', name: 'Oregon',               row: 4, col:  1 },
    { abbr: 'NV', name: 'Nevada',               row: 5, col:  1 },
    { abbr: 'CA', name: 'California',           row: 6, col:  1 },
    { abbr: 'ID', name: 'Idaho',                row: 4, col:  2 },
    { abbr: 'UT', name: 'Utah',                 row: 5, col:  2 },
    { abbr: 'AZ', name: 'Arizona',              row: 6, col:  2 },

    // ── USA: Mountain ────────────────────────────────────────────
    { abbr: 'MT', name: 'Montana',              row: 4, col:  3 },
    { abbr: 'WY', name: 'Wyoming',              row: 5, col:  3 },
    { abbr: 'CO', name: 'Colorado',             row: 6, col:  3 },
    { abbr: 'NM', name: 'New Mexico',           row: 7, col:  3 },

    // ── USA: Great Plains ────────────────────────────────────────
    { abbr: 'ND', name: 'North Dakota',         row: 4, col:  4 },
    { abbr: 'SD', name: 'South Dakota',         row: 5, col:  4 },
    { abbr: 'NE', name: 'Nebraska',             row: 6, col:  4 },
    { abbr: 'KS', name: 'Kansas',               row: 7, col:  4 },
    { abbr: 'OK', name: 'Oklahoma',             row: 8, col:  4 },
    { abbr: 'TX', name: 'Texas',                row: 9, col:  4 },

    // ── USA: Upper Midwest / Plains ──────────────────────────────
    { abbr: 'MN', name: 'Minnesota',            row: 4, col:  5 },
    { abbr: 'IA', name: 'Iowa',                 row: 5, col:  5 },
    { abbr: 'IL', name: 'Illinois',             row: 6, col:  5 },
    { abbr: 'MO', name: 'Missouri',             row: 7, col:  5 },
    { abbr: 'AR', name: 'Arkansas',             row: 8, col:  5 },
    { abbr: 'MS', name: 'Mississippi',          row: 9, col:  5 },
    { abbr: 'LA', name: 'Louisiana',            row: 10, col: 5 },

    // ── USA: Great Lakes / Midwest ───────────────────────────────
    { abbr: 'WI', name: 'Wisconsin',            row: 5, col:  6 },
    { abbr: 'IN', name: 'Indiana',              row: 6, col:  6 },
    { abbr: 'KY', name: 'Kentucky',             row: 7, col:  6 },
    { abbr: 'AL', name: 'Alabama',              row: 9, col:  6 },

    // ── USA: Great Lakes East / Appalachia ───────────────────────
    { abbr: 'MI', name: 'Michigan',             row: 5, col:  7 },
    { abbr: 'OH', name: 'Ohio',                 row: 6, col:  7 },
    { abbr: 'WV', name: 'West Virginia',        row: 7, col:  7 },
    { abbr: 'TN', name: 'Tennessee',            row: 8, col:  7 },
    { abbr: 'GA', name: 'Georgia',              row: 9, col:  7 },
    { abbr: 'FL', name: 'Florida',              row: 10, col: 7 },

    // ── USA: Mid-Atlantic → Southeast ────────────────────────────
    { abbr: 'NY', name: 'New York',             row: 5, col:  8 },
    { abbr: 'PA', name: 'Pennsylvania',         row: 6, col:  8 },
    { abbr: 'VA', name: 'Virginia',             row: 7, col:  8 },
    { abbr: 'NC', name: 'North Carolina',       row: 8, col:  8 },
    { abbr: 'SC', name: 'South Carolina',       row: 9, col:  8 },

    // ── USA: Northeast corridor ──────────────────────────────────
    { abbr: 'VT', name: 'Vermont',              row: 4, col:  9 },
    { abbr: 'RI', name: 'Rhode Island',         row: 5, col:  9 },
    { abbr: 'NJ', name: 'New Jersey',           row: 6, col:  9 },
    { abbr: 'MD', name: 'Maryland',             row: 7, col:  9 },
    { abbr: 'DC', name: 'Washington D.C.',      row: 8, col:  9 },
    { abbr: 'ME', name: 'Maine',                row: 3, col: 10 },
    { abbr: 'NH', name: 'New Hampshire',        row: 4, col: 10 },
    { abbr: 'MA', name: 'Massachusetts',        row: 5, col: 10 },
    { abbr: 'CT', name: 'Connecticut',          row: 6, col: 10 },
    { abbr: 'DE', name: 'Delaware',             row: 7, col: 10 },

    // ── USA: Non-contiguous ──────────────────────────────────────
    { abbr: 'AK', name: 'Alaska',               row: 11, col: 0 },
    { abbr: 'HI', name: 'Hawaii',               row: 11, col: 2 },
];

// Interpolate between #162040 (dark navy) and #0ea5e9 (bright sky-blue).
function tileColor(intensity) {
    const r = Math.round(22  + intensity * (14  - 22));
    const g = Math.round(32  + intensity * (165 - 32));
    const b = Math.round(64  + intensity * (233 - 64));
    return `rgb(${r},${g},${b})`;
}

export default class TAMmap extends LightningElement {
    tiles         = [];
    totalAccounts = '—';
    statesWithAccounts = 0;
    maxCount      = 0;
    topState      = '—';
    activeTooltip = null;
    isLoading     = true;
    hasError      = false;
    errorMessage  = '';

    @wire(getAccountCountsByState)
    wiredCounts({ data, error }) {
        this.isLoading = false;
        if (data) {
            this._buildTiles(data);
        } else if (error) {
            this.hasError    = true;
            this.errorMessage = error?.body?.message ?? 'Failed to load account data.';
        }
    }

    _buildTiles(data) {
        // Aggregate by uppercase state abbreviation
        const countMap = {};
        data.forEach(({ state, count }) => {
            if (state) {
                const key = state.toUpperCase().trim();
                countMap[key] = (countMap[key] || 0) + count;
            }
        });

        let total    = 0;
        let maxCount = 0;
        let topAbbr  = null;
        let stateCount = 0;

        Object.entries(countMap).forEach(([abbr, cnt]) => {
            total += cnt;
            stateCount++;
            if (cnt > maxCount) { maxCount = cnt; topAbbr = abbr; }
        });

        this.totalAccounts      = total.toLocaleString();
        this.maxCount           = maxCount;
        this.statesWithAccounts = stateCount;
        this.topState           = topAbbr ? `${topAbbr} (${maxCount.toLocaleString()})` : '—';

        this.tiles = STATE_TILES.map(tile => {
            const count     = countMap[tile.abbr] || 0;
            const intensity = maxCount > 0 ? count / maxCount : 0;
            const bg        = tileColor(intensity);
            const color     = intensity > 0.55 ? '#0a1020' : 'rgba(255,255,255,0.65)';
            return {
                ...tile,
                count,
                tileClass: tile.isCanada ? 'state-tile canada-tile' : 'state-tile',
                style: `grid-row:${tile.row + 1};grid-column:${tile.col + 1};background-color:${bg};color:${color};`,
            };
        });
    }

    handleMouseEnter(event) {
        const abbr = event.currentTarget.dataset.abbr;
        this.activeTooltip = this.tiles.find(t => t.abbr === abbr) || null;
    }

    handleMouseLeave() {
        this.activeTooltip = null;
    }
}
