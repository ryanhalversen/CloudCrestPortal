@isTest
private class EodTimeRetroControllerTest {

    // ── Test data factory ─────────────────────────────────────────────────
    private static Map<String, Object> createTestData() {
        Sprint__c sprint = new Sprint__c(Name = 'Test Sprint');
        insert sprint;

        Sprint_Items__c epic = new Sprint_Items__c(
            Name            = 'Test Epic',
            Projects_new__c = sprint.Id
        );
        insert epic;

        Case story = new Case(
            Subject  = 'Test Story Subject',
            Status   = 'Work In Progress (WIP)',
            Priority = 'High',
            Epic__c  = epic.Id
        );
        insert story;

        return new Map<String, Object>{
            'sprint' => sprint,
            'epic'   => epic,
            'story'  => story
        };
    }

    // Note: createTestDataWithProject is intentionally omitted until the
    // Projects__c parent object API name is confirmed in this org.

    private static Time__c createTimeRecord(Id storyId, Id epicId, Decimal mins, Date logDate) {
        Time__c t = new Time__c(
            Case__c                = storyId,
            Epic__c                = epicId,
            Minutes_Logged__c      = mins,
            Additional_Comments__c = 'Test note',
            Logged_Date__c         = logDate,
            Start_Time__c          = Datetime.now().addMinutes(-(Integer)mins),
            Stop_Time__c           = Datetime.now(),
            Active__c              = false
        );
        insert t;
        return t;
    }

    // ── getTeamUsers ──────────────────────────────────────────────────────

    @isTest
    static void testGetTeamUsers_includesCurrentUser() {
        Test.startTest();
        List<User> users = EodTimeRetroController.getTeamUsers();
        Test.stopTest();

        Boolean found = false;
        for (User u : users) {
            if (u.Id == UserInfo.getUserId()) { found = true; break; }
        }
        System.assert(found, 'Current user should always appear in getTeamUsers');
    }

    @isTest
    static void testGetTeamUsers_includesUsersWithRecentTime() {
        Map<String, Object> td = createTestData();
        Case story           = (Case) td.get('story');
        Sprint_Items__c epic = (Sprint_Items__c) td.get('epic');

        // Log time so current user qualifies via the aggregate query path too
        createTimeRecord(story.Id, epic.Id, 60, Date.today());

        Test.startTest();
        List<User> users = EodTimeRetroController.getTeamUsers();
        Test.stopTest();

        System.assert(!users.isEmpty(), 'Should return at least the current user');
    }

    // ── getTodayStories ───────────────────────────────────────────────────

    @isTest
    static void testGetTodayStories_returnsStoriesModifiedToday() {
        Map<String, Object> td = createTestData();
        Case story = (Case) td.get('story');
        story.Subject = 'Updated Subject';
        update story;

        Test.startTest();
        List<EodTimeRetroController.StoryWrapper> results =
            EodTimeRetroController.getTodayStories(UserInfo.getUserId());
        Test.stopTest();

        System.assert(!results.isEmpty(), 'Should return at least one story');
        System.assertEquals(story.Id, results[0].storyId, 'Story ID should match');
        System.assertEquals('Updated Subject', results[0].subject, 'Subject should match');
    }

    @isTest
    static void testGetTodayStories_nullUserIdFallsBackToCurrentUser() {
        Map<String, Object> td = createTestData();
        Case story = (Case) td.get('story');
        story.Subject = 'Null User Test';
        update story;

        Test.startTest();
        // Passing null should fall back to UserInfo.getUserId()
        List<EodTimeRetroController.StoryWrapper> results =
            EodTimeRetroController.getTodayStories(null);
        Test.stopTest();

        System.assert(!results.isEmpty(), 'Null userId should fall back to current user and return stories');
    }

    @isTest
    static void testGetTodayStories_hasTimeIsFalseWhenNoTimeLogged() {
        Map<String, Object> td = createTestData();
        Case story = (Case) td.get('story');
        story.Subject = 'No Time Story';
        update story;

        Test.startTest();
        List<EodTimeRetroController.StoryWrapper> results =
            EodTimeRetroController.getTodayStories(UserInfo.getUserId());
        Test.stopTest();

        EodTimeRetroController.StoryWrapper match = null;
        for (EodTimeRetroController.StoryWrapper w : results) {
            if (w.storyId == story.Id) { match = w; break; }
        }
        System.assertNotEquals(null, match, 'Story should appear in results');
        System.assertEquals(false, match.hasTime,      'hasTime should be false');
        System.assertEquals(0,     match.totalMinutes, 'totalMinutes should be 0');
        System.assertEquals(0,     match.totalHours,   'totalHours should be 0');
    }

