public without sharing class ProjectScorecardController {

    @AuraEnabled(cacheable=true)
    public static List<Sprint__c> getProjects(String viewMode) {
        if (viewMode == 'all') {
            return [
                SELECT Id, Name, Status__c,
                       Contracted_Hours_Sprint__c,
                       Hours_Delivered__c,
                       Completed_Delta_Sprint__c,
                       Pace_Status__c,
                       Contract_Type__c,
                       Weekly_Pace_Estimate__c,
                       Project_Start_Date__c,
                       Project_End_Date__c,
                       Accountlu__r.Name,
                       Owner.Name
                FROM Sprint__c
                WHERE Status__c = 'In Progress'
                ORDER BY Owner.Name ASC, Project_Start_Date__c DESC
                LIMIT 50
            ];
        } else {
            return [
                SELECT Id, Name, Status__c,
                       Contracted_Hours_Sprint__c,
                       Hours_Delivered__c,
                       Completed_Delta_Sprint__c,
                       Pace_Status__c,
                       Contract_Type__c,
                       Weekly_Pace_Estimate__c,
                       Project_Start_Date__c,
                       Project_End_Date__c,
                       Accountlu__r.Name,
                       Owner.Name
                FROM Sprint__c
                WHERE Status__c = 'In Progress'
                AND OwnerId = :UserInfo.getUserId()
                ORDER BY Project_Start_Date__c DESC
                LIMIT 50
            ];
        }
    }
}