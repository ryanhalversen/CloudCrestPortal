@isTest
public class SubmitAStoryControllerTest {

    @TestSetup
    static void setupData() {
        List<Case> cases = new List<Case>{
            new Case(Subject = 'Story 1', Status = 'New',     Priority = 'High',   Type = 'Feature', Department__c = 'IT',    Sprint_Week__c = 1, Sprint_Start_Date__c = Date.today()),
            new Case(Subject = 'Story 2', Status = 'Backlog', Priority = 'Medium', Type = 'Bug',     Department__c = 'Sales', Sprint_Week__c = 2, Sprint_Start_Date__c = Date.today().addDays(7))
        };
        insert cases;
    }

    @isTest
    static void testGetPicklistValues_valid() {
        Test.startTest();
        List<String> values = SubmitAStoryController.getPicklistValues('Case', 'Priority');
        Test.stopTest();

        System.assertNotEquals(null, values, 'Values should not be null');
        System.assert(values.size() > 0, 'Should return at least one picklist value');
    }

    @isTest
    static void testGetPicklistValues_invalidObject() {
        Test.startTest();
        List<String> values = SubmitAStoryController.getPicklistValues('FakeObject__c', 'Priority');
        Test.stopTest();

        System.assertNotEquals(null, values, 'Should return empty list not null');
        System.assertEquals(0, values.size(), 'Should return empty list for invalid object');
    }

    @isTest
    static void testGetPicklistValues_invalidField() {
        Test.startTest();
        List<String> values = SubmitAStoryController.getPicklistValues('Case', 'FakeField__c');
        Test.stopTest();

        System.assertNotEquals(null, values, 'Should return empty list not null');
        System.assertEquals(0, values.size(), 'Should return empty list for invalid field');
    }

    @isTest
    static void testCreateStory() {
        Test.startTest();
        Id caseId = SubmitAStoryController.createStory(
            'Test Story', 'Test Description', 'High', 'Feature', 'IT'
        );
        Test.stopTest();

        System.assertNotEquals(null, caseId, 'Case Id should not be null');
        Case c = [SELECT Subject, Description, Priority, Type, Department__c, Status FROM Case WHERE Id = :caseId];
        System.assertEquals('Test Story',       c.Subject,       'Subject should match');
        System.assertEquals('Test Description', c.Description,   'Description should match');
        System.assertEquals('High',             c.Priority,      'Priority should match');
        System.assertEquals('Feature',          c.Type,          'Type should match');
        System.assertEquals('IT',               c.Department__c, 'Department should match');
        System.assertEquals('New',              c.Status,        'Status should default to New');
    }

    @isTest
    static void testGetStories_allStories() {
        Test.startTest();
        List<Case> result = SubmitAStoryController.getStories(false);
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assert(result.size() >= 2, 'Should return all stories');
    }

    @isTest
    static void testGetStories_mineOnly() {
        Test.startTest();
        List<Case> result = SubmitAStoryController.getStories(true);
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assert(result.size() >= 0, 'Should return cases for current user without error');
    }

    @isTest
    static void testAssignToSprint() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Story 1' LIMIT 1];
        Date sprintStart = Date.today().addDays(14);

        Test.startTest();
        SubmitAStoryController.assignToSprint(c.Id, 3, sprintStart);
        Test.stopTest();

        Case updated = [SELECT Sprint_Week__c, Sprint_Start_Date__c FROM Case WHERE Id = :c.Id];
        System.assertEquals(3,           updated.Sprint_Week__c,       'Sprint week should be 3');
        System.assertEquals(sprintStart, updated.Sprint_Start_Date__c, 'Sprint start date should match');
    }

    @isTest
    static void testRemoveFromSprint() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Story 1' LIMIT 1];

        Test.startTest();
        SubmitAStoryController.removeFromSprint(c.Id);
        Test.stopTest();

        Case updated = [SELECT Sprint_Week__c, Sprint_Start_Date__c FROM Case WHERE Id = :c.Id];
        System.assertEquals(null, updated.Sprint_Week__c,       'Sprint week should be null');
        System.assertEquals(null, updated.Sprint_Start_Date__c, 'Sprint start date should be null');
    }

    @isTest
    static void testUpdateStoryStatus_valid() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Story 1' LIMIT 1];

        Test.startTest();
        SubmitAStoryController.updateStoryStatus(c.Id, 'In Review');
        Test.stopTest();

        Case updated = [SELECT Status FROM Case WHERE Id = :c.Id];
        System.assertEquals('In Review', updated.Status, 'Status should be updated to In Review');
    }

    @isTest
    static void testUpdateStoryStatus_invalid() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Story 1' LIMIT 1];

        Test.startTest();
        try {
            SubmitAStoryController.updateStoryStatus(c.Id, 'NotARealStatus');
            System.assert(false, 'Should have thrown an exception');
        } catch (AuraHandledException e) {
            System.assert(e.getMessage() != null, 'Exception message should not be null');
        }
        Test.stopTest();
    }
}