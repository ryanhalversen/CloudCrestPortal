public without sharing class cc_ClientPortalController {

    public class EpicInfo {
        @AuraEnabled public Id epicId;
        @AuraEnabled public String name;
        @AuraEnabled public Integer storyCount;
        @AuraEnabled public Integer completedStories;
        @AuraEnabled public Integer totalStories;
    }

    // Internal/operational cases that should never surface on the client board
    private static final Set<String> EXCLUDED_SUBJECTS = new Set<String>{
        'Meetings', 'Project Management', 'Helpdesk'
    };

    public class PortalData {
        @AuraEnabled public List<Case> stories;
        @AuraEnabled public List<EpicInfo> epics;
        @AuraEnabled public Decimal hoursConsumed;
        @AuraEnabled public Decimal hoursRemaining;
        @AuraEnabled public Date projectedEndDate;
        @AuraEnabled public String projectName;
    }

    @AuraEnabled(cacheable=true)
    public static PortalData getPortalData() {
        return buildPortalData(resolveAccountId());
    }

    @TestVisible
    private static PortalData buildPortalData(Id accountId) {
        PortalData data = new PortalData();
        data.stories = new List<Case>();
        data.epics = new List<EpicInfo>();
        data.hoursConsumed = 0;

        if (accountId == null) return data;

        List<Sprint__c> activeProjects = [
            SELECT Id, Name, Est_Project_End_Date_Sprint__c, Completed_Delta_Sprint__c
            FROM Sprint__c
            WHERE Accountlu__c = :accountId
              AND Status__c = 'In Progress'
            ORDER BY CreatedDate DESC
            LIMIT 1
        ];
        if (activeProjects.isEmpty()) return data;

        Sprint__c project = activeProjects[0];
        Id projectId = project.Id;
        data.projectName = project.Name;
        data.projectedEndDate = project.Est_Project_End_Date_Sprint__c;
        data.hoursRemaining = project.Completed_Delta_Sprint__c;

        data.stories = [
            SELECT Id, CaseNumber, Subject, Status, Priority, Type,
                   Description, CreatedDate, Origin, CreatedBy.Name,
                   Epic__c, Epic__r.Name, Closing_Comments__c
            FROM Case
            WHERE Projects__c = :projectId
              AND Subject NOT IN :EXCLUDED_SUBJECTS
            ORDER BY CreatedDate DESC
            LIMIT 500
        ];

        data.epics = buildEpicInfos(projectId);

        AggregateResult[] timeAgg = [
            SELECT SUM(Hours_Logged__c) total
            FROM Time__c
            WHERE Epic__r.Projects_new__c = :projectId
        ];
        if (!timeAgg.isEmpty() && timeAgg[0].get('total') != null) {
            data.hoursConsumed = (Decimal) timeAgg[0].get('total');
        }

        return data;
    }

    private static List<EpicInfo> buildEpicInfos(Id projectId) {
        List<EpicInfo> result = new List<EpicInfo>();

        List<Sprint_Items__c> epics = [
            SELECT Id, Name
            FROM Sprint_Items__c
            WHERE Projects_new__c = :projectId
            ORDER BY Name ASC
        ];
        if (epics.isEmpty()) return result;

        Set<Id> epicIds = new Map<Id, Sprint_Items__c>(epics).keySet();

        Map<Id, Integer> totalMap = new Map<Id, Integer>();
        Map<Id, Integer> completedMap = new Map<Id, Integer>();
        for (AggregateResult ar : [
            SELECT Epic__c, Status, COUNT(Id) cnt
            FROM Case
            WHERE Epic__c IN :epicIds
              AND Subject NOT IN :EXCLUDED_SUBJECTS
            GROUP BY Epic__c, Status
        ]) {
            Id eid = (Id) ar.get('Epic__c');
            Integer cnt = Integer.valueOf(ar.get('cnt'));
            totalMap.put(eid, (totalMap.containsKey(eid) ? totalMap.get(eid) : 0) + cnt);
            if ('Completed'.equals((String) ar.get('Status'))) {
                completedMap.put(eid, (completedMap.containsKey(eid) ? completedMap.get(eid) : 0) + cnt);
            }
        }

        for (Sprint_Items__c e : epics) {
            EpicInfo ei = new EpicInfo();
            ei.epicId = e.Id;
            ei.name = e.Name;
            ei.totalStories = totalMap.containsKey(e.Id) ? totalMap.get(e.Id) : 0;
            ei.completedStories = completedMap.containsKey(e.Id) ? completedMap.get(e.Id) : 0;
            ei.storyCount = ei.totalStories;
            result.add(ei);
        }
        return result;
    }

    @AuraEnabled
    public static Case createStory(String subject, String description, String storyType, String priority) {
        Id accountId = resolveAccountId();
        if (accountId == null) {
            throw new AuraHandledException('Unable to determine your account. Please contact support.');
        }
        return insertStory(accountId, subject, description, storyType, priority);
    }

    @TestVisible
    private static Case insertStory(Id accountId, String subject, String description, String storyType, String priority) {
        List<Sprint__c> activeProjects = [
            SELECT Id FROM Sprint__c
            WHERE Accountlu__c = :accountId
              AND Status__c = 'In Progress'
            ORDER BY CreatedDate DESC
            LIMIT 1
        ];
        Id projectId = activeProjects.isEmpty() ? null : activeProjects[0].Id;

        Id epicId = null;
        if (projectId != null) {
            List<Sprint_Items__c> defaultEpics = [
                SELECT Id FROM Sprint_Items__c
                WHERE Name = 'Needs Assignment'
                  AND Projects_new__c = :projectId
                LIMIT 1
            ];
            epicId = defaultEpics.isEmpty() ? null : defaultEpics[0].Id;
        }

        try {
            Case c = new Case(
                Subject = subject,
                Description = description,
                Type = storyType,
                Priority = priority,
                Status = 'New',
                Origin = 'Portal',
                AccountId = accountId,
                Projects__c = projectId,
                Epic__c = epicId
            );
            insert c;

            return [
                SELECT Id, CaseNumber, Subject, Status, Priority, Type,
                       Description, CreatedDate,
                       Epic__c, Epic__r.Name, Closing_Comments__c
                FROM Case
                WHERE Id = :c.Id
                LIMIT 1
            ];
        } catch (DmlException e) {
            throw new AuraHandledException('Failed to create story: ' + e.getMessage());
        }
    }

    @AuraEnabled(cacheable=true)
    public static Map<String, List<String>> getPicklistValues() {
        Map<String, List<String>> result = new Map<String, List<String>>();
        result.put('Type', getFieldPicklistValues(Case.Type.getDescribe()));
        result.put('Priority', getFieldPicklistValues(Case.Priority.getDescribe()));
        return result;
    }

    private static List<String> getFieldPicklistValues(Schema.DescribeFieldResult fieldDescribe) {
        List<String> values = new List<String>();
        for (Schema.PicklistEntry entry : fieldDescribe.getPicklistValues()) {
            if (entry.isActive()) {
                values.add(entry.getValue());
            }
        }
        return values;
    }

    private static Id resolveAccountId() {
        List<User> users = [SELECT ContactId FROM User WHERE Id = :UserInfo.getUserId() LIMIT 1];
        if (users.isEmpty() || users[0].ContactId == null) return null;

        List<Contact> contacts = [SELECT AccountId FROM Contact WHERE Id = :users[0].ContactId LIMIT 1];
        if (contacts.isEmpty() || contacts[0].AccountId == null) return null;

        return contacts[0].AccountId;
    }
}
