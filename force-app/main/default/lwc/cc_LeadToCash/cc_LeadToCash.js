import { LightningElement, wire, track } from 'lwc';
import getInitiativesWithActionItems from '@salesforce/apex/CC_LeadToCashController.getInitiativesWithActionItems';

const ROLE_CONFIG = {
    sales:       { badgeClass: 'role-badge role-sales',       headerClass: 'section-header section-sales' },
    delivery:    { badgeClass: 'role-badge role-delivery',    headerClass: 'section-header section-delivery' },
    finance:     { badgeClass: 'role-badge role-finance',     headerClass: 'section-header section-finance' },
    projectlead: { badgeClass: 'role-badge role-projectlead', headerClass: 'section-header section-projectlead' }
};

const STAGES = [
    {
        id: 1,
        name: 'Lead Generation',
        roles: [
            { label: 'Sales', type: 'sales' }
        ],
        sections: [
            {
                role: 'SALES',
                type: 'sales',
                tasks: [
                    'Define ideal client profile (ICP)',
                    'Set up outbound prospecting cadences',
                    'Activate referral partner network',
                    'Publish thought leadership content',
                    'Monitor inbound leads & inquiries',
                    'Quality leads against ICP criteria',
                    'Log leads in Salesforce with source tracking',
                    'Route qualified leads to Discovery'
                ]
            }
        ],
        artifacts: [
            { name: 'ICP Document',                  desc: 'Ideal client profile criteria & targeting rules' },
            { name: 'Prospecting Cadence Templates', desc: 'Automated sequences for outbound outreach' },
            { name: 'Technical Assessment',          desc: '' }
        ]
    },
    {
        id: 2,
        name: 'Discovery',
        roles: [
            { label: 'Sales',         type: 'sales' },
            { label: 'Delivery Mgmt', type: 'delivery' }
        ],
        sections: [
            {
                role: 'SALES',
                type: 'sales',
                tasks: [
                    'Schedule discovery call with prospects',
                    'Lead discovery call & build report',
                    'Identify stakeholders & decision-makers',
                    'Confirm budget range & timeline',
                    'Map current Salesforce environment',
                    'Identify pain points & business goals',
                    'Assess technical debt & integration needs',
                    'Determine engagement type'
                ]
            }
        ],
        artifacts: [
            { name: 'Discovery Call Template',    desc: 'Question framework & call structure' },
            { name: 'Pricing Framework Tool',     desc: 'Tier calculator (each tier = access level)' },
            { name: 'Epic Breakdown / Scope Doc', desc: '' },
            { name: 'Salesforce Opportunity',     desc: '' },
            { name: 'Technical Assessment',       desc: '' }
        ]
    },
    {
        id: 3,
        name: 'Scoping',
        roles: [
            { label: 'Sales',         type: 'sales' },
            { label: 'Delivery Mgmt', type: 'delivery' }
        ],
        sections: [
            {
                role: 'SALES',
                type: 'sales',
                tasks: [
                    "Align scope to client's stated budget",
                    'Communicate pricing tier options',
                    'Get internal go/no-go on deal viability'
                ]
            },
            {
                role: 'DELIVERY MGMT',
                type: 'delivery',
                tasks: [
                    'Map work to pricing tier',
                    'Break scope into Epics & milestones',
                    'Estimate hours per Epic',
                    'Identify resource needs (FTE vs. contractor)',
                    'Flag risks & dependencies'
                ]
            }
        ],
        artifacts: [
            { name: 'Pricing Framework Tool',     desc: '' },
            { name: 'Epic Breakdown / Scope Doc', desc: '' },
            { name: 'Salesforce Opportunity',     desc: '' },
            { name: 'Technical Assessment',       desc: '' }
        ]
    },
    {
        id: 4,
        name: 'Proposal',
        roles: [
            { label: 'Sales',         type: 'sales' },
            { label: 'Delivery Mgmt', type: 'delivery' }
        ],
        sections: [
            {
                role: 'SALES',
                type: 'sales',
                tasks: [
                    'Send proposal to client stakeholders',
                    'Address questions & negotiate terms',
                    'Manage expectations on pricing & scope'
                ]
            },
            {
                role: 'DELIVERY MGMT',
                type: 'delivery',
                tasks: [
                    'Send SOW with scope, timeline & deliverables',
                    'Apply rate integrity rules',
                    'Define payment terms',
                    'Set access-level & communication boundaries',
                    'Include change order process'
                ]
            }
        ],
        artifacts: [
            { name: 'SOW / MSA Template',     desc: '' },
            { name: 'Change Order Template',  desc: '' },
            { name: 'Pricing Framework Tool', desc: '' }
        ]
    },
    {
        id: 5,
        name: 'Close',
        roles: [
            { label: 'Sales',         type: 'sales' },
            { label: 'Delivery Mgmt', type: 'delivery' }
        ],
        sections: [
            {
                role: 'SALES',
                type: 'sales',
                tasks: [
                    'Confirm signed contract / MSA / SOW',
                    'Update Opp to Closed-Won in Salesforce',
                    'Notify delivery team of new engagement'
                ]
            },
            {
                role: 'DELIVERY MGMT',
                type: 'delivery',
                tasks: [
                    'Trigger upfront invoice (if applicable)',
                    'Confirm payment received before kickoff',
                    'Create Project record & link to Opp',
                    'Set up billing schedule'
                ]
            }
        ],
        artifacts: [
            { name: 'Project Record (Salesforce)', desc: '' },
            { name: 'Billing Schedule',            desc: '' },
            { name: 'Salesforce Opportunity',      desc: '' },
            { name: 'SOW / MSA Template',          desc: '' }
        ]
    },
    {
        id: 6,
        name: 'Onboarding',
        roles: [
            { label: 'Delivery Mgmt', type: 'delivery' },
            { label: 'Project Lead',  type: 'projectlead' }
        ],
        sections: [
            {
                role: 'DELIVERY MGMT',
                type: 'delivery',
                tasks: [
                    'Confirm resource allocation in Command Center',
                    'Share communication & escalation protocols',
                    'Set client expectations on access boundaries',
                    'Deliver welcome packet with timeline'
                ]
            },
            {
                role: 'PROJECT LEAD',
                type: 'projectlead',
                tasks: [
                    'Schedule kickoff call with client team',
                    'Create Epics & assign resources in Salesforce',
                    'Provision sandbox / environment access'
                ]
            }
        ],
        artifacts: [
            { name: 'Command Center Dashboard',    desc: '' },
            { name: 'Client Welcome Packet',       desc: '' },
            { name: 'Meeting Cadence Template',    desc: '' },
            { name: 'Epic Breakdown / Scope Doc',  desc: '' },
            { name: 'Project Record (Salesforce)', desc: '' }
        ]
    },
    {
        id: 7,
        name: 'Delivery',
        roles: [
            { label: 'Delivery Mgmt', type: 'delivery' },
            { label: 'Project Lead',  type: 'projectlead' }
        ],
        sections: [
            {
                role: 'DELIVERY MGMT',
                type: 'delivery',
                tasks: [
                    'Track capacity in Command Center',
                    'Manage change requests via CO process',
                    'Log invoice with Project link',
                    'Reconcile blockers & risks proactively',
                    'Get client sign-off on milestones',
                    'Send reminders at 7 / 14 / 30 days',
                    'Preserve billing history across renewals'
                ]
            },
            {
                role: 'PROJECT LEAD',
                type: 'projectlead',
                tasks: [
                    'Execute sprint / milestone cycles',
                    'Conduct weekly status meetings',
                    'Perform QA & UAT per deliverable',
                    'Document configs & custom development'
                ]
            }
        ],
        artifacts: [
            { name: 'Status Report Template',     desc: 'Weekly progress report for client' },
            { name: 'QA / UAT Checklist',         desc: 'Test scripts & sign-off tracker' },
            { name: 'Epic Breakdown / Scope Doc', desc: '' },
            { name: 'Change Order Template',      desc: '' },
            { name: 'Project Record (Salesforce)', desc: '' },
            { name: 'Command Center Dashboard',   desc: '' },
            { name: 'Meeting Cadence Template',   desc: '' }
        ]
    },
    {
        id: 8,
        name: 'Invoicing',
        roles: [
            { label: 'Finance', type: 'finance' }
        ],
        sections: [
            {
                role: 'FINANCE',
                type: 'finance',
                tasks: [
                    'Generate invoice per contract terms',
                    'Attach time logs or sign-offs',
                    'Send invoice to client billing contact',
                    'Reconcile against project budget',
                    'Track invoice status',
                    'Send reminders at 7 / 14 / 30 days',
                    'Preserve billing history across renewals'
                ]
            }
        ],
        artifacts: [
            { name: 'Invoice Template',              desc: 'Standard format with markup tiers' },
            { name: 'Collections Escalation Policy', desc: 'Standard payment escalation steps' },
            { name: 'Billing Schedule',              desc: '' },
            { name: 'Project Record (Salesforce)',   desc: '' }
        ]
    },
    {
        id: 9,
        name: 'Cash Collection',
        roles: [
            { label: 'Finance',       type: 'finance' },
            { label: 'Delivery Mgmt', type: 'delivery' },
            { label: 'Project Lead',  type: 'projectlead' }
        ],
        sections: [
            {
                role: 'FINANCE',
                type: 'finance',
                tasks: [
                    'Confirm payment received',
                    'Match payment to invoice & close out',
                    'Recognize revenue in accounting',
                    'Reconcile against project budget',
                    'Update Project financial summary',
                    'Escalate overdue per collections policy',
                    'Issue receipts / confirmations'
                ]
            },
            {
                role: 'SALES',
                type: 'sales',
                tasks: [
                    'Identify upsell & cross-sell opportunities',
                    'Draft renewal SOW or expansion scope',
                    'Update pipeline with renewal Opp',
                    'Nurture relationships & referrals'
                ]
            },
            {
                role: 'DELIVERY MGMT',
                type: 'delivery',
                tasks: [
                    'Conduct project retrospective',
                    'Gather client satisfaction feedback',
                    'Re-parent Epics for new contract period',
                    'Re-engage Discovery or Scoping'
                ]
            }
        ],
        artifacts: [
            { name: 'Collections Escalation Policy', desc: '' },
            { name: 'Client Satisfaction Survey',    desc: 'Post-project feedback questionnaire' },
            { name: 'Retrospective Template',        desc: 'Structured debrief for continuous improvement' },
            { name: 'Salesforce Opportunity',        desc: '' },
            { name: 'Epic Breakdown / Scope Doc',    desc: '' },
            { name: 'SOW / MSA Template',            desc: '' },
            { name: 'Project Record (Salesforce)',   desc: '' }
        ]
    },
    {
        id: 10,
        name: 'Renewal & Expansion',
        roles: [
            { label: 'Sales',         type: 'sales' },
            { label: 'Delivery Mgmt', type: 'delivery' },
            { label: 'Project Lead',  type: 'projectlead' }
        ],
        sections: [
            {
                role: 'SALES',
                type: 'sales',
                tasks: [
                    'Review contract end dates & renewal windows',
                    'Identify upsell & expansion opportunities',
                    'Draft renewal or expansion SOW',
                    'Present renewal terms to client',
                    'Update pipeline with renewal Opp'
                ]
            },
            {
                role: 'DELIVERY MGMT',
                type: 'delivery',
                tasks: [
                    'Assess project performance vs. scope',
                    'Identify service gaps or new opportunities',
                    'Re-parent Epics for new contract period',
                    'Re-engage Discovery or Scoping as needed'
                ]
            },
            {
                role: 'PROJECT LEAD',
                type: 'projectlead',
                tasks: [
                    'Transition resources for renewal engagement',
                    'Archive completed Epics & deliverables',
                    'Set up new contract period in Salesforce'
                ]
            }
        ],
        artifacts: [
            { name: 'SOW / MSA Template',          desc: '' },
            { name: 'Salesforce Opportunity',       desc: '' },
            { name: 'Epic Breakdown / Scope Doc',   desc: '' },
            { name: 'Project Record (Salesforce)',  desc: '' }
        ]
    }
];

