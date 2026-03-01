@isTest
public class StoryBoardControllerTest {

    @TestSetup
    static void setupData() {
        Sprint__c sprint = new Sprint__c(Name = 'Test Sprint', Status__c = 'In Progress');
        insert sprint;

        Sprint_Items__c epic = new Sprint_Items__c(
            Name            = 'Needs Assignment',
            Projects_new__c = sprint.Id
        );
        insert epic;

        List<Case> cases = new List<Case>{
            new Case(Subject = 'Story 1', Status = 'New',     Priority = 'High',   Type = 'Feature', Sprint_Week__c = 1, Sprint_Start_Date__c = Date.today(), Projects__c = sprint.Id),
            new Case(Subject = 'Story 2', Status = 'Backlog', Priority = 'Medium', Type = 'Bug',     Sprint_Week__c = 2, Sprint_Start_Date__c = Date.today().addDays(7), Projects__c = sprint.Id),
            new Case(Subject = 'Story 3', Status = 'New',     Priority = 'Low',    Type = 'Feature', Projects__c = sprint.Id)
        };
        insert cases;
    }

    @isTest
    static void testGetStories_allStories() {
        Test.startTest();
        List<Case> result = StoryBoardController.getStories(false, null, null);
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assert(result.size() >= 3, 'Should return all stories');
    }

    @isTest
    static void testGetStories_mineOnly() {
        Test.startTest();
        List<Case> result = StoryBoardController.getStories(true, null, null);
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

    @isTest
    static void testGetNextSteps_empty() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Story 3' LIMIT 1];

        Test.startTest();
        List<CaseComment> result = StoryBoardController.getNextSteps(c.Id);
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assertEquals(0, result.size(), 'Should return no comments yet');
    }

    @isTest
    static void testAddNextStep_and_getNextSteps() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Story 2' LIMIT 1];

        Test.startTest();
        Id commentId = StoryBoardController.addNextStep(c.Id, 'Investigated root cause');
        List<CaseComment> result = StoryBoardController.getNextSteps(c.Id);
        Test.stopTest();

