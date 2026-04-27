@IsTest
private class CC_ProjectMgmtReportingControllerTest {

    @TestSetup
    static void makeData() {
        Account acc = new Account(Name = 'Test Client Corp');
        insert acc;

        Sprint__c proj1 = new Sprint__c(
            Name                    = 'Test Project Alpha',
            Status__c               = 'In Progress',
            Weekly_Pace_Estimate__c = 10,
            Project_Start_Date__c   = Date.today().addDays(-60),
            Project_End_Date__c     = Date.today().addDays(30),
            Accountlu__c            = acc.Id
        );
        insert proj1;

        Sprint__c proj2 = new Sprint__c(
            Name                    = 'Test Project Beta',
            Status__c               = 'Completed',
            Weekly_Pace_Estimate__c = 5,
            Project_Start_Date__c   = Date.today().addDays(-120),
            Project_End_Date__c     = Date.today().addDays(-10),
            Accountlu__c            = acc.Id
        );
        insert proj2;

        // Epics on proj1
        Sprint_Items__c epic1 = new Sprint_Items__c(Name = 'Epic One',   Projects_new__c = proj1.Id);
        Sprint_Items__c epic2 = new Sprint_Items__c(Name = 'Epic Two',   Projects_new__c = proj1.Id);
        insert new List<Sprint_Items__c>{ epic1, epic2 };

        // A closed story on proj1
        Case closedStory = new Case(
            Subject     = 'Delivered feature',
            Status      = 'Completed',
            Priority    = 'Medium',
            Projects__c = proj1.Id
        );
        insert closedStory;

        // Time entries against each epic
        insert new List<Time__c>{
            new Time__c(Case__c = closedStory.Id, Epic__c = epic1.Id,
                        Minutes_Logged__c = 120, Additional_Comments__c = 'Work A',
                        Logged_Date__c = Date.today()),
            new Time__c(Case__c = closedStory.Id, Epic__c = epic1.Id,
                        Minutes_Logged__c = 60,  Additional_Comments__c = 'Work B',
                        Logged_Date__c = Date.today()),
            new Time__c(Case__c = closedStory.Id, Epic__c = epic2.Id,
                        Minutes_Logged__c = 90,  Additional_Comments__c = 'Work C',
                        Logged_Date__c = Date.today())
        };
    }

    @IsTest
    static void testGetClientReportData_returnsClients() {
        Test.startTest();
        List<CC_ProjectMgmtReportingController.ClientWrapper> results =
            CC_ProjectMgmtReportingController.getClientReportData();
        Test.stopTest();

        System.assertNotEquals(null, results, 'Result should not be null');
        System.assertEquals(1, results.size(), 'Expected exactly one client');

        CC_ProjectMgmtReportingController.ClientWrapper client = results[0];
        System.assertEquals('Test Client Corp', client.accountName);
        System.assertEquals(2, client.projects.size(), 'Expected two projects for client');
        System.assertNotEquals(null, client.totalContractedHours);
        System.assertNotEquals(null, client.totalDeliveredHours);
    }

    @IsTest
    static void testGetClientReportData_projectFields() {
        Test.startTest();
        List<CC_ProjectMgmtReportingController.ClientWrapper> results =
            CC_ProjectMgmtReportingController.getClientReportData();
        Test.stopTest();

        CC_ProjectMgmtReportingController.ClientWrapper client = results[0];
        // Verify project wrapper fields are populated
        for (CC_ProjectMgmtReportingController.ProjectWrapper pw : client.projects) {
            System.assertNotEquals(null, pw.id);
            System.assertNotEquals(null, pw.name);
            System.assertNotEquals(null, pw.status);
            System.assertNotEquals(null, pw.completedStories, 'completedStories list should not be null');
            System.assertNotEquals(null, pw.completedStoryCount, 'completedStoryCount should not be null');
        }
    }

    @IsTest
    static void testGetClientReportData_noData() {
        delete [SELECT Id FROM Time__c];
        delete [SELECT Id FROM Case];
        delete [SELECT Id FROM Sprint_Items__c];
        delete [SELECT Id FROM Sprint__c];
        Test.startTest();
        List<CC_ProjectMgmtReportingController.ClientWrapper> results =
            CC_ProjectMgmtReportingController.getClientReportData();
        Test.stopTest();

        System.assertNotEquals(null, results);
        System.assertEquals(0, results.size(), 'Expected empty list when no sprints exist');
    }

    @IsTest
    static void testGetProjectReport() {
        Sprint__c proj = [SELECT Id FROM Sprint__c WHERE Name = 'Test Project Alpha' LIMIT 1];

        Test.startTest();
        CC_ProjectMgmtReportingController.ProjectReportWrapper result =
            CC_ProjectMgmtReportingController.getProjectReport(proj.Id);
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assertEquals('Test Project Alpha', result.name);
        System.assertEquals('In Progress', result.status);
        System.assertNotEquals(null, result.completedStories,  'completedStories should not be null');
        System.assertNotEquals(null, result.inProgressStories, 'inProgressStories should not be null');
        System.assertNotEquals(null, result.blockedStories,    'blockedStories should not be null');
        System.assertNotEquals(null, result.epics,             'epics should not be null');
        System.assertEquals(2, result.epics.size(),            'Expected two epics');
        // epic1 has 180 mins (120+60), epic2 has 90 mins — verify both are present
        Decimal totalMins = 0;
        for (CC_ProjectMgmtReportingController.EpicWrapper ew : result.epics) totalMins += ew.minutesLogged;
        System.assertEquals(270, totalMins, 'Total minutes should be 270');
    }

    @IsTest
    static void testGetProjectReport_nullId() {
        Test.startTest();
        CC_ProjectMgmtReportingController.ProjectReportWrapper result =
            CC_ProjectMgmtReportingController.getProjectReport(null);
        Test.stopTest();
        System.assertEquals(null, result, 'Should return null for null projectId');
    }

    @IsTest
    static void testGetClientReportData_excludesCancelledSprints() {
        // Add a cancelled sprint — should not appear in results
        Account acc = [SELECT Id FROM Account LIMIT 1];
        Sprint__c cancelled = new Sprint__c(
            Name                    = 'Cancelled Project',
            Status__c               = 'Cancelled',
            Weekly_Pace_Estimate__c = 5,
            Project_End_Date__c     = Date.today().addDays(10),
            Accountlu__c            = acc.Id
        );
        insert cancelled;

        Test.startTest();
        List<CC_ProjectMgmtReportingController.ClientWrapper> results =
            CC_ProjectMgmtReportingController.getClientReportData();
        Test.stopTest();

        // Only the 2 non-cancelled projects should appear
        System.assertEquals(1, results.size());
        System.assertEquals(2, results[0].projects.size(), 'Cancelled sprint should be excluded');
    }
}
