@isTest
private class OutpostDevelopmentControllerTest {

    // ── Test data factory ─────────────────────────────────────────────────

    private static User createSupportUser() {
        Profile p = [SELECT Id FROM Profile WHERE Name = 'Standard User' LIMIT 1];
        User supportUser = new User(
            FirstName          = 'Support',
            LastName           = 'TestUser',
            Email              = 'outpost.support.test@example.com',
            Username           = 'outpost.support.test@example.com.outposttest' + System.currentTimeMillis(),
            Alias              = 'opsuppt',
            TimeZoneSidKey     = 'America/New_York',
            LocaleSidKey       = 'en_US',
            EmailEncodingKey   = 'UTF-8',
            LanguageLocaleKey  = 'en_US',
            ProfileId          = p.Id
        );
        insert supportUser;
        return supportUser;
    }

    private static Map<String, Object> createTestData() {
        Sprint__c sprint = new Sprint__c(Name = 'Outpost Test Sprint', Status__c = 'In Progress');
        insert sprint;

        Sprint_Items__c epic = new Sprint_Items__c(
            Name            = 'Outpost Test Epic',
            Projects_new__c = sprint.Id
        );
        insert epic;

        User supportUser = createSupportUser();

        Case ownerStory = new Case(
            Subject          = 'Owner Story for Outpost',
            Status           = 'Scheduled',
            Priority         = 'High',
            Projects__c      = sprint.Id,
            Story_Support__c = supportUser.Id,
            Epic__c          = epic.Id
        );
        Database.DMLOptions dlo = new Database.DMLOptions();
        dlo.assignmentRuleHeader.useDefaultRule = false;
        ownerStory.setOptions(dlo);
        insert ownerStory;

        return new Map<String, Object>{
            'sprint'      => sprint,
            'epic'        => epic,
            'supportUser' => supportUser,
            'ownerStory'  => ownerStory
        };
    }

    // ── getOutpostData ────────────────────────────────────────────────────

    @isTest
    static void testGetOutpostData_noProjectFilter() {
        createTestData();

        Test.startTest();
        OutpostDevelopmentController.OutpostData result =
            OutpostDevelopmentController.getOutpostData(null);
        Test.stopTest();

        System.assertNotEquals(null, result,                'OutpostData should not be null');
        System.assertNotEquals(null, result.ownerStories,   'ownerStories should not be null');
        System.assertNotEquals(null, result.supportStories, 'supportStories should not be null');
        System.assertNotEquals(null, result.projects,       'projects should not be null');
        System.assert(result.isOwner,                       'isOwner should be true after inserting owner story');
    }

    @isTest
    static void testGetOutpostData_withProjectFilter() {
        Map<String, Object> td = createTestData();
        Sprint__c sprint = (Sprint__c) td.get('sprint');

        Test.startTest();
        OutpostDevelopmentController.OutpostData result =
            OutpostDevelopmentController.getOutpostData(sprint.Id);
        Test.stopTest();

        System.assertNotEquals(null, result, 'OutpostData should not be null');
        System.assert(result.ownerStories.size() > 0, 'Should return owner story matching project filter');
    }

    @isTest
    static void testGetOutpostData_projectsListPopulated() {
        createTestData();

        Test.startTest();
        OutpostDevelopmentController.OutpostData result =
            OutpostDevelopmentController.getOutpostData(null);
        Test.stopTest();

        Boolean found = false;
        for (OutpostDevelopmentController.ProjectOption po : result.projects) {
            if (po.label == 'Outpost Test Sprint') { found = true; break; }
        }
        System.assert(found, 'Projects list should include the test sprint');
    }

    @isTest
    static void testGetOutpostData_ownerStoryWrappedCorrectly() {
        Map<String, Object> td = createTestData();
        Case ownerStory = (Case) td.get('ownerStory');

        Test.startTest();
        OutpostDevelopmentController.OutpostData result =
            OutpostDevelopmentController.getOutpostData(null);
        Test.stopTest();

        OutpostDevelopmentController.StoryWrapper match = null;
        for (OutpostDevelopmentController.StoryWrapper w : result.ownerStories) {
            if (w.id == ownerStory.Id) { match = w; break; }
        }
        System.assertNotEquals(null, match,                            'Owner story should appear in ownerStories');
        System.assertEquals('Owner Story for Outpost', match.subject,  'Subject should match');
        System.assertEquals('Scheduled',               match.status,   'Status should match');
        System.assertEquals('High',                    match.priority, 'Priority should match');
        System.assertEquals(0,                         match.hoursLogged,    'hoursLogged should default to 0');
        System.assertEquals(0,                         match.hoursEstimate,  'hoursEstimate should default to 0');
    }

