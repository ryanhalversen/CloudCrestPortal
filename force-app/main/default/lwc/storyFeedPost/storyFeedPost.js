import { LightningElement, api, track, wire } from 'lwc';
import { getRecord } from 'lightning/uiRecordApi';
import createReply from '@salesforce/apex/StoryFeedController.createReply';
import USER_ID from '@salesforce/user/Id';
import NAME_FIELD from '@salesforce/schema/User.Name';

export default class StoryFeedPost extends LightningElement {
    @api post;
    @api recordId;

    @track showReplies  = false;
    @track replyBody    = '';
    @track isReplying   = false;
    @track replyError   = null;

    currentUserName = '';

    @wire(getRecord, { recordId: USER_ID, fields: [NAME_FIELD] })
    wiredUser({ data, error }) {
        if (data)  this.currentUserName = data.fields.Name.value;
        if (error) console.error('StoryFeedPost getRecord error', error);
    }

    // ── Getters ──────────────────────────────────────────────────────────────

    get postClass() {
        const base = 'post';
        if (this.post.postType === 'DECISION') return base + ' post-decision';
        if (this.post.postType === 'BLOCKER')  return base + ' post-blocker';
        return base;
    }

    get isTagged() {
        return this.post.postType === 'DECISION' || this.post.postType === 'BLOCKER';
    }

    get tagBadgeClass() {
        return this.post.postType === 'DECISION'
            ? 'tag-badge tag-decision'
            : 'tag-badge tag-blocker';
    }

    get authorInitials() {
        return this.toInitials(this.post.authorName);
    }

    get currentUserInitials() {
        return this.toInitials(this.currentUserName);
    }

    get hasReplies() {
        return this.post.replies && this.post.replies.length > 0;
    }

    get replyLabel() {
        const count = this.post.replies ? this.post.replies.length : 0;
        return count === 1 ? '1 reply' : `${count} replies`;
    }

    get replyToggleIcon() {
        return this.showReplies ? '▲' : '▾';
    }

    get isReplyDisabled() {
        return this.replyBody.trim().length === 0 || this.isReplying;
    }

    get replyBtnLabel() {
        return this.isReplying ? 'Posting...' : 'Reply';
    }

    // Pre-compute initials on each reply so template doesn't need
    // to call a method inline — fixes LWC1535 CallExpression error
    get repliesWithInitials() {
        if (!this.post.replies) return [];
        return this.post.replies.map(r => ({
            ...r,
            initials: this.toInitials(r.authorName)
        }));
    }

    // ── Handlers ─────────────────────────────────────────────────────────────

    handleToggleReplies() {
        this.showReplies = !this.showReplies;
    }

    handleReplyInput(e) {
        this.replyBody = e.target.value;
    }

    handleReplyKeyDown(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            this.handleReply();
        }
    }

    async handleReply() {
        if (this.isReplyDisabled) return;
        this.isReplying = true;
        this.replyError = null;
        try {
            await createReply({
                feedItemId: this.post.id,
                body: this.replyBody.trim()
            });
            this.replyBody = '';
            this.template.querySelector('textarea').value = '';
            this.dispatchEvent(new CustomEvent('replycreated', { bubbles: true }));
        } catch (err) {
            this.replyError = 'Unable to post reply. Please try again.';
            console.error('StoryFeedPost createReply error', err);
        } finally {
            this.isReplying = false;
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    toInitials(name) {
        if (!name) return '?';
        return name.split(' ')
            .map(w => w[0])
            .join('')
            .substring(0, 2)
            .toUpperCase();
    }
}