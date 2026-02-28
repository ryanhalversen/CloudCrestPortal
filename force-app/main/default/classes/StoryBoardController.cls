public without sharing class StoryBoardController {

    @AuraEnabled(cacheable=true)
    public static List<Case> getStories(Boolean mineOnly, Id projectId) {
        String q =
            'SELECT Id, CaseNumber, Subject, Status, Priority, Type, ' +
            'CreatedDate, Description, Sprint_Week__c, Sprint_Start_Date__c, Projects__c, ' +
            'Hours_Estimate_to_Complete__c ' +
            'FROM Case';

        List<String> filters = new List<String>();
        if (mineOnly) {
            filters.add('OwnerId = \'' + UserInfo.getUserId() + '\'');
        }
        if (projectId != null) {
            filters.add('Projects__c = \'' + projectId + '\'');
        }
        if (!filters.isEmpty()) {
            q += ' WHERE ' + String.join(filters, ' AND ');
        }
        q += ' ORDER BY CreatedDate DESC LIMIT 500';

        return Database.query(q);
    }

    // ── Get Projects ──────────────────────────────────────────────────────
    @AuraEnabled(cacheable=true)
    public static List<Sprint__c> getProjects() {
        return [
            SELECT Id, Name, OwnerId, Owner.Name,
                   Project_Lead_Sprint__c, Project_Lead_Sprint__r.Name
            FROM Sprint__c
            WHERE Status__c = 'In Progress'
            ORDER BY Name ASC
            LIMIT 100
        ];
    }

    // ── Assign to Sprint ──────────────────────────────────────────────────
    @AuraEnabled
    public static void assignToSprint(Id caseId, Integer sprintWeek, Date sprintStartDate) {
        try {
            Case c = new Case(
                Id                   = caseId,
                Sprint_Week__c       = sprintWeek,
                Sprint_Start_Date__c = sprintStartDate
            );
            update c;
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }

    // ── Remove from Sprint ────────────────────────────────────────────────
    @AuraEnabled
    public static void removeFromSprint(Id caseId) {
        try {
            Case c = new Case(
                Id                   = caseId,
                Sprint_Week__c       = null,
                Sprint_Start_Date__c = null
            );
            update c;
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }

    // ── Update Story Status ───────────────────────────────────────────────
    @AuraEnabled
    public static void updateStoryStatus(Id caseId, String newStatus) {
        try {
            Set<String> validStatuses = new Set<String>{
                'New', 'Scheduled', 'Work In Progress (WIP)', 'Waiting for User',
                'On Hold', 'Backlog', 'In Review', 'In UAT',
                'Blocked', 'Cancelled', 'Completed'
            };
            if (!validStatuses.contains(newStatus)) {
                throw new AuraHandledException('Invalid status value: ' + newStatus);
            }
            Case c = new Case(
                Id     = caseId,
                Status = newStatus
            );
            update c;
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }

    // ── Update Priority ───────────────────────────────────────────────────
    @AuraEnabled
    public static void updatePriority(Id caseId, String priority) {
        try {
            Set<String> validPriorities = new Set<String>{
                'Critical', 'High', 'Medium', 'Low'
            };
            if (!validPriorities.contains(priority)) {
                throw new AuraHandledException('Invalid priority value: ' + priority);
            }
            Case c = new Case(
                Id       = caseId,
                Priority = priority
            );
            update c;
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }

    // ── Update Estimated Hours ────────────────────────────────────────────
    @AuraEnabled
    public static void updateEstimatedHours(Id caseId, Decimal hours) {
        try {
            Case c = new Case(
                Id                            = caseId,
                Hours_Estimate_to_Complete__c = hours
            );
            update c;
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }

    // ── Create Story ──────────────────────────────────────────────────────
    @AuraEnabled
    public static void createStory(Id projectId, String subject, String description, String priority, String department) {
        try {
            List<Sprint_Items__c> epics = [
                SELECT Id
                FROM Sprint_Items__c
                WHERE Name = 'Needs Assignment'
                AND Projects_new__c = :projectId
                LIMIT 1
            ];

            Case c = new Case(
                Subject       = subject,
                Description   = description,
                Priority      = priority,
                Department__c = department,
                Projects__c   = projectId,
                Epic__c       = epics.isEmpty() ? null : epics[0].Id
            );
            insert c;
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }
}