    @isTest
    static void testGetOutpostData_excludedSubjectsFiltered() {
        Sprint__c sprint = new Sprint__c(Name = 'Exclude Test Sprint', Status__c = 'In Progress');
        insert sprint;

        User supportUser = createSupportUser();

        Case excludedCase = new Case(
            Subject          = 'Meetings',
            Status           = 'Scheduled',
            Priority         = 'Low',
            Projects__c      = sprint.Id,
            Story_Support__c = supportUser.Id
        );
        Database.DMLOptions dlo = new Database.DMLOptions();
        dlo.assignmentRuleHeader.useDefaultRule = false;
        excludedCase.setOptions(dlo);
        insert excludedCase;

        Test.startTest();
        OutpostDevelopmentController.OutpostData result =
            OutpostDevelopmentController.getOutpostData(null);
        Test.stopTest();

        for (OutpostDevelopmentController.StoryWrapper w : result.ownerStories) {
            System.assertNotEquals('Meetings', w.subject, '"Meetings" should be excluded from results');
        }
    }

    // ── updateStatus ──────────────────────────────────────────────────────

    @isTest
    static void testUpdateStatus_validStatus() {
        Map<String, Object> td = createTestData();
        Case ownerStory = (Case) td.get('ownerStory');

        Test.startTest();
        OutpostDevelopmentController.updateStatus(ownerStory.Id, 'Work In Progress (WIP)');
        Test.stopTest();

        Case updated = [SELECT Status FROM Case WHERE Id = :ownerStory.Id];
        System.assertEquals('Work In Progress (WIP)', updated.Status, 'Status should be updated');
    }

    @isTest
    static void testUpdateStatus_invalidStatusThrows() {
        Map<String, Object> td = createTestData();
        Case ownerStory = (Case) td.get('ownerStory');

        Boolean threw = false;
        Test.startTest();
        try {
            OutpostDevelopmentController.updateStatus(ownerStory.Id, 'Cancelled');
        } catch (AuraHandledException ex) {
            threw = true;
        }
        Test.stopTest();

        System.assert(threw, 'Should throw AuraHandledException for invalid status');
    }

    @isTest
    static void testUpdateStatus_allValidStatuses() {
        Map<String, Object> td = createTestData();
        Case ownerStory = (Case) td.get('ownerStory');

        List<String> statuses = new List<String>{
            'New', 'Backlog', 'Scheduled', 'Work In Progress (WIP)',
            'Waiting for User', 'On Hold', 'In Review', 'In UAT', 'Blocked', 'Completed'
        };

        Test.startTest();
        for (String s : statuses) {
            OutpostDevelopmentController.updateStatus(ownerStory.Id, s);
        }
        Test.stopTest();

        Case updated = [SELECT Status FROM Case WHERE Id = :ownerStory.Id];
        System.assertEquals('Completed', updated.Status, 'Last status should be Completed');
    }

    // ── logTime ───────────────────────────────────────────────────────────

    @isTest
    static void testLogTime_createsTimeRecord() {
        Map<String, Object> td = createTestData();
        Case ownerStory = (Case) td.get('ownerStory');

        Test.startTest();
        OutpostDevelopmentController.logTime(ownerStory.Id, 90, 'Test log', String.valueOf(Date.today()));
        Test.stopTest();

        List<Time__c> timeRecs = [
            SELECT Minutes_Logged__c, Additional_Comments__c, Logged_Date__c
            FROM Time__c WHERE Case__c = :ownerStory.Id
        ];
        System.assertEquals(1,            timeRecs.size(),                     'One Time record should be created');
        System.assertEquals(90,           timeRecs[0].Minutes_Logged__c,       'Minutes should be 90');
        System.assertEquals('Test log',   timeRecs[0].Additional_Comments__c,  'Notes should match');
        System.assertEquals(Date.today(), timeRecs[0].Logged_Date__c,          'Date should be today');
    }

