public with sharing class CC_ProjectMgmtReportingController {

    @AuraEnabled(cacheable=true)
    public static List<ClientWrapper> getClientReportData() {

        // ── Step 1: Load all non-cancelled, account-linked sprints ──────────
        List<Sprint__c> sprints = [
            SELECT Id, Name, Status__c, Contract_Type__c, Delivery_Type__c,
                   Contracted_Hours_Sprint__c, Hours_Delivered__c,
                   Pace_Status__c, Weekly_Pace_Estimate__c,
                   Project_Start_Date__c, Project_End_Date__c,
                   Accountlu__c, Accountlu__r.Name, Owner.Name
            FROM Sprint__c
            WHERE Accountlu__c != null
              AND Status__c    != 'Cancelled'
            ORDER BY Accountlu__r.Name ASC, Project_Start_Date__c DESC NULLS LAST
            LIMIT 200
        ];

        if (sprints.isEmpty()) return new List<ClientWrapper>();

        // ── Step 2: Completed story counts + samples per sprint ─────────────
        Set<Id> sprintIds = new Map<Id, Sprint__c>(sprints).keySet();

        Map<Id, Integer>          storyCountMap = new Map<Id, Integer>();
        Map<Id, List<StoryWrapper>> storyMap    = new Map<Id, List<StoryWrapper>>();
        for (Id sid : sprintIds) {
            storyCountMap.put(sid, 0);
            storyMap.put(sid, new List<StoryWrapper>());
        }

        for (Case c : [
            SELECT Id, Subject, Status, Type, Projects__c
            FROM   Case
            WHERE  Projects__c IN :sprintIds
              AND  IsClosed = true
            ORDER BY LastModifiedDate DESC
            LIMIT 2000
        ]) {
            Id sid = c.Projects__c;
            storyCountMap.put(sid, storyCountMap.get(sid) + 1);
            List<StoryWrapper> stories = storyMap.get(sid);
            if (stories.size() < 10) {
                StoryWrapper sw = new StoryWrapper();
                sw.id      = c.Id;
                sw.subject = c.Subject;
                sw.status  = c.Status;
                sw.type    = c.Type;
                stories.add(sw);
            }
        }

        // ── Step 3: Group sprints by Account ────────────────────────────────
        Map<Id, ClientWrapper> clientMap = new Map<Id, ClientWrapper>();

        for (Sprint__c s : sprints) {
            Id accId = s.Accountlu__c;

            if (!clientMap.containsKey(accId)) {
                ClientWrapper cw        = new ClientWrapper();
                cw.accountId            = accId;
                cw.accountName          = s.Accountlu__r.Name;
                cw.totalContractedHours = 0;
                cw.totalDeliveredHours  = 0;
                cw.projects             = new List<ProjectWrapper>();
                clientMap.put(accId, cw);
            }
            ClientWrapper cw = clientMap.get(accId);

            Decimal contracted = s.Contracted_Hours_Sprint__c != null ? s.Contracted_Hours_Sprint__c : 0;
            Decimal delivered  = s.Hours_Delivered__c         != null ? s.Hours_Delivered__c         : 0;

            ProjectWrapper pw       = new ProjectWrapper();
            pw.id                   = s.Id;
            pw.name                 = s.Name;
            pw.status               = s.Status__c;
            pw.contractType         = s.Contract_Type__c;
            pw.deliveryType         = s.Delivery_Type__c;
            pw.paceStatus           = s.Pace_Status__c;
            pw.contractedHours      = contracted;
            pw.deliveredHours       = delivered;
            pw.startDate            = s.Project_Start_Date__c != null ? String.valueOf(s.Project_Start_Date__c) : null;
            pw.endDate              = s.Project_End_Date__c   != null ? String.valueOf(s.Project_End_Date__c)   : null;
            pw.ownerName            = s.Owner != null ? s.Owner.Name : '';
            pw.completedStoryCount  = storyCountMap.get(s.Id);
            pw.completedStories     = storyMap.get(s.Id);

            cw.totalContractedHours += contracted;
            cw.totalDeliveredHours  += delivered;
            cw.projects.add(pw);
        }

        return clientMap.values();
    }

    // ── Wrappers ─────────────────────────────────────────────────────────────

    public class ClientWrapper {
        @AuraEnabled public String              accountId;
        @AuraEnabled public String              accountName;
        @AuraEnabled public Decimal             totalContractedHours;
        @AuraEnabled public Decimal             totalDeliveredHours;
        @AuraEnabled public List<ProjectWrapper> projects;
    }

    public class ProjectWrapper {
        @AuraEnabled public String              id;
        @AuraEnabled public String              name;
        @AuraEnabled public String              status;
        @AuraEnabled public String              contractType;
        @AuraEnabled public String              deliveryType;
        @AuraEnabled public String              paceStatus;
        @AuraEnabled public Decimal             contractedHours;
        @AuraEnabled public Decimal             deliveredHours;
        @AuraEnabled public String              startDate;
        @AuraEnabled public String              endDate;
        @AuraEnabled public String              ownerName;
        @AuraEnabled public Integer             completedStoryCount;
        @AuraEnabled public List<StoryWrapper>  completedStories;
    }

    public class StoryWrapper {
        @AuraEnabled public String id;
        @AuraEnabled public String subject;
        @AuraEnabled public String status;
        @AuraEnabled public String type;
    }
}
