public without sharing class EpicManagementPanelController {

    public class EpicWrapper {
        @AuraEnabled public Id      epicId;
        @AuraEnabled public String  name;
        @AuraEnabled public Date    startDate;
        @AuraEnabled public Date    endDate;
        @AuraEnabled public Decimal estimatedHours;
        @AuraEnabled public Decimal loggedHours;
        @AuraEnabled public String  description;
        @AuraEnabled public Integer totalStories;
        @AuraEnabled public Integer completedStories;
    }

    // ── Get Epics ─────────────────────────────────────────────────────────
    @AuraEnabled(cacheable=true)
    public static List<EpicWrapper> getEpicsForProject(Id projectId) {
        if (projectId == null) return new List<EpicWrapper>();

        List<Sprint_Items__c> epics = [
            SELECT Id, Name, Planned_Start_Date__c, Planned_Completed_Date__c,
                   Hours_Estimate__c, Time_Logged_to_Deliverable__c, Description__c
            FROM Sprint_Items__c
            WHERE Projects_new__c = :projectId
            ORDER BY Name ASC
        ];

        if (epics.isEmpty()) return new List<EpicWrapper>();

        Set<Id> epicIds = new Map<Id, Sprint_Items__c>(epics).keySet();

        Map<Id, Integer> totalMap     = new Map<Id, Integer>();
        Map<Id, Integer> completedMap = new Map<Id, Integer>();

        for (AggregateResult ar : [
            SELECT Epic__c, Status, COUNT(Id) cnt
            FROM   Case
            WHERE  Epic__c IN :epicIds
            GROUP  BY Epic__c, Status
        ]) {
            Id      eid = (Id)ar.get('Epic__c');
            Integer cnt = Integer.valueOf(ar.get('cnt'));
            totalMap.put(eid, (totalMap.containsKey(eid) ? totalMap.get(eid) : 0) + cnt);
            if ('Completed'.equals((String)ar.get('Status'))) {
                completedMap.put(eid, (completedMap.containsKey(eid) ? completedMap.get(eid) : 0) + cnt);
            }
        }

        List<EpicWrapper> result = new List<EpicWrapper>();
        for (Sprint_Items__c e : epics) {
            EpicWrapper w       = new EpicWrapper();
            w.epicId            = e.Id;
            w.name              = e.Name;
            w.startDate         = e.Planned_Start_Date__c;
            w.endDate           = e.Planned_Completed_Date__c;
            w.estimatedHours    = e.Hours_Estimate__c;
            w.loggedHours       = e.Time_Logged_to_Deliverable__c;
            w.description       = e.Description__c;
            w.totalStories      = totalMap.containsKey(e.Id)     ? totalMap.get(e.Id)     : 0;
            w.completedStories  = completedMap.containsKey(e.Id) ? completedMap.get(e.Id) : 0;
            result.add(w);
        }
        return result;
    }

    // ── Create Epic ───────────────────────────────────────────────────────
    @AuraEnabled
    public static Id createEpic(Id projectId, String name, Date startDate, Date endDate, Decimal estimatedHours, String description) {
        try {
            Sprint_Items__c epic = new Sprint_Items__c(
                Name                      = name,
                Projects_new__c           = projectId,
                Epic_Type__c              = 'Sub-Project',
                Planned_Start_Date__c     = startDate,
                Planned_Completed_Date__c = endDate,
                Hours_Estimate__c         = estimatedHours,
                Description__c            = description
            );
            insert epic;
            return epic.Id;
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }

    // ── Update Epic ───────────────────────────────────────────────────────
    @AuraEnabled
    public static void updateEpic(Id epicId, String name, Date startDate, Date endDate, Decimal estimatedHours, String description) {
        try {
            Sprint_Items__c epic = new Sprint_Items__c(
                Id                        = epicId,
                Name                      = name,
                Planned_Start_Date__c     = startDate,
                Planned_Completed_Date__c = endDate,
                Hours_Estimate__c         = estimatedHours,
                Description__c            = description
            );
            update epic;
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }
}
