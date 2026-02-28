import { LightningElement, api } from 'lwc';

export default class StoryFeedSidebar extends LightningElement {
    @api story = {};

    get priorityClass() {
        const p = (this.story.priority || '').toLowerCase();
        if (p === 'critical') return 'detail-value priority-critical';
        if (p === 'high')     return 'detail-value priority-high';
        return 'detail-value';
    }

    get dueDateClass() {
        if (!this.story.plannedCompletion) return 'detail-value';
        const due  = new Date(this.story.plannedCompletion);
        const now  = new Date();
        const diff = (due - now) / (1000 * 60 * 60 * 24);
        if (diff < 0)  return 'detail-value due-overdue';
        if (diff <= 3) return 'detail-value due-soon';
        return 'detail-value';
    }
}