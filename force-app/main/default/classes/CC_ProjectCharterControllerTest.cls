@isTest
private class CC_ProjectCharterControllerTest {

    @TestSetup
    static void makeData() {
        insert new Sprint__c(Name = 'Test Project');
    }

    // ── getCharterData ────────────────────────────────────────────────────────

    @isTest
    static void testGetCharterData_CreatesCharter() {
        Sprint__c sprint = [SELECT Id FROM Sprint__c LIMIT 1];

        Test.startTest();
        CC_ProjectCharterController.CharterDataWrapper result =
            CC_ProjectCharterController.getCharterData(sprint.Id);
        Test.stopTest();

        System.assertNotEquals(null, result.charterId,    'charterId should be set');
        System.assertEquals('Draft', result.charterStatus, 'new charter should be Draft');
        System.assertEquals('Test Project', result.projectName);
        System.assertEquals(0, result.milestones.size());
        System.assertEquals(0, result.raciCells.size());
        System.assertEquals(0, result.risks.size());
        System.assertEquals(0, result.signoffs.size());
    }

    @isTest
    static void testGetCharterData_ReturnsExistingCharter() {
        Sprint__c sprint = [SELECT Id FROM Sprint__c LIMIT 1];
        insert new ProjectCharter__c(
            Sprint__c          = sprint.Id,
            Status__c          = 'In Review',
            Business_Problem__c = 'Legacy system pain'
        );

        Test.startTest();
        CC_ProjectCharterController.CharterDataWrapper result =
            CC_ProjectCharterController.getCharterData(sprint.Id);
        Test.stopTest();

        System.assertEquals('In Review', result.charterStatus);
        System.assertEquals('Legacy system pain', result.businessProblem);
        // Should not create a second charter
        System.assertEquals(1, [SELECT COUNT() FROM ProjectCharter__c WHERE Sprint__c = :sprint.Id]);
    }

