// force-app/main/default/classes/ContractorBoardControllerTest.cls
@IsTest
private class ContractorBoardControllerTest {

    // ── Test Data Factory ─────────────────────────────────────────────────────

    private static Map<String, Object> createTestData() {
        // Project (Sprint__c)
        Sprint__c proj = new Sprint__c(Name = 'Test Project', Status__c = 'In Progress');
        insert proj;

        // Epic (Sprint_Items__c)
        Sprint_Items__c epic = new Sprint_Items__c(
            Name            = 'Test Epic',
            Projects_new__c = proj.Id
        );
        insert epic;

        // Story (Case)
        Case story = new Case(
            Subject     = 'Test Story',
            Description = 'Test description',
            Status      = 'New',
            Priority    = 'Medium',
            Projects__c = proj.Id,
            Epic__c     = epic.Id
        );
        insert story;

        // Time entry
        Time__c te = new Time__c(
            Case__c                = story.Id,
            Epic__c                = epic.Id,
            Minutes_Logged__c      = 120,
            Additional_Comments__c = 'Initial work',
            Logged_Date__c         = Date.today()
        );
        insert te;

        // Next step (CaseComment)
        CaseComment cc = new CaseComment(
            ParentId    = story.Id,
            CommentBody = 'First next step',
            IsPublished = false
        );
        insert cc;

        return new Map<String, Object>{
            'proj'  => proj,
            'epic'  => epic,
            'story' => story,
            'te'    => te
        };
    }

    // ── Read Tests ────────────────────────────────────────────────────────────

    @IsTest
    static void testGetProjectsForUser() {
        createTestData();
        Test.startTest();
        List<Sprint__c> projects = ContractorBoardController.getProjectsForUser();
        Test.stopTest();
        // Running user owns the test story so should see its project
        System.assertNotEquals(0, projects.size(), 'Should return project for this user');
    }

    @IsTest
    static void testGetProjectsForUser_noStories() {
        // No data — user has no stories
        Test.startTest();
        List<Sprint__c> projects = ContractorBoardController.getProjectsForUser();
        Test.stopTest();
        System.assertEquals(0, projects.size(), 'Should return empty list');
    }

    @IsTest
    static void testGetStories_all() {
        createTestData();
        Test.startTest();
        List<Case> stories = ContractorBoardController.getStories(null);
        Test.stopTest();
        System.assertNotEquals(null, stories, 'Should return a list');
    }

    @IsTest
    static void testGetStories_byProject() {
        Map<String, Object> data = createTestData();
        Sprint__c proj = (Sprint__c) data.get('proj');
        Test.startTest();
        List<Case> stories = ContractorBoardController.getStories(proj.Id);
        Test.stopTest();
        // Running user owns the story, so should appear
        System.assertEquals(1, stories.size(), 'Should return story for project');
    }

    @IsTest
    static void testGetTimeEntries() {
        Map<String, Object> data = createTestData();
        Case story = (Case) data.get('story');
        Test.startTest();
        List<Time__c> entries = ContractorBoardController.getTimeEntries(story.Id);
        Test.stopTest();
        System.assertEquals(1, entries.size(), 'Should return one time entry');
        System.assertEquals(120, entries[0].Minutes_Logged__c, 'Minutes should match');
    }

    @IsTest
    static void testGetNextSteps() {
        Map<String, Object> data = createTestData();
        Case story = (Case) data.get('story');
        Test.startTest();
        List<CaseComment> steps = ContractorBoardController.getNextSteps(story.Id);
        Test.stopTest();
        System.assertEquals(1, steps.size(), 'Should return one next step');
    }

    @IsTest
    static void testGetChatMessages() {
        Map<String, Object> data = createTestData();
        Case story = (Case) data.get('story');
        FeedItem fi = new FeedItem(ParentId = story.Id, Body = 'Hello team', Type = 'TextPost');
        insert fi;
        Test.startTest();
        List<ContractorBoardController.ChatMessageWrapper> msgs =
            ContractorBoardController.getChatMessages(story.Id);
        Test.stopTest();
        System.assertNotEquals(0, msgs.size(), 'Should return chat message');
        System.assertEquals('Hello team', msgs[0].body, 'Body should match');
        System.assert(msgs[0].isMine, 'Running user authored the message');
    }

    @IsTest
    static void testGetAttachments_empty() {
        Map<String, Object> data = createTestData();
        Case story = (Case) data.get('story');
        Test.startTest();
        List<ContractorBoardController.AttachmentWrapper> atts =
            ContractorBoardController.getAttachments(story.Id);
        Test.stopTest();
        System.assertEquals(0, atts.size(), 'Should return empty list');
    }

    @IsTest
    static void testSearchUsers() {
        createTestData();
        Test.startTest();
        List<ContractorBoardController.UserOption> users =
            ContractorBoardController.searchUsers('Admin');
        Test.stopTest();
        System.assertNotEquals(null, users, 'Should return a list');
    }

    // ── Write Tests ───────────────────────────────────────────────────────────

