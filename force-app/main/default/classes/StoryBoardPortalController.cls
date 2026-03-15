public without sharing class StoryBoardPortalController {

    // ── Get Stories ───────────────────────────────────────────────────────
    @AuraEnabled(cacheable=true)
    public static List<Case> getStories(Id projectId, Id epicId) {
        // Resolve the running user's Contact → Account
        List<User> users = [SELECT ContactId FROM User WHERE Id = :UserInfo.getUserId() LIMIT 1];
        if (users.isEmpty() || users[0].ContactId == null) return new List<Case>();

        List<Contact> contacts = [SELECT AccountId FROM Contact WHERE Id = :users[0].ContactId LIMIT 1];
        if (contacts.isEmpty() || contacts[0].AccountId == null) return new List<Case>();

        Id accountId = contacts[0].AccountId;

        String q =
            'SELECT Id, CaseNumber, Subject, Status, Priority, Type, Department__c, ' +
            'CreatedDate, Description, Projects__c, ' +
            'Hours_Estimate_to_Complete__c, OwnerId, Owner.Name, Projects__r.Name, ' +
            'Epic__c, Epic__r.Name, ContactId, Contact.Name, ' +
            'Story_Support__c, Support_Message_Pending__c, ' +
            'Solution__c, Components_to_Deploy__c, Q_A__c, Documentation__c, Closing_Comments__c ' +
            'FROM Case';

        List<String> filters = new List<String>{
            'Subject NOT IN (\'Meetings\', \'Project Management\', \'Helpdesk\')',
            'Projects__c IN (SELECT Id FROM Sprint__c WHERE Accountlu__c = \'' + accountId + '\' AND Status__c = \'In Progress\')'
        };
        if (projectId != null) {
            filters.add('Projects__c = \'' + projectId + '\'');
        }
        if (epicId != null) {
            filters.add('Epic__c = \'' + epicId + '\'');
        }
        if (!filters.isEmpty()) {
            q += ' WHERE ' + String.join(filters, ' AND ');
        }
        q += ' ORDER BY CreatedDate DESC LIMIT 500';

        return Database.query(q);
    }

    // ── Get Projects (scoped to the portal user's Account) ───────────────
    @AuraEnabled(cacheable=true)
    public static List<Sprint__c> getProjects() {
        // Resolve the running user's Contact → Account
        List<User> users = [SELECT ContactId FROM User WHERE Id = :UserInfo.getUserId() LIMIT 1];
        if (users.isEmpty() || users[0].ContactId == null) return new List<Sprint__c>();

        List<Contact> contacts = [SELECT AccountId FROM Contact WHERE Id = :users[0].ContactId LIMIT 1];
        if (contacts.isEmpty() || contacts[0].AccountId == null) return new List<Sprint__c>();

        Id accountId = contacts[0].AccountId;
        return [
            SELECT Id, Name, OwnerId
            FROM Sprint__c
            WHERE Accountlu__c = :accountId
            AND   Status__c    = 'In Progress'
            ORDER BY Name ASC
            LIMIT 100
        ];
    }

    // ── Get Attachments (read-only) ───────────────────────────────────────
    public class AttachmentWrapper {
        @AuraEnabled public Id      contentDocumentId;
        @AuraEnabled public Id      latestVersionId;
        @AuraEnabled public String  title;
        @AuraEnabled public String  fileExtension;
        @AuraEnabled public Long    sizeBytes;
        @AuraEnabled public Boolean isImage;
        @AuraEnabled public String  downloadUrl;
    }

    @AuraEnabled(cacheable=false)
    public static List<AttachmentWrapper> getAttachments(Id caseId) {
        List<AttachmentWrapper> result = new List<AttachmentWrapper>();
        for (ContentDocumentLink cdl : [
            SELECT ContentDocument.Id, ContentDocument.Title,
                   ContentDocument.FileExtension, ContentDocument.ContentSize,
                   ContentDocument.LatestPublishedVersionId
            FROM   ContentDocumentLink
            WHERE  LinkedEntityId = :caseId
            ORDER BY ContentDocument.CreatedDate DESC
            LIMIT  25
        ]) {
            AttachmentWrapper w   = new AttachmentWrapper();
            w.contentDocumentId   = cdl.ContentDocument.Id;
            w.latestVersionId     = cdl.ContentDocument.LatestPublishedVersionId;
            w.title               = cdl.ContentDocument.Title;
            w.fileExtension       = (cdl.ContentDocument.FileExtension ?? '').toLowerCase();
            w.sizeBytes           = cdl.ContentDocument.ContentSize;
            w.isImage             = new Set<String>{'jpg','jpeg','png','gif','webp','svg','bmp'}.contains(w.fileExtension);
            w.downloadUrl         = '/sfc/servlet.shepherd/version/download/' + w.latestVersionId;
            result.add(w);
        }
        return result;
    }
}
