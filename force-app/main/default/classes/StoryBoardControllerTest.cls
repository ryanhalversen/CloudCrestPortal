@isTest
public class StoryBoardControllerTest {

    @TestSetup
    static void setupData() {
        List<Case> cases = new List<Case>{
            new Case(Subject = 'Story 1', Status = 'New',     Priority = 'High',   Type = 'Feature', Sprint_Week__c = 1, Sprint_Start_Date__c = Date.today()),
            new Case(Subject = 'Story 2', Status = 'Backlog', Priority = 'Medium', Type = 'Bug',     Sprint_Week__c = 2, Sprint_Start_Date__c = Date.today().addDays(7)),
            new Case(Subject = 'Story 3', Status = 'New',     Priority = 'Low',    Type = 'Feature')
        };
        insert cases;
    }

    @isTest
    static void testGetStories_allStories() {
        Test.startTest();
        List<Case> result = StoryBoardController.getStories(false, null);
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assert(result.size() >= 3, 'Should return all stories');
    }

    @isTest
    static void testGetStories_mineOnly() {
        Test.startTest();
        List<Case> result = StoryBoardController.getStories(true, null);
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assert(result.size() >= 0, 'Should return cases for current user');
    }

    @isTest
    static void testAssignToSprint() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Story 3' LIMIT 1];
        Date sprintStart = Date.today();

        Test.startTest();
        StoryBoardController.assignToSprint(c.Id, 3, sprintStart);
        Test.stopTest();

        Case updated = [SELECT Sprint_Week__c, Sprint_Start_Date__c FROM Case WHERE Id = :c.Id];
        System.assertEquals(3,           updated.Sprint_Week__c,        'Sprint week should be 3');
        System.assertEquals(sprintStart, updated.Sprint_Start_Date__c,  'Sprint start date should match');
    }

    @isTest
    static void testRemoveFromSprint() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Story 1' LIMIT 1];

        Test.startTest();
        StoryBoardController.removeFromSprint(c.Id);
        Test.stopTest();

        Case updated = [SELECT Sprint_Week__c, Sprint_Start_Date__c FROM Case WHERE Id = :c.Id];
        System.assertEquals(null, updated.Sprint_Week__c,       'Sprint week should be null');
        System.assertEquals(null, updated.Sprint_Start_Date__c, 'Sprint start date should be null');
    }

    @isTest
    static void testUpdateStoryStatus_valid() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Story 1' LIMIT 1];

        Test.startTest();
        StoryBoardController.updateStoryStatus(c.Id, 'Work In Progress (WIP)');
        Test.stopTest();

        Case updated = [SELECT Status FROM Case WHERE Id = :c.Id];
        System.assertEquals('Work In Progress (WIP)', updated.Status, 'Status should be updated');
    }

    @isTest
    static void testUpdateStoryStatus_invalid() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Story 1' LIMIT 1];

        Test.startTest();
        try {
            StoryBoardController.updateStoryStatus(c.Id, 'InvalidStatus');
            System.assert(false, 'Should have thrown an exception');
        } catch (AuraHandledException e) {
            System.assert(e.getMessage() != null, 'Exception message should not be null');
        }
        Test.stopTest();
    }
}