    @isTest
    static void testGetTodayStories_hasTimeIsTrueWhenTimeLogged() {
        Map<String, Object> td = createTestData();
        Case story           = (Case) td.get('story');
        Sprint_Items__c epic = (Sprint_Items__c) td.get('epic');
        story.Subject = 'Has Time Story';
        update story;

        createTimeRecord(story.Id, epic.Id, 120, Date.today());

        Test.startTest();
        List<EodTimeRetroController.StoryWrapper> results =
            EodTimeRetroController.getTodayStories(UserInfo.getUserId());
        Test.stopTest();

        EodTimeRetroController.StoryWrapper match = null;
        for (EodTimeRetroController.StoryWrapper w : results) {
            if (w.storyId == story.Id) { match = w; break; }
        }
        System.assertNotEquals(null, match, 'Story should appear in results');
        System.assertEquals(true,  match.hasTime,      'hasTime should be true');
        System.assertEquals(120,   match.totalMinutes, 'totalMinutes should be 120');
        System.assertEquals(2.0,   match.totalHours,   'totalHours should be 2.0');
    }

    @isTest
    static void testGetTodayStories_aggregatesMultipleTimeEntries() {
        Map<String, Object> td = createTestData();
        Case story           = (Case) td.get('story');
        Sprint_Items__c epic = (Sprint_Items__c) td.get('epic');
        story.Subject = 'Multi Time Story';
        update story;

        createTimeRecord(story.Id, epic.Id, 60, Date.today());
        createTimeRecord(story.Id, epic.Id, 90, Date.today());

        Test.startTest();
        List<EodTimeRetroController.StoryWrapper> results =
            EodTimeRetroController.getTodayStories(UserInfo.getUserId());
        Test.stopTest();

        EodTimeRetroController.StoryWrapper match = null;
        for (EodTimeRetroController.StoryWrapper w : results) {
            if (w.storyId == story.Id) { match = w; break; }
        }
        System.assertNotEquals(null, match, 'Story should appear in results');
        System.assertEquals(150, match.totalMinutes, 'Should sum 60 + 90 = 150 mins');
        System.assertEquals(2.5, match.totalHours,   'Should equal 2.5 hours');
    }

    @isTest
    static void testGetTodayStories_emptyWhenNoStoriesTouched() {
        Test.startTest();
        List<EodTimeRetroController.StoryWrapper> results =
            EodTimeRetroController.getTodayStories(UserInfo.getUserId());
        Test.stopTest();

        System.assert(results.isEmpty(), 'Should return empty list when no stories touched today');
    }

    @isTest
    static void testGetTodayStories_storyWithNoProjectHandledGracefully() {
        Map<String, Object> td = createTestData(); // no Projects__c set
        Case story = (Case) td.get('story');
        story.Subject = 'No Project Story';
        update story;

        Test.startTest();
        List<EodTimeRetroController.StoryWrapper> results =
            EodTimeRetroController.getTodayStories(UserInfo.getUserId());
        Test.stopTest();

        EodTimeRetroController.StoryWrapper match = null;
        for (EodTimeRetroController.StoryWrapper w : results) {
            if (w.storyId == story.Id) { match = w; break; }
        }
        System.assertNotEquals(null, match, 'Story without project should still appear');
        System.assertEquals(null, match.projectId,   'projectId should be null');
        System.assertEquals(null, match.projectName, 'projectName should be null');
    }

    @isTest
    static void testGetTodayStories_historyWrapperPopulated() {
        Map<String, Object> td = createTestData();
        Case story = (Case) td.get('story');
        // First update sets LastModifiedById and creates CaseHistory entry
        story.Status  = 'New';
        update story;
        story.Status  = 'Work In Progress (WIP)';
        update story;

        Test.startTest();
        List<EodTimeRetroController.StoryWrapper> results =
            EodTimeRetroController.getTodayStories(UserInfo.getUserId());
        Test.stopTest();

        EodTimeRetroController.StoryWrapper match = null;
        for (EodTimeRetroController.StoryWrapper w : results) {
            if (w.storyId == story.Id) { match = w; break; }
        }
        System.assertNotEquals(null, match, 'Story should appear');
        // History list should be initialised (may be empty in test context but must not be null)
        System.assertNotEquals(null, match.history, 'history list should never be null');
    }