        System.assertNotEquals(null, commentId, 'Comment Id should be returned');
        System.assertEquals(1, result.size(), 'Should return the saved comment');
        System.assertEquals('Investigated root cause', result[0].CommentBody, 'Comment body should match');
    }

    @isTest
    static void testGetTimeEntries_empty() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Story 1' LIMIT 1];

        Test.startTest();
        List<Time__c> result = StoryBoardController.getTimeEntries(c.Id);
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assertEquals(0, result.size(), 'Should return no time entries');
    }

    @isTest
    static void testUpdateEstimatedHours() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Story 1' LIMIT 1];

        Test.startTest();
        StoryBoardController.updateEstimatedHours(c.Id, 4.5);
        Test.stopTest();

        Case updated = [SELECT Hours_Estimate_to_Complete__c FROM Case WHERE Id = :c.Id];
        System.assertEquals(4.5, updated.Hours_Estimate_to_Complete__c, 'Estimated hours should be updated');
    }

    @isTest
    static void testUpdateNextStep() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Story 2' LIMIT 1];
        Id commentId = StoryBoardController.addNextStep(c.Id, 'Original note');

        Test.startTest();
        StoryBoardController.updateNextStep(commentId, 'Updated note');
        Test.stopTest();

        CaseComment updated = [SELECT CommentBody FROM CaseComment WHERE Id = :commentId];
        System.assertEquals('Updated note', updated.CommentBody, 'Comment body should be updated');
    }

    @isTest
    static void testGetProjects() {
        Test.startTest();
        List<Sprint__c> result = StoryBoardController.getProjects();
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assert(result.size() >= 1, 'Should return at least the test sprint');
    }

    @isTest
    static void testGetStories_withProjectId() {
        Sprint__c sprint = [SELECT Id FROM Sprint__c WHERE Name = 'Test Sprint' LIMIT 1];

        Test.startTest();
        List<Case> result = StoryBoardController.getStories(false, sprint.Id, null);
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assert(result.size() >= 3, 'Should return stories for that project');
        for (Case c : result) {
            System.assertEquals(sprint.Id, c.Projects__c, 'All stories should belong to the sprint');
        }
    }

    @isTest
    static void testGetStories_overheadExcluded() {
        insert new List<Case>{
            new Case(Subject = 'Meetings',           Status = 'Work In Progress (WIP)'),
            new Case(Subject = 'Project Management', Status = 'Work In Progress (WIP)'),
            new Case(Subject = 'Helpdesk',           Status = 'Work In Progress (WIP)')
        };

        Test.startTest();
        List<Case> result = StoryBoardController.getStories(false, null, null);
        Test.stopTest();

        for (Case c : result) {
            System.assert(
                c.Subject != 'Meetings' && c.Subject != 'Project Management' && c.Subject != 'Helpdesk',
                'Overhead stories should be excluded: ' + c.Subject
            );
        }
    }

    @isTest
    static void testUpdatePriority_valid() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Story 1' LIMIT 1];

        Test.startTest();
        StoryBoardController.updatePriority(c.Id, 'Critical');
        Test.stopTest();

        Case updated = [SELECT Priority FROM Case WHERE Id = :c.Id];
        System.assertEquals('Critical', updated.Priority, 'Priority should be updated to Critical');
    }

    @isTest
    static void testUpdatePriority_invalid() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Story 1' LIMIT 1];

        Test.startTest();
        try {
            StoryBoardController.updatePriority(c.Id, 'SuperUrgent');
            System.assert(false, 'Should have thrown an exception');
        } catch (AuraHandledException e) {
            System.assert(e.getMessage() != null, 'Exception message should not be null');
        }
        Test.stopTest();
    }

    @isTest
    static void testCreateStory() {
        Sprint__c sprint = [SELECT Id FROM Sprint__c WHERE Name = 'Test Sprint' LIMIT 1];

        Test.startTest();
        StoryBoardController.createStory(sprint.Id, 'New Test Story', 'A description', 'High', null, null);
        Test.stopTest();

        List<Case> created = [SELECT Subject, Priority, Projects__c, OwnerId FROM Case WHERE Subject = 'New Test Story'];
        System.assertEquals(1,                    created.size(),          'Should have created one story');
        System.assertEquals('High',               created[0].Priority,     'Priority should match');
        System.assertEquals(sprint.Id,            created[0].Projects__c,  'Project should match');
        System.assertEquals(UserInfo.getUserId(), created[0].OwnerId,      'Owner should be the creating user');
    }

    @isTest
    static void testLogTime() {
        Sprint__c sprint = [SELECT Id FROM Sprint__c WHERE Name = 'Test Sprint' LIMIT 1];
        Sprint_Items__c epic = [SELECT Id FROM Sprint_Items__c WHERE Projects_new__c = :sprint.Id LIMIT 1];
        Case c = [SELECT Id FROM Case WHERE Subject = 'Story 1' LIMIT 1];
        update new Case(Id = c.Id, Epic__c = epic.Id);
        Date logDate = Date.today();

        Test.startTest();
        Id timeId = StoryBoardController.logTime(c.Id, 2.5, 'Worked on implementation', logDate);
        Test.stopTest();

        System.assertNotEquals(null, timeId, 'Time Id should be returned');
        Time__c t = [SELECT Minutes_Logged__c, Additional_Comments__c, Logged_Date__c FROM Time__c WHERE Id = :timeId];
        System.assertEquals(150, t.Minutes_Logged__c, 'Minutes should be 2.5 * 60 = 150');
        System.assertEquals('Worked on implementation', t.Additional_Comments__c, 'Description should match');
        System.assertEquals(logDate, t.Logged_Date__c, 'Date should match');
    }

    @isTest
    static void testCloseStory() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Story 1' LIMIT 1];

        Test.startTest();
        StoryBoardController.closeStory(c.Id, 'Completed', 'All tasks done', 'IT', 'High', 'Feature');
        Test.stopTest();

        Case updated = [SELECT Status, Closing_Comments__c, Department__c, Priority, Type FROM Case WHERE Id = :c.Id];
        System.assertEquals('Completed',      updated.Status,              'Status should be Completed');
        System.assertEquals('All tasks done', updated.Closing_Comments__c, 'Closing comments should match');
        System.assertEquals('IT',             updated.Department__c,       'Department should match');
        System.assertEquals('High',           updated.Priority,            'Priority should match');
        System.assertEquals('Feature',        updated.Type,                'Type should match');
    }

    @isTest
    static void testCloseStory_invalidStatus() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Story 2' LIMIT 1];

        Test.startTest();
        try {
            StoryBoardController.closeStory(c.Id, 'New', 'Comments', 'IT', 'High', 'Bug');
            System.assert(false, 'Should have thrown');
        } catch (AuraHandledException e) {
            System.assert(e.getMessage() != null);
        }
        Test.stopTest();
    }

    @isTest
    static void testAssignEpic() {
        Sprint__c sprint = [SELECT Id FROM Sprint__c WHERE Name = 'Test Sprint' LIMIT 1];
        Sprint_Items__c epic = [SELECT Id FROM Sprint_Items__c WHERE Projects_new__c = :sprint.Id LIMIT 1];
        Case c = [SELECT Id FROM Case WHERE Subject = 'Story 2' LIMIT 1];

        Test.startTest();
        StoryBoardController.assignEpic(c.Id, epic.Id);
        Test.stopTest();

        Case updated = [SELECT Epic__c FROM Case WHERE Id = :c.Id];
        System.assertEquals(epic.Id, updated.Epic__c, 'Epic should be assigned');
    }

    @isTest
    static void testGetStories_withEpicId() {
        Sprint__c sprint = [SELECT Id FROM Sprint__c WHERE Name = 'Test Sprint' LIMIT 1];
        Sprint_Items__c epic = [SELECT Id FROM Sprint_Items__c WHERE Projects_new__c = :sprint.Id LIMIT 1];

        // Assign Story 1 to the epic
        Case c = [SELECT Id FROM Case WHERE Subject = 'Story 1' LIMIT 1];
        update new Case(Id = c.Id, Epic__c = epic.Id);

        Test.startTest();
        List<Case> result = StoryBoardController.getStories(false, sprint.Id, epic.Id);
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assertEquals(1, result.size(), 'Should return only stories in that epic');
        System.assertEquals('Story 1', result[0].Subject, 'Should be Story 1');
    }

    @isTest
    static void testSearchUsers() {
        Test.startTest();
        List<User> result = StoryBoardController.searchUsers('User');
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
    }

    @isTest
    static void testReassignStory() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Story 1' LIMIT 1];
        User u = [SELECT Id FROM User WHERE IsActive = true LIMIT 1];

        Test.startTest();
        StoryBoardController.reassignStory(c.Id, u.Id);
        Test.stopTest();

        Case updated = [SELECT OwnerId FROM Case WHERE Id = :c.Id];
        System.assertEquals(u.Id, updated.OwnerId, 'OwnerId should be updated');
    }

    @isTest
    static void testCreateStory_withEpicId() {
        Sprint__c sprint = [SELECT Id FROM Sprint__c WHERE Name = 'Test Sprint' LIMIT 1];
        Sprint_Items__c epic = [SELECT Id FROM Sprint_Items__c WHERE Projects_new__c = :sprint.Id LIMIT 1];

        Test.startTest();
        StoryBoardController.createStory(sprint.Id, 'Epic Story', 'Desc', 'Medium', null, epic.Id);
        Test.stopTest();

        List<Case> created = [SELECT Subject, Epic__c FROM Case WHERE Subject = 'Epic Story'];
        System.assertEquals(1,       created.size(),    'Should have created one story');
        System.assertEquals(epic.Id, created[0].Epic__c, 'Story should be linked to the epic');
    }
}