    @isTest
    static void testLogTime_nullDateDefaultsToToday() {
        Map<String, Object> td = createTestData();
        Case ownerStory = (Case) td.get('ownerStory');

        Test.startTest();
        OutpostDevelopmentController.logTime(ownerStory.Id, 30, 'No date', null);
        Test.stopTest();

        Time__c t = [SELECT Logged_Date__c FROM Time__c WHERE Case__c = :ownerStory.Id LIMIT 1];
        System.assertEquals(Date.today(), t.Logged_Date__c, 'Null date should default to today');
    }

    @isTest
    static void testLogTime_blankDescriptionStoredAsNull() {
        Map<String, Object> td = createTestData();
        Case ownerStory = (Case) td.get('ownerStory');

        Test.startTest();
        OutpostDevelopmentController.logTime(ownerStory.Id, 60, '', null);
        Test.stopTest();

        Time__c t = [SELECT Additional_Comments__c FROM Time__c WHERE Case__c = :ownerStory.Id LIMIT 1];
        System.assertEquals(null, t.Additional_Comments__c, 'Blank notes should store as null');
    }

    // ── postComment ───────────────────────────────────────────────────────

    @isTest
    static void testPostComment_createsCaseComment() {
        Map<String, Object> td = createTestData();
        Case ownerStory = (Case) td.get('ownerStory');

        Test.startTest();
        OutpostDevelopmentController.postComment(ownerStory.Id, 'Hello from outpost');
        Test.stopTest();

        List<CaseComment> comments = [
            SELECT CommentBody, IsPublished
            FROM CaseComment WHERE ParentId = :ownerStory.Id
        ];
        System.assertEquals(1,                    comments.size(),            'One CaseComment should be created');
        System.assertEquals('Hello from outpost', comments[0].CommentBody,   'Comment body should match');
        System.assertEquals(true,                 comments[0].IsPublished,   'Comment should be published');
    }

    // ── getComments ───────────────────────────────────────────────────────

    @isTest
    static void testGetComments_returnsComments() {
        Map<String, Object> td = createTestData();
        Case ownerStory = (Case) td.get('ownerStory');

        insert new CaseComment(ParentId = ownerStory.Id, CommentBody = 'Comment One', IsPublished = true);
        insert new CaseComment(ParentId = ownerStory.Id, CommentBody = 'Comment Two', IsPublished = true);

        Test.startTest();
        List<OutpostDevelopmentController.CommentWrapper> result =
            OutpostDevelopmentController.getComments(ownerStory.Id);
        Test.stopTest();

        System.assertEquals(2,             result.size(),       'Should return 2 comments');
        System.assertEquals('Comment One', result[0].body,      'First comment body should match');
        System.assertNotEquals(null,        result[0].createdDate, 'Created date should be populated');
        // Note: authorName may be null in some test contexts due to platform restrictions on CaseComment.CreatedBy
    }

    @isTest
    static void testGetComments_emptyWhenNoComments() {
        Map<String, Object> td = createTestData();
        Case ownerStory = (Case) td.get('ownerStory');

        Test.startTest();
        List<OutpostDevelopmentController.CommentWrapper> result =
            OutpostDevelopmentController.getComments(ownerStory.Id);
        Test.stopTest();

        System.assertNotEquals(null, result, 'Should return empty list, not null');
        System.assertEquals(0, result.size(), 'Should be empty with no comments');
    }

    // ── postChatMessage ───────────────────────────────────────────────────

    @isTest
    static void testPostChatMessage_createsFeedItem() {
        Map<String, Object> td = createTestData();
        Case ownerStory = (Case) td.get('ownerStory');

        Test.startTest();
        Id result = OutpostDevelopmentController.postChatMessage(ownerStory.Id, 'Hello team');
        Test.stopTest();

        System.assertNotEquals(null, result, 'Should return the FeedItem Id');
        List<FeedItem> items = [SELECT Id, Body FROM FeedItem WHERE Id = :result];
        System.assertEquals(1, items.size(), 'FeedItem should exist');
        System.assertEquals('Hello team', items[0].Body, 'Body should match');
    }

    @isTest
    static void testPostChatMessage_withMentionSyntax() {
        Map<String, Object> td = createTestData();
        Case ownerStory = (Case) td.get('ownerStory');
        User supportUser = (User) td.get('supportUser');

        String msg = 'Hey @[' + supportUser.Id + '] check this out';

        Test.startTest();
        Id result = OutpostDevelopmentController.postChatMessage(ownerStory.Id, msg);
        Test.stopTest();

        System.assertNotEquals(null, result, 'Should return a FeedItem Id even with mention syntax');
    }