    @isTest
    static void testGetTodayStories_historyCapAtFourEntries() {
        Map<String, Object> td = createTestData();
        Case story = (Case) td.get('story');

        // Cycle status multiple times to generate > 4 history entries
        List<String> statuses = new List<String>{
            'New', 'Work In Progress (WIP)', 'In Review',
            'On Hold', 'Waiting for User', 'Work In Progress (WIP)'
        };
        for (String s : statuses) {
            story.Status = s;
            update story;
        }

        Test.startTest();
        List<EodTimeRetroController.StoryWrapper> results =
            EodTimeRetroController.getTodayStories(UserInfo.getUserId());
        Test.stopTest();

        EodTimeRetroController.StoryWrapper match = null;
        for (EodTimeRetroController.StoryWrapper w : results) {
            if (w.storyId == story.Id) { match = w; break; }
        }
        System.assertNotEquals(null, match, 'Story should appear');
        System.assert(match.history.size() <= 4, 'History should be capped at 4 entries');
    }

    // ── getTimeStats ──────────────────────────────────────────────────────

    @isTest
    static void testGetTimeStats_todayHours() {
        Map<String, Object> td = createTestData();
        Case story           = (Case) td.get('story');
        Sprint_Items__c epic = (Sprint_Items__c) td.get('epic');

        createTimeRecord(story.Id, epic.Id, 180, Date.today());

        Test.startTest();
        EodTimeRetroController.TimeStats stats =
            EodTimeRetroController.getTimeStats(UserInfo.getUserId());
        Test.stopTest();

        System.assertEquals(3.0, stats.todayHours,       'Today hours should be 3.0');
        System.assert(stats.weekHours  >= 3.0, 'Week hours should include today');
        System.assert(stats.monthHours >= 3.0, 'Month hours should include today');
    }

    @isTest
    static void testGetTimeStats_nullUserIdFallsBackToCurrentUser() {
        Map<String, Object> td = createTestData();
        Case story           = (Case) td.get('story');
        Sprint_Items__c epic = (Sprint_Items__c) td.get('epic');

        createTimeRecord(story.Id, epic.Id, 60, Date.today());

        Test.startTest();
        EodTimeRetroController.TimeStats stats =
            EodTimeRetroController.getTimeStats(null);
        Test.stopTest();

        System.assert(stats.todayHours >= 1.0, 'Null userId should fall back to current user');
    }

    @isTest
    static void testGetTimeStats_zeroWhenNoTimeLogged() {
        Test.startTest();
        EodTimeRetroController.TimeStats stats =
            EodTimeRetroController.getTimeStats(UserInfo.getUserId());
        Test.stopTest();

        System.assertEquals(0, stats.todayHours,  'Today should be 0');
        System.assertEquals(0, stats.weekHours,   'Week should be 0');
        System.assertEquals(0, stats.monthHours,  'Month should be 0');
    }

    @isTest
    static void testGetTimeStats_byDayMapPopulated() {
        Map<String, Object> td = createTestData();
        Case story           = (Case) td.get('story');
        Sprint_Items__c epic = (Sprint_Items__c) td.get('epic');

        createTimeRecord(story.Id, epic.Id, 120, Date.today());

        Test.startTest();
        EodTimeRetroController.TimeStats stats =
            EodTimeRetroController.getTimeStats(UserInfo.getUserId());
        Test.stopTest();

        String  todayKey  = String.valueOf(Date.today());
        Decimal todayMins = null;
        for (EodTimeRetroController.DayEntry e : stats.byDay) {
            if (e.day == todayKey) { todayMins = e.minutes; break; }
        }
        System.assertNotEquals(null, todayMins, 'byDay should contain today key');
        System.assertEquals(120,    todayMins,  'byDay value should be 120 mins');
    }

    @isTest
    static void testGetTimeStats_byDayEmptyWhenNoTime() {
        Test.startTest();
        EodTimeRetroController.TimeStats stats =
            EodTimeRetroController.getTimeStats(UserInfo.getUserId());
        Test.stopTest();

        System.assertNotEquals(null, stats.byDay, 'byDay should never be null');
        System.assertEquals(0, stats.byDay.size(), 'byDay should be empty with no time logged');
    }

