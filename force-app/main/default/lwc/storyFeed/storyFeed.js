import { LightningElement, api, track } from 'lwc';
import getStoriesBySprintWeek from '@salesforce/apex/StoryFeedController.getStoriesBySprintWeek';
import getCurrentSprintWeek   from '@salesforce/apex/StoryFeedController.getCurrentSprintWeek';
import getAllStories           from '@salesforce/apex/StoryFeedController.getAllStories';

const PRIORITY_MAP = {
    'Critical':         'pill pill-critical',
    'High':             'pill pill-high',
    'Medium':           'pill pill-medium',
    'Low':              'pill pill-low',
    'Needs Assignment': 'pill pill-medium'
};

const PRIORITY_ORDER = { 'Critical': 1, 'High': 2, 'Medium': 3, 'Low': 4, 'Needs Assignment': 5 };

export default class StoryFeedHub extends LightningElement {
    @api recordId;
    @track currentWeek      = 1;
    @track selectedRecordId = null;
    @track isLoading        = true;
    @track stories          = [];
    @track groupBy          = 'SPRINT';
    @track sortBy           = 'PRIORITY';

    allStories = [];

    // ── Init ─────────────────────────────────────────────────────────────────
    async connectedCallback() {
        try {
            const week = await getCurrentSprintWeek();
            this.currentWeek = week || 1;
        } catch(e) {
            this.currentWeek = 1;
        }
        await this.loadStories();
    }

    async loadStories() {
        this.isLoading        = true;
        this.selectedRecordId = null;
        try {
            const raw = await getStoriesBySprintWeek({ sprintWeek: this.currentWeek });
            this.allStories = raw || [];
            this.applyFilter();
        } catch(e) {
            console.error('loadStories error', e);
            this.allStories = [];
            this.stories    = [];
        } finally {
            this.isLoading = false;
        }
    }

    applyFilter() {
        let filtered = [...this.allStories];

        // Group/filter
        if (this.groupBy === 'SPRINT') {
            filtered = filtered.filter(s => s.Sprint_Week__c == this.currentWeek);
        } else if (this.groupBy === 'PRIORITY') {
            filtered = filtered.filter(s => s.Priority != null);
        } else if (this.groupBy === 'DEPARTMENT') {
            filtered = filtered.filter(s => s.Department__c != null);
        } else if (this.groupBy === 'STATUS') {
            filtered = filtered.filter(s => s.Status != null);
        }
        // ALL — no filtering

        // Sort
        if (this.sortBy === 'PRIORITY') {
            filtered.sort((a, b) => {
                const pa = PRIORITY_ORDER[a.Priority] || 99;
                const pb = PRIORITY_ORDER[b.Priority] || 99;
                return pa - pb;
            });
        } else if (this.sortBy === 'DATE') {
            filtered.sort((a, b) => new Date(b.CreatedDate) - new Date(a.CreatedDate));
        }

        this.stories = filtered.map(s => this.mapStory(s, s.Id === this.selectedRecordId));
    }

    mapStory(s, isSelected) {
        const orgBase = window.location.origin.replace('.my.site.com', '.lightning.force.com');
        return {
            id:            s.Id,
            subject:       s.Subject,
            status:        s.Status,
            priority:      s.Priority,
            department:    s.Department__c,
            stage:         s.Stage__c,
            sprintWeek:    s.Sprint_Week__c,
            orgUrl:        `${orgBase}/lightning/r/Case/${s.Id}/view`,
            priorityClass: PRIORITY_MAP[s.Priority] || 'pill pill-medium',
            itemClass:     'story-item' + (isSelected ? ' story-item-active' : '')
        };
    }

    // ── Handlers ─────────────────────────────────────────────────────────────
    handleGroupChange(e) {
        this.groupBy = e.target.value;
        if (this.groupBy === 'SPRINT') {
            this.loadStories();
        } else {
            this.loadAllStories();
        }
    }

    async loadAllStories() {
        this.isLoading        = true;
        this.selectedRecordId = null;
        try {
            const raw = await getAllStories({});
            this.allStories = raw || [];
            this.applyFilter();
        } catch(e) {
            console.error('loadAllStories error', e);
            this.allStories = [];
            this.stories    = [];
        } finally {
            this.isLoading = false;
        }
    }

    handleSortChange(e) {
        this.sortBy = e.target.value;
        this.applyFilter();
    }

    handleStorySelect(e) {
        e.stopPropagation();
        const id = e.currentTarget.dataset.id;
        this.selectedRecordId = id;
        this.stories = this.stories.map(s => ({
            ...s,
            itemClass: 'story-item' + (s.id === id ? ' story-item-active' : '')
        }));
    }

    handleLinkClick(e) {
        e.stopPropagation();
    }

    handlePrevWeek() {
        if (this.currentWeek > 1) {
            this.currentWeek -= 1;
            this.loadStories();
        }
    }

    handleNextWeek() {
        this.currentWeek += 1;
        this.loadStories();
    }

    // ── Getters ───────────────────────────────────────────────────────────────
    get isFirstWeek()  { return this.currentWeek <= 1; }
    get isSprintView() { return this.groupBy === 'SPRINT'; }
    get isEmpty()      { return !this.isLoading && this.stories.length === 0; }
    get hasStories()   { return !this.isLoading && this.stories.length > 0; }
}