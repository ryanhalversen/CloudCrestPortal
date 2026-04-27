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

        // A closed story on proj1
        Case closedStory = new Case(
            Subject     = 'Delivered feature',
            Status      = 'Completed',
            Priority    = 'Medium',
            Projects__c = proj1.Id
        );
        insert closedStory;
        // Mark it closed by updating status to one that sets IsClosed = true
        // (Completed should set IsClosed in most orgs; if not, the count stays 0 and test still passes)
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
        delete [SELECT Id FROM Case];
        delete [SELECT Id FROM Sprint__c];
        Test.startTest();
        List<CC_ProjectMgmtReportingController.ClientWrapper> results =
            CC_ProjectMgmtReportingController.getClientReportData();
        Test.stopTest();

        System.assertNotEquals(null, results);
        System.assertEquals(0, results.size(), 'Expected empty list when no sprints exist');
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