    @isTest
    static void testGetTimeStats_offCalendarCountsEntriesWithoutTimestamp() {
        Map<String, Object> td = createTestData();
        Case story           = (Case) td.get('story');
        Sprint_Items__c epic = (Sprint_Items__c) td.get('epic');

        // Entry WITH timestamps (should not count as off-calendar)
        Time__c withTs = new Time__c(
            Case__c           = story.Id, Epic__c = epic.Id,
            Minutes_Logged__c = 60, Logged_Date__c = Date.today(),
            Start_Time__c     = Datetime.now().addHours(-1),
            Stop_Time__c      = Datetime.now(), Active__c = false
        );
        insert withTs;

        // Entry WITHOUT timestamps (should count as off-calendar)
        Time__c noTs = new Time__c(
            Case__c           = story.Id, Epic__c = epic.Id,
            Minutes_Logged__c = 90, Logged_Date__c = Date.today(),
            Active__c         = false
        );
        insert noTs;

        Test.startTest();
        EodTimeRetroController.TimeStats stats =
            EodTimeRetroController.getTimeStats(UserInfo.getUserId());
        Test.stopTest();

        System.assertEquals(1,   stats.offCalendarCount,  'Only the no-timestamp entry should count');
        System.assertEquals(1.5, stats.offCalendarHours,  '90 mins = 1.5h off-calendar');
    }

    @isTest
    static void testGetTimeStats_offCalendarZeroWhenAllHaveTimestamps() {
        Map<String, Object> td = createTestData();
        Case story           = (Case) td.get('story');
        Sprint_Items__c epic = (Sprint_Items__c) td.get('epic');

        Time__c t = new Time__c(
            Case__c           = story.Id, Epic__c = epic.Id,
            Minutes_Logged__c = 60, Logged_Date__c = Date.today(),
            Start_Time__c     = Datetime.now().addHours(-1),
            Stop_Time__c      = Datetime.now(), Active__c = false
        );
        insert t;

        Test.startTest();
        EodTimeRetroController.TimeStats stats =
            EodTimeRetroController.getTimeStats(UserInfo.getUserId());
        Test.stopTest();

        System.assertEquals(0,   stats.offCalendarCount, 'Zero off-calendar when all have timestamps');
        System.assertEquals(0.0, stats.offCalendarHours, 'Zero hours when all on calendar');
    }

    // ── logTime ───────────────────────────────────────────────────────────

    @isTest
    static void testLogTime_createsTimeRecord() {
        Map<String, Object> td = createTestData();
        Case story           = (Case) td.get('story');
        Sprint_Items__c epic = (Sprint_Items__c) td.get('epic');

        Test.startTest();
        Id timeId = EodTimeRetroController.logTime(story.Id, epic.Id, 2.5, 'Test note', null);
        Test.stopTest();

        System.assertNotEquals(null, timeId, 'Should return new Time record Id');

        Time__c t = [
            SELECT Id, Case__c, Epic__c, Minutes_Logged__c,
                   Additional_Comments__c, Logged_Date__c, Active__c
            FROM Time__c WHERE Id = :timeId
        ];
        System.assertEquals(story.Id,    t.Case__c,                'Case should match story');
        System.assertEquals(epic.Id,     t.Epic__c,                'Epic should match');
        System.assertEquals(150,         t.Minutes_Logged__c,      '2.5h = 150 mins');
        System.assertEquals('Test note', t.Additional_Comments__c, 'Notes should match');
        System.assertEquals(Date.today(), t.Logged_Date__c,        'Logged date should be today');
        System.assertEquals(false,       t.Active__c,              'Active should be false');
    }

    @isTest
    static void testLogTime_emptyNotesAllowed() {
        Map<String, Object> td = createTestData();
        Case story           = (Case) td.get('story');
        Sprint_Items__c epic = (Sprint_Items__c) td.get('epic');

        Test.startTest();
        Id timeId = EodTimeRetroController.logTime(story.Id, epic.Id, 1.0, '', null);
        Test.stopTest();

        System.assertNotEquals(null, timeId, 'Should succeed with empty notes');
        Time__c t = [SELECT Additional_Comments__c FROM Time__c WHERE Id = :timeId];
        System.assertEquals(null, t.Additional_Comments__c, 'Notes should be null when empty string passed');
    }

