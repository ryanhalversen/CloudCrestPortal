public with sharing class SubmitAStoryController {

    @AuraEnabled(cacheable=true)
    public static List<String> getPicklistValues(String objectApiName, String fieldApiName) {
        List<String> values = new List<String>();
        Schema.SObjectType objType = Schema.getGlobalDescribe().get(objectApiName);
        if (objType == null) return values;

        Schema.DescribeSObjectResult objDescribe = objType.getDescribe();
        Map<String, Schema.SObjectField> fields = objDescribe.fields.getMap();
        Schema.SObjectField field = fields.get(fieldApiName);
        if (field == null) return values;

        for (Schema.PicklistEntry entry : field.getDescribe().getPicklistValues()) {
            if (entry.isActive()) {
                values.add(entry.getValue());
            }
        }
        return values;
    }

    @AuraEnabled
    public static Id createStory(String subject, String description, String priority,
                                  String storyType, String department) {
        try {
            Case c = new Case(
                Subject       = subject,
                Description   = description,
                Priority      = priority,
                Type          = storyType,
                Department__c = department,
                Status        = 'New'
            );
            insert c;
            return c.Id;
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }

    @AuraEnabled(cacheable=true)
    public static List<Case> getStories(Boolean mineOnly) {
        if (mineOnly) {
            return [
                SELECT Id, CaseNumber, Subject, Description, Status, Priority, Type, CreatedDate,
                       Sprint_Week__c, Sprint_Start_Date__c
                FROM Case
                WHERE OwnerId = :UserInfo.getUserId()
                ORDER BY CreatedDate DESC
                LIMIT 200
            ];
        } else {
            return [
                SELECT Id, CaseNumber, Subject, Description, Status, Priority, Type, CreatedDate,
                       Sprint_Week__c, Sprint_Start_Date__c
                FROM Case
                ORDER BY CreatedDate DESC
                LIMIT 200
            ];
        }
    }

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
}