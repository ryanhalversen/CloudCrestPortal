public without sharing class ProjectManagementPanelController {

    // ── Events for a Given Date ───────────────────────────────────────────
    @AuraEnabled
    public static List<Event> getEventsForDate(String dateStr, String filterUserId) {
        Date targetDate   = (dateStr != null && dateStr != '') ? Date.valueOf(dateStr) : Date.today();
        DateTime dayStart = DateTime.newInstance(targetDate,            Time.newInstance(0, 0, 0, 0));
        DateTime dayEnd   = DateTime.newInstance(targetDate.addDays(1), Time.newInstance(0, 0, 0, 0));
        Id userId         = (filterUserId != null && filterUserId != '')
                              ? (Id) filterUserId
                              : UserInfo.getUserId();
        return [
            SELECT Id, Subject, StartDateTime, EndDateTime, Owner.Name
            FROM Event
            WHERE OwnerId = :userId
            AND StartDateTime >= :dayStart
            AND StartDateTime < :dayEnd
            AND IsAllDayEvent = false
            ORDER BY StartDateTime ASC
            LIMIT 50
        ];
    }

    // ── Team Users for Filter ─────────────────────────────────────────────
    @AuraEnabled(cacheable=true)
    public static List<User> getCalendarUsers() {
        Id currentUserId = UserInfo.getUserId();
        Date cutoff      = Date.today().addDays(-60);
        Set<Id> activeUserIds = new Set<Id>{ currentUserId };
        for (AggregateResult ar : [
            SELECT OwnerId FROM Event
            WHERE StartDateTime >= :DateTime.newInstance(cutoff, Time.newInstance(0,0,0,0))
            GROUP BY OwnerId
        ]) {
            activeUserIds.add((Id) ar.get('OwnerId'));
        }
        return [
            SELECT Id, Name
            FROM User
            WHERE Id IN :activeUserIds
            AND IsActive = true
            ORDER BY Name ASC
        ];
    }

    // ── Overhead Case IDs for a Project ───────────────────────────────────
    @AuraEnabled(cacheable=true)
    public static Map<String, Id> getOverheadCaseIds(Id projectId) {
        Map<String, Id> result = new Map<String, Id>();
        for (Case c : [
            SELECT Id, Subject
            FROM Case
            WHERE Projects__c = :projectId
            AND Subject IN ('Meetings', 'Project Management', 'Helpdesk')
        ]) {
            result.put(c.Subject, c.Id);
        }
        return result;
    }

    // ── Log Time Entry ────────────────────────────────────────────────────
    @AuraEnabled
    public static void logTime(Id caseId, Integer minutes, String note, Date logDate, String eventId) {
        try {
            Case c = [SELECT Id, Epic__c, Projects__c FROM Case WHERE Id = :caseId LIMIT 1];

            // Use the case's epic; fall back to the project's Needs Assignment epic
            Id epicId = c.Epic__c;
            if (epicId == null && c.Projects__c != null) {
                List<Sprint_Items__c> epics = [
                    SELECT Id FROM Sprint_Items__c
                    WHERE Name = 'Needs Assignment'
                    AND Projects_new__c = :c.Projects__c
                    LIMIT 1
                ];
                if (!epics.isEmpty()) epicId = epics[0].Id;
            }

            Datetime stopNow = Datetime.now();
            insert new Time__c(
                Case__c                 = caseId,
                Epic__c                 = epicId,
                Minutes_Logged__c       = minutes,
                Additional_Comments__c  = note,
                Logged_Date__c          = logDate,
                Start_Time__c           = stopNow.addMinutes(-minutes),
                Stop_Time__c            = stopNow,
                Active__c               = false,
                Salesforce_Event_Id__c  = eventId
            );
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }

    // ── Logged Event IDs for Current User ────────────────────────────────
    @AuraEnabled
    public static List<String> getLoggedEventIds(List<String> eventIds) {
        List<String> result = new List<String>();
        for (Time__c t : [
            SELECT Salesforce_Event_Id__c
            FROM Time__c
            WHERE Salesforce_Event_Id__c IN :eventIds
            AND CreatedById = :UserInfo.getUserId()
        ]) {
            result.add(t.Salesforce_Event_Id__c);
        }
        return result;
    }
}