    @IsTest
    static void testPostChatMessage() {
        Map<String, Object> data = createTestData();
        Case story = (Case) data.get('story');
        Test.startTest();
        ContractorBoardController.postChatMessage(story.Id, 'Test message');
        Test.stopTest();
        List<FeedItem> feeds = [
            SELECT Id FROM FeedItem WHERE ParentId = :story.Id AND Type = 'TextPost'
        ];
        System.assertEquals(1, feeds.size(), 'Feed item should be created');
    }

    @IsTest
    static void testPostChatMessage_blankThrows() {
        Map<String, Object> data = createTestData();
        Case story = (Case) data.get('story');
        Boolean threw = false;
        Test.startTest();
        try {
            ContractorBoardController.postChatMessage(story.Id, '');
        } catch (AuraHandledException e) {
            threw = true;
        }
        Test.stopTest();
        System.assert(threw, 'Should throw for blank message');
    }

    @IsTest
    static void testLogTime() {
        Map<String, Object> data = createTestData();
        Case story = (Case) data.get('story');
        Test.startTest();
        ContractorBoardController.logTime(story.Id, 2.5, 'Worked on review');
        Test.stopTest();
        List<Time__c> newEntries = [
            SELECT Minutes_Logged__c FROM Time__c
            WHERE Case__c = :story.Id AND Minutes_Logged__c = 150
        ];
        System.assertEquals(1, newEntries.size(), '2.5h = 150 min record should exist');
    }

    @IsTest
    static void testLogTime_zeroThrows() {
        Map<String, Object> data = createTestData();
        Case story = (Case) data.get('story');
        Boolean threw = false;
        Test.startTest();
        try {
            ContractorBoardController.logTime(story.Id, 0, 'Bad');
        } catch (AuraHandledException e) {
            threw = true;
        }
        Test.stopTest();
        System.assert(threw, 'Should throw for zero hours');
    }

    @IsTest
    static void testAddNextStep() {
        Map<String, Object> data = createTestData();
        Case story = (Case) data.get('story');
        Test.startTest();
        ContractorBoardController.addNextStep(story.Id, 'New step here');
        Test.stopTest();
        List<CaseComment> steps = [
            SELECT CommentBody FROM CaseComment WHERE ParentId = :story.Id
        ];
        System.assertEquals(2, steps.size(), 'Should have two next steps');
    }

    @IsTest
    static void testAddNextStep_blankThrows() {
        Map<String, Object> data = createTestData();
        Case story = (Case) data.get('story');
        Boolean threw = false;
        Test.startTest();
        try {
            ContractorBoardController.addNextStep(story.Id, '   ');
        } catch (AuraHandledException e) {
            threw = true;
        }
        Test.stopTest();
        System.assert(threw, 'Should throw for blank text');
    }

    @IsTest
    static void testCreateStory() {
        Map<String, Object> data = createTestData();
        Sprint__c proj = (Sprint__c) data.get('proj');
        Test.startTest();
        String caseNum = ContractorBoardController.createStory(
            'New Contractor Story', 'Details here', 'High', proj.Id, 'Bug'
        );
        Test.stopTest();
        System.assertNotEquals(null, caseNum, 'Should return a case number');
        List<Case> cases = [SELECT Subject, Priority FROM Case WHERE CaseNumber = :caseNum];
        System.assertEquals(1, cases.size(), 'Case should be created');
        System.assertEquals('High', cases[0].Priority, 'Priority should match');
    }

    @IsTest
    static void testCreateStory_noSubjectThrows() {
        Boolean threw = false;
        Test.startTest();
        try {
            ContractorBoardController.createStory('', 'desc', 'Low', null, null);
        } catch (AuraHandledException e) {
            threw = true;
        }
        Test.stopTest();
        System.assert(threw, 'Should throw when subject is blank');
    }

    @IsTest
    static void testUploadAttachment() {
        Map<String, Object> data = createTestData();
        Case story = (Case) data.get('story');
        // Minimal valid 1x1 PNG in base64
        String b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        Test.startTest();
        String docId = ContractorBoardController.uploadAttachment(
            story.Id, 'test.png', b64, 'image/png'
        );
        Test.stopTest();
        System.assertNotEquals(null, docId, 'Should return document ID');
        List<ContentDocumentLink> links = [
            SELECT Id FROM ContentDocumentLink
            WHERE LinkedEntityId = :story.Id AND ContentDocumentId = :docId
        ];
        System.assertEquals(1, links.size(), 'Link should be created');
    }

    @IsTest
    static void testUploadAttachment_blankThrows() {
        Map<String, Object> data = createTestData();
        Case story = (Case) data.get('story');
        Boolean threw = false;
        Test.startTest();
        try {
            ContractorBoardController.uploadAttachment(story.Id, 'f.txt', '', 'text/plain');
        } catch (AuraHandledException e) {
            threw = true;
        }
        Test.stopTest();
        System.assert(threw, 'Should throw for blank base64');
    }
}
