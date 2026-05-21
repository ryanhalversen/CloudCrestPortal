public without sharing class cc_ClientPortalController {

    public class PortalData {
        @AuraEnabled public List<Case> stories;
        @AuraEnabled public Decimal hoursConsumed;
        @AuraEnabled public Date projectedEndDate;
        @AuraEnabled public String projectName;
    }

    @AuraEnabled(cacheable=true)
    public static PortalData getPortalData() {
        Id accountId = resolveAccountId();
        PortalData data = new PortalData();

        if (accountId == null) {
            data.stories = new List<Case>();
            data.hoursConsumed = 0;
            return data;
        }

        data.stories = [
            SELECT Id, CaseNumber, Subject, Status, Priority, Type,
                   Description, CreatedDate, CreatedBy.Name,
                   OwnerId, Owner.Name
            FROM Case
            WHERE AccountId = :accountId
            ORDER BY CreatedDate DESC
            LIMIT 500
        ];

        AggregateResult[] timeAgg = [
            SELECT SUM(Hours_Logged__c) total
            FROM Time__c
            WHERE Epic__r.Projects_new__r.Accountlu__c = :accountId
              AND Epic__r.Projects_new__r.Status__c = 'In Progress'
        ];
        if (!timeAgg.isEmpty() && timeAgg[0].get('total') != null) {
            data.hoursConsumed = (Decimal) timeAgg[0].get('total');
        } else {
            data.hoursConsumed = 0;
        }

        List<Sprint__c> activeProjects = [
            SELECT Id, Name, Est_Project_End_Date_Sprint__c
            FROM Sprint__c
            WHERE Accountlu__c = :accountId
              AND Status__c = 'In Progress'
            ORDER BY CreatedDate DESC
            LIMIT 1
        ];
        if (!activeProjects.isEmpty()) {
            data.projectedEndDate = activeProjects[0].Est_Project_End_Date_Sprint__c;
            data.projectName = activeProjects[0].Name;
        }

        return data;
    }

    @AuraEnabled
    public static Case createStory(String subject, String description, String storyType, String priority) {
        Id accountId = resolveAccountId();
        if (accountId == null) {
            throw new AuraHandledException('Unable to determine your account. Please contact support.');
        }

        try {
            Case c = new Case(
                Subject = subject,
                Description = description,
                Type = storyType,
                Priority = priority,
                Status = 'New',
                Origin = 'Portal',
                AccountId = accountId
            );
            insert c;

            return [
                SELECT Id, CaseNumber, Subject, Status, Priority, Type,
                       Description, CreatedDate, CreatedBy.Name,
                       OwnerId, Owner.Name
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
