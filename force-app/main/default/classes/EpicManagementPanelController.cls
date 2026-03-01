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

    public class MilestoneWrapper {
        @AuraEnabled public Id     feedItemId;
        @AuraEnabled public String label;
        @AuraEnabled public Date   milestoneDate;
        @AuraEnabled public String description;
        @AuraEnabled public String changedBy;
        @AuraEnabled public String changedDate;
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

    // ── Get Milestones ────────────────────────────────────────────────────
    @AuraEnabled
    public static List<MilestoneWrapper> getMilestonesForEpic(Id epicId) {
        if (epicId == null) return new List<MilestoneWrapper>();
        List<MilestoneWrapper> result = new List<MilestoneWrapper>();
        for (FeedItem fi : [
            SELECT Id, Body, CreatedDate, LastEditDate, CreatedBy.Name
            FROM FeedItem
            WHERE ParentId = :epicId
            ORDER BY CreatedDate ASC
        ]) {
            if (fi.Body == null || !fi.Body.startsWith('MILESTONE | ')) continue;
            List<String> parts = fi.Body.split(' \\| ', 4);
            if (parts.size() < 3) continue;
            MilestoneWrapper w = new MilestoneWrapper();
            w.feedItemId  = fi.Id;
            w.label       = parts[1];
            try { w.milestoneDate = Date.valueOf(parts[2].trim()); } catch (Exception e) { continue; }
            w.description = parts.size() >= 4 ? parts[3].trim() : '';
            w.changedBy   = fi.CreatedBy.Name;
            w.changedDate = fi.LastEditDate != null
                ? fi.LastEditDate.format('M/d/yyyy')
                : fi.CreatedDate.format('M/d/yyyy');
            result.add(w);
        }
        return result;
    }

    // ── Save Milestone ────────────────────────────────────────────────────
    @AuraEnabled
    public static Id saveMilestone(Id epicId, Id feedItemId, String label, Date milestoneDate, String description) {
        String body = 'MILESTONE | ' + label + ' | ' + String.valueOf(milestoneDate)
            + (String.isNotBlank(description) ? ' | ' + description : '');
        try {
            if (feedItemId == null) {
                FeedItem fi = new FeedItem(ParentId = epicId, Body = body);
                insert fi;
                return fi.Id;
            } else {
                update new FeedItem(Id = feedItemId, Body = body);
                return feedItemId;
            }
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }

    // ── Delete Milestone ──────────────────────────────────────────────────
    @AuraEnabled
    public static void deleteMilestone(Id feedItemId) {
        try {
            delete new FeedItem(Id = feedItemId);
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }

    // ── Update Epic Dates (lightweight, for timeline drag) ────────────────
    @AuraEnabled
    public static void updateEpicDates(Id epicId, Date startDate, Date endDate) {
        try {
            update new Sprint_Items__c(
                Id                        = epicId,
                Planned_Start_Date__c     = startDate,
                Planned_Completed_Date__c = endDate
            );
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }
}
