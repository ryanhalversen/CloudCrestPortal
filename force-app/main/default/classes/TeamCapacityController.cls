public with sharing class TeamCapacityController {

    @AuraEnabled(cacheable=true)
    public static CapacityData getCapacityData() {
        return new CapacityData(buildProjects(), buildWeeklyHours(), buildContractors());
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
                   On_Time_Weekly_Pace__c,
                   Support_Split__c,
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
            w.onTimeWeeklyPace = s.On_Time_Weekly_Pace__c ?? 0;
            w.contractedHours = s.Contracted_Hours_Sprint__c ?? 0;
            w.hoursDelivered  = s.Hours_Delivered__c ?? 0;
            w.endDate         = s.Project_End_Date__c != null
                                ? String.valueOf(s.Project_End_Date__c) : null;
            w.paceStatus      = s.Pace_Status__c;
            w.remainingWeeks  = s.Remaining_Weeks__c;
            w.supportSplit    = s.Support_Split__c ?? 0;
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

    // ── Contractors ────────────────────────────────────────────────────────
    private static List<ContractorWrapper> buildContractors() {
        List<ContractorWrapper> result = new List<ContractorWrapper>();
        for (Contact c : [
            SELECT Id, Name, Available_Hours__c
            FROM Contact
            WHERE Account.Name = 'CloudCrest Contractors'
              AND Available_Hours__c != null
              AND Available_Hours__c > 0
            ORDER BY Name ASC
        ]) {
            ContractorWrapper w = new ContractorWrapper();
            w.id          = c.Id;
            w.name        = c.Name;
            w.weeklyHours = c.Available_Hours__c;
            result.add(w);
        }
        return result;
    }

    // ── Wrappers ───────────────────────────────────────────────────────────
    public class CapacityData {
        @AuraEnabled public List<ProjectWrapper>    projects;
        @AuraEnabled public List<UserHoursWrapper>  weeklyHours;
        @AuraEnabled public List<ContractorWrapper> contractors;
        public CapacityData(List<ProjectWrapper> p, List<UserHoursWrapper> h, List<ContractorWrapper> c) {
            projects    = p;
            weeklyHours = h;
            contractors = c;
        }
    }

    public class ContractorWrapper {
        @AuraEnabled public Id      id;
        @AuraEnabled public String  name;
        @AuraEnabled public Decimal weeklyHours;
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
        @AuraEnabled public Decimal onTimeWeeklyPace;
        @AuraEnabled public Decimal contractedHours;
        @AuraEnabled public Decimal hoursDelivered;
        @AuraEnabled public String  endDate;
        @AuraEnabled public String  paceStatus;
        @AuraEnabled public Decimal remainingWeeks;
        @AuraEnabled public Decimal supportSplit;
        @AuraEnabled public String  contractType;
    }

    public class UserHoursWrapper {
        @AuraEnabled public Id      userId;
        @AuraEnabled public Decimal hours;
    }

    // ── Billing history — individual user ──────────────────────────────────
    @AuraEnabled(cacheable=true)
    public static List<BillingEntry> getBillingHistory(String userId, Integer weeks) {
        if (String.isBlank(userId) || weeks == null || weeks <= 0) return new List<BillingEntry>();
        Date startDate = Date.today().addDays(-weeks * 7);
        List<Time__c> rows = [
            SELECT Minutes_Logged__c, Logged_Date__c,
                   Case__r.Projects__c, Case__r.Projects__r.Name
            FROM Time__c
            WHERE CreatedById = :userId
              AND Logged_Date__c >= :startDate
            ORDER BY Logged_Date__c DESC
            LIMIT 2000
        ];
        List<BillingEntry> result = new List<BillingEntry>();
        for (Time__c t : rows) {
            BillingEntry e = new BillingEntry();
            e.loggedDate   = t.Logged_Date__c;
            e.minutes      = t.Minutes_Logged__c != null ? (Integer)t.Minutes_Logged__c : 0;
            e.projectId    = t.Case__r?.Projects__c;
            e.projectName  = t.Case__r?.Projects__r?.Name;
            result.add(e);
        }
        return result;
    }

    // ── Billing history — whole team ───────────────────────────────────────
    @AuraEnabled(cacheable=true)
    public static List<BillingEntry> getTeamBillingHistory(Integer weeks) {
        if (weeks == null || weeks <= 0) return new List<BillingEntry>();
        Date startDate = Date.today().addDays(-weeks * 7);
        List<Time__c> rows = [
            SELECT Minutes_Logged__c, Logged_Date__c,
                   Case__r.Projects__c, Case__r.Projects__r.Name
            FROM Time__c
            WHERE Logged_Date__c >= :startDate
            ORDER BY Logged_Date__c DESC
            LIMIT 5000
        ];
        List<BillingEntry> result = new List<BillingEntry>();
        for (Time__c t : rows) {
            BillingEntry e = new BillingEntry();
            e.loggedDate  = t.Logged_Date__c;
            e.minutes     = t.Minutes_Logged__c != null ? (Integer)t.Minutes_Logged__c : 0;
            e.projectId   = t.Case__r?.Projects__c;
            e.projectName = t.Case__r?.Projects__r?.Name;
            result.add(e);
        }
        return result;
    }

    public class BillingEntry {
        @AuraEnabled public Date    loggedDate;
        @AuraEnabled public Integer minutes;
        @AuraEnabled public String  projectId;
        @AuraEnabled public String  projectName;
    }
}
