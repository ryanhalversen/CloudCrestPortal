public with sharing class StoryFeedController {

    // ─── Feed Items ───────────────────────────────────────────────────────────

    @AuraEnabled(cacheable=true)
    public static List<FeedItemWrapper> getFeedItems(Id recordId, String filterType) {
        List<FeedItem> items = [
            SELECT Id, Body, CreatedDate, Type,
                   CreatedBy.Name,
                   (SELECT Id, CommentBody, CreatedDate,
                           CreatedBy.Name
                    FROM FeedComments
                    ORDER BY CreatedDate ASC)
            FROM FeedItem
            WHERE ParentId = :recordId
            ORDER BY CreatedDate DESC
            LIMIT 100
        ];

        List<FeedItemWrapper> results = new List<FeedItemWrapper>();
        for (FeedItem fi : items) {
            if (filterType == 'DECISIONS' && !bodyHasTag(fi.Body, '[DECISION]')) continue;
            if (filterType == 'BLOCKERS'  && !bodyHasTag(fi.Body, '[BLOCKER]'))  continue;
            if (filterType == 'FILES'     && fi.Type != 'ContentPost')            continue;
            results.add(new FeedItemWrapper(fi));
        }
        return results;
    }

    @AuraEnabled
    public static FeedItemWrapper createPost(Id recordId, String body) {
        FeedItem fi = new FeedItem(ParentId = recordId, Body = body);
        insert fi;
        fi = [
            SELECT Id, Body, CreatedDate, Type,
                   CreatedBy.Name
            FROM FeedItem WHERE Id = :fi.Id
        ];
        return new FeedItemWrapper(fi);
    }

    @AuraEnabled
    public static FeedCommentWrapper createReply(Id feedItemId, String body) {
        FeedComment fc = new FeedComment(FeedItemId = feedItemId, CommentBody = body);
        insert fc;
        fc = [
            SELECT Id, CommentBody, CreatedDate,
                   CreatedBy.Name
            FROM FeedComment WHERE Id = :fc.Id
        ];
        return new FeedCommentWrapper(fc);
    }

    // ─── Stories By Sprint Week ───────────────────────────────────────────────

    @AuraEnabled(cacheable=true)
    public static List<Case> getStoriesBySprintWeek(Integer sprintWeek) {
        return [
            SELECT Id, Subject, Status, Priority,
                   Sprint_Week__c, Stage__c, Department__c,
                   Priority_Number__c, CreatedDate
            FROM Case
            WHERE Sprint_Week__c = :sprintWeek
            AND Status != 'Closed'
            ORDER BY Priority_Number__c ASC NULLS LAST
            LIMIT 50
        ];
    }

    // ─── All Stories ──────────────────────────────────────────────────────────

    @AuraEnabled(cacheable=true)
    public static List<Case> getAllStories() {
        return [
            SELECT Id, Subject, Status, Priority,
                   Sprint_Week__c, Stage__c, Department__c,
                   Priority_Number__c, CreatedDate
            FROM Case
            WHERE Status != 'Closed'
            ORDER BY Priority_Number__c ASC NULLS LAST
            LIMIT 200
        ];
    }

    // ─── Current Sprint Week ──────────────────────────────────────────────────

    @AuraEnabled(cacheable=true)
    public static Integer getCurrentSprintWeek() {
        List<Case> cases = [
            SELECT Sprint_Week__c
            FROM Case
            WHERE Status != 'Closed'
            AND Sprint_Week__c != null
            ORDER BY Sprint_Week__c ASC
            LIMIT 1
        ];
        if (!cases.isEmpty() && cases[0].Sprint_Week__c != null) {
            return cases[0].Sprint_Week__c.intValue();
        }
        return 1;
    }

    // ─── Story Details ────────────────────────────────────────────────────────

    @AuraEnabled
    public static StoryDetailWrapper getStoryDetails(Id recordId) {
        Case c = [
            SELECT Id, Subject, Status, Priority, Department__c,
                   Stage__c, Planned_Completion_Date__c,
                   Sprint_Week__c, OwnerId, Owner.Name,
                   ContactId, Contact.Name, CaseNumber, Description
            FROM Case
            WHERE Id = :recordId
            LIMIT 1
        ];
        return new StoryDetailWrapper(c);
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    private static Boolean bodyHasTag(String body, String tag) {
        return body != null && body.toUpperCase().contains(tag.toUpperCase());
    }

    // ─── Wrappers ─────────────────────────────────────────────────────────────

    public class TrackedChangeWrapper {
        @AuraEnabled public String fieldName;
        @AuraEnabled public String oldValue;
        @AuraEnabled public String newValue;

        public TrackedChangeWrapper(String fieldName, String oldValue, String newValue) {
            this.fieldName = fieldName;
            this.oldValue  = String.isNotBlank(oldValue) ? oldValue : '—';
            this.newValue  = String.isNotBlank(newValue) ? newValue : '—';
        }
    }

    // Parses {"fu":[{"fn":"Status","ov":"Old","nv":"New"}]} from TrackedChange body
    private static List<TrackedChangeWrapper> parseTrackedChanges(String body) {
        List<TrackedChangeWrapper> changes = new List<TrackedChangeWrapper>();
        if (String.isBlank(body)) return changes;
        try {
            Map<String, Object> root = (Map<String, Object>) JSON.deserializeUntyped(body);
            List<Object> fu = (List<Object>) root.get('fu');
            if (fu == null) return changes;
            for (Object item : fu) {
                Map<String, Object> change = (Map<String, Object>) item;
                String fn = (String) change.get('fn');
                String ov = change.get('ov') != null ? String.valueOf(change.get('ov')) : null;
                String nv = change.get('nv') != null ? String.valueOf(change.get('nv')) : null;
                // Skip internal/system fields
                if (fn == null || fn.startsWith('feedEvent') || fn == 'feedEvent') continue;
                // Clean up field name — remove object prefix (e.g. "Case.Status" → "Status")
                if (fn.contains('.')) fn = fn.substringAfter('.');
                // Skip ID-looking values (Salesforce IDs are 15/18 char alphanumeric)
                if (ov != null && ov.length() == 18 && ov.startsWith('005')) continue;
                changes.add(new TrackedChangeWrapper(fn, ov, nv));
            }
        } catch(Exception e) {
            System.debug('parseTrackedChanges error: ' + e.getMessage());
        }
        return changes;
    }

    public class FeedItemWrapper {
        @AuraEnabled public String  id;
        @AuraEnabled public String  body;
        @AuraEnabled public String  authorName;
        @AuraEnabled public String  createdDate;
        @AuraEnabled public String  postType;
        @AuraEnabled public List<FeedCommentWrapper> replies;
        @AuraEnabled public List<TrackedChangeWrapper> trackedChanges;

        public FeedItemWrapper(FeedItem fi) {
            this.id          = fi.Id;
            this.body        = fi.Body;
            this.authorName  = fi.CreatedBy.Name;
            this.createdDate = fi.CreatedDate.format('MMM d \'at\' h:mm a');
            this.postType    = resolveType(fi.Body, fi.Type);
            this.replies     = new List<FeedCommentWrapper>();
            if (fi.FeedComments != null) {
                for (FeedComment fc : fi.FeedComments) {
                    this.replies.add(new FeedCommentWrapper(fc));
                }
            }
            this.trackedChanges = fi.Type == 'TrackedChange'
                ? parseTrackedChanges(fi.Body)
                : new List<TrackedChangeWrapper>();
            // If TrackedChange but parsing returned nothing, add a generic entry
            if (fi.Type == 'TrackedChange' && this.trackedChanges.isEmpty()) {
                this.trackedChanges.add(new TrackedChangeWrapper('Update', null, 'Field updated'));
            }
        }

        private String resolveType(String body, String sfType) {
            if (sfType == 'TrackedChange')  return 'TRACKED_CHANGE';
            if (sfType == 'ContentPost')    return 'FILE';
            if (bodyHasTag(body, '[DECISION]')) return 'DECISION';
            if (bodyHasTag(body, '[BLOCKER]'))  return 'BLOCKER';
            return 'STANDARD';
        }
    }

    public class FeedCommentWrapper {
        @AuraEnabled public String id;
        @AuraEnabled public String body;
        @AuraEnabled public String authorName;
        @AuraEnabled public String createdDate;

        public FeedCommentWrapper(FeedComment fc) {
            this.id          = fc.Id;
            this.body        = fc.CommentBody;
            this.authorName  = fc.CreatedBy.Name;
            this.createdDate = fc.CreatedDate.format('MMM d \'at\' h:mm a');
        }
    }

    public class StoryDetailWrapper {
        @AuraEnabled public String id;
        @AuraEnabled public String caseNumber;
        @AuraEnabled public String subject;
        @AuraEnabled public String status;
        @AuraEnabled public String priority;
        @AuraEnabled public String department;
        @AuraEnabled public String stage;
        @AuraEnabled public String plannedCompletion;
        @AuraEnabled public String sprintWeek;
        @AuraEnabled public String description;
        @AuraEnabled public String ownerName;
        @AuraEnabled public String contactName;

        public StoryDetailWrapper(Case c) {
            this.id                = c.Id;
            this.caseNumber        = c.CaseNumber;
            this.subject           = c.Subject;
            this.status            = c.Status;
            this.priority          = c.Priority;
            this.department        = c.Department__c;
            this.stage             = c.Stage__c;
            this.description       = c.Description;
            this.plannedCompletion = c.Planned_Completion_Date__c != null
                                     ? c.Planned_Completion_Date__c.format()
                                     : null;
            this.sprintWeek        = c.Sprint_Week__c != null
                                     ? 'Week ' + String.valueOf(c.Sprint_Week__c.intValue())
                                     : null;
            this.ownerName         = c.Owner.Name;
            this.contactName       = c.Contact != null ? c.Contact.Name : null;
        }
    }
}