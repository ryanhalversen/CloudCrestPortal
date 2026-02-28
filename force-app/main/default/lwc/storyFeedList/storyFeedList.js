import { LightningElement, api, track, wire } from 'lwc';
import getFeedItems from '@salesforce/apex/StoryFeedController.getFeedItems';
import { refreshApex } from '@salesforce/apex';

export default class StoryFeedList extends LightningElement {
    @api recordId;
    @api filterType     = 'ALL';
    @api refreshCounter = 0;

    @track isLoading = true;
    @track hasError  = false;

    wiredFeedResult;

    @wire(getFeedItems, {
        recordId:   '$recordId',
        filterType: '$filterType'
    })
    wiredFeed(result) {
        this.wiredFeedResult = result;
        this.isLoading = false;
        if (result.data) {
            this.hasError = false;
        }
        if (result.error) {
            this.hasError = true;
            console.error('StoryFeedList getFeedItems error', result.error);
        }
    }

    get posts() {
        if (!this.wiredFeedResult || !this.wiredFeedResult.data) return [];
        return this.wiredFeedResult.data
            .filter(p => (p.body && p.body.trim()) || (p.trackedChanges && p.trackedChanges.length > 0) || p.postType === 'TRACKED_CHANGE')
            .map(p => ({
                ...p,
                isTrackedChange: p.postType === 'TRACKED_CHANGE' || (p.trackedChanges && p.trackedChanges.length > 0),
                isRegularPost:   p.postType !== 'TRACKED_CHANGE' && (!p.trackedChanges || p.trackedChanges.length === 0)
            }));
    }

    @api
    refresh() {
        this.isLoading = true;
        refreshApex(this.wiredFeedResult).finally(() => {
            this.isLoading = false;
        });
    }

    handleReplyCreated() {
        this.refresh();
    }

    get isEmpty() {
        return !this.isLoading && !this.hasError && this.posts.length === 0;
    }

    get hasPosts() {
        return !this.isLoading && !this.hasError && this.posts.length > 0;
    }
}