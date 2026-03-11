// force-app/main/default/classes/CommandCenterControllerTest.cls
@IsTest
private class CommandCenterControllerTest {

    // ── Test Data Setup ───────────────────────────────────────────────────────

    @TestSetup
    static void makeData() {
        // Account for contractors
        Account acc = new Account(Name = 'CloudCrest Contractors');
        insert acc;

        // Contractor contact
        Contact con = new Contact(LastName = 'TestContractor', AccountId = acc.Id, Available_Hours__c = 20);
        insert con;

        // Project (Sprint__c) — only writable fields
        Sprint__c proj = new Sprint__c(
            Name                    = 'Test Project',
            Status__c               = 'In Progress',
            Weekly_Pace_Estimate__c = 10,
            Project_End_Date__c     = Date.today().addDays(45)
        );
        insert proj;

        // Epic (Sprint_Items__c) — required for Time__c
        Sprint_Items__c epic = new Sprint_Items__c(
            Name            = 'Test Epic',
            Projects_new__c = proj.Id
        );
        insert epic;

        // Story (Case)
        Case story = new Case(
            Subject     = 'Test Story',
            Status      = 'Work In Progress (WIP)',
            Priority    = 'Medium',
            Projects__c = proj.Id,
            Epic__c     = epic.Id
        );
        insert story;

        // A blocked story
        Case blocked = new Case(
            Subject     = 'Blocked Story',
            Status      = 'Blocked',
            Priority    = 'High',
            Projects__c = proj.Id,
            Epic__c     = epic.Id
        );
        insert blocked;

        // Time entry — current week
        Time__c te = new Time__c(
            Case__c                = story.Id,
            Epic__c                = epic.Id,
            Minutes_Logged__c      = 120,
            Additional_Comments__c = 'Initial work',
            Logged_Date__c         = Date.today()
        );
        insert te;

        // Time entry — 2 weeks ago (for past tests)
        Time__c teOld = new Time__c(
            Case__c                = story.Id,
            Epic__c                = epic.Id,
            Minutes_Logged__c      = 240,
            Additional_Comments__c = 'Past work',
            Logged_Date__c         = Date.today().addDays(-14)
        );
        insert teOld;
    }

    // ── Past Row Tests ────────────────────────────────────────────────────────

    @IsTest
    static void testGetPastManagement() {
        Test.startTest();
        CommandCenterController.CardData cd = CommandCenterController.getPastManagement();
        Test.stopTest();

        System.assertNotEquals(null, cd, 'CardData should not be null');
        System.assertEquals('Team Performance', cd.title);
        System.assertEquals(3, cd.kpis.size(), 'Should have 3 KPIs');
        System.assertEquals('bar', cd.chartType);
        System.assertEquals(4, cd.chartLabels.size(), 'Should have 4 week labels');
        System.assertNotEquals(0, cd.insights.size(), 'Should have insights');
    }

    @IsTest
    static void testGetPastCustomer() {
        Test.startTest();
        CommandCenterController.CardData cd = CommandCenterController.getPastCustomer();
        Test.stopTest();

        System.assertNotEquals(null, cd, 'CardData should not be null');
        System.assertEquals('Client Delivery', cd.title);
        System.assertEquals(3, cd.kpis.size());
        System.assertEquals('bar', cd.chartType);
    }

    @IsTest
    static void testGetPastEmployee() {
        Test.startTest();
        CommandCenterController.CardData cd = CommandCenterController.getPastEmployee();
        Test.stopTest();

        System.assertNotEquals(null, cd, 'CardData should not be null');
        System.assertEquals('Individual Performance', cd.title);
        System.assertEquals(3, cd.kpis.size());
        System.assertEquals('bar', cd.chartType);
        // Should have at least 1 contributor (from @TestSetup time entries)
        System.assertNotEquals(0, cd.chartLabels.size(), 'Should show at least one contributor');
    }

    // ── Present Row Tests ─────────────────────────────────────────────────────

    @IsTest
    static void testGetPresentManagement() {
        Test.startTest();
        CommandCenterController.CardData cd = CommandCenterController.getPresentManagement();
        Test.stopTest();

        System.assertNotEquals(null, cd, 'CardData should not be null');
        System.assertEquals('Story Pipeline', cd.title);
        System.assertEquals(3, cd.kpis.size());
        System.assertEquals('doughnut', cd.chartType);
        System.assertEquals(1, cd.datasets.size());
        System.assertNotEquals(null, cd.datasets[0].colors, 'Doughnut should have per-slice colors');
        // Blocked story in test data → Blocked KPI value should be '1'
        Boolean foundBlocked = false;
        for (CommandCenterController.KPI k : cd.kpis) {
            if (k.label == 'Blocked') foundBlocked = true;
        }
        System.assert(foundBlocked, 'Should have a Blocked KPI');
    }