    @isTest
    static void testLogTime_setsStartAndStopTime() {
        Map<String, Object> td = createTestData();
        Case story           = (Case) td.get('story');
        Sprint_Items__c epic = (Sprint_Items__c) td.get('epic');

        Datetime before = Datetime.now().addSeconds(-1);

        Test.startTest();
        Id timeId = EodTimeRetroController.logTime(story.Id, epic.Id, 1.0, '', null);
        Test.stopTest();

        Datetime after = Datetime.now().addSeconds(1);
        Time__c t = [SELECT Start_Time__c, Stop_Time__c FROM Time__c WHERE Id = :timeId];

        System.assert(t.Stop_Time__c >= before && t.Stop_Time__c <= after,
            'Stop time should be approximately now');
        System.assert(t.Start_Time__c < t.Stop_Time__c,
            'Start time should be before stop time');
    }

    @isTest
    static void testLogTime_fractionalHoursRoundedCorrectly() {
        Map<String, Object> td = createTestData();
        Case story           = (Case) td.get('story');
        Sprint_Items__c epic = (Sprint_Items__c) td.get('epic');

        Test.startTest();
        Id timeId = EodTimeRetroController.logTime(story.Id, epic.Id, 0.25, 'Quarter hour', null);
        Test.stopTest();

        Time__c t = [SELECT Minutes_Logged__c FROM Time__c WHERE Id = :timeId];
        System.assertEquals(15, t.Minutes_Logged__c, '0.25h should round to 15 mins');
    }

    // ── getStoriesForDate ─────────────────────────────────────────────────

    @isTest
    static void testGetStoriesForDate_returnsStoriesForPastDate() {
        Map<String, Object> td = createTestData();
        Case story           = (Case) td.get('story');
        Sprint_Items__c epic = (Sprint_Items__c) td.get('epic');

        // Log time on today so the story appears
        createTimeRecord(story.Id, epic.Id, 60, Date.today());
        story.Subject = 'Past Date Story';
        update story;

        String todayStr = String.valueOf(Date.today());

        Test.startTest();
        List<EodTimeRetroController.StoryWrapper> results =
            EodTimeRetroController.getStoriesForDate(UserInfo.getUserId(), todayStr);
        Test.stopTest();

        System.assert(!results.isEmpty(), 'Should return stories for today date string');
    }

    @isTest
    static void testGetStoriesForDate_nullUserFallsBack() {
        Map<String, Object> td = createTestData();
        Case story = (Case) td.get('story');
        story.Subject = 'Null User Date Test';
        update story;

        String todayStr = String.valueOf(Date.today());

        Test.startTest();
        List<EodTimeRetroController.StoryWrapper> results =
            EodTimeRetroController.getStoriesForDate(null, todayStr);
        Test.stopTest();

        System.assert(!results.isEmpty(), 'Null userId should fall back to current user');
    }

    @isTest
    static void testGetStoriesForDate_emptyForDateWithNoActivity() {
        // Use a past date with no stories
        String pastDate = String.valueOf(Date.today().addDays(-6));

        Test.startTest();
        List<EodTimeRetroController.StoryWrapper> results =
            EodTimeRetroController.getStoriesForDate(UserInfo.getUserId(), pastDate);
        Test.stopTest();

        System.assert(results.isEmpty(), 'Should return empty for date with no activity');
    }

    // ── getTimeBreakdown ──────────────────────────────────────────────────

    @isTest
    static void testGetTimeBreakdown_today() {
        Map<String, Object> td = createTestData();
        Case story           = (Case) td.get('story');
        Sprint_Items__c epic = (Sprint_Items__c) td.get('epic');
        createTimeRecord(story.Id, epic.Id, 90, Date.today());

        Test.startTest();
        List<EodTimeRetroController.AccountGroup> result =
            EodTimeRetroController.getTimeBreakdown(UserInfo.getUserId(), 'today');
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assert(!result.isEmpty(), 'Should have at least one account group');
        System.assert(result[0].entries.size() > 0, 'Group should have entries');
        System.assertNotEquals(null, result[0].totalHours, 'Total hours should be set');
    }

