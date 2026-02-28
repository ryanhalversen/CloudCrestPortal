@isTest
public class ProjectManagementPanelControllerTest {

    @TestSetup
    static void setupData() {
        Sprint__c project = new Sprint__c(
            Name      = 'Test Overhead Project',
            Status__c = 'In Progress'
        );
        insert project;

        Sprint_Items__c epic = new Sprint_Items__c(
            Name            = 'Needs Assignment',
            Projects_new__c = project.Id
        );
        insert epic;

        insert new List<Case>{
            new Case(Subject = 'Meetings',           Projects__c = project.Id, Status = 'Work In Progress (WIP)'),
            new Case(Subject = 'Project Management', Projects__c = project.Id, Status = 'Work In Progress (WIP)'),
            new Case(Subject = 'Helpdesk',           Projects__c = project.Id, Status = 'Work In Progress (WIP)')
        };

        insert new Event(
            Subject           = 'Test Meeting',
            StartDateTime     = DateTime.newInstance(Date.today(), Time.newInstance(10, 0, 0, 0)),
            EndDateTime       = DateTime.newInstance(Date.today(), Time.newInstance(10, 30, 0, 0)),
            DurationInMinutes = 30,
            ActivityDateTime  = DateTime.newInstance(Date.today(), Time.newInstance(10, 0, 0, 0))
        );
    }

    @isTest
    static void testGetEventsForDate_today() {
        Test.startTest();
        List<Event> result = ProjectManagementPanelController.getEventsForDate(String.valueOf(Date.today()), null);
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assert(result.size() >= 1, 'Should return at least the test event');
        System.assertEquals('Test Meeting', result[0].Subject, 'Event subject should match');
    }

    @isTest
    static void testGetEventsForDate_nullDefaults() {
        Test.startTest();
        List<Event> result = ProjectManagementPanelController.getEventsForDate(null, null);
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null when dateStr is null');
    }

    @isTest
    static void testGetCalendarUsers() {
        Test.startTest();
        List<User> result = ProjectManagementPanelController.getCalendarUsers();
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assert(result.size() >= 1, 'Should return at least the current user');
    }

    @isTest
    static void testGetOverheadCaseIds() {
        Sprint__c project = [SELECT Id FROM Sprint__c WHERE Name = 'Test Overhead Project' LIMIT 1];

        Test.startTest();
        Map<String, Id> result = ProjectManagementPanelController.getOverheadCaseIds(project.Id);
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assertEquals(3, result.size(), 'Should return 3 overhead cases');
        System.assert(result.containsKey('Meetings'),           'Should have Meetings key');
        System.assert(result.containsKey('Project Management'), 'Should have Project Management key');
        System.assert(result.containsKey('Helpdesk'),           'Should have Helpdesk key');
    }

    @isTest
    static void testGetOverheadCaseIds_wrongProject() {
        Sprint__c other = new Sprint__c(Name = 'Other Project', Status__c = 'In Progress');
        insert other;

        Test.startTest();
        Map<String, Id> result = ProjectManagementPanelController.getOverheadCaseIds(other.Id);
        Test.stopTest();

        System.assertEquals(0, result.size(), 'Should return empty map for project with no overhead cases');
    }

    @isTest
    static void testLogTime() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Meetings' LIMIT 1];
        Date today = Date.today();

        Test.startTest();
        ProjectManagementPanelController.logTime(c.Id, 45, 'Sprint planning discussion', today, null);
        Test.stopTest();

        List<Time__c> entries = [
            SELECT Id, Minutes_Logged__c, Additional_Comments__c, Logged_Date__c
            FROM Time__c WHERE Case__c = :c.Id
        ];
        System.assertEquals(1,                            entries.size(),                       'Should have created one time entry');
        System.assertEquals(45,                           entries[0].Minutes_Logged__c,         'Minutes should be 45');
        System.assertEquals('Sprint planning discussion', entries[0].Additional_Comments__c,    'Note should match');
        System.assertEquals(today,                        entries[0].Logged_Date__c,            'Date should match');
    }

    @isTest
    static void testLogTime_nullNote() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Helpdesk' LIMIT 1];

        Test.startTest();
        ProjectManagementPanelController.logTime(c.Id, 15, null, Date.today(), null);
        Test.stopTest();

        List<Time__c> entries = [SELECT Minutes_Logged__c FROM Time__c WHERE Case__c = :c.Id];
        System.assertEquals(1,  entries.size(),               'Should have created one time entry');
        System.assertEquals(15, entries[0].Minutes_Logged__c, 'Minutes should be 15');
    }

    @isTest
    static void testGetLoggedEventIds() {
        Case c   = [SELECT Id FROM Case WHERE Subject = 'Meetings' LIMIT 1];
        Event ev = [SELECT Id FROM Event WHERE Subject = 'Test Meeting' LIMIT 1];

        Test.startTest();
        ProjectManagementPanelController.logTime(c.Id, 30, 'Meeting logged', Date.today(), String.valueOf(ev.Id));
        List<String> result = ProjectManagementPanelController.getLoggedEventIds(
            new List<String>{ String.valueOf(ev.Id) }
        );
        Test.stopTest();

        System.assertEquals(1,                    result.size(), 'Should return 1 logged event ID');
        System.assertEquals(String.valueOf(ev.Id), result[0],    'Returned ID should match');
    }

    @isTest
    static void testGetLoggedEventIds_noMatch() {
        Test.startTest();
        List<String> result = ProjectManagementPanelController.getLoggedEventIds(
            new List<String>{ '00U000000000001AAA' }
        );
        Test.stopTest();

        System.assertEquals(0, result.size(), 'Should return empty list for unlogged event');
    }
}