    // ── getChatMessages ───────────────────────────────────────────────────

    @isTest
    static void testGetChatMessages_returnsMessages() {
        Map<String, Object> td = createTestData();
        Case ownerStory = (Case) td.get('ownerStory');

        insert new FeedItem(ParentId = ownerStory.Id, Body = 'First message', Type = 'TextPost');
        insert new FeedItem(ParentId = ownerStory.Id, Body = 'Second message', Type = 'TextPost');

        Test.startTest();
        List<OutpostDevelopmentController.ChatMessageWrapper> result =
            OutpostDevelopmentController.getChatMessages(ownerStory.Id);
        Test.stopTest();

        System.assertEquals(2, result.size(), 'Should return 2 chat messages');
        System.assertEquals('First message',  result[0].body, 'First message body should match');
        System.assertEquals('Second message', result[1].body, 'Second message body should match');
        System.assertNotEquals(null, result[0].createdDate, 'Created date should be populated');
        System.assertNotEquals(null, result[0].authorId,    'Author Id should be populated');
    }

    @isTest
    static void testGetChatMessages_emptyWhenNoMessages() {
        Map<String, Object> td = createTestData();
        Case ownerStory = (Case) td.get('ownerStory');

        Test.startTest();
        List<OutpostDevelopmentController.ChatMessageWrapper> result =
            OutpostDevelopmentController.getChatMessages(ownerStory.Id);
        Test.stopTest();

        System.assertNotEquals(null, result, 'Should return empty list, not null');
        System.assertEquals(0, result.size(), 'Should be empty with no messages');
    }

    @isTest
    static void testGetChatMessages_isCurrentUserFlagSet() {
        Map<String, Object> td = createTestData();
        Case ownerStory = (Case) td.get('ownerStory');

        insert new FeedItem(ParentId = ownerStory.Id, Body = 'My message', Type = 'TextPost');

        Test.startTest();
        List<OutpostDevelopmentController.ChatMessageWrapper> result =
            OutpostDevelopmentController.getChatMessages(ownerStory.Id);
        Test.stopTest();

        System.assertEquals(true, result[0].isCurrentUser, 'isCurrentUser should be true for message posted by current user');
    }

    @isTest
    static void testGetChatMessages_resolvesMentionInBody() {
        Map<String, Object> td = createTestData();
        Case ownerStory   = (Case) td.get('ownerStory');
        User supportUser  = (User) td.get('supportUser');

        // Insert FeedItem with @[userId] mention syntax
        String msgWithMention = 'Hi @[' + supportUser.Id + '] see above';
        insert new FeedItem(ParentId = ownerStory.Id, Body = msgWithMention, Type = 'TextPost');

        Test.startTest();
        List<OutpostDevelopmentController.ChatMessageWrapper> result =
            OutpostDevelopmentController.getChatMessages(ownerStory.Id);
        Test.stopTest();

        System.assertEquals(1, result.size(), 'Should return 1 message');
        System.assert(result[0].body.contains('@Support TestUser'),
            'Mention should be resolved to display name. Got: ' + result[0].body);
    }

    // ── searchChatUsers ───────────────────────────────────────────────────

    @isTest
    static void testSearchChatUsers_returnsMatchingUsers() {
        createTestData(); // creates 'Support TestUser'

        Test.startTest();
        List<OutpostDevelopmentController.UserOption> result =
            OutpostDevelopmentController.searchChatUsers('Support');
        Test.stopTest();

        System.assert(!result.isEmpty(), 'Should return at least one matching user');
        Boolean found = false;
        for (OutpostDevelopmentController.UserOption opt : result) {
            if (opt.label.contains('Support')) { found = true; break; }
        }
        System.assert(found, 'Should find the Support TestUser');
    }

    @isTest
    static void testSearchChatUsers_emptyTermReturnsEmpty() {
        Test.startTest();
        List<OutpostDevelopmentController.UserOption> result =
            OutpostDevelopmentController.searchChatUsers('');
        Test.stopTest();

        System.assertNotEquals(null, result, 'Should return empty list, not null');
        System.assertEquals(0, result.size(), 'Blank term should return empty');
    }
}