    @isTest
    static void testGetTimeBreakdown_week() {
        Map<String, Object> td = createTestData();
        Case story           = (Case) td.get('story');
        Sprint_Items__c epic = (Sprint_Items__c) td.get('epic');
        createTimeRecord(story.Id, epic.Id, 60, Date.today());

        Test.startTest();
        List<EodTimeRetroController.AccountGroup> result =
            EodTimeRetroController.getTimeBreakdown(UserInfo.getUserId(), 'week');
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
    }

    @isTest
    static void testGetTimeBreakdown_month() {
        Map<String, Object> td = createTestData();
        Case story           = (Case) td.get('story');
        Sprint_Items__c epic = (Sprint_Items__c) td.get('epic');
        createTimeRecord(story.Id, epic.Id, 120, Date.today());

        Test.startTest();
        List<EodTimeRetroController.AccountGroup> result =
            EodTimeRetroController.getTimeBreakdown(UserInfo.getUserId(), 'month');
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assert(!result.isEmpty(), 'Should have at least one account group for month');
    }

    @isTest
    static void testGetTimeBreakdown_nullUserFallsBack() {
        Map<String, Object> td = createTestData();
        Case story           = (Case) td.get('story');
        Sprint_Items__c epic = (Sprint_Items__c) td.get('epic');
        createTimeRecord(story.Id, epic.Id, 60, Date.today());

        Test.startTest();
        List<EodTimeRetroController.AccountGroup> result =
            EodTimeRetroController.getTimeBreakdown(null, 'today');
        Test.stopTest();

        System.assertNotEquals(null, result, 'Null userId should fall back to current user');
    }

    @isTest
    static void testGetTimeBreakdown_emptyWhenNoTime() {
        Test.startTest();
        List<EodTimeRetroController.AccountGroup> result =
            EodTimeRetroController.getTimeBreakdown(UserInfo.getUserId(), 'today');
        Test.stopTest();

        System.assertNotEquals(null, result, 'Should return empty list, not null');
        System.assertEquals(0, result.size(), 'Should be empty with no time logged');
    }

    // ── logTime with logDate ──────────────────────────────────────────────

    @isTest
    static void testLogTime_withExplicitLogDate() {
        Map<String, Object> td = createTestData();
        Case story           = (Case) td.get('story');
        Sprint_Items__c epic = (Sprint_Items__c) td.get('epic');

        String yesterday = String.valueOf(Date.today().addDays(-1));

        Test.startTest();
        Id timeId = EodTimeRetroController.logTime(story.Id, epic.Id, 1.0, 'Back dated', yesterday);
        Test.stopTest();

        Time__c t = [SELECT Logged_Date__c FROM Time__c WHERE Id = :timeId];
        System.assertEquals(Date.today().addDays(-1), t.Logged_Date__c, 'Should use provided logDate');
    }

    @isTest
    static void testLogTime_withEmptyLogDateUsesToday() {
        Map<String, Object> td = createTestData();
        Case story           = (Case) td.get('story');
        Sprint_Items__c epic = (Sprint_Items__c) td.get('epic');

        Test.startTest();
        Id timeId = EodTimeRetroController.logTime(story.Id, epic.Id, 1.0, 'No date', '');
        Test.stopTest();

        Time__c t = [SELECT Logged_Date__c FROM Time__c WHERE Id = :timeId];
        System.assertEquals(Date.today(), t.Logged_Date__c, 'Empty logDate should default to today');
    }

    // ── updateTime ────────────────────────────────────────────────────────

    @isTest
    static void testUpdateTime_updatesMinutesAndNotes() {
        Map<String, Object> td = createTestData();
        Case story           = (Case) td.get('story');
        Sprint_Items__c epic = (Sprint_Items__c) td.get('epic');

        Time__c t = createTimeRecord(story.Id, epic.Id, 60, Date.today());

        Test.startTest();
        EodTimeRetroController.updateTime(t.Id, 3.0, 'Updated note');
        Test.stopTest();

        Time__c updated = [
            SELECT Minutes_Logged__c, Additional_Comments__c FROM Time__c WHERE Id = :t.Id
        ];
        System.assertEquals(180,            updated.Minutes_Logged__c,      '3.0h = 180 mins');
        System.assertEquals('Updated note', updated.Additional_Comments__c, 'Notes should update');
    }

