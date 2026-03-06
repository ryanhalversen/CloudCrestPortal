public with sharing class TeamCapacityController {

    @AuraEnabled(cacheable=true)
    public static CapacityData getCapacityData() {
        return new CapacityData(buildProjects(), buildWeeklyHours());
    }

    // ── Active projects ────────────────────────────────────────────────────
    private static List<ProjectWrapper> buildProjects() {
        List<ProjectWrapper> result = new List<ProjectWrapper>();
        for (Sprint__c s : [
            SELECT Id, Name,
                   OwnerId, Owner.Name,
                   Support_Lead__c, Support_Lead__r.Name,
                   Weekly_Pace_Estimate__c,
                   Contracted_Hours_Sprint__c,
                   Hours_Delivered__c,
                   Project_End_Date__c,
                   Pace_Status__c,
                   Remaining_Weeks__c,
                   Contract_Type__c,
                   Accountlu__r.Name
            FROM Sprint__c
            WHERE Status__c = 'In Progress'
            ORDER BY Owner.Name ASC, Accountlu__r.Name ASC, Name ASC
        ]) {
            ProjectWrapper w  = new ProjectWrapper();
            w.id              = s.Id;
            w.name            = s.Name;
            w.clientName      = s.Accountlu__r?.Name ?? '—';
            w.ownerId         = s.OwnerId;
            w.ownerName       = s.Owner?.Name ?? '—';
            w.supportLeadId   = s.Support_Lead__c;
            w.supportLeadName = s.Support_Lead__r?.Name;
            w.weeklyPace      = s.Weekly_Pace_Estimate__c ?? 0;
            w.contractedHours = s.Contracted_Hours_Sprint__c ?? 0;
            w.hoursDelivered  = s.Hours_Delivered__c ?? 0;
            w.endDate         = s.Project_End_Date__c != null
                                ? String.valueOf(s.Project_End_Date__c) : null;
            w.paceStatus      = s.Pace_Status__c;
            w.remainingWeeks  = s.Remaining_Weeks__c;
            w.contractType    = s.Contract_Type__c;
            result.add(w);
        }
        return result;
    }

    // ── Hours logged this week per user ────────────────────────────────────
    private static List<UserHoursWrapper> buildWeeklyHours() {
        Date weekStart = Date.today().toStartOfWeek();
        List<UserHoursWrapper> result = new List<UserHoursWrapper>();
        for (AggregateResult ar : [
            SELECT CreatedById uid, SUM(Minutes_Logged__c) mins
            FROM Time__c
            WHERE Logged_Date__c >= :weekStart
            GROUP BY CreatedById
        ]) {
            UserHoursWrapper w = new UserHoursWrapper();
            w.userId = (Id)ar.get('uid');
            Decimal m = ar.get('mins') != null ? (Decimal)ar.get('mins') : 0;
            w.hours  = (m / 60).setScale(1, RoundingMode.HALF_UP);
            result.add(w);
        }
        return result;
    }

    // ── Wrappers ───────────────────────────────────────────────────────────
    public class CapacityData {
        @AuraEnabled public List<ProjectWrapper>   projects;
        @AuraEnabled public List<UserHoursWrapper> weeklyHours;
        public CapacityData(List<ProjectWrapper> p, List<UserHoursWrapper> h) {
            projects    = p;
            weeklyHours = h;
        }
    }

    public class ProjectWrapper {
        @AuraEnabled public Id      id;
        @AuraEnabled public String  name;
        @AuraEnabled public String  clientName;
        @AuraEnabled public Id      ownerId;
        @AuraEnabled public String  ownerName;
        @AuraEnabled public Id      supportLeadId;
        @AuraEnabled public String  supportLeadName;
        @AuraEnabled public Decimal weeklyPace;
        @AuraEnabled public Decimal contractedHours;
        @AuraEnabled public Decimal hoursDelivered;
        @AuraEnabled public String  endDate;
        @AuraEnabled public String  paceStatus;
        @AuraEnabled public Decimal remainingWeeks;
        @AuraEnabled public String  contractType;
    }

    public class UserHoursWrapper {
        @AuraEnabled public Id      userId;
        @AuraEnabled public Decimal hours;
    }
}
