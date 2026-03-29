import { LightningElement, wire } from 'lwc';
import getAccountCountsByState from '@salesforce/apex/TAMmapController.getAccountCountsByState';

// Tile grid layout — each state is positioned on an 11-col × 9-row grid.
// Row/col are 0-based; CSS grid uses 1-based, so we add 1 in the style string.
const STATE_TILES = [
    // ── Far Northeast ───────────────────────────────────────────────
    { abbr: 'ME', name: 'Maine',                row: 0, col: 10 },
    { abbr: 'VT', name: 'Vermont',              row: 1, col:  9 },
    { abbr: 'NH', name: 'New Hampshire',        row: 1, col: 10 },
    { abbr: 'MA', name: 'Massachusetts',        row: 2, col: 10 },
    { abbr: 'RI', name: 'Rhode Island',         row: 2, col:  9 },
    { abbr: 'CT', name: 'Connecticut',          row: 3, col: 10 },
    { abbr: 'NJ', name: 'New Jersey',           row: 3, col:  9 },
    { abbr: 'DE', name: 'Delaware',             row: 4, col: 10 },
    { abbr: 'MD', name: 'Maryland',             row: 4, col:  9 },
    { abbr: 'DC', name: 'Washington D.C.',      row: 5, col:  9 },

    // ── Mid-Atlantic → Southeast ─────────────────────────────────
    { abbr: 'NY', name: 'New York',             row: 2, col:  8 },
    { abbr: 'PA', name: 'Pennsylvania',         row: 3, col:  8 },
    { abbr: 'VA', name: 'Virginia',             row: 4, col:  8 },
    { abbr: 'NC', name: 'North Carolina',       row: 5, col:  8 },
    { abbr: 'SC', name: 'South Carolina',       row: 6, col:  8 },
    { abbr: 'GA', name: 'Georgia',              row: 6, col:  7 },
    { abbr: 'FL', name: 'Florida',              row: 7, col:  7 },

    // ── Appalachia / Upper South ─────────────────────────────────
    { abbr: 'MI', name: 'Michigan',             row: 2, col:  7 },
    { abbr: 'OH', name: 'Ohio',                 row: 3, col:  7 },
    { abbr: 'WV', name: 'West Virginia',        row: 4, col:  7 },
    { abbr: 'KY', name: 'Kentucky',             row: 4, col:  6 },
    { abbr: 'TN', name: 'Tennessee',            row: 5, col:  7 },
    { abbr: 'AL', name: 'Alabama',              row: 6, col:  6 },

    // ── Midwest ─────────────────────────────────────────────────
    { abbr: 'WI', name: 'Wisconsin',            row: 2, col:  6 },
    { abbr: 'IL', name: 'Illinois',             row: 3, col:  5 },
    { abbr: 'IN', name: 'Indiana',              row: 3, col:  6 },
    { abbr: 'MO', name: 'Missouri',             row: 4, col:  5 },
    { abbr: 'AR', name: 'Arkansas',             row: 5, col:  5 },
    { abbr: 'MS', name: 'Mississippi',          row: 6, col:  5 },
    { abbr: 'LA', name: 'Louisiana',            row: 7, col:  5 },

    // ── Upper Midwest / Plains ───────────────────────────────────
    { abbr: 'MN', name: 'Minnesota',            row: 1, col:  5 },
    { abbr: 'IA', name: 'Iowa',                 row: 2, col:  5 },
    { abbr: 'KS', name: 'Kansas',               row: 4, col:  4 },
    { abbr: 'OK', name: 'Oklahoma',             row: 5, col:  4 },
    { abbr: 'TX', name: 'Texas',                row: 6, col:  4 },

    // ── Great Plains ─────────────────────────────────────────────
    { abbr: 'ND', name: 'North Dakota',         row: 1, col:  4 },
    { abbr: 'SD', name: 'South Dakota',         row: 2, col:  4 },
    { abbr: 'NE', name: 'Nebraska',             row: 3, col:  4 },

    // ── Mountain ─────────────────────────────────────────────────
    { abbr: 'MT', name: 'Montana',              row: 1, col:  3 },
    { abbr: 'WY', name: 'Wyoming',              row: 2, col:  3 },
    { abbr: 'CO', name: 'Colorado',             row: 3, col:  3 },
    { abbr: 'NM', name: 'New Mexico',           row: 4, col:  3 },

    // ── West ─────────────────────────────────────────────────────
    { abbr: 'ID', name: 'Idaho',                row: 1, col:  2 },
    { abbr: 'UT', name: 'Utah',                 row: 2, col:  2 },
    { abbr: 'AZ', name: 'Arizona',              row: 3, col:  2 },
    { abbr: 'NV', name: 'Nevada',               row: 2, col:  1 },
    { abbr: 'OR', name: 'Oregon',               row: 1, col:  1 },
    { abbr: 'CA', name: 'California',           row: 3, col:  1 },
    { abbr: 'WA', name: 'Washington',           row: 0, col:  1 },

    // ── Non-contiguous ──────────────────────────────────────────
    { abbr: 'AK', name: 'Alaska',               row: 8, col:  0 },
    { abbr: 'HI', name: 'Hawaii',               row: 8, col:  2 },
];

// Interpolate between #e8f4f8 (light) and #0070d2 (Salesforce blue).
function tileColor(intensity) {
    const r = Math.round(232 + intensity * (0   - 232));
    const g = Math.round(244 + intensity * (112 - 244));
    const b = Math.round(248 + intensity * (210 - 248));
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
            const color     = intensity > 0.55 ? '#ffffff' : '#1c3557';
            return {
                ...tile,
                count,
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
