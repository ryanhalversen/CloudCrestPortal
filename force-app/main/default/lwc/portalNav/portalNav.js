import { LightningElement, api, wire } from 'lwc';
import { NavigationMixin, CurrentPageReference } from 'lightning/navigation';

export default class PortalNav extends NavigationMixin(LightningElement) {
    @api projectName = 'CloudCrest Portal Test Project';

    @wire(CurrentPageReference)
    currentPageRef;

    get navItems() {
        const currentSlug = this.currentPageRef?.attributes?.name || '';

        const items = [
            { label: 'Home',               slug: 'Home',                  pageName: 'Home'                  },
            { label: 'Executive Overview', slug: 'Executive_Overview__c', pageName: 'Executive_Overview__c' },
            { label: 'Project Management', slug: 'Project_Management__c', pageName: 'Project_Management__c' },
            { label: 'Daily Ops',          slug: 'Daily_Ops__c',          pageName: 'Daily_Ops__c'          },
        ];

        return items.map(item => ({
            ...item,
            cssClass: currentSlug === item.slug ? 'nav-link active' : 'nav-link'
        }));
    }

    handleNav(e) {
        e.preventDefault();
        const pageName = e.currentTarget.dataset.page;
        this[NavigationMixin.Navigate]({
            type: 'comm__namedPage',
            attributes: { name: pageName }
        });
    }
}