export default class Cc_LeadToCash extends LightningElement {
    @track _initiatives = [];

    @wire(getInitiativesWithActionItems)
    wiredInitiatives({ error, data }) {
        if (data) {
            this._initiatives = data;
        } else if (error) {
            this._initiatives = [];
            console.error('CC_LeadToCash: error loading initiatives', error);
        }
    }

    // ── Initiatives Panel ─────────────────────────────────────

    get hasInitiatives() {
        return this._initiatives && this._initiatives.length > 0;
    }

    get initiativeCount() {
        return this._initiatives ? this._initiatives.length : 0;
    }

    get processedInitiatives() {
        return (this._initiatives || []).map((init, idx) => {
            const meta = [init.category, init.quarter].filter(Boolean).join(' · ');
            return {
                ...init,
                meta,
                statusBadgeClass: 'init-status-badge ' + this._statusClass(init.status),
                hasActionItems: init.actionItems && init.actionItems.length > 0,
                actionItems: (init.actionItems || []).map((ai, i) => ({
                    ...ai,
                    rowId: `${idx}-ai-${i}`,
                    dotClass:  'ai-dot ' + this._statusClass(ai.status),
                    nameClass: 'ai-name' + (this._isComplete(ai.status) ? ' ai-name-done' : '')
                }))
            };
        });
    }