    @isTest
    static void testUpdateTime_canClearNotes() {
        Map<String, Object> td = createTestData();
        Case story           = (Case) td.get('story');
        Sprint_Items__c epic = (Sprint_Items__c) td.get('epic');

        Time__c t = createTimeRecord(story.Id, epic.Id, 60, Date.today());

        Test.startTest();
        EodTimeRetroController.updateTime(t.Id, 1.0, '');
        Test.stopTest();

        Time__c updated = [SELECT Additional_Comments__c FROM Time__c WHERE Id = :t.Id];
        System.assertEquals(null, updated.Additional_Comments__c, 'Notes should be null when cleared');
    }

    // ── updateTimeStamps ──────────────────────────────────────────────────

    @isTest
    static void testUpdateTimeStamps_updatesStartStopAndMinutes() {
        Map<String, Object> td = createTestData();
        Case story           = (Case) td.get('story');
        Sprint_Items__c epic = (Sprint_Items__c) td.get('epic');

        Time__c t = createTimeRecord(story.Id, epic.Id, 60, Date.today());

        // New window: 9:00 AM → 10:30 AM today (90 minutes)
        Datetime newStart = Datetime.newInstance(Date.today(), Time.newInstance(9, 0, 0, 0));
        Datetime newStop  = Datetime.newInstance(Date.today(), Time.newInstance(10, 30, 0, 0));
        Long startMs = newStart.getTime();
        Long stopMs  = newStop.getTime();
        String logDate = String.valueOf(Date.today());

        Test.startTest();
        EodTimeRetroController.updateTimeStamps(t.Id, startMs, stopMs, logDate);
        Test.stopTest();

        Time__c updated = [
            SELECT Start_Time__c, Stop_Time__c, Minutes_Logged__c, Logged_Date__c
            FROM Time__c WHERE Id = :t.Id
        ];
        System.assertEquals(newStart,     updated.Start_Time__c,     'Start_Time__c should be updated');
        System.assertEquals(newStop,      updated.Stop_Time__c,      'Stop_Time__c should be updated');
        System.assertEquals(90,           updated.Minutes_Logged__c, 'Minutes should be 90 (1.5h)');
        System.assertEquals(Date.today(), updated.Logged_Date__c,    'Logged_Date__c should match logDate');
    }

    @isTest
    static void testUpdateTimeStamps_nullLogDateFallsBackToStartDate() {
        Map<String, Object> td = createTestData();
        Case story           = (Case) td.get('story');
        Sprint_Items__c epic = (Sprint_Items__c) td.get('epic');

        Time__c t = createTimeRecord(story.Id, epic.Id, 30, Date.today());

        Datetime newStart = Datetime.newInstance(Date.today(), Time.newInstance(8, 0, 0, 0));
        Datetime newStop  = Datetime.newInstance(Date.today(), Time.newInstance(8, 30, 0, 0));

        Test.startTest();
        EodTimeRetroController.updateTimeStamps(t.Id, newStart.getTime(), newStop.getTime(), null);
        Test.stopTest();

        Time__c updated = [SELECT Logged_Date__c FROM Time__c WHERE Id = :t.Id];
        System.assertEquals(Date.today(), updated.Logged_Date__c, 'Null logDate should derive date from startTime');
    }

    @isTest
    static void testUpdateTimeStamps_crossDayMove() {
        Map<String, Object> td = createTestData();
        Case story           = (Case) td.get('story');
        Sprint_Items__c epic = (Sprint_Items__c) td.get('epic');

        Time__c t = createTimeRecord(story.Id, epic.Id, 60, Date.today());

        Date yesterday     = Date.today().addDays(-1);
        Datetime newStart  = Datetime.newInstance(yesterday, Time.newInstance(14, 0, 0, 0));
        Datetime newStop   = Datetime.newInstance(yesterday, Time.newInstance(15, 0, 0, 0));
        String   logDate   = String.valueOf(yesterday);

        Test.startTest();
        EodTimeRetroController.updateTimeStamps(t.Id, newStart.getTime(), newStop.getTime(), logDate);
        Test.stopTest();

        Time__c updated = [SELECT Logged_Date__c, Minutes_Logged__c FROM Time__c WHERE Id = :t.Id];
        System.assertEquals(yesterday, updated.Logged_Date__c,    'Should move to yesterday');
        System.assertEquals(60,        updated.Minutes_Logged__c, 'Duration should still be 60 mins');
    }
}