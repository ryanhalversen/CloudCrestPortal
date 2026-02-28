@isTest
public class ExecOverviewControllerTest {

    @TestSetup
    static void setupData() {
        List<Case> cases = new List<Case>{
            new Case(Status='Completed',       Priority='High',   Type='Bug',         Department__c='IT',          Sprint_Week__c=1),
            new Case(Status='Blocked',         Priority='Medium', Type='Feature',     Department__c='IT',          Sprint_Week__c=1),
            new Case(Status='Work In Progress',Priority='Low',    Type='Bug',         Department__c='Finance',     Sprint_Week__c=2),
            new Case(Status='In Review',       Priority='High',   Type='Enhancement', Department__c='Finance',     Sprint_Week__c=2),
            new Case(Status='Backlog',         Priority='Medium', Type='Feature',     Department__c='Sales',       Sprint_Week__c=3),
            new Case(Status='In UAT',          Priority='Low',    Type='Bug',         Department__c='Sales',       Sprint_Week__c=3),
            new Case(Status='Cancelled',       Priority='High',   Type='Enhancement', Department__c='HR',          Sprint_Week__c=4)
        };
        insert cases;
    }

    @isTest
    static void testGetKpiSummary() {
        Test.startTest();
        Map<String, Integer> kpi = ExecOverviewController.getKpiSummary();
        Test.stopTest();

        System.assertNotEquals(null, kpi, 'KPI map should not be null');
        System.assert(kpi.containsKey('total'),      'Should have total key');
        System.assert(kpi.containsKey('completed'),  'Should have completed key');
        System.assert(kpi.containsKey('blocked'),    'Should have blocked key');
        System.assert(kpi.containsKey('inProgress'), 'Should have inProgress key');
        System.assert(kpi.containsKey('inReview'),   'Should have inReview key');
        System.assert(kpi.containsKey('backlog'),    'Should have backlog key');
        System.assert(kpi.containsKey('inUAT'),      'Should have inUAT key');
        System.assert(kpi.containsKey('cancelled'),  'Should have cancelled key');

        System.assertEquals(1, kpi.get('completed'),  'Should have 1 completed');
        System.assertEquals(1, kpi.get('blocked'),    'Should have 1 blocked');
        System.assertEquals(1, kpi.get('inProgress'), 'Should have 1 inProgress');
        System.assertEquals(1, kpi.get('inReview'),   'Should have 1 inReview');
        System.assertEquals(1, kpi.get('backlog'),    'Should have 1 backlog');
        System.assertEquals(1, kpi.get('inUAT'),      'Should have 1 inUAT');
        System.assertEquals(1, kpi.get('cancelled'),  'Should have 1 cancelled');
        System.assertEquals(7, kpi.get('total'),      'Total should be 7');
    }

    @isTest
    static void testGetStoriesByDepartment() {
        Test.startTest();
        List<Map<String, Object>> result = ExecOverviewController.getStoriesByDepartment();
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assert(result.size() > 0, 'Should have at least one department');
        System.assert(result[0].containsKey('dept'),  'Should have dept key');
        System.assert(result[0].containsKey('count'), 'Should have count key');
    }

    @isTest
    static void testGetStoriesByPriority() {
        Test.startTest();
        List<Map<String, Object>> result = ExecOverviewController.getStoriesByPriority();
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assert(result.size() > 0, 'Should have at least one priority');
        System.assert(result[0].containsKey('priority'), 'Should have priority key');
        System.assert(result[0].containsKey('count'),    'Should have count key');
    }

    @isTest
    static void testGetStoriesByType() {
        Test.startTest();
        List<Map<String, Object>> result = ExecOverviewController.getStoriesByType();
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assert(result.size() > 0, 'Should have at least one type');
        System.assert(result[0].containsKey('type'),  'Should have type key');
        System.assert(result[0].containsKey('count'), 'Should have count key');
    }

    @isTest
    static void testGetTypeTrend() {
        Test.startTest();
        List<Map<String, Object>> result = ExecOverviewController.getTypeTrend();
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assert(result.size() > 0, 'Should have at least one trend entry');
        System.assert(result[0].containsKey('week'),  'Should have week key');
        System.assert(result[0].containsKey('type'),  'Should have type key');
        System.assert(result[0].containsKey('count'), 'Should have count key');
    }
}