@isTest
public class StoryFeedControllerTest {

    @TestSetup
    static void setupData() {
        List<Case> cases = new List<Case>{
            new Case(Subject = 'Story 1', Status = 'New',     Priority = 'High',   Sprint_Week__c = 1, Department__c = 'IT',      Priority_Number__c = 1),
            new Case(Subject = 'Story 2', Status = 'Backlog', Priority = 'Medium', Sprint_Week__c = 1, Department__c = 'Finance',  Priority_Number__c = 2),
            new Case(Subject = 'Story 3', Status = 'New',     Priority = 'Low',    Sprint_Week__c = 2, Department__c = 'Sales',    Priority_Number__c = 3),
            new Case(Subject = 'Story 4', Status = 'Closed',  Priority = 'Low',    Sprint_Week__c = 1, Department__c = 'HR')
        };
        insert cases;
    }

    // ─── Feed Items ───────────────────────────────────────────────

    @isTest
    static void testGetFeedItems_noFilter() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Story 1' LIMIT 1];
        insert new FeedItem(ParentId = c.Id, Body = 'Test post');

        Test.startTest();
        List<StoryFeedController.FeedItemWrapper> result = StoryFeedController.getFeedItems(c.Id, 'ALL');
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assert(result.size() >= 1, 'Should return at least one feed item');
        System.assertEquals('Test post', result[0].body, 'Body should match');
        System.assertNotEquals(null, result[0].authorName,  'Author name should not be null');
        System.assertNotEquals(null, result[0].createdDate, 'Created date should not be null');
        System.assertNotEquals(null, result[0].postType,    'Post type should not be null');
        System.assertNotEquals(null, result[0].replies,     'Replies should not be null');
    }

    @isTest
    static void testGetFeedItems_decisionFilter() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Story 1' LIMIT 1];
        insert new FeedItem(ParentId = c.Id, Body = '[DECISION] Go with option A');
        insert new FeedItem(ParentId = c.Id, Body = 'Just a regular post');

        Test.startTest();
        List<StoryFeedController.FeedItemWrapper> result = StoryFeedController.getFeedItems(c.Id, 'DECISIONS');
        Test.stopTest();

        System.assertEquals(1, result.size(), 'Should only return DECISION posts');
        System.assert(result[0].body.contains('[DECISION]'), 'Post should contain DECISION tag');
        System.assertEquals('DECISION', result[0].postType, 'Post type should be DECISION');
    }

    @isTest
    static void testGetFeedItems_blockerFilter() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Story 1' LIMIT 1];
        insert new FeedItem(ParentId = c.Id, Body = '[BLOCKER] Waiting on API access');
        insert new FeedItem(ParentId = c.Id, Body = 'Normal update');

        Test.startTest();
        List<StoryFeedController.FeedItemWrapper> result = StoryFeedController.getFeedItems(c.Id, 'BLOCKERS');
        Test.stopTest();

        System.assertEquals(1, result.size(), 'Should only return BLOCKER posts');
        System.assertEquals('BLOCKER', result[0].postType, 'Post type should be BLOCKER');
    }

    @isTest
    static void testGetFeedItems_filesFilter() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Story 1' LIMIT 1];
        // Standard post - should be filtered out when FILES filter is applied
        insert new FeedItem(ParentId = c.Id, Body = 'A regular post');

        Test.startTest();
        List<StoryFeedController.FeedItemWrapper> result = StoryFeedController.getFeedItems(c.Id, 'FILES');
        Test.stopTest();

        // No ContentPost type items, so should return empty
        System.assertNotEquals(null, result, 'Result should not be null');
        System.assertEquals(0, result.size(), 'Should return no file posts');
    }

    @isTest
    static void testGetFeedItems_withReplies() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Story 1' LIMIT 1];
        FeedItem fi = new FeedItem(ParentId = c.Id, Body = 'Post with reply');
        insert fi;
        insert new FeedComment(FeedItemId = fi.Id, CommentBody = 'A reply comment');

        Test.startTest();
        List<StoryFeedController.FeedItemWrapper> result = StoryFeedController.getFeedItems(c.Id, 'ALL');
        Test.stopTest();

        System.assert(result.size() >= 1, 'Should return feed items');
        // Find the item with replies
        StoryFeedController.FeedItemWrapper itemWithReply = null;
        for (StoryFeedController.FeedItemWrapper w : result) {
            if (w.body == 'Post with reply') { itemWithReply = w; break; }
        }
        System.assertNotEquals(null, itemWithReply, 'Should find the post');
        System.assertEquals(1, itemWithReply.replies.size(), 'Should have 1 reply');
        System.assertEquals('A reply comment', itemWithReply.replies[0].body, 'Reply body should match');
    }

    @isTest
    static void testGetFeedItems_emptyBody() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Story 1' LIMIT 1];
        insert new FeedItem(ParentId = c.Id, Body = null);

        Test.startTest();
        List<StoryFeedController.FeedItemWrapper> result = StoryFeedController.getFeedItems(c.Id, 'DECISIONS');
        Test.stopTest();

        // Null body should not match DECISION filter
        System.assertEquals(0, result.size(), 'Null body should not match DECISION filter');
    }

    // ─── Create Post / Reply ──────────────────────────────────────

    @isTest
    static void testCreatePost() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Story 1' LIMIT 1];

        Test.startTest();
        StoryFeedController.FeedItemWrapper result = StoryFeedController.createPost(c.Id, 'New post body');
        Test.stopTest();

        System.assertNotEquals(null, result,            'Result should not be null');
        System.assertEquals('New post body', result.body, 'Body should match');
        System.assertNotEquals(null, result.id,         'Id should not be null');
        System.assertNotEquals(null, result.createdDate,'Created date should not be null');
        System.assertNotEquals(null, result.authorName, 'Author name should not be null');
        System.assertEquals('STANDARD', result.postType, 'Post type should be STANDARD');
    }

    @isTest
    static void testCreatePost_withDecisionTag() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Story 1' LIMIT 1];

        Test.startTest();
        StoryFeedController.FeedItemWrapper result = StoryFeedController.createPost(c.Id, '[DECISION] Use React');
        Test.stopTest();

        System.assertEquals('DECISION', result.postType, 'Post type should be DECISION');
    }

    @isTest
    static void testCreatePost_withBlockerTag() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Story 1' LIMIT 1];

        Test.startTest();
        StoryFeedController.FeedItemWrapper result = StoryFeedController.createPost(c.Id, '[BLOCKER] API is down');
        Test.stopTest();

        System.assertEquals('BLOCKER', result.postType, 'Post type should be BLOCKER');
    }

    @isTest
    static void testCreateReply() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Story 1' LIMIT 1];
        FeedItem fi = new FeedItem(ParentId = c.Id, Body = 'Parent post');
        insert fi;

        Test.startTest();
        StoryFeedController.FeedCommentWrapper result = StoryFeedController.createReply(fi.Id, 'This is a reply');
        Test.stopTest();

        System.assertNotEquals(null, result,                  'Result should not be null');
        System.assertEquals('This is a reply', result.body,  'Reply body should match');
        System.assertNotEquals(null, result.authorName,       'Author name should not be null');
        System.assertNotEquals(null, result.createdDate,      'Created date should not be null');
        System.assertNotEquals(null, result.id,               'Id should not be null');
    }

    // ─── Stories ──────────────────────────────────────────────────

    @isTest
    static void testGetStoriesBySprintWeek() {
        Test.startTest();
        List<Case> result = StoryFeedController.getStoriesBySprintWeek(1);
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assertEquals(2, result.size(), 'Should return 2 open stories in sprint week 1');
        for (Case c : result) {
            System.assertEquals(1, c.Sprint_Week__c.intValue(), 'All cases should be sprint week 1');
        }
    }

    @isTest
    static void testGetStoriesBySprintWeek_noResults() {
        Test.startTest();
        List<Case> result = StoryFeedController.getStoriesBySprintWeek(99);
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assertEquals(0, result.size(), 'Should return no stories for non-existent week');
    }

    @isTest
    static void testGetAllStories() {
        Test.startTest();
        List<Case> result = StoryFeedController.getAllStories();
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assertEquals(3, result.size(), 'Should return 3 open stories (Story 4 is Closed)');
    }

    @isTest
    static void testGetCurrentSprintWeek() {
        Test.startTest();
        Integer week = StoryFeedController.getCurrentSprintWeek();
        Test.stopTest();

        System.assertNotEquals(null, week, 'Sprint week should not be null');
        System.assertEquals(1, week, 'Should return lowest sprint week (1)');
    }

    @isTest
    static void testGetCurrentSprintWeek_noOpenCases() {
        List<Case> cases = [SELECT Id, Status FROM Case WHERE Status != 'Closed'];
        for (Case c : cases) c.Status = 'Closed';
        update cases;

        Test.startTest();
        Integer week = StoryFeedController.getCurrentSprintWeek();
        Test.stopTest();

        System.assertEquals(1, week, 'Should default to week 1 when no open cases');
    }

    // ─── Story Details ────────────────────────────────────────────

    @isTest
    static void testGetStoryDetails() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Story 1' LIMIT 1];

        Test.startTest();
        StoryFeedController.StoryDetailWrapper result = StoryFeedController.getStoryDetails(c.Id);
        Test.stopTest();

        System.assertNotEquals(null, result,           'Result should not be null');
        System.assertEquals('Story 1', result.subject, 'Subject should match');
        System.assertEquals('New',     result.status,  'Status should match');
        System.assertEquals('High',    result.priority,'Priority should match');
        System.assertNotEquals(null,    result.id,      'Id should not be null');
        System.assertNotEquals(null,    result.ownerName, 'Owner name should not be null');
        System.assertNotEquals(null,    result.caseNumber,'Case number should not be null');
    }

    @isTest
    static void testGetStoryDetails_withSprintWeek() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Story 1' LIMIT 1];

        Test.startTest();
        StoryFeedController.StoryDetailWrapper result = StoryFeedController.getStoryDetails(c.Id);
        Test.stopTest();

        System.assertNotEquals(null, result.sprintWeek, 'Sprint week string should not be null');
        System.assert(result.sprintWeek.contains('1'), 'Sprint week should contain the week number');
    }

    @isTest
    static void testGetStoryDetails_noSprintWeek() {
        Case c = new Case(Subject = 'No Sprint', Status = 'New', Priority = 'Low');
        insert c;

        Test.startTest();
        StoryFeedController.StoryDetailWrapper result = StoryFeedController.getStoryDetails(c.Id);
        Test.stopTest();

        System.assertEquals(null, result.sprintWeek, 'Sprint week should be null when not set');
    }

    @isTest
    static void testGetStoryDetails_withPlannedCompletion() {
        Case c = new Case(
            Subject = 'With Date',
            Status = 'New',
            Priority = 'Low',
            Planned_Completion_Date__c = Date.today().addDays(7)
        );
        insert c;

        Test.startTest();
        StoryFeedController.StoryDetailWrapper result = StoryFeedController.getStoryDetails(c.Id);
        Test.stopTest();

        System.assertNotEquals(null, result.plannedCompletion, 'Planned completion should not be null');
    }
}