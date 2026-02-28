public with sharing class SprintPlannerController {

    public class PlannerData {
        @AuraEnabled public List<Sprint__c> projects;
        @AuraEnabled public List<Case> stories;
    }

    // ── Returns all In Progress projects ──────────────────────────────────
    @AuraEnabled(cacheable=true)
    public static List<Sprint__c> getProjects() {
        return [
            SELECT Id, Name, Weekly_Pace_Estimate__c,
                   Project_Start_Date__c, Project_End_Date__c,
                   OwnerId, Owner.Name
            FROM Sprint__c
            WHERE Status__c = 'In Progress'
            ORDER BY Project_Start_Date__c DESC
            LIMIT 50
        ];
    }

    // ── Returns stories for one project or all in-progress projects ────────
    @AuraEnabled
    public static PlannerData getPlannerData(Id projectId) {
        try {
            PlannerData result = new PlannerData();

            if (projectId != null) {
                result.projects = [
                    SELECT Id, Name, Weekly_Pace_Estimate__c,
                           Project_Start_Date__c, Project_End_Date__c
                    FROM Sprint__c
                    WHERE Id = :projectId
                    LIMIT 1
                ];
                result.stories = [
                    SELECT Id, Subject, Description, Priority, Type, Status,
                           Hours_Estimate_to_Complete__c, Department__c, CreatedDate,
                           Sprint_Week__c, Sprint_Start_Date__c, Projects__c
                    FROM Case
                    WHERE Projects__c = :projectId
                    AND IsClosed = false
                    ORDER BY CreatedDate DESC
                    LIMIT 300
                ];
            } else {
                result.projects = [
                    SELECT Id, Name, Weekly_Pace_Estimate__c,
                           Project_Start_Date__c, Project_End_Date__c
                    FROM Sprint__c
                    WHERE Status__c = 'In Progress'
                    ORDER BY Project_Start_Date__c DESC
                    LIMIT 50
                ];
                Set<Id> projectIds = new Map<Id, Sprint__c>(result.projects).keySet();
                result.stories = [
                    SELECT Id, Subject, Description, Priority, Type, Status,
                           Hours_Estimate_to_Complete__c, Department__c, CreatedDate,
                           Sprint_Week__c, Sprint_Start_Date__c, Projects__c
                    FROM Case
                    WHERE Projects__c IN :projectIds
                    AND IsClosed = false
                    ORDER BY CreatedDate DESC
                    LIMIT 300
                ];
            }

            return result;

        } catch (Exception ex) {
            throw new AuraHandledException('Failed to load planner: ' + ex.getMessage());
        }
    }

    // ── Returns In Progress projects owned by the given user + their stories ─
    @AuraEnabled
    public static PlannerData getProjectsByOwner(Id ownerId) {
        try {
            PlannerData result = new PlannerData();
            result.projects = [
                SELECT Id, Name, Weekly_Pace_Estimate__c,
                       Project_Start_Date__c, Project_End_Date__c,
                       OwnerId, Owner.Name
                FROM Sprint__c
                WHERE Status__c = 'In Progress'
                AND OwnerId = :ownerId
                ORDER BY Project_Start_Date__c DESC
                LIMIT 50
            ];
            Set<Id> projectIds = new Map<Id, Sprint__c>(result.projects).keySet();
            result.stories = [
                SELECT Id, Subject, Description, Priority, Type, Status,
                       Hours_Estimate_to_Complete__c, Department__c, CreatedDate,
                       Sprint_Week__c, Sprint_Start_Date__c, Projects__c
                FROM Case
                WHERE Projects__c IN :projectIds
                AND IsClosed = false
                ORDER BY CreatedDate DESC
                LIMIT 500
            ];
            return result;
        } catch (Exception ex) {
            throw new AuraHandledException('Failed to load owner projects: ' + ex.getMessage());
        }
    }

    @AuraEnabled
    public static void updateHoursEstimate(Id caseId, Decimal hours) {
        try {
            Case c = new Case(Id = caseId, Hours_Estimate_to_Complete__c = hours);
            update c;
        } catch (Exception ex) {
            throw new AuraHandledException('Failed to update hours: ' + ex.getMessage());
        }
    }
}