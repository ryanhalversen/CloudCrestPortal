public with sharing class CC_ProjectCharterController {

    // ── Data wrapper returned to LWC ─────────────────────────────────────────

    public class CharterDataWrapper {
        @AuraEnabled public Id     charterId;
        @AuraEnabled public String charterStatus;
        @AuraEnabled public String businessProblem;
        @AuraEnabled public String solutionSummary;
        @AuraEnabled public String objectives;
        @AuraEnabled public String successCriteria;
        @AuraEnabled public String scopeIn;
        @AuraEnabled public String scopeOut;
        @AuraEnabled public String assumptions;
        @AuraEnabled public String dependencies;
        @AuraEnabled public String communicationPlan;
        @AuraEnabled public String changeOrderProcess;
        @AuraEnabled public String approvedDate;
        // Sprint__c context (read-only in charter)
        @AuraEnabled public String projectName;
        @AuraEnabled public String accountName;
        @AuraEnabled public String projectStatus;
        @AuraEnabled public String projectStartDate;
        @AuraEnabled public String projectEndDate;
        @AuraEnabled public String ownerName;
        // Child records
        @AuraEnabled public List<Charter_Milestone__c> milestones;
        @AuraEnabled public List<Charter_RACI__c>      raciCells;
        @AuraEnabled public List<Charter_Risk__c>      risks;
        @AuraEnabled public List<Charter_Signoff__c>   signoffs;
    }

    // ── Load all charter data; auto-create if none exists ────────────────────

    @AuraEnabled
    public static CharterDataWrapper getCharterData(Id projectId) {
        if (projectId == null) {
            throw new AuraHandledException('projectId is required');
        }

        Sprint__c sprint = [
            SELECT Id, Name, Status__c,
                   Project_Start_Date__c, Project_End_Date__c,
                   Accountlu__r.Name,
                   Project_Lead_Sprint__r.Name
            FROM   Sprint__c
            WHERE  Id = :projectId
            LIMIT  1
        ];

        List<ProjectCharter__c> existing = [
            SELECT Id, Status__c,
                   Business_Problem__c, Solution_Summary__c,
                   Objectives__c, Success_Criteria__c,
                   Scope_In__c, Scope_Out__c,
                   Assumptions__c, Dependencies__c,
                   Communication_Plan__c, Change_Order_Process__c,
                   Approved_Date__c
            FROM   ProjectCharter__c
            WHERE  Sprint__c = :projectId
            LIMIT  1
        ];

        ProjectCharter__c charter;
        if (existing.isEmpty()) {
            charter = new ProjectCharter__c(Sprint__c = projectId, Status__c = 'Draft');
            insert charter;
        } else {
            charter = existing[0];
        }

        List<Charter_Milestone__c> milestones = [
            SELECT Id, Name, Start_Date__c, End_Date__c, Status__c, Sort_Order__c
            FROM   Charter_Milestone__c
            WHERE  Charter__c = :charter.Id
            ORDER BY Sort_Order__c ASC NULLS LAST, Name ASC
        ];

        List<Charter_RACI__c> raciCells = [
            SELECT Id, Activity__c, Role__c, Assignment__c, Activity_Order__c
            FROM   Charter_RACI__c
            WHERE  Charter__c = :charter.Id
            ORDER BY Activity_Order__c ASC NULLS LAST, Activity__c ASC
        ];

        List<Charter_Risk__c> risks = [
            SELECT Id, Risk_Description__c, Likelihood__c, Impact__c, Mitigation__c, Sort_Order__c
            FROM   Charter_Risk__c
            WHERE  Charter__c = :charter.Id
            ORDER BY Sort_Order__c ASC NULLS LAST
        ];

        List<Charter_Signoff__c> signoffs = [
            SELECT Id, Signer_Name__c, Role__c, Status__c, Signed_Date__c
            FROM   Charter_Signoff__c
            WHERE  Charter__c = :charter.Id
            ORDER BY CreatedDate ASC
        ];

        CharterDataWrapper w    = new CharterDataWrapper();
        w.charterId             = charter.Id;
        w.charterStatus         = charter.Status__c;
        w.businessProblem       = charter.Business_Problem__c;
        w.solutionSummary       = charter.Solution_Summary__c;
        w.objectives            = charter.Objectives__c;
        w.successCriteria       = charter.Success_Criteria__c;
        w.scopeIn               = charter.Scope_In__c;
        w.scopeOut              = charter.Scope_Out__c;
        w.assumptions           = charter.Assumptions__c;
        w.dependencies          = charter.Dependencies__c;
        w.communicationPlan     = charter.Communication_Plan__c;
        w.changeOrderProcess    = charter.Change_Order_Process__c;
        w.approvedDate          = charter.Approved_Date__c != null
                                    ? String.valueOf(charter.Approved_Date__c) : null;
        w.projectName           = sprint.Name;
        w.accountName           = sprint.Accountlu__r != null ? sprint.Accountlu__r.Name : '';
        w.projectStatus         = sprint.Status__c;
        w.projectStartDate      = sprint.Project_Start_Date__c != null
                                    ? String.valueOf(sprint.Project_Start_Date__c) : null;
        w.projectEndDate        = sprint.Project_End_Date__c != null
                                    ? String.valueOf(sprint.Project_End_Date__c) : null;
        w.ownerName             = sprint.Project_Lead_Sprint__r != null
                                    ? sprint.Project_Lead_Sprint__r.Name : '';
        w.milestones            = milestones;
        w.raciCells             = raciCells;
        w.risks                 = risks;
        w.signoffs              = signoffs;
        return w;
    }

    // ── Save charter header fields ────────────────────────────────────────────

    @AuraEnabled
    public static void saveCharter(ProjectCharter__c charter) {
        update charter;
    }

    // ── Save milestones: delete orphans, upsert rest ─────────────────────────

    @AuraEnabled
    public static void saveMilestones(Id charterId, List<Charter_Milestone__c> records) {
        Set<Id> keepIds = new Set<Id>();
        for (Charter_Milestone__c r : records) {
            r.Charter__c = charterId;
            if (r.Id != null) keepIds.add(r.Id);
        }
        delete [SELECT Id FROM Charter_Milestone__c
                WHERE  Charter__c = :charterId AND Id NOT IN :keepIds];
        upsert records;
    }

    // ── Save RACI: full replace (matrix shape can change) ────────────────────

    @AuraEnabled
    public static void saveRaci(Id charterId, List<Charter_RACI__c> records) {
        delete [SELECT Id FROM Charter_RACI__c WHERE Charter__c = :charterId];
        List<Charter_RACI__c> toInsert = new List<Charter_RACI__c>();
        for (Charter_RACI__c r : records) {
            toInsert.add(new Charter_RACI__c(
                Charter__c        = charterId,
                Activity__c       = r.Activity__c,
                Role__c           = r.Role__c,
                Assignment__c     = r.Assignment__c,
                Activity_Order__c = r.Activity_Order__c
            ));
        }
        if (!toInsert.isEmpty()) insert toInsert;
    }

    // ── Save risks: delete orphans, upsert rest ───────────────────────────────

    @AuraEnabled
    public static void saveRisks(Id charterId, List<Charter_Risk__c> records) {
        Set<Id> keepIds = new Set<Id>();
        for (Charter_Risk__c r : records) {
            r.Charter__c = charterId;
            if (r.Id != null) keepIds.add(r.Id);
        }
        delete [SELECT Id FROM Charter_Risk__c
                WHERE  Charter__c = :charterId AND Id NOT IN :keepIds];
        upsert records;
    }

    // ── Save sign-offs: delete orphans, upsert rest ───────────────────────────

    @AuraEnabled
    public static void saveSignoffs(Id charterId, List<Charter_Signoff__c> records) {
        Set<Id> keepIds = new Set<Id>();
        for (Charter_Signoff__c r : records) {
            r.Charter__c = charterId;
            if (r.Id != null) keepIds.add(r.Id);
        }
        delete [SELECT Id FROM Charter_Signoff__c
                WHERE  Charter__c = :charterId AND Id NOT IN :keepIds];
        upsert records;
    }
}
