@isTest
public class ProjectScorecardControllerTest {

    @TestSetup
    static void setupData() {
        Account acc = new Account(Name = 'Test Account');
        insert acc;

        // Current user's projects
        List<Sprint__c> sprints = new List<Sprint__c>{
            new Sprint__c(
                Name                      = 'My Sprint 1',
                Accountlu__c              = acc.Id,
                Status__c                 = 'In Progress',
                Weekly_Pace_Estimate__c   = 8,
                Project_Start_Date__c     = Date.today().addDays(-10),
                Project_End_Date__c       = Date.today().addDays(10)
            ),
            new Sprint__c(
                Name                      = 'My Sprint 2',
                Accountlu__c              = acc.Id,
                Status__c                 = 'In Progress',
                Weekly_Pace_Estimate__c   = 12,
                Project_Start_Date__c     = Date.today().addDays(-5),
                Project_End_Date__c       = Date.today().addDays(15)
            ),
            new Sprint__c(
                Name                      = 'Completed Sprint',
                Accountlu__c              = acc.Id,
                Status__c                 = 'Completed',
                Project_Start_Date__c     = Date.today().addDays(-30),
                Project_End_Date__c       = Date.today().addDays(-10)
            )
        };
        insert sprints;
    }

    // ── viewMode = 'mine' ──────────────────────────────────────────────────────

    @isTest
    static void testGetProjects_mine_returnsInProgressOnly() {
        Test.startTest();
        List<Sprint__c> result = ProjectScorecardController.getProjects('mine');
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        for (Sprint__c s : result) {
            System.assertEquals('In Progress', s.Status__c, 'Only In Progress sprints expected');
        }
    }

    @isTest
    static void testGetProjects_mine_returnsWeeklyPaceField() {
        Test.startTest();
        List<Sprint__c> result = ProjectScorecardController.getProjects('mine');
        Test.stopTest();

        System.assert(result.size() > 0, 'Expected at least one result');
        // Weekly_Pace_Estimate__c should be populated on inserted records
        Boolean hasValue = false;
        for (Sprint__c s : result) {
            if (s.Weekly_Pace_Estimate__c != null) { hasValue = true; break; }
        }
        System.assert(hasValue, 'At least one record should have Weekly_Pace_Estimate__c set');
    }

    @isTest
    static void testGetProjects_mine_emptyResult() {
        delete [SELECT Id FROM Sprint__c WHERE Status__c = 'In Progress'];

        Test.startTest();
        List<Sprint__c> result = ProjectScorecardController.getProjects('mine');
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assertEquals(0, result.size(), 'Expected empty list');
    }

    // ── viewMode = 'all' ───────────────────────────────────────────────────────

    @isTest
    static void testGetProjects_all_returnsInProgressOnly() {
        Test.startTest();
        List<Sprint__c> result = ProjectScorecardController.getProjects('all');
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        for (Sprint__c s : result) {
            System.assertEquals('In Progress', s.Status__c, 'Only In Progress sprints expected');
        }
    }

    @isTest
    static void testGetProjects_all_doesNotFilterByOwner() {
        // Create a second user and insert a sprint owned by them
        Profile p = [SELECT Id FROM Profile WHERE Name = 'Standard User' LIMIT 1];
        User otherUser = new User(
            FirstName    = 'Other',
            LastName     = 'User',
            Email        = 'otheruser_scorecard@test.com',
            Username     = 'otheruser_scorecard@test.com.sandbox',
            Alias        = 'otusr',
            TimeZoneSidKey    = 'America/New_York',
            LocaleSidKey      = 'en_US',
            EmailEncodingKey  = 'UTF-8',
            LanguageLocaleKey = 'en_US',
            ProfileId    = p.Id
        );
        insert otherUser;

        Account acc = [SELECT Id FROM Account LIMIT 1];
        Sprint__c otherSprint = new Sprint__c(
            Name                  = 'Other User Sprint',
            Accountlu__c          = acc.Id,
            Status__c             = 'In Progress',
            OwnerId               = otherUser.Id,
            Project_Start_Date__c = Date.today().addDays(-3),
            Project_End_Date__c   = Date.today().addDays(20)
        );
        insert otherSprint;

        Test.startTest();
        List<Sprint__c> result = ProjectScorecardController.getProjects('all');
        Test.stopTest();

        // 'all' mode should include the other user's sprint too
        Boolean foundOther = false;
        for (Sprint__c s : result) {
            if (s.Name == 'Other User Sprint') { foundOther = true; break; }
        }
        System.assert(foundOther, 'All mode should include sprints owned by other users');
    }

    @isTest
    static void testGetProjects_all_emptyResult() {
        delete [SELECT Id FROM Sprint__c WHERE Status__c = 'In Progress'];

        Test.startTest();
        List<Sprint__c> result = ProjectScorecardController.getProjects('all');
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assertEquals(0, result.size(), 'Expected empty list');
    }

    // ── Null / edge cases ──────────────────────────────────────────────────────

    @isTest
    static void testGetProjects_nullViewMode_defaultsToMine() {
        // Passing null should not throw; it falls into the else branch (mine)
        Test.startTest();
        List<Sprint__c> result = ProjectScorecardController.getProjects(null);
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
    }
}