    @isTest
    static void testGetCharterData_NullProjectId() {
        Test.startTest();
        try {
            CC_ProjectCharterController.getCharterData(null);
            System.assert(false, 'Expected AuraHandledException');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
        Test.stopTest();
    }

    // ── saveCharter ───────────────────────────────────────────────────────────

    @isTest
    static void testSaveCharter() {
        Sprint__c sprint = [SELECT Id FROM Sprint__c LIMIT 1];
        ProjectCharter__c charter = new ProjectCharter__c(Sprint__c = sprint.Id, Status__c = 'Draft');
        insert charter;

        charter.Status__c          = 'Approved';
        charter.Business_Problem__c = 'Updated problem';
        charter.Objectives__c      = 'Ship on time';

        Test.startTest();
        CC_ProjectCharterController.saveCharter(charter);
        Test.stopTest();

        ProjectCharter__c updated = [
            SELECT Status__c, Business_Problem__c, Objectives__c
            FROM   ProjectCharter__c WHERE Id = :charter.Id
        ];
        System.assertEquals('Approved',        updated.Status__c);
        System.assertEquals('Updated problem', updated.Business_Problem__c);
        System.assertEquals('Ship on time',    updated.Objectives__c);
    }

    // ── saveMilestones ────────────────────────────────────────────────────────

    @isTest
    static void testSaveMilestones_InsertUpdateDelete() {
        Sprint__c sprint = [SELECT Id FROM Sprint__c LIMIT 1];
        ProjectCharter__c charter = new ProjectCharter__c(Sprint__c = sprint.Id);
        insert charter;

        List<Charter_Milestone__c> initial = new List<Charter_Milestone__c>{
            new Charter_Milestone__c(Charter__c = charter.Id, Name = 'Phase 1', Sort_Order__c = 1),
            new Charter_Milestone__c(Charter__c = charter.Id, Name = 'Phase 2', Sort_Order__c = 2)
        };
        insert initial;

        // Keep phase 1 (updated), drop phase 2, add phase 3
        List<Charter_Milestone__c> updated = new List<Charter_Milestone__c>{
            new Charter_Milestone__c(Id = initial[0].Id, Charter__c = charter.Id,
                                     Name = 'Phase 1 — Updated', Sort_Order__c = 1),
            new Charter_Milestone__c(Charter__c = charter.Id, Name = 'Phase 3', Sort_Order__c = 3)
        };

        Test.startTest();
        CC_ProjectCharterController.saveMilestones(charter.Id, updated);
        Test.stopTest();

        List<Charter_Milestone__c> result = [
            SELECT Name FROM Charter_Milestone__c
            WHERE  Charter__c = :charter.Id ORDER BY Sort_Order__c
        ];
        System.assertEquals(2, result.size());
        System.assertEquals('Phase 1 — Updated', result[0].Name);
        System.assertEquals('Phase 3',           result[1].Name);
    }

    // ── saveRaci ──────────────────────────────────────────────────────────────

    @isTest
    static void testSaveRaci_FullReplace() {
        Sprint__c sprint = [SELECT Id FROM Sprint__c LIMIT 1];
        ProjectCharter__c charter = new ProjectCharter__c(Sprint__c = sprint.Id);
        insert charter;

        // Insert an old-format record that should be replaced
        insert new Charter_RACI__c(
            Charter__c = charter.Id,
            Role__c = 'Old Role', Contact_Name__c = 'Old Person'
        );

        // New roles-roster format: Role__c + Contact_Name__c only
        List<Charter_RACI__c> newRoles = new List<Charter_RACI__c>{
            new Charter_RACI__c(Role__c = 'Project Manager', Contact_Name__c = 'Alice'),
            new Charter_RACI__c(Role__c = 'Developer',       Contact_Name__c = 'Bob')
        };

        Test.startTest();
        CC_ProjectCharterController.saveRaci(charter.Id, newRoles);
        Test.stopTest();

        List<Charter_RACI__c> result = [
            SELECT Role__c, Contact_Name__c
            FROM   Charter_RACI__c WHERE Charter__c = :charter.Id
            ORDER BY Role__c
        ];
        System.assertEquals(2, result.size(), 'Should have exactly 2 role records');
        System.assertEquals('Developer',       result[0].Role__c);
        System.assertEquals('Bob',             result[0].Contact_Name__c);
        System.assertEquals('Project Manager', result[1].Role__c);
        System.assertEquals('Alice',           result[1].Contact_Name__c);
    }

    @isTest
    static void testSaveRaci_EmptyList() {
        Sprint__c sprint = [SELECT Id FROM Sprint__c LIMIT 1];
        ProjectCharter__c charter = new ProjectCharter__c(Sprint__c = sprint.Id);
        insert charter;
        insert new Charter_RACI__c(Charter__c = charter.Id, Activity__c = 'A', Role__c = 'PM');

        Test.startTest();
        CC_ProjectCharterController.saveRaci(charter.Id, new List<Charter_RACI__c>());
        Test.stopTest();

        System.assertEquals(0, [SELECT COUNT() FROM Charter_RACI__c WHERE Charter__c = :charter.Id]);
    }

    // ── saveRisks ─────────────────────────────────────────────────────────────

    @isTest
    static void testSaveRisks() {
        Sprint__c sprint = [SELECT Id FROM Sprint__c LIMIT 1];
        ProjectCharter__c charter = new ProjectCharter__c(Sprint__c = sprint.Id);
        insert charter;

        List<Charter_Risk__c> risks = new List<Charter_Risk__c>{
            new Charter_Risk__c(Charter__c = charter.Id, Risk_Description__c = 'Scope creep',
                                Likelihood__c = 'High', Impact__c = 'High',
                                Mitigation__c = 'Change log', Sort_Order__c = 1)
        };

        Test.startTest();
        CC_ProjectCharterController.saveRisks(charter.Id, risks);
        Test.stopTest();

        List<Charter_Risk__c> result = [SELECT Risk_Description__c, Likelihood__c FROM Charter_Risk__c WHERE Charter__c = :charter.Id];
        System.assertEquals(1, result.size());
        System.assertEquals('Scope creep', result[0].Risk_Description__c);
        System.assertEquals('High',        result[0].Likelihood__c);
    }

    @isTest
    static void testSaveRisks_DeleteOrphans() {
        Sprint__c sprint = [SELECT Id FROM Sprint__c LIMIT 1];
        ProjectCharter__c charter = new ProjectCharter__c(Sprint__c = sprint.Id);
        insert charter;

        List<Charter_Risk__c> initial = new List<Charter_Risk__c>{
            new Charter_Risk__c(Charter__c = charter.Id, Risk_Description__c = 'Risk A'),
            new Charter_Risk__c(Charter__c = charter.Id, Risk_Description__c = 'Risk B')
        };
        insert initial;

        // Only keep Risk A
        Test.startTest();
        CC_ProjectCharterController.saveRisks(charter.Id, new List<Charter_Risk__c>{
            new Charter_Risk__c(Id = initial[0].Id, Charter__c = charter.Id, Risk_Description__c = 'Risk A')
        });
        Test.stopTest();

        System.assertEquals(1, [SELECT COUNT() FROM Charter_Risk__c WHERE Charter__c = :charter.Id]);
    }

    // ── saveSignoffs ──────────────────────────────────────────────────────────

    @isTest
    static void testSaveSignoffs() {
        Sprint__c sprint = [SELECT Id FROM Sprint__c LIMIT 1];
        ProjectCharter__c charter = new ProjectCharter__c(Sprint__c = sprint.Id);
        insert charter;

        List<Charter_Signoff__c> signoffs = new List<Charter_Signoff__c>{
            new Charter_Signoff__c(Charter__c = charter.Id, Signer_Name__c = 'Jane Smith',
                                   Role__c = 'Client Sponsor', Status__c = 'Pending')
        };

        Test.startTest();
        CC_ProjectCharterController.saveSignoffs(charter.Id, signoffs);
        Test.stopTest();

        Charter_Signoff__c result = [
            SELECT Signer_Name__c, Role__c, Status__c
            FROM   Charter_Signoff__c WHERE Charter__c = :charter.Id LIMIT 1
        ];
        System.assertEquals('Jane Smith',     result.Signer_Name__c);
        System.assertEquals('Client Sponsor', result.Role__c);
        System.assertEquals('Pending',        result.Status__c);
    }
}
