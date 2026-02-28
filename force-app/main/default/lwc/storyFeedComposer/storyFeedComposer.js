import { LightningElement, api, track, wire } from 'lwc';
import { CurrentPageReference } from 'lightning/navigation';
import createPost from '@salesforce/apex/StoryFeedController.createPost';
import USER_ID from '@salesforce/user/Id';
import NAME_FIELD from '@salesforce/schema/User.Name';
import { getRecord } from 'lightning/uiRecordApi';

export default class StoryFeedComposer extends LightningElement {
    @api recordId;

    @track postBody    = '';
    @track activeTag   = null;   // 'DECISION' | 'BLOCKER' | null
    @track isPosting   = false;
    @track errorMessage = null;

    currentUserName = '';

    // Get current user name for initials
    @wire(getRecord, { recordId: USER_ID, fields: [NAME_FIELD] })
    wiredUser({ data, error }) {
        if (data)  this.currentUserName = data.fields.Name.value;
        if (error) console.error('StoryFeedComposer getRecord error', error);
    }

    get initials() {
        if (!this.currentUserName) return '?';
        return this.currentUserName
            .split(' ')
            .map(w => w[0])
            .join('')
            .substring(0, 2)
            .toUpperCase();
    }

    get isPostDisabled() {
        return this.postBody.trim().length === 0 || this.isPosting;
    }

    get postLabel() {
        return this.isPosting ? 'Posting...' : 'Post';
    }

    get decisionBtnClass() {
        return 'tag-pill tag-decision' + (this.activeTag === 'DECISION' ? ' tag-active' : '');
    }

    get blockerBtnClass() {
        return 'tag-pill tag-blocker' + (this.activeTag === 'BLOCKER' ? ' tag-active' : '');
    }

    handleInput(e) {
        this.postBody = e.target.value;
    }

    // Ctrl/Cmd + Enter to post
    handleKeyDown(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            this.handlePost();
        }
    }

    handleTagToggle(e) {
        const tag = e.currentTarget.dataset.tag;
        // Toggle off if already active
        this.activeTag = this.activeTag === tag ? null : tag;
    }

    async handlePost() {
        if (this.isPostDisabled) return;
        this.isPosting    = true;
        this.errorMessage = null;

        // Prefix body with tag if set
        const prefix = this.activeTag ? `[${this.activeTag}] ` : '';
        const body   = prefix + this.postBody.trim();

        try {
            await createPost({ recordId: this.recordId, body });
            this.postBody  = '';
            this.activeTag = null;
            // Clear the textarea visually
            this.template.querySelector('textarea').value = '';
            // Notify parent to refresh feed
            this.dispatchEvent(new CustomEvent('postcreated'));
        } catch (err) {
            this.errorMessage = 'Something went wrong posting your message. Please try again.';
            console.error('StoryFeedComposer createPost error', err);
        } finally {
            this.isPosting = false;
        }
    }
}