@isTest
public class EpicManagementPanelControllerTest {

    @TestSetup
    static void setupData() {
        Sprint__c sprint = new Sprint__c(Name = 'Test Sprint', Status__c = 'In Progress');
        insert sprint;

        Sprint_Items__c epic = new Sprint_Items__c(
            Name                      = 'Feature A',
            Projects_new__c           = sprint.Id,
            Epic_Type__c              = 'Sub-Project',
            Planned_Start_Date__c     = Date.today(),
            Planned_Completed_Date__c = Date.today().addDays(30),
            Hours_Estimate__c         = 40
        );
        insert epic;

        // "Ongoing optimization" epic — should also appear in getEpicsForProject results
        Sprint_Items__c ongoingEpic = new Sprint_Items__c(
            Name            = 'Ongoing Work',
            Projects_new__c = sprint.Id,
            Epic_Type__c    = 'Ongoing optimization'
        );
        insert ongoingEpic;

        List<Case> cases = new List<Case>{
            new Case(Subject = 'Story 1', Status = 'New',       Projects__c = sprint.Id, Epic__c = epic.Id),
            new Case(Subject = 'Story 2', Status = 'Completed', Projects__c = sprint.Id, Epic__c = epic.Id),
            new Case(Subject = 'Story 3', Status = 'Work In Progress (WIP)', Projects__c = sprint.Id, Epic__c = epic.Id)
        };
        insert cases;
    }

    @isTest
    static void testGetEpicsForProject() {
        Sprint__c sprint = [SELECT Id FROM Sprint__c LIMIT 1];

        Test.startTest();
        List<EpicManagementPanelController.EpicWrapper> result =
            EpicManagementPanelController.getEpicsForProject(sprint.Id);
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assertEquals(2, result.size(), 'Should return both epics regardless of type');
        // Find Feature A to verify story counts
        EpicManagementPanelController.EpicWrapper featureA = null;
        for (EpicManagementPanelController.EpicWrapper w : result) {
            if (w.name == 'Feature A') { featureA = w; break; }
        }
        System.assertNotEquals(null, featureA, 'Feature A should be in results');
        System.assertEquals(3, featureA.totalStories, 'Should count 3 total stories');
        System.assertEquals(1, featureA.completedStories, 'Should count 1 completed story');
        System.assertEquals(40, featureA.estimatedHours, 'Estimated hours should match');
    }

    @isTest
    static void testGetEpicsForProject_nullProjectId() {
        Test.startTest();
        List<EpicManagementPanelController.EpicWrapper> result =
            EpicManagementPanelController.getEpicsForProject(null);
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assertEquals(0, result.size(), 'Should return empty list for null project');
    }

    @isTest
    static void testGetEpicsForProject_noStories() {
        Sprint__c sprint = [SELECT Id FROM Sprint__c LIMIT 1];

        // Create an epic with no cases
        Sprint_Items__c emptyEpic = new Sprint_Items__c(
            Name            = 'Empty Epic',
            Projects_new__c = sprint.Id,
            Epic_Type__c    = 'Sub-Project'
        );
        insert emptyEpic;

        Test.startTest();
        List<EpicManagementPanelController.EpicWrapper> result =
            EpicManagementPanelController.getEpicsForProject(sprint.Id);
        Test.stopTest();

        EpicManagementPanelController.EpicWrapper empty = null;
        for (EpicManagementPanelController.EpicWrapper w : result) {
            if (w.name == 'Empty Epic') { empty = w; break; }
        }
        System.assertNotEquals(null, empty, 'Empty Epic should be in results');
        System.assertEquals(0, empty.totalStories,     'Total should be 0');
        System.assertEquals(0, empty.completedStories, 'Completed should be 0');
    }

    @isTest
    static void testCreateEpic() {
        Sprint__c sprint = [SELECT Id FROM Sprint__c LIMIT 1];

        Test.startTest();
        Id epicId = EpicManagementPanelController.createEpic(
            sprint.Id,
            'New Epic',
            Date.today(),
            Date.today().addDays(60),
            80,
            'A new epic description'
        );
        Test.stopTest();

        System.assertNotEquals(null, epicId, 'Epic Id should be returned');
        Sprint_Items__c created = [
            SELECT Name, Epic_Type__c, Hours_Estimate__c, Description__c
            FROM Sprint_Items__c WHERE Id = :epicId
        ];
        System.assertEquals('New Epic',              created.Name,              'Name should match');
        System.assertEquals('Sub-Project',            created.Epic_Type__c,      'Type should be Sub-Project');
        System.assertEquals(80,                       created.Hours_Estimate__c, 'Estimated hours should match');
        System.assertEquals('A new epic description', created.Description__c,    'Description should match');
    }

    @isTest
    static void testUpdateEpic() {
        Sprint_Items__c epic = [SELECT Id FROM Sprint_Items__c WHERE Name = 'Feature A' LIMIT 1];

        Test.startTest();
        EpicManagementPanelController.updateEpic(
            epic.Id,
            'Feature A Updated',
            Date.today().addDays(5),
            Date.today().addDays(45),
            50,
            'Updated description'
        );
        Test.stopTest();

        Sprint_Items__c updated = [
            SELECT Name, Hours_Estimate__c, Description__c,
                   Planned_Start_Date__c, Planned_Completed_Date__c
            FROM Sprint_Items__c WHERE Id = :epic.Id
        ];
        System.assertEquals('Feature A Updated',    updated.Name,              'Name should be updated');
        System.assertEquals(50,                     updated.Hours_Estimate__c, 'Hours should be updated');
        System.assertEquals('Updated description',  updated.Description__c,    'Description should be updated');
    }
}
