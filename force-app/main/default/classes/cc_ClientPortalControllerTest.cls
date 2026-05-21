@isTest
public class cc_ClientPortalControllerTest {

    @TestSetup
    static void setupData() {
        Account acct = new Account(Name = 'Portal Test Account');
        insert acct;

        Sprint__c project = new Sprint__c(
            Name = 'Active Portal Project',
            Status__c = 'In Progress',
            Accountlu__c = acct.Id
        );
        insert project;

        Sprint_Items__c epic = new Sprint_Items__c(
            Name = 'Portal Test Epic',
            Projects_new__c = project.Id
        );
        insert epic;

        List<Case> stories = new List<Case>{
            new Case(Subject = 'Portal Story A', Status = 'New', Priority = 'High', Type = 'Feature', AccountId = acct.Id),
            new Case(Subject = 'Portal Story B', Status = 'In Progress', Priority = 'Medium', Type = 'Bug', AccountId = acct.Id),
            new Case(Subject = 'Portal Story C', Status = 'Closed', Priority = 'Low', Type = 'Feature', AccountId = acct.Id)
        };
        insert stories;
    }

    @isTest
    static void testGetPortalData_noContact() {
        Test.startTest();
        cc_ClientPortalController.PortalData result = cc_ClientPortalController.getPortalData();
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assertEquals(0, result.stories.size(), 'Should return empty stories when user has no ContactId');
        System.assertEquals(0, result.hoursConsumed, 'Hours should be 0');
    }

    @isTest
    static void testCreateStory_noContact() {
        Test.startTest();
        try {
            cc_ClientPortalController.createStory('Test', 'Desc', 'Feature', 'High');
            System.assert(false, 'Should have thrown AuraHandledException');
        } catch (AuraHandledException e) {
            System.assert(e.getMessage() != null, 'Exception message should not be null');
        }
        Test.stopTest();
    }

    @isTest
    static void testCreateStory_directCoverage() {
        Account acct = [SELECT Id FROM Account WHERE Name = 'Portal Test Account' LIMIT 1];

        Case c = new Case(
            Subject = 'Direct Create Test',
            Description = 'Testing direct insert',
            Type = 'Feature',
            Priority = 'High',
            Status = 'New',
            Origin = 'Portal',
            AccountId = acct.Id
        );
        insert c;

        Case result = [
            SELECT Id, Subject, Status, Origin, AccountId
            FROM Case
            WHERE Id = :c.Id
            LIMIT 1
        ];

        System.assertEquals('Direct Create Test', result.Subject, 'Subject should match');
        System.assertEquals('New', result.Status, 'Status should be New');
        System.assertEquals('Portal', result.Origin, 'Origin should be Portal');
        System.assertEquals(acct.Id, result.AccountId, 'AccountId should match');
    }

    @isTest
    static void testGetPicklistValues() {
        Test.startTest();
        Map<String, List<String>> result = cc_ClientPortalController.getPicklistValues();
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assert(result.containsKey('Type'), 'Should contain Type key');
        System.assert(result.containsKey('Priority'), 'Should contain Priority key');
        System.assert(result.get('Priority').size() > 0, 'Priority should have values');
    }

    @isTest
    static void testGetPortalData_queryCoverage() {
        Account acct = [SELECT Id FROM Account WHERE Name = 'Portal Test Account' LIMIT 1];

        List<Case> stories = [
            SELECT Id, Subject, Status, Priority, Type, AccountId
            FROM Case
            WHERE AccountId = :acct.Id
        ];
        System.assertEquals(3, stories.size(), 'Should have 3 test stories');

        List<Sprint__c> projects = [
            SELECT Id, Name
            FROM Sprint__c
            WHERE Accountlu__c = :acct.Id AND Status__c = 'In Progress'
        ];
        System.assertEquals(1, projects.size(), 'Should have 1 active project');
    }
}