    _statusClass(status) {
        const s = (status || '').toLowerCase();
        if (this._isComplete(status))               return 'st-complete';
        if (s.includes('progress') || s.includes('active')) return 'st-active';
        if (s.includes('block') || s.includes('hold'))      return 'st-blocked';
        return 'st-open';
    }

    _isComplete(status) {
        return (status || '').toLowerCase().includes('complet');
    }

    // ── Board Data ────────────────────────────────────────────

    get stageGroups() {
        const byId = Object.fromEntries(this.processedStages.map(s => [s.id, s]));
        return [
            { id: 'grp-1', label: 'Partnerships & Marketing', labelClass: 'group-label group-label-marketing', stages: [byId[1]] },
            { id: 'grp-2', label: 'Sales',                    labelClass: 'group-label group-label-sales',     stages: [byId[2], byId[3], byId[4], byId[5]] },
            { id: 'grp-3', label: 'Delivery',                 labelClass: 'group-label group-label-delivery',  stages: [byId[6], byId[7], byId[10]] },
            { id: 'grp-4', label: 'Finance',                  labelClass: 'group-label group-label-finance',   stages: [byId[8], byId[9]] }
        ];
    }

    get processedStages() {
        return STAGES.map(stage => ({
            ...stage,
            roles: stage.roles.map(role => ({
                ...role,
                badgeClass: ROLE_CONFIG[role.type]?.badgeClass ?? 'role-badge'
            })),
            sections: stage.sections.map(section => ({
                ...section,
                sectionKey: `${stage.id}-${section.role}`,
                headerClass: ROLE_CONFIG[section.type]?.headerClass ?? 'section-header',
                tasks: section.tasks.map((task, i) => ({
                    id: `${stage.id}-${section.role}-${i}`,
                    label: task
                }))
            })),
            artifacts: stage.artifacts.map((artifact, i) => ({
                ...artifact,
                id: `${stage.id}-art-${i}`
            }))
        }));
    }
}
