public with sharing class EodTimeRetroController {

    // ── Team users for dropdown ────────────────────────────────────────
    @AuraEnabled(cacheable=true)
    public static List<User> getTeamUsers() {
        Id currentUserId = UserInfo.getUserId();
        Date cutoff      = Date.today().addDays(-30);
        Set<Id> activeUserIds = new Set<Id>{ currentUserId };
        for (AggregateResult ar : [
            SELECT CreatedById FROM Time__c
            WHERE Logged_Date__c >= :cutoff GROUP BY CreatedById
        ]) { activeUserIds.add((Id)ar.get('CreatedById')); }
        return [SELECT Id, Name FROM User WHERE Id IN :activeUserIds AND IsActive = true ORDER BY Name];
    }

    // ── Stories touched TODAY (wire, cacheable) ────────────────────────
    @AuraEnabled(cacheable=true)
    public static List<StoryWrapper> getTodayStories(Id userId) {
        if (userId == null) userId = UserInfo.getUserId();
        return buildStoryWrappers(userId, Date.today(), true);
    }

    // ── Stories touched on a SPECIFIC date (imperative) ───────────────
    @AuraEnabled
    public static List<StoryWrapper> getStoriesForDate(Id userId, String dateStr) {
        if (userId == null) userId = UserInfo.getUserId();
        Date targetDate = Date.valueOf(dateStr);
        return buildStoryWrappers(userId, targetDate, false);
    }

    // ── Shared story-building logic ────────────────────────────────────
    private static List<StoryWrapper> buildStoryWrappers(Id userId, Date targetDate, Boolean todayOnly) {
        // For today: use LastModifiedDate = TODAY. For past: use a date range.
        List<Case> stories;
        if (todayOnly) {
            stories = [
                SELECT Id, CaseNumber, Subject, Status, Priority,
                       LastModifiedDate, Epic__c, Projects__c, Projects__r.Name
                FROM Case
                WHERE LastModifiedById = :userId
                AND LastModifiedDate = TODAY
                ORDER BY Projects__c NULLS LAST, LastModifiedDate DESC
            ];
        } else {
            Datetime startDt = Datetime.newInstance(targetDate, Time.newInstance(0,0,0,0));
            Datetime endDt   = Datetime.newInstance(targetDate.addDays(1), Time.newInstance(0,0,0,0));
            stories = [
                SELECT Id, CaseNumber, Subject, Status, Priority,
                       LastModifiedDate, Epic__c, Projects__c, Projects__r.Name
                FROM Case
                WHERE LastModifiedById = :userId
                AND LastModifiedDate >= :startDt
                AND LastModifiedDate < :endDt
                ORDER BY Projects__c NULLS LAST, LastModifiedDate DESC
            ];
        }

        if (stories.isEmpty()) return new List<StoryWrapper>();

        Set<Id> storyIds = new Map<Id, Case>(stories).keySet();

        List<Time__c> times = [
            SELECT Id, Case__c, Minutes_Logged__c, Additional_Comments__c,
                   Start_Time__c, Stop_Time__c, Logged_Date__c, Active__c
            FROM Time__c
            WHERE Case__c IN :storyIds AND CreatedById = :userId AND Logged_Date__c = :targetDate
        ];

        Map<Id, List<Time__c>> timeByStory = new Map<Id, List<Time__c>>();
        for (Time__c t : times) {
            if (!timeByStory.containsKey(t.Case__c)) timeByStory.put(t.Case__c, new List<Time__c>());
            timeByStory.get(t.Case__c).add(t);
        }

        List<CaseHistory> historyList = [
            SELECT CaseId, Field, OldValue, NewValue, CreatedDate
            FROM CaseHistory
            WHERE CaseId IN :storyIds AND CreatedById = :userId
            AND CreatedDate >= :Datetime.newInstance(targetDate, Time.newInstance(0,0,0,0))
            AND CreatedDate <  :Datetime.newInstance(targetDate.addDays(1), Time.newInstance(0,0,0,0))
            AND Field NOT IN ('created', 'feedPost', 'attachment')
            ORDER BY CreatedDate DESC
        ];

        Map<Id, List<CaseHistory>> historyByStory = new Map<Id, List<CaseHistory>>();
        // historyList is DESC by CreatedDate — first occurrence per CaseId = most recent event
        Map<Id, Datetime> wipEnterTime = new Map<Id, Datetime>();
        Map<Id, Datetime> wipExitTime  = new Map<Id, Datetime>();
        for (CaseHistory h : historyList) {
            if (!historyByStory.containsKey(h.CaseId)) historyByStory.put(h.CaseId, new List<CaseHistory>());
            if (historyByStory.get(h.CaseId).size() < 4) historyByStory.get(h.CaseId).add(h);
            if (h.Field == 'Status') {
                String nv = h.NewValue != null ? String.valueOf(h.NewValue) : '';
                String ov = h.OldValue != null ? String.valueOf(h.OldValue) : '';
                if ((nv == 'Work In Progress (WIP)' || nv == 'Working') && !wipEnterTime.containsKey(h.CaseId)) {
                    wipEnterTime.put(h.CaseId, h.CreatedDate);
                }
                if ((ov == 'Work In Progress (WIP)' || ov == 'Working') && !wipExitTime.containsKey(h.CaseId)) {
                    wipExitTime.put(h.CaseId, h.CreatedDate);
                }
            }
        }

        List<StoryWrapper> result = new List<StoryWrapper>();
        for (Case c : stories) {
            StoryWrapper w  = new StoryWrapper();
            w.storyId       = c.Id;
            w.caseNumber    = c.CaseNumber;
            w.subject       = c.Subject;
            w.status        = c.Status;
            w.priority      = c.Priority;
            w.epicId        = c.Epic__c;
            w.projectId     = c.Projects__c;
            w.projectName   = c.Projects__r?.Name;
            w.timeEntries   = timeByStory.containsKey(c.Id) ? timeByStory.get(c.Id) : new List<Time__c>();
            Decimal totalMins = 0;
            for (Time__c t : w.timeEntries) totalMins += (t.Minutes_Logged__c != null ? t.Minutes_Logged__c : 0);
            w.totalMinutes  = totalMins;
            w.totalHours    = (totalMins / 60).setScale(1, RoundingMode.HALF_UP);
            w.hasTime       = !w.timeEntries.isEmpty();
            List<HistoryEntry> entries = new List<HistoryEntry>();
            if (historyByStory.containsKey(c.Id)) {
                List<CaseHistory> caseHist = historyByStory.get(c.Id);
                // Reverse DESC list to display oldest → newest
                for (Integer i = caseHist.size() - 1; i >= 0; i--) {
                    CaseHistory h = caseHist[i];
                    HistoryEntry he = new HistoryEntry();
                    he.id          = h.Id;
                    he.field       = h.Field;
                    he.oldValue    = h.OldValue != null ? String.valueOf(h.OldValue) : null;
                    he.newValue    = h.NewValue != null ? String.valueOf(h.NewValue) : null;
                    he.createdDate = h.CreatedDate.format('h:mm a');
                    entries.add(he);
                }
            }
            w.history = entries;
            // WIP suggested hours — most recent enter/exit WIP today
            Datetime wipStart = wipEnterTime.get(c.Id);
            Datetime wipEnd   = wipExitTime.get(c.Id);
            if (wipStart != null) {
                Datetime effectiveEnd = null;
                if (wipEnd != null && wipEnd > wipStart) {
                    effectiveEnd = wipEnd;
                } else if (c.Status == 'Work In Progress (WIP)' || c.Status == 'Working') {
                    effectiveEnd = Datetime.now();
                }
                if (effectiveEnd != null) {
                    Long diffMs = effectiveEnd.getTime() - wipStart.getTime();
                    w.suggestedHours = (Decimal.valueOf(diffMs) / 3600000).setScale(1, RoundingMode.HALF_UP);
                }
            }
            result.add(w);
        }
        return result;
    }

    // ── Time stats ────────────────────────────────────────────────────
    @AuraEnabled(cacheable=true)
    public static TimeStats getTimeStats(Id userId) {
        if (userId == null) userId = UserInfo.getUserId();
        Date today      = Date.today();
        Date weekStart  = today.toStartOfWeek();
        Date monthStart = Date.newInstance(today.year(), today.month(), 1);
        List<Time__c> allMonth = [
            SELECT Minutes_Logged__c, Logged_Date__c FROM Time__c
            WHERE CreatedById = :userId AND Logged_Date__c >= :monthStart
        ];
        Decimal todayMins = 0, weekMins = 0, monthMins = 0;
        Map<String, Decimal> dayMap = new Map<String, Decimal>();
        for (Time__c t : allMonth) {
            Decimal m = (t.Minutes_Logged__c != null) ? t.Minutes_Logged__c : 0;
            monthMins += m;
            if (t.Logged_Date__c >= weekStart) {
                weekMins += m;
                String dk = String.valueOf(t.Logged_Date__c);
                dayMap.put(dk, (dayMap.containsKey(dk) ? dayMap.get(dk) : 0) + m);
            }
            if (t.Logged_Date__c == today) todayMins += m;
        }
        List<DayEntry> entries = new List<DayEntry>();
        for (String d : dayMap.keySet()) entries.add(new DayEntry(d, dayMap.get(d)));
        TimeStats s  = new TimeStats();
        s.todayHours = (todayMins / 60).setScale(1, RoundingMode.HALF_UP);
        s.weekHours  = (weekMins  / 60).setScale(1, RoundingMode.HALF_UP);
        s.monthHours = (monthMins / 60).setScale(1, RoundingMode.HALF_UP);
        s.byDay      = entries;
        return s;
    }

    // ── Time breakdown by account/project for a period ────────────────
    @AuraEnabled
    public static List<AccountGroup> getTimeBreakdown(Id userId, String period) {
        if (userId == null) userId = UserInfo.getUserId();
        Date today      = Date.today();
        Date startDate;
        if      (period == 'today') startDate = today;
        else if (period == 'week')  startDate = today.toStartOfWeek();
        else                        startDate = Date.newInstance(today.year(), today.month(), 1);

        List<Time__c> times = [
            SELECT Id, Case__c, Case__r.Subject, Case__r.Projects__c, Case__r.Projects__r.Name,
                   Minutes_Logged__c, Additional_Comments__c, Logged_Date__c
            FROM Time__c
            WHERE CreatedById = :userId
            AND Logged_Date__c >= :startDate
            AND Logged_Date__c <= :today
            ORDER BY Case__r.Projects__r.Name NULLS LAST, Logged_Date__c DESC
        ];

        Map<String, AccountGroup> groupMap = new Map<String, AccountGroup>();
        List<String> order = new List<String>();

        for (Time__c t : times) {
            String projId   = t.Case__r.Projects__c != null
                              ? String.valueOf(t.Case__r.Projects__c) : '__none__';
            String projName = (t.Case__r.Projects__r != null && t.Case__r.Projects__r.Name != null)
                              ? t.Case__r.Projects__r.Name : 'No Project';
            if (!groupMap.containsKey(projId)) {
                groupMap.put(projId, new AccountGroup(projId, projName));
                order.add(projId);
            }
            Decimal hrs = ((t.Minutes_Logged__c != null ? t.Minutes_Logged__c : 0) / 60)
                          .setScale(1, RoundingMode.HALF_UP);
            groupMap.get(projId).entries.add(
                new TimeEntry(t.Id, t.Case__r.Subject, hrs, t.Additional_Comments__c));
            groupMap.get(projId).totalHours += hrs;
        }

        List<AccountGroup> result = new List<AccountGroup>();
        for (String k : order) {
            groupMap.get(k).totalHours = groupMap.get(k).totalHours.setScale(1, RoundingMode.HALF_UP);
            result.add(groupMap.get(k));
        }
        return result;
    }

    // ── Log time (supports optional back-date) ────────────────────────
    @AuraEnabled
    public static Id logTime(Id storyId, Id epicId, Decimal hours, String notes, String logDate) {
        Decimal mins     = (hours * 60).setScale(0, RoundingMode.HALF_UP);
        Date targetDate  = (logDate != null && logDate != '') ? Date.valueOf(logDate) : Date.today();
        Datetime stopNow = Datetime.now();
        Datetime startDt = stopNow.addMinutes(-(Integer)mins);
        Time__c t = new Time__c(
            Case__c                = storyId,
            Epic__c                = epicId,
            Minutes_Logged__c      = mins,
            Additional_Comments__c = notes,
            Logged_Date__c         = targetDate,
            Start_Time__c          = startDt,
            Stop_Time__c           = stopNow,
            Active__c              = false
        );
        insert t;
        return t.Id;
    }

    // ── Update time ───────────────────────────────────────────────────
    @AuraEnabled
    public static void updateTime(Id timeId, Decimal hours, String notes) {
        Decimal mins = (hours * 60).setScale(0, RoundingMode.HALF_UP);
        update new Time__c(Id = timeId, Minutes_Logged__c = mins, Additional_Comments__c = notes);
    }

    // ── Wrappers ──────────────────────────────────────────────────────
    public class StoryWrapper {
        @AuraEnabled public Id                 storyId;
        @AuraEnabled public String             caseNumber;
        @AuraEnabled public String             subject;
        @AuraEnabled public String             status;
        @AuraEnabled public String             priority;
        @AuraEnabled public Id                 epicId;
        @AuraEnabled public Id                 projectId;
        @AuraEnabled public String             projectName;
        @AuraEnabled public List<Time__c>      timeEntries;
        @AuraEnabled public Decimal            totalMinutes;
        @AuraEnabled public Decimal            totalHours;
        @AuraEnabled public Boolean            hasTime;
        @AuraEnabled public Decimal            suggestedHours;
        @AuraEnabled public List<HistoryEntry> history;
    }

    public class HistoryEntry {
        @AuraEnabled public String id;
        @AuraEnabled public String field;
        @AuraEnabled public String oldValue;
        @AuraEnabled public String newValue;
        @AuraEnabled public String createdDate;
    }

    public class AccountGroup {
        @AuraEnabled public String          accountId;
        @AuraEnabled public String          accountName;
        @AuraEnabled public Decimal         totalHours;
        @AuraEnabled public List<TimeEntry> entries;
        public AccountGroup(String aid, String aname) {
            accountId = aid; accountName = aname; totalHours = 0; entries = new List<TimeEntry>();
        }
    }

    public class TimeEntry {
        @AuraEnabled public String  timeId;
        @AuraEnabled public String  subject;
        @AuraEnabled public Decimal hours;
        @AuraEnabled public String  notes;
        public TimeEntry(String tid, String sub, Decimal h, String n) {
            timeId = tid; subject = sub; hours = h; notes = n;
        }
    }

    public class DayEntry {
        @AuraEnabled public String  day;
        @AuraEnabled public Decimal minutes;
        public DayEntry(String d, Decimal m) { day = d; minutes = m; }
    }

    public class TimeStats {
        @AuraEnabled public Decimal        todayHours;
        @AuraEnabled public Decimal        weekHours;
        @AuraEnabled public Decimal        monthHours;
        @AuraEnabled public List<DayEntry> byDay;
    }
}