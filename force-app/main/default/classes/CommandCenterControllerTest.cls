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
        System.assertEquals('line', cd.chartType);
        System.assertEquals(4, cd.chartLabels.size(), 'Should have 4 week labels');
        System.assertEquals(2, cd.datasets.size(), 'Should have Hours Logged + Target datasets');
        // Target dataset should be dashed
        Boolean foundDashed = false;
        for (CommandCenterController.ChartDataset ds : cd.datasets) {
            if (ds.isDashed == true) foundDashed = true;
        }
        System.assert(foundDashed, 'Target line should be dashed');
        System.assertNotEquals(0, cd.insights.size(), 'Should have insights');
        // Verify KPI labels match spec
        Boolean foundOnTrack = false, foundHoursTarget = false, foundUtil = false;
        for (CommandCenterController.KPI k : cd.kpis) {
            if (k.label == 'Projects On Track') foundOnTrack = true;
            if (k.label == 'Hours vs Target')   foundHoursTarget = true;
            if (k.label == 'Utilization')        foundUtil = true;
        }
        System.assert(foundOnTrack,     'Should have Projects On Track KPI');
        System.assert(foundHoursTarget, 'Should have Hours vs Target KPI');
        System.assert(foundUtil,         'Should have Utilization KPI');
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
        System.assertEquals(2, cd.datasets.size(), 'Should have Delivered + Committed datasets');
        // Test project has Weekly_Pace_Estimate__c = 10 → treated as retainer → appears in chart
        System.assertNotEquals(0, cd.chartLabels.size(), 'Retainer project should appear in chart');
        // Verify KPI labels
        Boolean foundDeliveryRate = false;
        Boolean foundAtPace       = false;
        for (CommandCenterController.KPI k : cd.kpis) {
            if (k.label == 'Delivery Rate')      foundDeliveryRate = true;
            if (k.label == 'Projects at Pace')   foundAtPace       = true;
        }
        System.assert(foundDeliveryRate, 'Should have Delivery Rate KPI');
        System.assert(foundAtPace,        'Should have Projects at Pace KPI');
    }

    @IsTest
    static void testGetPastEmployee() {
        Test.startTest();
        CommandCenterController.CardData cd = CommandCenterController.getPastEmployee();
        Test.stopTest();

        System.assertNotEquals(null, cd, 'CardData should not be null');
        System.assertEquals('Individual Performance', cd.title);
        System.assertEquals(3, cd.kpis.size(), 'Card should have 3 KPIs');
        System.assertEquals(6, cd.modalKpis.size(), 'Modal should have 6 KPIs');
        System.assertEquals('bar', cd.chartType);
        // Always shows all 4 team members
        System.assertEquals(4, cd.chartLabels.size(), 'Should show 4 team members');
        // 3 datasets: bars + 2 reference lines
        System.assertEquals(3, cd.datasets.size(), 'Should have bars + 2 reference line datasets');
        // No second chart
        System.assertEquals(null, cd.datasets2, 'Second chart should not be present');
    }

    // ── Present Row Tests ─────────────────────────────────────────────────────

    @IsTest
    static void testGetPresentManagement() {
        Test.startTest();
        CommandCenterController.CardData cd = CommandCenterController.getPresentManagement();
        Test.stopTest();

        System.assertNotEquals(null, cd, 'CardData should not be null');
        System.assertEquals('Delivery Readiness', cd.title);
        System.assertEquals(3, cd.kpis.size());
        System.assertEquals('bar', cd.chartType);
        System.assertEquals(2, cd.datasets.size(), 'Should have weekly pace + retained reference datasets');
        // Blocked story in test data → Blocked KPI should be present
        Boolean foundBlocked = false, foundEstHrs = false;
        for (CommandCenterController.KPI k : cd.kpis) {
            if (k.label == 'Blocked Stories') foundBlocked = true;
            if (k.label == 'Est. Hours to Complete') foundEstHrs = true;
        }
        System.assert(foundBlocked, 'Should have a Blocked KPI');
        System.assert(foundEstHrs,  'Should have Est. Hours to Complete KPI');
    }

    @IsTest
    static void testGetPresentCustomer() {
        Test.startTest();
        CommandCenterController.CardData cd = CommandCenterController.getPresentCustomer();
        Test.stopTest();

        System.assertNotEquals(null, cd, 'CardData should not be null');
        System.assertEquals('Client Coverage', cd.title);
        System.assertEquals(3, cd.kpis.size(), 'Card face should have 3 KPIs');
        System.assertEquals(6, cd.modalKpis.size(), 'Modal should have 6 KPIs');
        System.assertEquals('bar', cd.chartType);
        // Chart 1: outstanding story count per project (single dataset, no ref line)
        System.assertEquals(1, cd.datasets.size(), 'Chart 1 should have single dataset');
        // Our test project is In Progress (retainer, Weekly_Pace_Estimate__c = 10)
        System.assertEquals(1, cd.chartLabels.size(), 'Should show 1 active project');
        // No chart 2
        System.assertEquals(null, cd.datasets2, 'Chart 2 should not be present');
    }

    @IsTest
    static void testGetPresentEmployee() {
        Test.startTest();
        CommandCenterController.CardData cd = CommandCenterController.getPresentEmployee();
        Test.stopTest();

        System.assertNotEquals(null, cd, 'CardData should not be null');
        System.assertEquals('Individual Readiness', cd.title);
        System.assertEquals(3, cd.kpis.size());
        System.assertEquals('bar', cd.chartType);
        System.assertEquals(2, cd.datasets.size(), 'Should have Logged + Target datasets');
        // Test contractor should appear in chart
        System.assertNotEquals(0, cd.chartLabels.size(), 'Should show contractor');
    }

    // ── Future Row Tests ──────────────────────────────────────────────────────

    @IsTest
    static void testGetFutureManagement() {
        Test.startTest();
        CommandCenterController.CardData cd = CommandCenterController.getFutureManagement();
        Test.stopTest();

        System.assertNotEquals(null, cd, 'CardData should not be null');
        System.assertEquals('Utilization Forecast', cd.title);
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
        System.assertEquals('Client Transitions', cd.title);
        System.assertEquals(3, cd.kpis.size());
        System.assertEquals('bar', cd.chartType);
        // Chart now shows weekly demand shape for 8 weeks
        System.assertEquals(8, cd.chartLabels.size(), 'Should have 8-week labels');
        System.assertEquals(1, cd.datasets.size(), 'Should have single demand dataset');
        // Test project ends in 45 days → within 8 weeks → should appear in endings count
        Boolean endingsKpiFound = false;
        for (CommandCenterController.KPI k : cd.kpis) {
            if (k.label == 'Endings in 8 wks') endingsKpiFound = true;
        }
        System.assert(endingsKpiFound, 'Should have Endings in 8 wks KPI');
    }

    @IsTest
    static void testGetFutureEmployee() {
        Test.startTest();
        CommandCenterController.CardData cd = CommandCenterController.getFutureEmployee();
        Test.stopTest();

        System.assertNotEquals(null, cd, 'CardData should not be null');
        System.assertEquals('Assignment Forecast', cd.title);
        System.assertEquals(3, cd.kpis.size());
        System.assertEquals('bar', cd.chartType);
        // Our test contractor with 20h/week
        System.assertEquals(1, cd.chartLabels.size(), 'Should show test contractor');
        System.assertEquals(20, cd.datasets[0].data[0], 'Contractor should have 20h available');
    }

    // ── Drilldown Tests ───────────────────────────────────────────────────────

    @IsTest
    static void testGetProjectWeeklyHours() {
        Sprint__c proj = [SELECT Id FROM Sprint__c LIMIT 1];
        Test.startTest();
        CommandCenterController.DrilldownData dd = CommandCenterController.getProjectWeeklyHours(proj.Id);
        Test.stopTest();
        System.assertNotEquals(null, dd, 'DrilldownData should not be null');
        System.assertEquals(8, dd.labels.size(), 'Should have 8-week labels');
        System.assertNotEquals(null, dd.delivered, 'Should have delivered data');
        System.assertEquals(8, dd.delivered.size(), 'Delivered array should have 8 entries');
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
        // deliveryRate = 0% (0h delivered / committed) → critical
        System.assertEquals('critical', cd.status, '0h delivered vs committed → critical');
        // Projects still appear in chart even with no time entries
        System.assertNotEquals(0, cd.chartLabels.size(), 'Retainer project still appears in chart');
    }
}