    @IsTest
    static void testGetPresentCustomer() {
        Test.startTest();
        CommandCenterController.CardData cd = CommandCenterController.getPresentCustomer();
        Test.stopTest();

        System.assertNotEquals(null, cd, 'CardData should not be null');
        System.assertEquals('Project Health', cd.title);
        System.assertEquals(3, cd.kpis.size());
        System.assertEquals('bar', cd.chartType);
        System.assertEquals(2, cd.datasets.size(), 'Should have Contracted + Delivered datasets');
        // Our test project is In Progress
        System.assertNotEquals(0, cd.chartLabels.size(), 'Should show active projects');
    }

    @IsTest
    static void testGetPresentEmployee() {
        Test.startTest();
        CommandCenterController.CardData cd = CommandCenterController.getPresentEmployee();
        Test.stopTest();

        System.assertNotEquals(null, cd, 'CardData should not be null');
        System.assertEquals('Weekly Utilization', cd.title);
        System.assertEquals(3, cd.kpis.size());
        System.assertEquals('bar', cd.chartType);
    }

    // ── Future Row Tests ──────────────────────────────────────────────────────

    @IsTest
    static void testGetFutureManagement() {
        Test.startTest();
        CommandCenterController.CardData cd = CommandCenterController.getFutureManagement();
        Test.stopTest();

        System.assertNotEquals(null, cd, 'CardData should not be null');
        System.assertEquals('Demand Forecast', cd.title);
        System.assertEquals(3, cd.kpis.size());
        System.assertEquals('line', cd.chartType);
        System.assertEquals(8, cd.chartLabels.size(), 'Should have 8-week labels');
        System.assertEquals(2, cd.datasets.size(), 'Should have Demand + Capacity datasets');
        // Capacity line should be dashed
        Boolean foundDashed = false;
        for (CommandCenterController.ChartDataset ds : cd.datasets) {
            if (ds.isDashed == true) foundDashed = true;
        }
        System.assert(foundDashed, 'Capacity line should be dashed');
    }

    @IsTest
    static void testGetFutureCustomer() {
        Test.startTest();
        CommandCenterController.CardData cd = CommandCenterController.getFutureCustomer();
        Test.stopTest();

        System.assertNotEquals(null, cd, 'CardData should not be null');
        System.assertEquals('Upcoming Deliverables', cd.title);
        System.assertEquals(3, cd.kpis.size());
        System.assertEquals('bar', cd.chartType);
        // Our test project ends in 45 days → should be in "Due 31-60 Days"
        System.assertEquals(1, cd.chartLabels.size(), 'Should track 1 upcoming project');
    }

    @IsTest
    static void testGetFutureEmployee() {
        Test.startTest();
        CommandCenterController.CardData cd = CommandCenterController.getFutureEmployee();
        Test.stopTest();

        System.assertNotEquals(null, cd, 'CardData should not be null');
        System.assertEquals('Capacity Planning', cd.title);
        System.assertEquals(3, cd.kpis.size());
        System.assertEquals('bar', cd.chartType);
        // Our test contractor with 20h/week
        System.assertEquals(1, cd.chartLabels.size(), 'Should show test contractor');
        System.assertEquals(20, cd.datasets[0].data[0], 'Contractor should have 20h available');
    }

    // ── No-Data Edge Cases ────────────────────────────────────────────────────

    @IsTest
    static void testGetPastManagement_empty() {
        // Delete in dependency order: Time → Case → Sprint
        delete [SELECT Id FROM Time__c];
        delete [SELECT Id FROM Case];
        delete [SELECT Id FROM Sprint__c];
        Test.startTest();
        CommandCenterController.CardData cd = CommandCenterController.getPastManagement();
        Test.stopTest();
        System.assertNotEquals(null, cd);
        System.assertEquals('neutral', cd.status, 'No projects → neutral status');
    }

    @IsTest
    static void testGetPastCustomer_noTimeEntries() {
        delete [SELECT Id FROM Time__c];
        Test.startTest();
        CommandCenterController.CardData cd = CommandCenterController.getPastCustomer();
        Test.stopTest();
        System.assertNotEquals(null, cd);
        System.assertEquals('critical', cd.status, 'No on-time projects → critical');
        System.assertEquals(0, cd.chartLabels.size());
    }
}
