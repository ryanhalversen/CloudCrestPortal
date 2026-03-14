// force-app/main/default/classes/ResourcePlanningController.cls
public with sharing class ResourcePlanningController {

    // ── FTE weekly targets (matches existing teamCapacity constants) ──────────
    static final Map<String,Integer> FTE_TARGETS = new Map<String,Integer>{
        'Alec' => 0,
        'Alec Hampton' => 0
    };
    // Users excluded from FTE swim lanes (contractors who also have User records, admins, etc.)
    static final Set<String> FTE_EXCLUDE = new Set<String>{
        'Alec White', 'Ryan Halversen', 'Ryan H'
    };
    static final Integer DEFAULT_FTE_TARGET = 35;

    // ── Project color palette ─────────────────────────────────────────────────
    static final List<String> COLORS = new List<String>{
        '#00b4d8','#f59e0b','#22c55e','#a855f7','#ef4444',
        '#0096c7','#0077b6','#48cae4','#e879f9','#fb923c',
        '#10b981','#f43f5e','#6366f1','#84cc16','#f97316'
    };

    // ── Response Wrappers ─────────────────────────────────────────────────────

    public class BoardData {
        @AuraEnabled public List<FteRow>        fteRows;
        @AuraEnabled public List<ProjectCard>   projectCards;
        @AuraEnabled public List<ContractorRow> contractorPool;
        @AuraEnabled public List<PipelineRow>   pipelineShelf;
        @AuraEnabled public List<AssignmentRow> assignments;
    }

    public class FteRow {
        @AuraEnabled public String  id;
        @AuraEnabled public String  name;
        @AuraEnabled public String  initials;
        @AuraEnabled public String  role;
        @AuraEnabled public Integer weeklyTarget;
    }

    public class ProjectCard {
        @AuraEnabled public String  id;
        @AuraEnabled public String  name;
        @AuraEnabled public String  client;
        @AuraEnabled public Decimal weeklyPace;      // on-time weekly pace
        @AuraEnabled public String  endDate;
        @AuraEnabled public String  urgency;
        @AuraEnabled public String  paceStatus;
        @AuraEnabled public String  color;
        @AuraEnabled public String  ownerId;
        @AuraEnabled public String  supportLeadId;
        @AuraEnabled public Decimal supportSplit;
        @AuraEnabled public Boolean isBlock;
        @AuraEnabled public Decimal remainingHours;
    }

    public class ContractorRow {
        @AuraEnabled public String  id;
        @AuraEnabled public String  name;
        @AuraEnabled public String  company;
        @AuraEnabled public String  initials;
        @AuraEnabled public Decimal availableHours;
    }

    public class PipelineRow {
        @AuraEnabled public String  id;
        @AuraEnabled public String  name;
        @AuraEnabled public String  client;
        @AuraEnabled public String  expectedStart;
        @AuraEnabled public Decimal weeklyHrs;
        @AuraEnabled public String  stage;
        @AuraEnabled public Integer probability;
    }

    public class AssignmentRow {
        @AuraEnabled public String  id;
        @AuraEnabled public String  sprintId;
        @AuraEnabled public String  userId;
        @AuraEnabled public String  contractorId;
        @AuraEnabled public String  opportunityId;
        @AuraEnabled public Decimal hoursPerWeek;
        @AuraEnabled public String  role;
        @AuraEnabled public String  assignmentType;
        @AuraEnabled public Boolean isDerived;
    }

    // ── Read ──────────────────────────────────────────────────────────────────

    @AuraEnabled(cacheable=true)
    public static BoardData getBoardData() {
        BoardData bd = new BoardData();

        // ── 1. Active billable projects ───────────────────────────────────────
        List<Sprint__c> sprints = [
            SELECT Id, Name, OwnerId, Support_Lead__c, Support_Split__c,
                   Accountlu__r.Name, Weekly_Pace_Estimate__c, On_Time_Weekly_Pace__c,
                   Project_End_Date__c, Pace_Status__c, Contract_Type__c,
                   Completed_Delta_Sprint__c
            FROM Sprint__c
            WHERE Status__c = 'In Progress'
            AND (NOT Name LIKE '%CloudCrest%')
            ORDER BY Name
        ];

        // ── 2. Collect FTE user IDs (owners of active projects + recent Time logs) ─
        Set<Id> fteIds = new Set<Id>();
        for (Sprint__c s : sprints) {
            if (s.OwnerId       != null) fteIds.add(s.OwnerId);
            if (s.Support_Lead__c != null) fteIds.add(s.Support_Lead__c);
        }
        // Also include users who logged time in the last 90 days (catches FTEs not owning a current project)
        for (AggregateResult ar : [
            SELECT CreatedById id
            FROM Time__c
            WHERE Logged_Date__c >= :Date.today().addDays(-90)
            GROUP BY CreatedById
        ]) {
            fteIds.add((Id) ar.get('id'));
        }
        // Exclude contractor contacts — contractors are Contacts, not Users, so all Users are FTEs
        Map<Id, User> userMap = fteIds.isEmpty()
            ? new Map<Id, User>()
            : new Map<Id, User>([SELECT Id, Name, SmallPhotoUrl FROM User WHERE Id IN :fteIds AND IsActive = true]);

        // ── 3. Contractors ────────────────────────────────────────────────────
        List<Contact> contractors = [
            SELECT Id, Name, Account.Name, Available_Hours__c
            FROM Contact
            WHERE Account.Name = 'CloudCrest Contractors'
            AND Available_Hours__c > 0
            ORDER BY Name
        ];

        // ── 4. Existing assignments ───────────────────────────────────────────
        List<Resource_Assignment__c> dbAssignments = [
            SELECT Id, Sprint__c, User__c, Contractor__c, Opportunity__c,
                   Hours_Per_Week__c, Role__c, Assignment_Type__c, Is_Derived__c
            FROM Resource_Assignment__c
            ORDER BY CreatedDate
        ];

        // ── 5. Pipeline opportunities ─────────────────────────────────────────
        List<Opportunity> opps = [
            SELECT Id, Name, Account.Name, Est_Project_Start_Date__c,
                   Contracted_Hours__c, StageName, Probability,
                   Est_Project_End_Date__c
            FROM Opportunity
            WHERE StageName NOT IN ('Closed Won', 'Closed Lost')
            AND Est_Project_Start_Date__c != null
            ORDER BY Est_Project_Start_Date__c
        ];

        // ── Build FTE rows (sorted by name) ──────────────────────────────────
        List<User> sortedUsers = userMap.values();
        sortedUsers.sort();
        bd.fteRows = new List<FteRow>();
        for (User u : sortedUsers) {
            if (FTE_EXCLUDE.contains(u.Name)) continue;
            FteRow f    = new FteRow();
            f.id        = u.Id;
            f.name      = u.Name;
            f.initials  = initials(u.Name);
            f.role      = FTE_TARGETS.containsKey(u.Name) ? 'Head of Delivery' : 'FTE';
            f.weeklyTarget = fteTarget(u.Name);
            bd.fteRows.add(f);
        }

        // ── Build project cards ───────────────────────────────────────────────
        bd.projectCards = new List<ProjectCard>();
        Integer ci = 0;
        for (Sprint__c s : sprints) {
            ProjectCard pc  = new ProjectCard();
            pc.id           = s.Id;
            pc.name         = s.Name;
            pc.client       = s.Accountlu__r != null ? s.Accountlu__r.Name : '—';
            pc.weeklyPace   = s.On_Time_Weekly_Pace__c != null ? s.On_Time_Weekly_Pace__c : 0;
            pc.isBlock        = 'Block'.equalsIgnoreCase(s.Contract_Type__c);
            pc.remainingHours = s.Completed_Delta_Sprint__c != null ? s.Completed_Delta_Sprint__c.setScale(1) : null;
            Integer daysLeft = s.Project_End_Date__c != null
                ? Date.today().daysBetween(s.Project_End_Date__c)
                : 9999;
            pc.endDate  = s.Project_End_Date__c != null ? s.Project_End_Date__c.format() : null;
            pc.urgency  = daysLeft <= 14 ? 'critical' : daysLeft <= 56 ? 'warning' : '';
            pc.paceStatus = s.Pace_Status__c != null ? s.Pace_Status__c : '';
            pc.color        = COLORS[Math.mod(ci, COLORS.size())];
            pc.ownerId      = s.OwnerId;
            pc.supportLeadId = s.Support_Lead__c;
            pc.supportSplit  = s.Support_Split__c != null ? s.Support_Split__c : 0;
            ci++;
            bd.projectCards.add(pc);
        }

        // ── Build contractor pool ─────────────────────────────────────────────
        bd.contractorPool = new List<ContractorRow>();
        for (Contact c : contractors) {
            ContractorRow cr  = new ContractorRow();
            cr.id             = c.Id;
            cr.name           = c.Name;
            cr.company        = c.Account != null ? c.Account.Name : '';
            cr.initials       = initials(c.Name);
            cr.availableHours = c.Available_Hours__c != null ? c.Available_Hours__c : 0;
            bd.contractorPool.add(cr);
        }

        // ── Build pipeline shelf ──────────────────────────────────────────────
        bd.pipelineShelf = new List<PipelineRow>();
        for (Opportunity o : opps) {
            PipelineRow pr  = new PipelineRow();
            pr.id           = o.Id;
            pr.name         = o.Name;
            pr.client       = o.Account != null ? o.Account.Name : '—';
            pr.expectedStart = o.Est_Project_Start_Date__c != null ? o.Est_Project_Start_Date__c.format() : null;
            Integer totalWks = 1;
            if (o.Est_Project_Start_Date__c != null && o.Est_Project_End_Date__c != null) {
                totalWks = Math.max(1, o.Est_Project_Start_Date__c.daysBetween(o.Est_Project_End_Date__c) / 7 + 1);
            }
            pr.weeklyHrs  = o.Contracted_Hours__c != null ? (o.Contracted_Hours__c / totalWks).setScale(1) : 0;
            pr.stage      = o.StageName;
            pr.probability = o.Probability != null ? o.Probability.intValue() : 0;
            bd.pipelineShelf.add(pr);
        }

        // ── Build assignment rows ─────────────────────────────────────────────
        bd.assignments = new List<AssignmentRow>();
        for (Resource_Assignment__c a : dbAssignments) {
            AssignmentRow ar  = new AssignmentRow();
            ar.id             = a.Id;
            ar.sprintId       = a.Sprint__c;
            ar.userId         = a.User__c;
            ar.contractorId   = a.Contractor__c;
            ar.opportunityId  = a.Opportunity__c;
            ar.hoursPerWeek   = a.Hours_Per_Week__c != null ? a.Hours_Per_Week__c : 0;
            ar.role           = a.Role__c;
            ar.assignmentType = a.Assignment_Type__c;
            ar.isDerived      = a.Is_Derived__c != null ? a.Is_Derived__c : false;
            bd.assignments.add(ar);
        }

        return bd;
    }

    // ── Write ─────────────────────────────────────────────────────────────────

    @AuraEnabled
    public static String upsertAssignment(
        String assignmentId,
        String sprintId,
        String userId,
        String contractorId,
        String opportunityId,
        Decimal hoursPerWeek,
        String role,
        String assignmentType,
        Boolean isDerived
    ) {
        Resource_Assignment__c a = new Resource_Assignment__c();
        if (String.isNotBlank(assignmentId) && assignmentId.startsWith('0')) {
            a.Id = (Id) assignmentId;
        }
        a.Sprint__c         = String.isNotBlank(sprintId)      ? (Id) sprintId      : null;
        a.User__c           = String.isNotBlank(userId)        ? (Id) userId        : null;
        a.Contractor__c     = String.isNotBlank(contractorId)  ? (Id) contractorId  : null;
        a.Opportunity__c    = String.isNotBlank(opportunityId) ? (Id) opportunityId : null;
        a.Hours_Per_Week__c = hoursPerWeek;
        a.Role__c           = role;
        a.Assignment_Type__c = String.isNotBlank(assignmentType) ? assignmentType : 'Active';
        a.Is_Derived__c     = isDerived != null ? isDerived : false;
        upsert a;
        return a.Id;
    }

    @AuraEnabled
    public static void updateSprintOwner(String sprintId, String newOwnerId) {
        if (String.isBlank(sprintId) || String.isBlank(newOwnerId)) return;
        Sprint__c s = new Sprint__c(Id = (Id) sprintId, OwnerId = (Id) newOwnerId);
        update s;
    }

    @AuraEnabled
    public static void deleteAssignment(String assignmentId) {
        if (String.isNotBlank(assignmentId) && assignmentId.startsWith('0')) {
            delete new Resource_Assignment__c(Id = (Id) assignmentId);
        }
    }

    @AuraEnabled
    public static void batchSaveAssignments(String payloadJson) {
        List<Object> items = (List<Object>) JSON.deserializeUntyped(payloadJson);
        List<Resource_Assignment__c> toUpsert = new List<Resource_Assignment__c>();
        List<Id> toDeleteIds = new List<Id>();

        for (Object obj : items) {
            Map<String,Object> m = (Map<String,Object>) obj;
            String action = (String) m.get('action');

            if (action == 'delete') {
                String rid = (String) m.get('id');
                if (String.isNotBlank(rid) && rid.startsWith('0')) toDeleteIds.add((Id) rid);
            } else {
                Resource_Assignment__c a = new Resource_Assignment__c();
                String rid = (String) m.get('id');
                if (String.isNotBlank(rid) && rid.startsWith('0')) a.Id = (Id) rid;
                String spId = (String) m.get('sprintId');
                String uId  = (String) m.get('userId');
                String cId  = (String) m.get('contractorId');
                String oId  = (String) m.get('opportunityId');
                a.Sprint__c      = String.isNotBlank(spId) ? (Id) spId : null;
                a.User__c        = String.isNotBlank(uId)  ? (Id) uId  : null;
                a.Contractor__c  = String.isNotBlank(cId)  ? (Id) cId  : null;
                a.Opportunity__c = String.isNotBlank(oId)  ? (Id) oId  : null;
                Object hrs = m.get('hoursPerWeek');
                a.Hours_Per_Week__c = hrs != null ? Decimal.valueOf(String.valueOf(hrs)) : 0;
                a.Role__c           = (String) m.get('role');
                a.Assignment_Type__c = (String) m.get('assignmentType');
                a.Is_Derived__c     = false;
                toUpsert.add(a);
            }
        }

        if (!toDeleteIds.isEmpty()) {
            List<Resource_Assignment__c> del = new List<Resource_Assignment__c>();
            for (Id id : toDeleteIds) del.add(new Resource_Assignment__c(Id = id));
            delete del;
        }
        if (!toUpsert.isEmpty()) upsert toUpsert;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static String initials(String name) {
        if (String.isBlank(name)) return '?';
        List<String> parts = name.trim().split(' +');
        String result = '';
        for (String p : parts) { if (String.isNotBlank(p)) result += p.substring(0,1).toUpperCase(); }
        return result.length() > 2 ? result.substring(0,2) : result;
    }

    private static Integer fteTarget(String name) {
        if (FTE_TARGETS.containsKey(name)) return FTE_TARGETS.get(name);
        for (String key : FTE_TARGETS.keySet()) {
            if (name != null && name.contains(key)) return FTE_TARGETS.get(key);
        }
        return DEFAULT_FTE_TARGET;
    }
}
