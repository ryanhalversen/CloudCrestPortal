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
        List<ContractorBoardController.StoryWrapper> stories = ContractorBoardController.getStories(null);
        Test.stopTest();
        System.assertNotEquals(null, stories, 'Should return a list');
    }

    @IsTest
    static void testGetStories_byProject() {
        Map<String, Object> data = createTestData();
        Sprint__c proj = (Sprint__c) data.get('proj');
        Test.startTest();
        List<ContractorBoardController.StoryWrapper> stories = ContractorBoardController.getStories(proj.Id);
        Test.stopTest();
        // Running user owns the story, so should appear
        System.assertEquals(1, stories.size(), 'Should return story for project');
        System.assertNotEquals(null, stories[0].ownerName, 'ownerName should be populated');
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

    // ── Update / Close Tests ──────────────────────────────────────────────────

    @IsTest
    static void testUpdateStoryStatus() {
        Map<String, Object> data = createTestData();
        Case story = (Case) data.get('story');
        Test.startTest();
        ContractorBoardController.updateStoryStatus(story.Id, 'In Progress');
        Test.stopTest();
        Case updated = [SELECT Status FROM Case WHERE Id = :story.Id];
        System.assertEquals('In Progress', updated.Status, 'Status should be updated');
    }

    @IsTest
    static void testUpdatePriority() {
        Map<String, Object> data = createTestData();
        Case story = (Case) data.get('story');
        Test.startTest();
        ContractorBoardController.updatePriority(story.Id, 'Critical');
        Test.stopTest();
        Case updated = [SELECT Priority FROM Case WHERE Id = :story.Id];
        System.assertEquals('Critical', updated.Priority, 'Priority should be updated');
    }

    @IsTest
    static void testUpdatePriority_invalidThrows() {
        Map<String, Object> data = createTestData();
        Case story = (Case) data.get('story');
        Boolean threw = false;
        Test.startTest();
        try {
            ContractorBoardController.updatePriority(story.Id, 'NotValid');
        } catch (AuraHandledException e) {
            threw = true;
        }
        Test.stopTest();
        System.assert(threw, 'Should throw for invalid priority');
    }

    @IsTest
    static void testUpdateStoryType() {
        Map<String, Object> data = createTestData();
        Case story = (Case) data.get('story');
        Test.startTest();
        ContractorBoardController.updateStoryType(story.Id, 'Bug');
        Test.stopTest();
        Case updated = [SELECT Type FROM Case WHERE Id = :story.Id];
        System.assertEquals('Bug', updated.Type, 'Type should be updated');
    }

    @IsTest
    static void testUpdateEstimatedHours() {
        Map<String, Object> data = createTestData();
        Case story = (Case) data.get('story');
        Test.startTest();
        ContractorBoardController.updateEstimatedHours(story.Id, 4.5);
        Test.stopTest();
        Case updated = [SELECT Hours_Estimate_to_Complete__c FROM Case WHERE Id = :story.Id];
        System.assertEquals(4.5, updated.Hours_Estimate_to_Complete__c, 'Est hours should be updated');
    }

    @IsTest
    static void testUpdateStoryDescription() {
        Map<String, Object> data = createTestData();
        Case story = (Case) data.get('story');
        Test.startTest();
        ContractorBoardController.updateStoryDescription(story.Id, 'Updated description');
        Test.stopTest();
        Case updated = [SELECT Description FROM Case WHERE Id = :story.Id];
        System.assertEquals('Updated description', updated.Description, 'Description should be updated');
    }

    @IsTest
    static void testUpdateStoryTextFields() {
        Map<String, Object> data = createTestData();
        Case story = (Case) data.get('story');
        Test.startTest();
        ContractorBoardController.updateStoryTextFields(
            story.Id, 'Solution text', 'Deploy components', 'QA steps', 'Docs here'
        );
        Test.stopTest();
        Case updated = [SELECT Solution__c, Components_to_Deploy__c, Q_A__c, Documentation__c FROM Case WHERE Id = :story.Id];
        System.assertEquals('Solution text', updated.Solution__c, 'Solution should be updated');
        System.assertEquals('Deploy components', updated.Components_to_Deploy__c, 'Components should be updated');
    }

    @IsTest
    static void testCloseStory() {
        Map<String, Object> data = createTestData();
        Case story = (Case) data.get('story');
        Test.startTest();
        ContractorBoardController.closeStory(story.Id, 'Completed', 'All done', 'IT', 'High', 'Feature');
        Test.stopTest();
        Case updated = [SELECT Status, Closing_Comments__c FROM Case WHERE Id = :story.Id];
        System.assertEquals('Completed', updated.Status, 'Status should be Completed');
        System.assertEquals('All done', updated.Closing_Comments__c, 'Closing comments should be set');
    }

    @IsTest
    static void testCloseStory_invalidStatusThrows() {
        Map<String, Object> data = createTestData();
        Case story = (Case) data.get('story');
        Boolean threw = false;
        Test.startTest();
        try {
            ContractorBoardController.closeStory(story.Id, 'BadStatus', null, null, null, null);
        } catch (AuraHandledException e) {
            threw = true;
        }
        Test.stopTest();
        System.assert(threw, 'Should throw for invalid close status');
    }

    @IsTest
    static void testUpdateTimeEntry() {
        Map<String, Object> data = createTestData();
        Time__c te = (Time__c) data.get('te');
        Test.startTest();
        ContractorBoardController.updateTimeEntry(te.Id, 3.0, 'Updated notes');
        Test.stopTest();
        Time__c updated = [SELECT Minutes_Logged__c, Additional_Comments__c FROM Time__c WHERE Id = :te.Id];
        System.assertEquals(180, updated.Minutes_Logged__c, '3h = 180 min');
        System.assertEquals('Updated notes', updated.Additional_Comments__c, 'Notes should be updated');
    }

    @IsTest
    static void testUpdateNextStep() {
        Map<String, Object> data = createTestData();
        Case story = (Case) data.get('story');
        CaseComment cc = [SELECT Id FROM CaseComment WHERE ParentId = :story.Id LIMIT 1];
        Test.startTest();
        ContractorBoardController.updateNextStep(cc.Id, 'Updated step text');
        Test.stopTest();
        CaseComment updated = [SELECT CommentBody FROM CaseComment WHERE Id = :cc.Id];
        System.assertEquals('Updated step text', updated.CommentBody, 'Comment should be updated');
    }

    @IsTest
    static void testDeleteAttachment() {
        Map<String, Object> data = createTestData();
        Case story = (Case) data.get('story');
        String b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        String docId = ContractorBoardController.uploadAttachment(story.Id, 'del.png', b64, 'image/png');
        Test.startTest();
        ContractorBoardController.deleteAttachment(docId);
        Test.stopTest();
        List<ContentDocument> docs = [SELECT Id FROM ContentDocument WHERE Id = :docId];
        System.assertEquals(0, docs.size(), 'Document should be deleted');
    }

    @IsTest
    static void testAssignContact() {
        Map<String, Object> data = createTestData();
        Case story = (Case) data.get('story');
        // Create a contact to assign
        Account acc = new Account(Name = 'Test Account');
        insert acc;
        Contact con = new Contact(FirstName = 'Test', LastName = 'Contact', AccountId = acc.Id);
        insert con;
        Test.startTest();
        ContractorBoardController.assignContact(story.Id, con.Id);
        Test.stopTest();
        Case updated = [SELECT ContactId FROM Case WHERE Id = :story.Id];
        System.assertEquals(con.Id, updated.ContactId, 'Contact should be assigned');
    }

    @IsTest
    static void testAssignContact_remove() {
        Map<String, Object> data = createTestData();
        Case story = (Case) data.get('story');
        Test.startTest();
        ContractorBoardController.assignContact(story.Id, null);
        Test.stopTest();
        Case updated = [SELECT ContactId FROM Case WHERE Id = :story.Id];
        System.assertEquals(null, updated.ContactId, 'Contact should be cleared');
    }

    @IsTest
    static void testGetContactsForProject() {
        Map<String, Object> data = createTestData();
        Sprint__c proj = (Sprint__c) data.get('proj');
        Test.startTest();
        List<Contact> contacts = ContractorBoardController.getContactsForProject(proj.Id);
        Test.stopTest();
        // Project has no account so returns empty
        System.assertNotEquals(null, contacts, 'Should return a list');
    }

    @IsTest
    static void testGetContactsForProject_blank() {
        Test.startTest();
        List<Contact> contacts = ContractorBoardController.getContactsForProject('');
        Test.stopTest();
        System.assertEquals(0, contacts.size(), 'Should return empty list for blank project');
    }

    // ── Timer Tests ───────────────────────────────────────────────────────────

    @IsTest
    static void testGetActiveTimer_none() {
        Test.startTest();
        ContractorBoardController.TimerWrapper tw = ContractorBoardController.getActiveTimer();
        Test.stopTest();
        System.assertEquals(null, tw, 'Should return null when no active timer');
    }

    @IsTest
    static void testStartAndStopTimer() {
        Map<String, Object> data = createTestData();
        Case story = (Case) data.get('story');
        Test.startTest();
        ContractorBoardController.StartTimerResult result = ContractorBoardController.startTimer(story.Id);
        System.assertNotEquals(null, result.newTimeId, 'Should return new timer ID');
        ContractorBoardController.TimerWrapper active = ContractorBoardController.getActiveTimer();
        System.assertNotEquals(null, active, 'Should have active timer');
        ContractorBoardController.stopTimer(result.newTimeId, 'Done working');
        Test.stopTest();
        Time__c stopped = [SELECT Active__c FROM Time__c WHERE Id = :result.newTimeId];
        System.assertEquals(false, stopped.Active__c, 'Timer should be inactive after stop');
    }

    @IsTest
    static void testStartTimer_autoStopsPrevious() {
        Map<String, Object> data = createTestData();
        Case story = (Case) data.get('story');
        Test.startTest();
        ContractorBoardController.StartTimerResult r1 = ContractorBoardController.startTimer(story.Id);
        ContractorBoardController.StartTimerResult r2 = ContractorBoardController.startTimer(story.Id);
        Test.stopTest();
        // First timer should be stopped
        Time__c first = [SELECT Active__c FROM Time__c WHERE Id = :r1.newTimeId];
        System.assertEquals(false, first.Active__c, 'First timer should have been stopped');
        System.assertNotEquals(null, r2.stoppedTimeId, 'Second start should report stopped timer');
    }

    @IsTest
    static void testDiscardTimer() {
        Map<String, Object> data = createTestData();
        Case story = (Case) data.get('story');
        Test.startTest();
        ContractorBoardController.StartTimerResult result = ContractorBoardController.startTimer(story.Id);
        ContractorBoardController.discardTimer(result.newTimeId);
        Test.stopTest();
        Time__c discarded = [SELECT Active__c, Minutes_Logged__c FROM Time__c WHERE Id = :result.newTimeId];
        System.assertEquals(false, discarded.Active__c, 'Discarded timer should be inactive');
        System.assertEquals(0, discarded.Minutes_Logged__c, 'Discarded timer should have 0 minutes');
    }

    @IsTest
    static void testLogTimerSession() {
        Map<String, Object> data = createTestData();
        Case story = (Case) data.get('story');
        Sprint_Items__c epic = (Sprint_Items__c) data.get('epic');
        Long startMs = System.now().getTime() - 3600000; // 1 hour ago
        Long stopMs  = System.now().getTime();
        Test.startTest();
        ContractorBoardController.logTimerSession(story.Id, epic.Id, startMs, stopMs, 'Timer notes');
        Test.stopTest();
        List<Time__c> entries = [SELECT Minutes_Logged__c FROM Time__c WHERE Case__c = :story.Id AND Active__c = false AND Minutes_Logged__c > 50];
        System.assertNotEquals(0, entries.size(), 'Should have logged timer session');
    }
}
