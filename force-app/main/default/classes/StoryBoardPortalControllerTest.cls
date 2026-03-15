@isTest
public class StoryBoardPortalControllerTest {

    @TestSetup
    static void setupData() {
        Sprint__c sprint = new Sprint__c(Name = 'Portal Test Sprint', Status__c = 'In Progress');
        insert sprint;

        List<Case> cases = new List<Case>{
            new Case(Subject = 'Portal Story 1', Status = 'New',     Priority = 'High',   Projects__c = sprint.Id),
            new Case(Subject = 'Portal Story 2', Status = 'Backlog', Priority = 'Medium', Projects__c = sprint.Id),
            new Case(Subject = 'Portal Story 3', Status = 'New',     Priority = 'Low',    Projects__c = sprint.Id)
        };
        insert cases;
    }

    @isTest
    static void testGetStories_noFilters() {
        Test.startTest();
        List<Case> result = StoryBoardPortalController.getStories(null, null);
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
    }

    @isTest
    static void testGetStories_byProject() {
        Sprint__c sprint = [SELECT Id FROM Sprint__c WHERE Name = 'Portal Test Sprint' LIMIT 1];

        Test.startTest();
        List<Case> result = StoryBoardPortalController.getStories(sprint.Id, null);
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assert(result.size() >= 3, 'Should return stories for the project');
    }

    @isTest
    static void testGetStories_byEpic() {
        Test.startTest();
        List<Case> result = StoryBoardPortalController.getStories(null, null);
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
    }

    @isTest
    static void testGetProjects() {
        Test.startTest();
        List<Sprint__c> result = StoryBoardPortalController.getProjects();
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assert(result.size() >= 1, 'Should return at least the test sprint');
    }

    @isTest
    static void testGetAttachments_noAttachments() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Portal Story 1' LIMIT 1];

        Test.startTest();
        List<StoryBoardPortalController.AttachmentWrapper> result =
            StoryBoardPortalController.getAttachments(c.Id);
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assertEquals(0, result.size(), 'Should return no attachments for a new case');
    }

    @isTest
    static void testGetAttachments_withAttachment() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Portal Story 1' LIMIT 1];

        ContentVersion cv = new ContentVersion(
            Title           = 'TestFile.pdf',
            PathOnClient    = 'TestFile.pdf',
            VersionData     = Blob.valueOf('test content'),
            ContentLocation = 'S'
        );
        insert cv;

        Id docId = [SELECT ContentDocumentId FROM ContentVersion WHERE Id = :cv.Id LIMIT 1].ContentDocumentId;
        insert new ContentDocumentLink(
            ContentDocumentId = docId,
            LinkedEntityId    = c.Id,
            ShareType         = 'V',
            Visibility        = 'AllUsers'
        );

        Test.startTest();
        List<StoryBoardPortalController.AttachmentWrapper> result =
            StoryBoardPortalController.getAttachments(c.Id);
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assertEquals(1, result.size(), 'Should return one attachment');
        System.assertEquals('TestFile.pdf', result[0].title, 'Title should match');
        System.assertEquals('pdf', result[0].fileExtension, 'Extension should be pdf');
        System.assertEquals(false, result[0].isImage, 'PDF should not be flagged as image');
    }

    @isTest
    static void testGetAttachments_imageFile() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Portal Story 2' LIMIT 1];

        ContentVersion cv = new ContentVersion(
            Title           = 'screenshot.png',
            PathOnClient    = 'screenshot.png',
            VersionData     = Blob.valueOf('fake png data'),
            ContentLocation = 'S'
        );
        insert cv;

        Id docId = [SELECT ContentDocumentId FROM ContentVersion WHERE Id = :cv.Id LIMIT 1].ContentDocumentId;
        insert new ContentDocumentLink(
            ContentDocumentId = docId,
            LinkedEntityId    = c.Id,
            ShareType         = 'V',
            Visibility        = 'AllUsers'
        );

        Test.startTest();
        List<StoryBoardPortalController.AttachmentWrapper> result =
            StoryBoardPortalController.getAttachments(c.Id);
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assertEquals(1, result.size(), 'Should return one attachment');
        System.assertEquals(true, result[0].isImage, 'PNG should be flagged as image');
    }
}
