public without sharing class OutpostDevelopmentController {

    static final List<String> COLUMNS = new List<String>{
        'New', 'Backlog', 'Scheduled', 'Work In Progress (WIP)',
        'Waiting for User', 'On Hold', 'In Review', 'In UAT', 'Blocked', 'Completed'
    };
    static final Set<String> EXCLUDED = new Set<String>{ 'Meetings', 'Project Management', 'Helpdesk' };

    // ── Wrapper Classes ───────────────────────────────────────────────────

    public class OutpostData {
        @AuraEnabled public List<StoryWrapper>  ownerStories;
        @AuraEnabled public List<StoryWrapper>  supportStories;
        @AuraEnabled public List<ProjectOption> projects;
        @AuraEnabled public Boolean             isOwner;
        @AuraEnabled public Boolean             isSupport;
    }

    public class StoryWrapper {
        @AuraEnabled public Id      id;
        @AuraEnabled public String  subject;
        @AuraEnabled public String  status;
        @AuraEnabled public String  priority;
        @AuraEnabled public String  type;
        @AuraEnabled public String  ownerName;
        @AuraEnabled public String  supportName;
        @AuraEnabled public String  projectName;
        @AuraEnabled public Id      projectId;
        @AuraEnabled public Decimal hoursLogged;
        @AuraEnabled public Decimal hoursEstimate;
    }

    public class ProjectOption {
        @AuraEnabled public Id     value;
        @AuraEnabled public String label;
    }

    public class CommentWrapper {
        @AuraEnabled public Id       id;
        @AuraEnabled public String   body;
        @AuraEnabled public String   authorName;
        @AuraEnabled public DateTime createdDate;
    }

    // ── getOutpostData ────────────────────────────────────────────────────

    @AuraEnabled(cacheable=true)
    public static OutpostData getOutpostData(String projectId) {
        Id userId = UserInfo.getUserId();

        String statusList  = '\'' + String.join(COLUMNS, '\',\'') + '\'';
        String excludeList = '\'' + String.join(new List<String>(EXCLUDED), '\',\'') + '\'';
        String projClause  = String.isNotBlank(projectId)
            ? ' AND Projects__c = \'' + String.escapeSingleQuotes(projectId) + '\''
            : '';

        String baseSelect =
            'SELECT Id, Subject, Status, Priority, Type, ' +
            'OwnerId, Owner.Name, Story_Support__c, Story_Support__r.Name, ' +
            'Projects__c, Projects__r.Name, ' +
            'Hours_Estimate_to_Complete__c, Time_Logged_on_Story__c ' +
            'FROM Case';

        String ownerQuery =
            baseSelect +
            ' WHERE OwnerId = \'' + userId + '\'' +
            ' AND Story_Support__c != null' +
            ' AND Status IN (' + statusList + ')' +
            ' AND Subject NOT IN (' + excludeList + ')' +
            projClause +
            ' ORDER BY CreatedDate DESC LIMIT 200';

        String supportQuery =
            baseSelect +
            ' WHERE Story_Support__c = \'' + userId + '\'' +
            ' AND Status IN (' + statusList + ')' +
            ' AND Subject NOT IN (' + excludeList + ')' +
            projClause +
            ' ORDER BY CreatedDate DESC LIMIT 200';

        List<Case> ownerCases   = Database.query(ownerQuery);
        List<Case> supportCases = Database.query(supportQuery);

        List<Sprint__c> sprints = [
            SELECT Id, Name
            FROM Sprint__c
            WHERE Status__c = 'In Progress'
            ORDER BY Name ASC
            LIMIT 100
        ];

        List<ProjectOption> projectOptions = new List<ProjectOption>();
        for (Sprint__c s : sprints) {
            ProjectOption po = new ProjectOption();
            po.value = s.Id;
            po.label = s.Name;
            projectOptions.add(po);
        }

        OutpostData data     = new OutpostData();
        data.ownerStories    = toWrappers(ownerCases);
        data.supportStories  = toWrappers(supportCases);
        data.projects        = projectOptions;
        data.isOwner         = !ownerCases.isEmpty();
        data.isSupport       = !supportCases.isEmpty();
        return data;
    }

    private static List<StoryWrapper> toWrappers(List<Case> cases) {
        List<StoryWrapper> result = new List<StoryWrapper>();
        for (Case c : cases) {
            StoryWrapper w  = new StoryWrapper();
            w.id            = c.Id;
            w.subject       = c.Subject;
            w.status        = c.Status;
            w.priority      = c.Priority;
            w.type          = c.Type;
            w.ownerName     = c.Owner != null     ? c.Owner.Name              : null;
            w.supportName   = c.Story_Support__r != null ? c.Story_Support__r.Name : null;
            w.projectName   = c.Projects__r != null ? c.Projects__r.Name      : null;
            w.projectId     = c.Projects__c;
            w.hoursLogged   = c.Time_Logged_on_Story__c != null
                ? (c.Time_Logged_on_Story__c / 60).setScale(2, RoundingMode.HALF_UP)
                : 0;
            w.hoursEstimate = c.Hours_Estimate_to_Complete__c != null
                ? c.Hours_Estimate_to_Complete__c
                : 0;
            result.add(w);
        }
        return result;
    }

    // ── updateStatus ──────────────────────────────────────────────────────

    @AuraEnabled
    public static void updateStatus(String caseId, String newStatus) {
        try {
            Set<String> valid = new Set<String>(COLUMNS);
            if (!valid.contains(newStatus)) {
                throw new AuraHandledException('Invalid status: ' + newStatus);
            }
            update new Case(Id = caseId, Status = newStatus);
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (AuraHandledException ex) {
            throw ex;
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }

    // ── logTime ───────────────────────────────────────────────────────────

    @AuraEnabled
    public static void logTime(String caseId, Integer minutes, String description, String loggedDate) {
        try {
            Case c = [SELECT Epic__c FROM Case WHERE Id = :caseId LIMIT 1];
            Date ld = String.isBlank(loggedDate) ? Date.today() : Date.valueOf(loggedDate);
            Time__c t = new Time__c(
                Case__c                = caseId,
                Epic__c                = c.Epic__c,
                Minutes_Logged__c      = minutes,
                Additional_Comments__c = String.isBlank(description) ? null : description,
                Logged_Date__c         = ld
            );
            insert t;
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }

    // ── postComment ───────────────────────────────────────────────────────

    @AuraEnabled
    public static void postComment(String caseId, String message) {
        try {
            insert new CaseComment(
                ParentId    = caseId,
                CommentBody = message,
                IsPublished = true
            );
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }

    // ── getComments ───────────────────────────────────────────────────────

    @AuraEnabled
    public static List<CommentWrapper> getComments(String caseId) {
        List<CommentWrapper> result = new List<CommentWrapper>();
        for (CaseComment cc : [
            SELECT Id, CommentBody, CreatedBy.Name, CreatedDate
            FROM CaseComment
            WHERE ParentId = :caseId
            ORDER BY CreatedDate ASC
            LIMIT 200
        ]) {
            CommentWrapper w = new CommentWrapper();
            w.id          = cc.Id;
            w.body        = cc.CommentBody;
            w.authorName  = cc.CreatedBy.Name;
            w.createdDate = cc.CreatedDate;
            result.add(w);
        }
        return result;
    }

    // ── Chat (Chatter FeedItem) ───────────────────────────────────────────

    public class ChatMessageWrapper {
        @AuraEnabled public Id       id;
        @AuraEnabled public String   body;
        @AuraEnabled public String   authorName;
        @AuraEnabled public Id       authorId;
        @AuraEnabled public DateTime createdDate;
        @AuraEnabled public Boolean  isCurrentUser;
    }

    public class UserOption {
        @AuraEnabled public Id     value;
        @AuraEnabled public String label;
    }

    @AuraEnabled
    public static List<ChatMessageWrapper> getChatMessages(String caseId) {
        Id curUserId = UserInfo.getUserId();

        List<FeedItem> feedItems = [
            SELECT Id, Body, CreatedDate, CreatedById, CreatedBy.Name
            FROM FeedItem
            WHERE ParentId = :caseId
            AND   Type     = 'TextPost'
            ORDER BY CreatedDate ASC
            LIMIT 100
        ];

        // Collect all @[userId] patterns to resolve display names
        Set<Id> mentionIds = new Set<Id>();
        Pattern p = Pattern.compile('@\\[([0-9A-Za-z]{15,18})\\]');
        for (FeedItem fi : feedItems) {
            if (fi.Body == null) continue;
            Matcher m = p.matcher(fi.Body);
            while (m.find()) { mentionIds.add((Id) m.group(1)); }
        }

        Map<Id, String> userNames = new Map<Id, String>();
        if (!mentionIds.isEmpty()) {
            for (User u : [SELECT Id, Name FROM User WHERE Id IN :mentionIds]) {
                userNames.put(u.Id, u.Name);
            }
        }

        List<ChatMessageWrapper> result = new List<ChatMessageWrapper>();
        for (FeedItem fi : feedItems) {
            ChatMessageWrapper w = new ChatMessageWrapper();
            w.id            = fi.Id;
            w.authorName    = fi.CreatedBy != null ? fi.CreatedBy.Name : 'Unknown';
            w.authorId      = fi.CreatedById;
            w.createdDate   = fi.CreatedDate;
            w.isCurrentUser = fi.CreatedById == curUserId;

            // Resolve @[userId] → @Name, then convert HTML to plain text
            String body = fi.Body != null ? fi.Body : '';
            for (Id uid : userNames.keySet()) {
                String displayName = '@' + userNames.get(uid);
                body = body.replace('@[' + uid + ']', displayName);
                body = body.replace('@[' + String.valueOf(uid).left(15) + ']', displayName);
            }
            w.body = htmlToPlainText(body);
            result.add(w);
        }
        return result;
    }

    @AuraEnabled
    public static Id postChatMessage(String caseId, String message) {
        try {
            // Test context: plain FeedItem (ConnectApi unavailable without mock setup)
            if (Test.isRunningTest()) {
                FeedItem fi = new FeedItem(
                    ParentId = caseId,
                    Body     = message,
                    Type     = 'TextPost'
                );
                insert fi;
                return fi.Id;
            }

            // Production: use ConnectApi for proper @mention notifications
            ConnectApi.FeedItemInput input = new ConnectApi.FeedItemInput();
            input.feedElementType = ConnectApi.FeedElementType.FeedItem;
            input.subjectId       = caseId;

            ConnectApi.MessageBodyInput body = new ConnectApi.MessageBodyInput();
            body.messageSegments = buildChatSegments(message);
            input.body = body;

            ConnectApi.FeedElement fe = ConnectApi.ChatterFeeds.postFeedElement(null, input);
            return (Id) fe.id;
        } catch (AuraHandledException ex) {
            throw ex;
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }

    private static List<ConnectApi.MessageSegmentInput> buildChatSegments(String message) {
        List<ConnectApi.MessageSegmentInput> segments = new List<ConnectApi.MessageSegmentInput>();
        Pattern p = Pattern.compile('@\\[([0-9A-Za-z]{15,18})\\]');
        Matcher m = p.matcher(message);
        Integer lastEnd = 0;

        while (m.find()) {
            if (m.start() > lastEnd) {
                ConnectApi.TextSegmentInput txt = new ConnectApi.TextSegmentInput();
                txt.text = message.substring(lastEnd, m.start());
                segments.add(txt);
            }
            ConnectApi.MentionSegmentInput mention = new ConnectApi.MentionSegmentInput();
            mention.id = m.group(1);
            segments.add(mention);
            lastEnd = m.end();
        }

        if (lastEnd < message.length()) {
            ConnectApi.TextSegmentInput txt = new ConnectApi.TextSegmentInput();
            txt.text = message.substring(lastEnd);
            segments.add(txt);
        }

        if (segments.isEmpty()) {
            ConnectApi.TextSegmentInput txt = new ConnectApi.TextSegmentInput();
            txt.text = message;
            segments.add(txt);
        }
        return segments;
    }

    @AuraEnabled(cacheable=true)
    public static List<UserOption> searchChatUsers(String term) {
        if (String.isBlank(term)) return new List<UserOption>();
        String likeTerm = '%' + String.escapeSingleQuotes(term.trim()) + '%';
        List<UserOption> result = new List<UserOption>();
        for (User u : [
            SELECT Id, Name
            FROM User
            WHERE IsActive = true AND Name LIKE :likeTerm
            ORDER BY Name ASC
            LIMIT 8
        ]) {
            UserOption opt = new UserOption();
            opt.value = u.Id;
            opt.label = u.Name;
            result.add(opt);
        }
        return result;
    }

    // ── HTML → plain text converter ───────────────────────────────────────

    private static String htmlToPlainText(String html) {
        if (String.isBlank(html)) return '';
        String t = html;
        // Block-level closings → newline
        t = t.replaceAll('(?i)</p>',   '\n');
        t = t.replaceAll('(?i)</div>', '\n');
        t = t.replaceAll('(?i)</li>',  '\n');
        t = t.replaceAll('(?i)<br\\s*/?>', '\n');
        // Strip all remaining tags
        t = t.replaceAll('<[^>]*>', '');
        // Decode common HTML entities
        t = t.replace('&amp;',  '&')
             .replace('&lt;',   '<')
             .replace('&gt;',   '>')
             .replace('&quot;', '"')
             .replace('&#39;',  '\'')
             .replace('&apos;', '\'')
             .replace('&nbsp;', ' ')
             .replace('&#160;', ' ');
        // Collapse 3+ consecutive newlines to 2
        t = t.replaceAll('\\n{3,}', '\n\n');
        return t.trim();
    }
}
