// force-app/main/default/classes/ContractorBoardController.cls
public with sharing class ContractorBoardController {

    // ── Wrapper Classes ───────────────────────────────────────────────────────

    public class AttachmentWrapper {
        @AuraEnabled public String contentDocumentId;
        @AuraEnabled public String title;
        @AuraEnabled public String fileExtension;
        @AuraEnabled public Long   contentSize;
        @AuraEnabled public String contentVersionId;
        @AuraEnabled public String downloadUrl;
    }

    public class ChatMessageWrapper {
        @AuraEnabled public String  id;
        @AuraEnabled public String  authorName;
        @AuraEnabled public String  body;
        @AuraEnabled public String  createdDate;
        @AuraEnabled public Boolean isMine;
    }

    public class UserOption {
        @AuraEnabled public String id;
        @AuraEnabled public String name;
    }

    // ── Read ──────────────────────────────────────────────────────────────────

    // Returns only projects where the running user has stories assigned to them
    @AuraEnabled(cacheable=true)
    public static List<Sprint__c> getProjectsForUser() {
        Id uid = UserInfo.getUserId();
        Set<Id> projIds = new Set<Id>();
        for (Case c : [
            SELECT Projects__c
            FROM   Case
            WHERE  Projects__c != null
            AND    (OwnerId = :uid OR Story_Support__c = :uid)
        ]) {
            projIds.add(c.Projects__c);
        }
        if (projIds.isEmpty()) return new List<Sprint__c>();
        return [
            SELECT Id, Name
            FROM   Sprint__c
            WHERE  Id IN :projIds
            ORDER BY Name
        ];
    }

    @AuraEnabled(cacheable=true)
    public static List<Case> getStories(String projectId) {
        Id uid = UserInfo.getUserId();

        String q =
            'SELECT Id, CaseNumber, Subject, Description, Status, Priority, Type, ' +
            'Sprint_Week__c, Projects__c, Projects__r.Name, Epic__c, Epic__r.Name, ' +
            'Hours_Estimate_to_Complete__c, Actual_Hours_to_Complete__c, ' +
            'OwnerId, Owner.Name, Story_Support__c, CreatedDate ' +
            'FROM Case ' +
            'WHERE Status NOT IN (\'Cancelled\') ' +
            'AND (OwnerId = \'' + uid + '\' OR Story_Support__c = \'' + uid + '\') ';

        if (String.isNotBlank(projectId)) {
            q += 'AND Projects__c = \'' + String.escapeSingleQuotes(projectId) + '\' ';
        }
        q += 'ORDER BY CreatedDate DESC LIMIT 500';

        return Database.query(q);
    }

    @AuraEnabled(cacheable=true)
    public static List<Time__c> getTimeEntries(String caseId) {
        return [
            SELECT Id, Minutes_Logged__c, Additional_Comments__c,
                   Logged_Date__c, CreatedBy.Name
            FROM   Time__c
            WHERE  Case__c = :caseId
            ORDER BY Logged_Date__c DESC, CreatedDate DESC
            LIMIT 100
        ];
    }

    @AuraEnabled(cacheable=true)
    public static List<CaseComment> getNextSteps(String caseId) {
        return [
            SELECT Id, CommentBody, CreatedDate, CreatedBy.Name
            FROM   CaseComment
            WHERE  ParentId = :caseId
            ORDER BY CreatedDate ASC
            LIMIT 200
        ];
    }

    @AuraEnabled(cacheable=true)
    public static List<ChatMessageWrapper> getChatMessages(String caseId) {
        Id uid = UserInfo.getUserId();
        List<ChatMessageWrapper> result = new List<ChatMessageWrapper>();
        List<FeedItem> items = [
            SELECT Id, Body, CreatedById, CreatedBy.Name, CreatedDate
            FROM   FeedItem
            WHERE  ParentId = :caseId
            AND    Type     = 'TextPost'
            ORDER BY CreatedDate ASC
            LIMIT 200
        ];
        for (FeedItem fi : items) {
            ChatMessageWrapper w = new ChatMessageWrapper();
            w.id          = fi.Id;
            w.authorName  = fi.CreatedBy.Name;
            w.body        = fi.Body != null ? fi.Body : '';
            w.createdDate = fi.CreatedDate != null
                ? fi.CreatedDate.format('M/d h:mm a')
                : '';
            w.isMine = (fi.CreatedById == uid);
            result.add(w);
        }
        return result;
    }

    @AuraEnabled(cacheable=true)
    public static List<AttachmentWrapper> getAttachments(String caseId) {
        List<AttachmentWrapper> result = new List<AttachmentWrapper>();
        for (ContentDocumentLink l : [
            SELECT ContentDocumentId,
                   ContentDocument.Title,
                   ContentDocument.FileExtension,
                   ContentDocument.ContentSize,
                   ContentDocument.LatestPublishedVersionId
            FROM   ContentDocumentLink
            WHERE  LinkedEntityId = :caseId
            ORDER BY ContentDocument.CreatedDate DESC
        ]) {
            AttachmentWrapper w = new AttachmentWrapper();
            w.contentDocumentId  = l.ContentDocumentId;
            w.title              = l.ContentDocument.Title;
            w.fileExtension      = l.ContentDocument.FileExtension;
            w.contentSize        = l.ContentDocument.ContentSize;
            w.contentVersionId   = l.ContentDocument.LatestPublishedVersionId;
            w.downloadUrl        = '/sfc/servlet.shepherd/document/download/' + l.ContentDocumentId;
            result.add(w);
        }
        return result;
    }

    @AuraEnabled(cacheable=true)
    public static List<UserOption> searchUsers(String searchTerm) {
        String term = '%' + searchTerm + '%';
        List<UserOption> opts = new List<UserOption>();
        for (User u : [
            SELECT Id, Name
            FROM   User
            WHERE  IsActive = true
            AND    Name LIKE :term
            ORDER BY Name
            LIMIT 10
        ]) {
            UserOption o = new UserOption();
            o.id   = u.Id;
            o.name = u.Name;
            opts.add(o);
        }
        return opts;
    }

    // ── Write ─────────────────────────────────────────────────────────────────

    @AuraEnabled
    public static void postChatMessage(String caseId, String message) {
        if (String.isBlank(caseId) || String.isBlank(message)) {
            throw new AuraHandledException('Message and case ID are required.');
        }
        FeedItem fi = new FeedItem();
        fi.ParentId = caseId;
        fi.Body     = message.trim();
        fi.Type     = 'TextPost';
        insert fi;
    }

    @AuraEnabled
    public static void logTime(String caseId, Decimal hours, String description) {
        if (String.isBlank(caseId) || hours == null || hours <= 0) {
            throw new AuraHandledException('Hours must be greater than 0.');
        }
        // Fetch Epic from the Case so we can stamp it on the Time record
        Case c = [SELECT Epic__c FROM Case WHERE Id = :caseId LIMIT 1];
        if (c.Epic__c == null) {
            throw new AuraHandledException('This story must be assigned to an Epic before time can be logged. Please contact your project manager.');
        }

        Time__c t              = new Time__c();
        t.Case__c              = caseId;
        t.Epic__c              = c.Epic__c;
        t.Minutes_Logged__c    = hours * 60;
        t.Additional_Comments__c = description;
        t.Logged_Date__c       = Date.today();
        insert t;
    }

    @AuraEnabled
    public static void addNextStep(String caseId, String text) {
        if (String.isBlank(caseId) || String.isBlank(text)) {
            throw new AuraHandledException('Comment text is required.');
        }
        CaseComment cc  = new CaseComment();
        cc.ParentId     = caseId;
        cc.CommentBody  = text.trim();
        cc.IsPublished  = false;
        insert cc;
    }

    @AuraEnabled
    public static String createStory(String subject, String description,
                                     String priority, String projectId,
                                     String storyType) {
        if (String.isBlank(subject)) {
            throw new AuraHandledException('Subject is required.');
        }
        Case c         = new Case();
        c.Subject      = subject;
        c.Description  = description;
        c.Priority     = String.isNotBlank(priority) ? priority : 'Medium';
        c.Status       = 'New';
        if (String.isNotBlank(projectId)) c.Projects__c = projectId;
        if (String.isNotBlank(storyType)) c.Type        = storyType;

        Database.DMLOptions dml = new Database.DMLOptions();
        dml.assignmentRuleHeader.useDefaultRule = false;
        Database.insert(c, dml);

        Case inserted = [SELECT Id, CaseNumber FROM Case WHERE Id = :c.Id LIMIT 1];
        return inserted.CaseNumber;
    }

    @AuraEnabled
    public static String uploadAttachment(String caseId, String fileName,
                                          String base64Data, String contentType) {
        if (String.isBlank(caseId) || String.isBlank(base64Data)) {
            throw new AuraHandledException('Invalid attachment data.');
        }
        ContentVersion cv    = new ContentVersion();
        cv.Title             = fileName;
        cv.PathOnClient      = fileName;
        cv.VersionData       = EncodingUtil.base64Decode(base64Data);
        cv.ContentLocation   = 'S';
        insert cv;

        ContentVersion inserted = [
            SELECT ContentDocumentId
            FROM   ContentVersion
            WHERE  Id = :cv.Id
            LIMIT 1
        ];

        ContentDocumentLink lnk  = new ContentDocumentLink();
        lnk.ContentDocumentId   = inserted.ContentDocumentId;
        lnk.LinkedEntityId      = caseId;
        lnk.ShareType           = 'V';
        lnk.Visibility          = 'AllUsers';
        insert lnk;

        return inserted.ContentDocumentId;
    }
}
