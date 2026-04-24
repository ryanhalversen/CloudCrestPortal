public with sharing class CC_LeadToCashController {

    @AuraEnabled(cacheable=true)
    public static List<InitiativeWrapper> getInitiativesWithActionItems() {
        List<InitiativeWrapper> results = new List<InitiativeWrapper>();

        for (Initiative__c init : [
            SELECT Id, Name, Status__c, Category__c, Calendar_Quarter__c,
                (SELECT Id, Name, Status__c, Priority__c, Completed_Date__c
                 FROM Action_Items__r
                 ORDER BY Name)
            FROM Initiative__c
            ORDER BY Calendar_Quarter__c NULLS LAST, Name
            LIMIT 100
        ]) {
            InitiativeWrapper iw      = new InitiativeWrapper();
            iw.id       = init.Id;
            iw.name     = init.Name;
            iw.status   = init.Status__c;
            iw.category = init.Category__c;
            iw.quarter  = init.Calendar_Quarter__c;
            iw.actionItems = new List<ActionItemWrapper>();

            for (Action_Item__c ai : init.Action_Items__r) {
                ActionItemWrapper aw   = new ActionItemWrapper();
                aw.id            = ai.Id;
                aw.name          = ai.Name;
                aw.status        = ai.Status__c;
                aw.priority      = ai.Priority__c != null ? String.valueOf(ai.Priority__c) : null;
                aw.completedDate = ai.Completed_Date__c != null ? String.valueOf(ai.Completed_Date__c) : null;
                iw.actionItems.add(aw);
            }
            results.add(iw);
        }
        return results;
    }

    public class InitiativeWrapper {
        @AuraEnabled public String id;
        @AuraEnabled public String name;
        @AuraEnabled public String status;
        @AuraEnabled public String category;
        @AuraEnabled public String quarter;
        @AuraEnabled public List<ActionItemWrapper> actionItems;
    }

    public class ActionItemWrapper {
        @AuraEnabled public String id;
        @AuraEnabled public String name;
        @AuraEnabled public String status;
        @AuraEnabled public String priority;
        @AuraEnabled public String completedDate;
    }

    // ── SOP Stages ────────────────────────────────────────────

    @AuraEnabled(cacheable=true)
    public static List<SopWrapper> getSopStages() {
        List<SopWrapper> results = new List<SopWrapper>();
        for (SOP__c sop : [
            SELECT Id, Name, Category__c, Status__c, Body__c, Summary__c,
                   Is_Unassigned__c, Linked_Initiative_Ids__c
            FROM SOP__c
            ORDER BY Name
        ]) {
            SopWrapper sw          = new SopWrapper();
            sw.id                  = sop.Id;
            sw.name                = sop.Name;
            sw.category            = sop.Category__c;
            sw.status              = sop.Status__c;
            sw.body                = sop.Body__c;
            sw.summary             = sop.Summary__c;
            sw.isUnassigned        = sop.Is_Unassigned__c;
            sw.linkedInitiativeIds = sop.Linked_Initiative_Ids__c;
            results.add(sw);
        }
        return results;
    }

    @AuraEnabled
    public static void updateSopUnassigned(String sopId, Boolean isUnassigned) {
        update new SOP__c(Id = sopId, Is_Unassigned__c = isUnassigned);
    }

    @AuraEnabled
    public static void addLinkedInitiative(String sopId, String initiativeId) {
        SOP__c sop = [
            SELECT Id, Linked_Initiative_Ids__c
            FROM SOP__c
            WHERE Id = :sopId
            LIMIT 1
        ];
        List<String> ids = String.isNotBlank(sop.Linked_Initiative_Ids__c)
            ? sop.Linked_Initiative_Ids__c.split(',')
            : new List<String>();
        if (!ids.contains(initiativeId)) {
            ids.add(initiativeId);
            sop.Linked_Initiative_Ids__c = String.join(ids, ',');
            update sop;
        }
    }

    public class SopWrapper {
        @AuraEnabled public String  id;
        @AuraEnabled public String  name;
        @AuraEnabled public String  category;
        @AuraEnabled public String  status;
        @AuraEnabled public String  body;
        @AuraEnabled public String  summary;
        @AuraEnabled public Boolean isUnassigned;
        @AuraEnabled public String  linkedInitiativeIds;
    }
}
